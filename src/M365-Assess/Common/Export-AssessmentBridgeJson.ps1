function Export-AssessmentBridgeJson {
    <#
    .SYNOPSIS
        Writes a structured JSON export of assessment findings for M365-Remediate integration.
    .DESCRIPTION
        Produces _Assessment-<Tenant>.json alongside the HTML and XLSX in the assessment output
        folder. The file contains per-finding structured data, tenant metadata, and domain summary
        counts in a format M365-Remediate can parse to pre-populate its remediation queue.
    .PARAMETER AllFindings
        Array of enriched check rows from Build-SectionHtml (CheckId, Status, RiskSeverity,
        Frameworks, Remediation, CurrentValue, etc.).
    .PARAMETER RegistryData
        Control registry hashtable from Import-ControlRegistry. Used to look up effort ratings.
    .PARAMETER TenantId
        Tenant GUID or domain written to the metadata block.
    .PARAMETER TenantName
        Display name of the tenant.
    .PARAMETER AssessedAt
        ISO 8601 timestamp for when the assessment ran. Defaults to current UTC time.
    .PARAMETER AssessmentVersion
        Semantic version string of M365-Assess that produced this data.
    .PARAMETER RegistryVersion
        Version/date label from registry.json (e.g. '2026-04-20').
    .PARAMETER OutputPath
        Full path for the output JSON file.
    .PARAMETER SensitiveCheckIds
        CheckId patterns (wildcards accepted) whose currentValue should be replaced with
        '[REDACTED]'. Defaults to empty (no redaction).
    .OUTPUTS
        [string] Path of the JSON file written.
    .EXAMPLE
        Export-AssessmentBridgeJson -AllFindings $allCisFindings -RegistryData $controlRegistry `
            -TenantId 'contoso.com' -TenantName 'Contoso' -AssessmentVersion '2.3.0' `
            -RegistryVersion '2026-04-20' -OutputPath 'C:\output\_Assessment-contoso.json'
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [PSCustomObject[]]$AllFindings,

        [Parameter()]
        [hashtable]$RegistryData = @{},

        [Parameter(Mandatory)]
        [string]$TenantId,

        [Parameter()]
        [string]$TenantName = '',

        [Parameter()]
        [string]$AssessedAt = '',

        [Parameter()]
        [string]$AssessmentVersion = '',

        [Parameter()]
        [string]$RegistryVersion = '',

        [Parameter(Mandatory)]
        [string]$OutputPath,

        [Parameter()]
        [string[]]$SensitiveCheckIds = @()
    )

    $findings = foreach ($f in $AllFindings) {
        $baseCheckId = $f.CheckId -replace '\.\d+$', ''
        $regEntry    = if ($RegistryData.ContainsKey($baseCheckId)) { $RegistryData[$baseCheckId] } else { $null }

        $severity = if ($f.RiskSeverity) { $f.RiskSeverity.ToLower() } else { 'medium' }

        $effort = if ($regEntry) {
            $e = if ($regEntry -is [hashtable]) { $regEntry['effort'] } else { $regEntry.effort }
            if ($e) { $e } else { 'medium' }
        } else { 'medium' }

        $fwSource  = if ($f.PSObject.Properties['Frameworks'] -and $f.Frameworks) { $f.Frameworks } else { $null }
        $frameworks = if ($fwSource -is [hashtable])  { [string[]]($fwSource.Keys) }
                      elseif ($fwSource)               { [string[]]($fwSource.PSObject.Properties.Name) }
                      else                             { [string[]]@() }

        $isSensitive = $SensitiveCheckIds.Count -gt 0 -and
            ($SensitiveCheckIds | Where-Object { $f.CheckId -like $_ }).Count -gt 0

        [PSCustomObject]@{
            checkId      = $f.CheckId
            status       = $f.Status
            severity     = $severity
            effort       = $effort
            frameworks   = $frameworks
            currentValue = if ($isSensitive) { '[REDACTED]' } else { $f.CurrentValue }
            remediation  = $f.Remediation
        }
    }

    $domainSummary = [ordered]@{}
    foreach ($f in $AllFindings) {
        $baseId = $f.CheckId -replace '\.\d+$', ''
        $d = switch -Wildcard ($baseId) {
            'CA-*'           { 'Conditional Access';    break }
            'ENTRA-ENTAPP-*' { 'Enterprise Apps';       break }
            'ENTRA-*'        { 'Entra ID';              break }
            'EXO-*'          { 'Exchange Online';       break }
            'DNS-*'          { 'Exchange Online';       break }
            'INTUNE-*'       { 'Intune';                break }
            'DEFENDER-*'     { 'Defender';              break }
            'SPO-*'          { 'SharePoint & OneDrive'; break }
            'TEAMS-*'        { 'Teams';                 break }
            'PURVIEW-*'      { 'Purview / Compliance';  break }
            'DLP-*'          { 'Purview / Compliance';  break }
            'COMPLIANCE-*'   { 'Purview / Compliance';  break }
            default          { 'Other' }
        }
        if (-not $domainSummary.Contains($d)) {
            $domainSummary[$d] = @{ pass = 0; warn = 0; fail = 0; review = 0; total = 0 }
        }
        $bucket = $domainSummary[$d]
        $bucket.total++
        switch ($f.Status) {
            'Pass'    { $bucket.pass++ }
            'Warning' { $bucket.warn++ }
            'Fail'    { $bucket.fail++ }
            'Review'  { $bucket.review++ }
        }
    }

    $bridge = [ordered]@{
        schemaVersion     = '1.0'
        assessedAt        = if ($AssessedAt) { $AssessedAt } else { [datetime]::UtcNow.ToString('o') }
        tenantId          = $TenantId
        tenantName        = $TenantName
        assessmentVersion = $AssessmentVersion
        registryVersion   = $RegistryVersion
        findings          = @($findings)
        domainSummary     = $domainSummary
    }

    $json = $bridge | ConvertTo-Json -Depth 6
    $json = $json -replace '"frameworks":\s*null', '"frameworks": []'
    Set-Content -Path $OutputPath -Value $json -Encoding UTF8
    return $OutputPath
}
