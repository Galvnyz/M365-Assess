function Complete-AssessmentArtifacts {
    <#
    .SYNOPSIS
        Records final artifact hashes after all assessment log writes finish.
    .DESCRIPTION
        Call after report generation and service disconnection. The final log entry
        is written before hashing. Optional evidence packaging and subsequent status
        messages do not append to the sealed assessment log.
    .PARAMETER AssessmentFolder
        Folder containing the completed assessment artifacts.
    .PARAMETER Provenance
        Run metadata for the canonical provenance manifest.
    .PARAMETER EvidencePackage
        Create the optional evidence archive after recording final hashes.
    .PARAMETER Redact
        Apply the existing redaction rules to supported evidence-package files.
    .EXAMPLE
        Complete-AssessmentArtifacts -AssessmentFolder './Assessment' -Provenance $metadata
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$AssessmentFolder,
        [Parameter(Mandatory)][System.Collections.IDictionary]$Provenance,
        [switch]$EvidencePackage,
        [switch]$Redact
    )

    Write-AssessmentLog -Level INFO -Message 'Service cleanup complete. Recording final artifact provenance.'
    $artifactHashes = @(Get-ChildItem -LiteralPath $AssessmentFolder -File -ErrorAction Stop |
        Where-Object Name -ne '_Assessment-Provenance.json' |
        Sort-Object Name | ForEach-Object {
            [ordered]@{
                name = $_.Name
                bytes = $_.Length
                sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256 -ErrorAction Stop).Hash
            }
        })
    $Provenance['generatedAtUtc'] = (Get-Date).ToUniversalTime().ToString('o')
    $Provenance['outputArtifacts'] = $artifactHashes
    $provenancePath = Join-Path -Path $AssessmentFolder -ChildPath '_Assessment-Provenance.json'
    $Provenance | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $provenancePath -Encoding UTF8 -ErrorAction Stop
    Write-Host "  Provenance recorded: $($artifactHashes.Count) artifacts hashed" -ForegroundColor DarkGray

    if ($EvidencePackage) {
        try {
            if (-not (Get-Command -Name Export-EvidencePackage -ErrorAction SilentlyContinue)) {
                . (Join-Path -Path $PSScriptRoot -ChildPath 'Export-EvidencePackage.ps1')
            }
            $packageParams = @{ AssessmentFolder = $AssessmentFolder }
            if ($Provenance.tenantNameSlug) { $packageParams['TenantName'] = $Provenance.tenantNameSlug }
            if ($Redact) {
                $packageParams['Redact'] = $true
                if ($Provenance.tenantNameSlug) { $packageParams['TenantDisplayName'] = $Provenance.tenantNameSlug }
            }
            $packagePath = Export-EvidencePackage @packageParams
            Write-Host "  Evidence package written: $packagePath" -ForegroundColor DarkGray
        }
        catch {
            # Preserve the final log bytes even if optional packaging fails.
            Write-Warning "Evidence package generation failed: $($_.Exception.Message)"
        }
    }
    return $provenancePath
}
