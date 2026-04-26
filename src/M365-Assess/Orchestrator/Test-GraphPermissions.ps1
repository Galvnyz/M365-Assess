<#
.SYNOPSIS
    Validates Graph API permissions after connection against required permissions.
.DESCRIPTION
    For delegated auth, compares granted scopes from Get-MgContext against the
    scopes required by selected assessment sections (sectionScopeMap).

    For app-only auth (B2 #773), queries the running app's service principal
    appRoleAssignments and compares against the per-section app permissions
    declared in Setup/PermissionDefinitions.ps1. Both paths emit per-section
    deficit warnings before collectors run, so users know which sections may
    produce incomplete results.
#>

# B2 #773: dot-source PermissionDefinitions for the per-section app-role map.
# Same source of truth as Grant-M365AssessConsent and the generated
# docs/PERMISSIONS.md (B7 #778). Idempotent re-source on each load.
. (Join-Path -Path $PSScriptRoot -ChildPath '..\Setup\PermissionDefinitions.ps1')

function Write-PermissionDeficitsFile {
    <#
    .SYNOPSIS
        Writes _PermissionDeficits.json with structured per-section deficit data.
    .DESCRIPTION
        Companion to Test-GraphAppRolePermissions / Test-GraphPermissions
        (#812 B2 followup). The HTML report's Permissions panel and the evidence
        package both consume this file. The shape is forward-compatible -- new
        keys can be added without breaking older readers.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$OutputFolder,
        [Parameter(Mandatory)] [ValidateSet('Delegated', 'AppOnly')] [string]$AuthMode,
        [Parameter(Mandatory)] [string[]]$ActiveSections,
        [Parameter()] [object]$RequiredRoles,   # HashSet[string] or [string[]]
        [Parameter()] [object]$GrantedRoles,    # HashSet[string] or [string[]]
        [Parameter()] [object]$MissingByRole = @(),
        [Parameter()] [hashtable]$PerSection = @{}
    )

    $reqArr = @($RequiredRoles | Where-Object { $_ })
    $grtArr = @($GrantedRoles  | Where-Object { $_ })
    $missArr = @($MissingByRole | Where-Object { $_ })

    # Per-section view: which roles each section needs, and which are missing.
    $sectionDeficits = [ordered]@{}
    foreach ($s in ($ActiveSections | Sort-Object -Unique)) {
        $required = if ($PerSection.ContainsKey($s)) { @($PerSection[$s]) } else { @() }
        $missing  = @($required | Where-Object { $missArr -icontains $_ })
        $sectionDeficits[$s] = [ordered]@{
            required = $required
            missing  = $missing
            ok       = ($missing.Count -eq 0)
        }
    }

    $payload = [ordered]@{
        schemaVersion  = '1.0'
        authMode       = $AuthMode
        generatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        activeSections = $ActiveSections
        required       = $reqArr
        granted        = $grtArr
        missing        = $missArr
        sections       = $sectionDeficits
    }
    $path = Join-Path -Path $OutputFolder -ChildPath '_PermissionDeficits.json'
    $payload | ConvertTo-Json -Depth 6 | Set-Content -Path $path -Encoding UTF8
    Write-AssessmentLog -Level INFO -Message "Wrote permission deficit map: $path" -Section 'Setup'
}

function Test-GraphAppRolePermissions {
    <#
    .SYNOPSIS
        Validates app-only Graph permissions by querying the running SP's
        app-role assignments and comparing against per-section requirements.
    .DESCRIPTION
        Used by Test-GraphPermissions when app-only auth is detected. Reads
        $script:RequiredGraphPermissions from PermissionDefinitions.ps1
        (which has Sections annotations on every permission) and inverts to
        a per-section view; queries the SP's appRoleAssignments via Graph;
        resolves role IDs to permission names through the Microsoft Graph
        SP's appRoles collection; reports missing roles per active section.

        Failures to query (e.g., the app lacks Application.Read.All to
        introspect itself) produce an explicit "could not verify" warning,
        not silence. AC for B2 #773.
    .PARAMETER Context
        The Get-MgContext output for the current Graph connection.
    .PARAMETER ActiveSections
        Section names the user selected for this run.
    .PARAMETER OutputFolder
        Optional. When supplied, writes _PermissionDeficits.json into this folder
        with the structured deficit map so the HTML report's Permissions panel
        and the evidence package can surface it (#812 B2 followup).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [object]$Context,

        [Parameter(Mandatory)]
        [string[]]$ActiveSections,

        [Parameter()]
        [string]$OutputFolder
    )

    $clientId = $Context.ClientId
    if (-not $clientId) {
        Write-Host '    i App-only auth detected but no ClientId in context -- cannot validate app roles.' -ForegroundColor Yellow
        Write-AssessmentLog -Level WARN -Message 'App-role validation skipped: ClientId missing from Graph context' -Section 'Setup'
        return
    }

    # Build per-section app-role requirements from the shared definitions.
    $perSection = @{}
    foreach ($entry in $script:RequiredGraphPermissions) {
        $sections = $entry.Sections -split ',' | ForEach-Object { $_.Trim() }
        foreach ($s in $sections) {
            if (-not $perSection.ContainsKey($s)) {
                $perSection[$s] = [System.Collections.Generic.List[string]]::new()
            }
            $perSection[$s].Add($entry.Name)
        }
    }

    # Required permissions for the selected sections (deduplicated, case-insensitive).
    $requiredRoles = New-Object -TypeName System.Collections.Generic.HashSet[string] -ArgumentList @([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($s in $ActiveSections) {
        if ($perSection.ContainsKey($s)) {
            foreach ($p in $perSection[$s]) { [void]$requiredRoles.Add($p) }
        }
    }

    if ($requiredRoles.Count -eq 0) {
        Write-Host '    i App-only auth: no Graph app roles required for the selected sections.' -ForegroundColor DarkGray
        return
    }

    # Query the running SP's app-role assignments and resolve role IDs through
    # the Microsoft Graph SP's appRoles collection. Wrapped in try/catch so
    # the structured "could not verify" warning fires on any failure.
    try {
        $sp = Get-MgServicePrincipal -Filter "appId eq '$clientId'" -Top 1 -ErrorAction Stop
        if (-not $sp) {
            Write-Host "    ! App-only auth: could not locate service principal for ClientId '$clientId'." -ForegroundColor Yellow
            Write-AssessmentLog -Level WARN -Message 'App-role validation skipped: SP lookup returned no results' -Section 'Setup'
            return
        }

        $assignments = @(Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -All -ErrorAction Stop)

        $graphSp = Get-MgServicePrincipal -Filter "appId eq '00000003-0000-0000-c000-000000000000'" -Top 1 -ErrorAction Stop
        if (-not $graphSp) {
            Write-Host '    ! App-only auth: Microsoft Graph SP not resolvable -- cannot map role IDs to names.' -ForegroundColor Yellow
            Write-AssessmentLog -Level WARN -Message 'App-role validation skipped: Microsoft Graph SP not found' -Section 'Setup'
            return
        }

        $roleById = @{}
        foreach ($r in $graphSp.AppRoles) {
            $roleById[[string]$r.Id] = $r.Value
        }

        $grantedRoles = New-Object -TypeName System.Collections.Generic.HashSet[string] -ArgumentList @([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($a in $assignments) {
            if ($a.ResourceId -eq $graphSp.Id) {
                $name = $roleById[[string]$a.AppRoleId]
                if ($name) { [void]$grantedRoles.Add($name) }
            }
        }

        $missing = @($requiredRoles | Where-Object { -not $grantedRoles.Contains($_) })

        if ($missing.Count -eq 0) {
            Write-Host "    $([char]0x2714) All $($requiredRoles.Count) required Graph app role(s) granted" -ForegroundColor Green
            Write-AssessmentLog -Level INFO -Message "Graph app-role validation passed ($($requiredRoles.Count) roles)" -Section 'Setup'
            if ($OutputFolder -and (Test-Path -Path $OutputFolder -PathType Container)) {
                Write-PermissionDeficitsFile -OutputFolder $OutputFolder -AuthMode 'AppOnly' `
                    -ActiveSections $ActiveSections -RequiredRoles $requiredRoles -GrantedRoles $grantedRoles `
                    -MissingByRole @() -PerSection $perSection
            }
            return
        }

        # Map missing roles back to affected sections.
        $affectedSections = @{}
        foreach ($role in $missing) {
            foreach ($s in $ActiveSections) {
                if (-not $perSection.ContainsKey($s)) { continue }
                if ($perSection[$s] | Where-Object { $_ -ieq $role }) {
                    if (-not $affectedSections.ContainsKey($s)) {
                        $affectedSections[$s] = [System.Collections.Generic.List[string]]::new()
                    }
                    $affectedSections[$s].Add($role)
                }
            }
        }

        Write-Host ''
        Write-Host "    $([char]0x26A0) $($missing.Count) Graph app role(s) not granted -- some checks may fail:" -ForegroundColor Yellow
        foreach ($s in $affectedSections.Keys | Sort-Object) {
            $list = ($affectedSections[$s] | Sort-Object) -join ', '
            Write-Host "      ${s}: $list" -ForegroundColor Yellow
        }
        Write-Host '    To fix: Entra ID > App registrations > [your app] > API permissions >' -ForegroundColor DarkGray
        Write-Host '      Add a permission > Microsoft Graph > Application permissions' -ForegroundColor DarkGray
        Write-Host "    Then click 'Grant admin consent for [tenant]' and re-run." -ForegroundColor DarkGray
        Write-Host ''

        Write-AssessmentLog -Level WARN -Message "Missing Graph app roles: $($missing -join ', ')" -Section 'Setup'

        if ($OutputFolder -and (Test-Path -Path $OutputFolder -PathType Container)) {
            Write-PermissionDeficitsFile -OutputFolder $OutputFolder -AuthMode 'AppOnly' `
                -ActiveSections $ActiveSections -RequiredRoles $requiredRoles -GrantedRoles $grantedRoles `
                -MissingByRole $missing -PerSection $perSection
        }
    }
    catch {
        # Structured "could not verify" warning per the AC -- never silent.
        Write-Host "    ! App-only auth: could not validate app roles -- $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host '    This usually means the app lacks Application.Read.All or Directory.Read.All' -ForegroundColor DarkGray
        Write-Host '    (needed to read its own service principal). Add either permission and re-run.' -ForegroundColor DarkGray
        Write-AssessmentLog -Level WARN -Message "App-role validation could not be performed: $($_.Exception.Message)" -Section 'Setup'
    }
}

function Test-GraphPermissions {
    <#
    .SYNOPSIS
        Validates Graph API scopes after connection.
    .DESCRIPTION
        Compares the scopes granted by Get-MgContext against the scopes
        required by the selected assessment sections (from sectionScopeMap).
        Warns about missing scopes before collectors run, so users know
        which sections may produce incomplete results.

        With app-only auth (certificate/managed identity), scopes are
        determined by app registration and Get-MgContext.Scopes may show
        '.default' only. In this case the check is skipped with an
        informational message.
    .PARAMETER RequiredScopes
        Array of Graph scope strings required for the selected sections.
    .PARAMETER SectionScopeMap
        Hashtable mapping section names to their required scope arrays.
    .PARAMETER ActiveSections
        Array of section names the user selected.
    .PARAMETER OutputFolder
        Optional. When supplied, writes _PermissionDeficits.json into this folder
        so the HTML report's Permissions panel and the evidence package can
        surface the deficit map (#812 B2 followup).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string[]]$RequiredScopes,

        [Parameter(Mandatory)]
        [hashtable]$SectionScopeMap,

        [Parameter(Mandatory)]
        [string[]]$ActiveSections,

        [Parameter()]
        [string]$OutputFolder
    )

    $context = Get-MgContext -ErrorAction SilentlyContinue
    if (-not $context) {
        Write-AssessmentLog -Level WARN -Message 'Graph context not available -- skipping scope validation' -Section 'Setup'
        return
    }

    $grantedScopes = @($context.Scopes)

    # App-only auth: delegated scopes are empty / '.default' (B2 #773).
    # Hand off to the app-role validator instead of skipping silently.
    if ($grantedScopes.Count -eq 0 -or ($grantedScopes.Count -eq 1 -and $grantedScopes[0] -eq '.default')) {
        Write-Host '    i App-only auth detected -- validating Graph app role assignments instead of delegated scopes...' -ForegroundColor DarkGray
        Test-GraphAppRolePermissions -Context $context -ActiveSections $ActiveSections -OutputFolder $OutputFolder
        return
    }

    # Compare required vs granted (case-insensitive)
    $grantedLower = $grantedScopes | ForEach-Object { $_.ToLower() }
    $missingScopes = @($RequiredScopes | Where-Object { $_.ToLower() -notin $grantedLower })

    if ($missingScopes.Count -eq 0) {
        Write-Host "    $([char]0x2714) All $($RequiredScopes.Count) required Graph scopes granted" -ForegroundColor Green
        Write-AssessmentLog -Level INFO -Message "Graph scope validation passed ($($RequiredScopes.Count) scopes)" -Section 'Setup'
        if ($OutputFolder -and (Test-Path -Path $OutputFolder -PathType Container)) {
            Write-PermissionDeficitsFile -OutputFolder $OutputFolder -AuthMode 'Delegated' `
                -ActiveSections $ActiveSections -RequiredRoles $RequiredScopes -GrantedRoles $grantedScopes `
                -MissingByRole @() -PerSection $SectionScopeMap
        }
        return
    }

    # Map missing scopes back to affected sections
    $affectedSections = @{}
    foreach ($scope in $missingScopes) {
        foreach ($section in $ActiveSections) {
            if (-not $SectionScopeMap.ContainsKey($section)) { continue }
            $sectionScopes = $SectionScopeMap[$section] | ForEach-Object { $_.ToLower() }
            if ($scope.ToLower() -in $sectionScopes) {
                if (-not $affectedSections.ContainsKey($section)) {
                    $affectedSections[$section] = [System.Collections.Generic.List[string]]::new()
                }
                $affectedSections[$section].Add($scope)
            }
        }
    }

    # Display warnings
    Write-Host ''
    Write-Host "    $([char]0x26A0) $($missingScopes.Count) Graph scope(s) not consented -- some checks may fail:" -ForegroundColor Yellow
    foreach ($section in $affectedSections.Keys | Sort-Object) {
        $scopeList = ($affectedSections[$section] | Sort-Object) -join ', '
        Write-Host "      ${section}: $scopeList" -ForegroundColor Yellow
    }
    if ($context.AuthType -eq 'AppOnly') {
        Write-Host "    To fix: add the missing permission(s) to your app registration, then grant admin consent." -ForegroundColor DarkGray
        Write-Host "    Entra ID > App registrations > [your app] > API permissions >" -ForegroundColor DarkGray
        Write-Host "      Add a permission > Microsoft Graph > Application permissions" -ForegroundColor DarkGray
        Write-Host "    Then click 'Grant admin consent for [tenant]' and re-run." -ForegroundColor DarkGray
    }
    else {
        $scopeArg = ($missingScopes | Sort-Object) -join ','
        Write-Host "    To fix: close this session and re-run the assessment. When the browser opens," -ForegroundColor DarkGray
        Write-Host "    sign in as a Global Admin and click 'Accept' to grant the missing permission(s)." -ForegroundColor DarkGray
        Write-Host "    If consent was already granted by an admin, run in a new PowerShell session:" -ForegroundColor DarkGray
        Write-Host "      Disconnect-MgGraph; Connect-MgGraph -Scopes '$scopeArg'" -ForegroundColor Cyan
    }
    Write-Host ''

    Write-AssessmentLog -Level WARN -Message "Missing Graph scopes: $($missingScopes -join ', ')" -Section 'Setup'

    if ($OutputFolder -and (Test-Path -Path $OutputFolder -PathType Container)) {
        Write-PermissionDeficitsFile -OutputFolder $OutputFolder -AuthMode 'Delegated' `
            -ActiveSections $ActiveSections -RequiredRoles $RequiredScopes -GrantedRoles $grantedScopes `
            -MissingByRole $missingScopes -PerSection $SectionScopeMap
    }
}
