function Export-AssessmentBaseline {
    <#
    .SYNOPSIS
        Saves a named baseline snapshot of all security-config collector results.
    .DESCRIPTION
        Reads all security-config CSVs (those containing CheckId and Status columns)
        from the current assessment folder and serialises them to JSON in a labelled
        baseline directory under <OutputFolder>/Baselines/<Label>_<TenantId>/.
        A metadata file records the label, tenant, version, sections run, and
        timestamp so that Compare-AssessmentBaseline can validate compatibility.
    .PARAMETER AssessmentFolder
        Path to the completed assessment output folder.
    .PARAMETER OutputFolder
        Root output folder (parent of Baselines/). Typically the -OutputFolder
        value passed to Invoke-M365Assessment.
    .PARAMETER Label
        Human-readable baseline label (e.g. 'Q1-2026'). Used as the folder name
        prefix and referenced with -CompareBaseline on future runs.
    .PARAMETER TenantId
        Tenant identifier passed in (GUID, vanity domain, or .onmicrosoft.com).
        Recorded in the manifest as the user-facing label. Falls back to the
        folder-key suffix when TenantGuid is not supplied (legacy callers).
    .PARAMETER TenantGuid
        Canonical tenant GUID (from Get-MgContext.TenantId via
        Resolve-TenantIdentity). When supplied, the baseline folder is named
        '<Label>_<TenantGuid>' so the same tenant referenced multiple ways
        produces a single folder (C1 #780). Friendly TenantId is preserved
        in the manifest for display.
    .PARAMETER DisplayName
        Tenant display name (Get-MgOrganization.DisplayName). Manifest only.
    .PARAMETER PrimaryDomain
        Primary verified domain (Get-MgOrganization.VerifiedDomains.IsDefault).
        Manifest only.
    .PARAMETER Environment
        Cloud environment string (commercial / gcc / gcchigh / dod). Manifest only.
    .PARAMETER Sections
        Array of section names that were assessed (recorded in metadata).
    .PARAMETER Version
        Assessment module version string (e.g. '1.15.0') recorded in metadata.
    .PARAMETER RegistryVersion
        Registry data version string (from controls/registry.json dataVersion)
        recorded in metadata to enable version-aware drift comparison.
    .EXAMPLE
        Export-AssessmentBaseline -AssessmentFolder $assessmentFolder `
            -OutputFolder '.\M365-Assessment' -Label 'Q1-2026' -TenantId 'contoso.com' `
            -TenantGuid '00000000-0000-0000-0000-000000000000'
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$AssessmentFolder,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$OutputFolder,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Label,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter()]
        [string]$TenantGuid = '',

        [Parameter()]
        [string]$DisplayName = '',

        [Parameter()]
        [string]$PrimaryDomain = '',

        [Parameter()]
        [string]$Environment = '',

        [Parameter()]
        [string[]]$Sections = @(),

        [Parameter()]
        [string]$Version = '',

        [Parameter()]
        [string]$RegistryVersion = ''
    )

    # Sanitise label for use as a folder name
    $safeLabel = $Label -replace '[^\w\-]', '_'

    # C1 #780: prefer the canonical GUID as the folder-key suffix. When the
    # caller hasn't resolved one (legacy callers, AD-only runs without Graph),
    # fall back to the user-supplied TenantId so behavior matches pre-v2.9.0.
    $folderSuffix = if ($TenantGuid) {
        $TenantGuid -replace '[^\w\-]', ''
    } else {
        $TenantId -replace '[^\w\.\-]', '_'
    }
    $baselineDir = Join-Path -Path $OutputFolder -ChildPath "Baselines\${safeLabel}_${folderSuffix}"

    if (-not (Test-Path -Path $baselineDir -PathType Container)) {
        $null = New-Item -Path $baselineDir -ItemType Directory -Force
    }

    # Copy each security-config CSV as JSON (identified by having CheckId + Status columns)
    $csvFiles = Get-ChildItem -Path $AssessmentFolder -Filter '*.csv' -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notlike '_*' }

    $saved = 0
    $checkCount = 0
    foreach ($csvFile in $csvFiles) {
        try {
            $rows = Import-Csv -Path $csvFile.FullName -ErrorAction Stop
            if (-not $rows) { continue }
            $firstRow = $rows | Select-Object -First 1
            $props = $firstRow.PSObject.Properties.Name
            # Only baseline security-config tables (must have both CheckId and Status)
            if ('CheckId' -notin $props -or 'Status' -notin $props) { continue }

            $jsonName = [System.IO.Path]::GetFileNameWithoutExtension($csvFile.Name) + '.json'
            $jsonPath = Join-Path -Path $baselineDir -ChildPath $jsonName
            $rows | ConvertTo-Json -Depth 5 | Set-Content -Path $jsonPath -Encoding UTF8
            $checkCount += @($rows).Count
            $saved++
        }
        catch {
            Write-Warning "Baseline: skipped '$($csvFile.Name)': $_"
        }
    }

    $decisionPath = Join-Path -Path $AssessmentFolder -ChildPath '_Assessment-Decisions.json'
    $savedDecisions = Join-Path -Path $baselineDir -ChildPath '_Assessment-Decisions.json'
    if (Test-Path -LiteralPath $decisionPath) { Copy-Item -LiteralPath $decisionPath -Destination $savedDecisions -Force }
    elseif (Test-Path -LiteralPath $savedDecisions) { Remove-Item -LiteralPath $savedDecisions -Force }
    # Write manifest after CSV scan (includes accurate CheckCount).
    # C1 #780: enriched identity fields (TenantGuid + DisplayName + PrimaryDomain
    # + Environment) live alongside the legacy TenantId. Older readers ignore
    # the new fields; new readers use TenantGuid as the canonical key.
    $manifest = [PSCustomObject]@{
        Label             = $Label
        SavedAt           = (Get-Date -Format 'o')
        TenantId          = $TenantId
        TenantGuid        = $TenantGuid
        DisplayName       = $DisplayName
        PrimaryDomain     = $PrimaryDomain
        Environment       = $Environment
        AssessmentVersion = $Version
        RegistryVersion   = $RegistryVersion
        CheckCount        = $checkCount
        Sections          = $Sections
    }
    $manifestPath = Join-Path -Path $baselineDir -ChildPath 'manifest.json'
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -Path $manifestPath -Encoding UTF8

    Write-Verbose "Baseline '$Label' saved to '$baselineDir' ($saved collector files, $checkCount checks)"
    return $baselineDir
}
