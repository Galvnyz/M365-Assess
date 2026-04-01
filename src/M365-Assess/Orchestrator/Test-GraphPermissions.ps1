<#
.SYNOPSIS
    Validates Graph API scopes after connection against required scopes.
.DESCRIPTION
    Compares granted scopes from Get-MgContext against the scopes
    required by selected assessment sections. Warns about missing
    scopes before collectors run.
#>
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
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string[]]$RequiredScopes,

        [Parameter(Mandatory)]
        [hashtable]$SectionScopeMap,

        [Parameter(Mandatory)]
        [string[]]$ActiveSections
    )

    $context = Get-MgContext -ErrorAction SilentlyContinue
    if (-not $context) {
        Write-AssessmentLog -Level WARN -Message 'Graph context not available -- skipping scope validation' -Section 'Setup'
        return
    }

    $grantedScopes = @($context.Scopes)

    # App-only auth: scopes may be empty or contain only '.default'
    if ($grantedScopes.Count -eq 0 -or ($grantedScopes.Count -eq 1 -and $grantedScopes[0] -eq '.default')) {
        Write-Host '    i App-only auth detected -- scope validation not available (permissions set in app registration)' -ForegroundColor DarkGray
        Write-AssessmentLog -Level INFO -Message 'App-only auth: scope validation skipped (permissions defined in Entra app registration)' -Section 'Setup'
        return
    }

    # Compare required vs granted (case-insensitive)
    $grantedLower = $grantedScopes | ForEach-Object { $_.ToLower() }
    $missingScopes = @($RequiredScopes | Where-Object { $_.ToLower() -notin $grantedLower })

    if ($missingScopes.Count -eq 0) {
        Write-Host "    $([char]0x2714) All $($RequiredScopes.Count) required Graph scopes granted" -ForegroundColor Green
        Write-AssessmentLog -Level INFO -Message "Graph scope validation passed ($($RequiredScopes.Count) scopes)" -Section 'Setup'
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
    Write-Host '    Tip: re-run consent or update app registration to include these scopes' -ForegroundColor DarkGray
    Write-Host ''

    Write-AssessmentLog -Level WARN -Message "Missing Graph scopes: $($missingScopes -join ', ')" -Section 'Setup'
}
