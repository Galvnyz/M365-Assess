<#
.SYNOPSIS
    Builds a sanitized evidence package ZIP for auditor handoff (D4 #788).
.DESCRIPTION
    Reads the post-processed assessment artifacts from a completed
    Invoke-M365Assessment run and bundles them into a single hash-manifested
    ZIP. When -Redact is supplied, scrubs UPNs, IPs, GUIDs, and the tenant
    display name from the content (deterministically -- the same UPN always
    becomes the same redaction token across the package).

    The package layout is documented in docs/EVIDENCE-PACKAGE.md and is
    intended to give an auditor everything they need to defend the findings
    without exposing PII.
.PARAMETER AssessmentFolder
    Path to the completed assessment output folder (the one Invoke-M365Assessment
    just wrote to). Must contain at minimum _Assessment-Summary*.csv and the
    HTML report.
.PARAMETER OutputPath
    Where to write the package ZIP. Defaults to a sibling of $AssessmentFolder
    named '<TenantName>_EvidencePackage_<UTCStamp>.zip'.
.PARAMETER TenantName
    Optional tenant identifier for the output filename. Defaults to the
    assessment-folder basename.
.PARAMETER Redact
    When set, applies the PII redaction ruleset to findings.json, the
    permissions summary and the data embedded in the HTML report. The XLSX
    matrix is left out of a redacted package, and the HTML report is left out
    if its data cannot be redacted. Redaction is pattern based (addresses,
    IPs, GUIDs, tenant display name); it does not remove display names.
.PARAMETER TenantDisplayName
    When -Redact is set, all case-insensitive occurrences of this string
    are replaced with <tenant>. Pass the actual tenant display name from
    the run; leave empty to skip that pass.
.OUTPUTS
    [string] Full path to the written ZIP.
#>

function Export-EvidencePackage {
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$AssessmentFolder,

        [Parameter()]
        [string]$OutputPath,

        [Parameter()]
        [string]$TenantName,

        [Parameter()]
        [switch]$Redact,

        [Parameter()]
        [string]$TenantDisplayName
    )

    if (-not (Test-Path -Path $AssessmentFolder -PathType Container)) {
        throw "AssessmentFolder not found: $AssessmentFolder"
    }

    # Load redaction rules only if needed -- avoids failure if the helper
    # isn't dot-sourced upstream.
    $redactionSalt = $null
    $redactionNotes = [System.Collections.Generic.List[string]]::new()
    if ($Redact) {
        $rulesPath = Join-Path -Path $PSScriptRoot -ChildPath 'Get-RedactionRules.ps1'
        if (-not (Get-Command -Name ConvertTo-RedactedReportHtml -ErrorAction SilentlyContinue)) {
            . $rulesPath
        }
        # One random salt per package: tokens correlate inside the package but
        # cannot be reversed by hashing guessed UPNs, and never match the
        # tokens of another package. The salt is not written anywhere.
        $redactionSalt = New-RedactionSalt
    }

    # Resolve filename + staging dir
    if (-not $TenantName) {
        $TenantName = (Split-Path -Leaf $AssessmentFolder) -replace '[^A-Za-z0-9_-]', '_'
    }
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
    if (-not $OutputPath) {
        $parent = Split-Path -Parent $AssessmentFolder
        $OutputPath = Join-Path -Path $parent -ChildPath "${TenantName}_EvidencePackage_${stamp}.zip"
    }

    $tempDir = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath "m365-evpkg-$([Guid]::NewGuid().ToString('N'))"
    New-Item -Path $tempDir -ItemType Directory -Force | Out-Null

    try {
        # ----- 1. Stage source artifacts (with optional redaction) -----
        $stagedFiles = [System.Collections.Generic.List[string]]::new()

        # 1a. HTML report. All tenant data lives in the window.REPORT_DATA
        # island, so with -Redact that island is parsed and redacted. If it
        # cannot be redacted the report is left out: a redacted package must
        # never carry an unredacted artifact.
        $htmlSrc = Get-ChildItem -Path $AssessmentFolder -Filter '*Assessment-Report*.html' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($htmlSrc) {
            $htmlDst = Join-Path -Path $tempDir -ChildPath 'executive-report.html'
            if ($Redact) {
                $htmlText = Get-Content -Path $htmlSrc.FullName -Raw
                $redactedHtml = ConvertTo-RedactedReportHtml -Html $htmlText -TenantDisplayName $TenantDisplayName -Salt $redactionSalt
                if ($null -ne $redactedHtml) {
                    Set-Content -Path $htmlDst -Value $redactedHtml -Encoding UTF8 -NoNewline
                    $stagedFiles.Add($htmlDst)
                }
                else {
                    $redactionNotes.Add('executive-report.html was omitted: its embedded data could not be redacted.')
                    Write-Warning 'Evidence package: the HTML report could not be redacted and was left out of the package.'
                }
            }
            else {
                Copy-Item -Path $htmlSrc.FullName -Destination $htmlDst -Force
                $stagedFiles.Add($htmlDst)
            }
        }

        # 1b. XLSX matrix. A workbook cannot be redacted in place without
        # rewriting every sheet, so with -Redact it is left out.
        $xlsxSrc = Get-ChildItem -Path $AssessmentFolder -Filter '*Compliance-Matrix*.xlsx' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($xlsxSrc) {
            if ($Redact) {
                $redactionNotes.Add('compliance-matrix.xlsx was omitted: the workbook is not redacted. Share it separately only if the recipient may see tenant identifiers.')
            }
            else {
                $xlsxDst = Join-Path -Path $tempDir -ChildPath 'compliance-matrix.xlsx'
                Copy-Item -Path $xlsxSrc.FullName -Destination $xlsxDst -Force
                $stagedFiles.Add($xlsxDst)
            }
        }

        # 1c. findings.json -- aggregate all per-collector CSVs into one JSON
        # using the structured evidence fields. Redacted on demand.
        $allFindings = [System.Collections.Generic.List[PSCustomObject]]::new()
        $csvFiles = Get-ChildItem -Path $AssessmentFolder -Filter '*-config*.csv' -ErrorAction SilentlyContinue
        foreach ($csv in $csvFiles) {
            $rows = Import-Csv -Path $csv.FullName
            foreach ($r in $rows) { $allFindings.Add($r) }
        }
        $findingsJson = $allFindings | ConvertTo-Json -Depth 6
        if ($Redact) {
            $findingsJson = if ($allFindings.Count -gt 0) {
                ConvertTo-RedactedJson -Json $findingsJson -TenantDisplayName $TenantDisplayName -Salt $redactionSalt -ForFile
            }
            else {
                '[]'
            }
        }
        $findingsPath = Join-Path -Path $tempDir -ChildPath 'findings.json'
        Set-Content -Path $findingsPath -Value $findingsJson -Encoding UTF8
        $stagedFiles.Add($findingsPath)

        # 1d. permissions-summary.json -- best-effort; if a deficit map was
        # written by Test-GraphAppRolePermissions, include it.
        $permSrc = Join-Path -Path $AssessmentFolder -ChildPath '_PermissionDeficits.json'
        $permDst = Join-Path -Path $tempDir -ChildPath 'permissions-summary.json'
        if (Test-Path -Path $permSrc) {
            $permContent = Get-Content -Path $permSrc -Raw
            if ($Redact) {
                $permContent = Invoke-RedactionRules -Text $permContent -TenantDisplayName $TenantDisplayName -Salt $redactionSalt
            }
            Set-Content -Path $permDst -Value $permContent -Encoding UTF8
        } else {
            # Stub so the schema is consistent even without B2 deficit data.
            Set-Content -Path $permDst -Value '{ "note": "No permissions deficit data available; run with delegated or app-only auth that includes Application.Read.All to populate." }' -Encoding UTF8
        }
        $stagedFiles.Add($permDst)

        # 1e. run-metadata.json
        $manifestPsd = Join-Path -Path $PSScriptRoot -ChildPath '..\M365-Assess.psd1'
        $assessVersion = if (Test-Path $manifestPsd) {
            (Import-PowerShellDataFile -Path $manifestPsd).ModuleVersion
        } else { 'unknown' }
        $registryPath = Join-Path -Path $PSScriptRoot -ChildPath '..\controls\registry.json'
        $registryDataVersion = if (Test-Path $registryPath) {
            try { (Get-Content -Path $registryPath -Raw | ConvertFrom-Json).dataVersion } catch { 'unknown' }
        } else { 'unknown' }

        $runMeta = [ordered]@{
            packageVersion        = '1.0'
            generatedAtUtc        = $stamp
            tenantName            = if ($Redact) { '<tenant>' } else { $TenantName }
            assessmentFolder      = if ($Redact) { '<redacted>' } else { $AssessmentFolder }
            assessmentVersion     = $assessVersion
            registryDataVersion   = $registryDataVersion
            redactionApplied      = [bool]$Redact
            redactionNotes        = @($redactionNotes)
            findingCount          = $allFindings.Count
        }
        $runMetaPath = Join-Path -Path $tempDir -ChildPath 'run-metadata.json'
        $runMeta | ConvertTo-Json -Depth 4 | Set-Content -Path $runMetaPath -Encoding UTF8
        $stagedFiles.Add($runMetaPath)

        # 1f. known-limitations.md (static reference)
        $limMd = @'
# Known limitations

This evidence package was generated by M365-Assess and bundles findings, evidence,
and supporting artifacts from a single assessment run.

If individual findings carry caveats (missing permissions, throttled APIs, sovereign
cloud restrictions), they are recorded in the `Limitations` field of each finding
in `findings.json`. This document is a generic preface; finding-specific limitations
override anything stated here.

When `-Redact` is in effect:

- UPNs, email addresses, IPv4/IPv6 addresses, and GUIDs are replaced with
  keyed hash tokens (e.g. `<user-a3f81b29c04d7e15>`).
- The tenant display name is replaced with `<tenant>` when it was supplied.
- Tokens are stable within the package -- the same UPN always produces the
  same `<user-...>` token, preserving join keys for cross-finding correlation.
  They use a random per-package key that is not stored, so they cannot be
  reversed by hashing guessed addresses and do not match other packages.
- The data embedded in the HTML report is redacted with the same rules.
- The XLSX matrix is left out of a redacted package. See `redactionNotes` in
  `run-metadata.json` for anything that was omitted.
- Redaction is pattern based. Display names, group names and free text that
  identify a person or organisation without matching an address, IP or GUID
  pattern are NOT removed. Review before sharing outside your organisation.

See `docs/EVIDENCE-PACKAGE.md` in the M365-Assess repository for the full
package layout reference.
'@
        $limPath = Join-Path -Path $tempDir -ChildPath 'known-limitations.md'
        Set-Content -Path $limPath -Value $limMd -Encoding UTF8
        $stagedFiles.Add($limPath)

        # 1g. README.md (top-level package guide for the auditor)
        $readme = @"
# M365-Assess Evidence Package

Generated: $stamp UTC
Source assessment: $(if ($Redact) { '<redacted>' } else { $AssessmentFolder })
Redaction applied: $($Redact.IsPresent)
Finding count: $($allFindings.Count)
M365-Assess version: $assessVersion
Registry data version: $registryDataVersion

## Files

- ``executive-report.html`` -- the full M365-Assess HTML report$(if ($Redact) { ' (embedded data redacted)' })
- ``compliance-matrix.xlsx`` -- framework crosswalk + evidence sheets$(if ($Redact) { ' (omitted from redacted packages)' })
- ``findings.json`` -- structured findings with evidence schema (D1 #785)
- ``permissions-summary.json`` -- per-section app-role / scope coverage
- ``run-metadata.json`` -- run identifier, version, redaction state
- ``known-limitations.md`` -- generic caveats; finding-specific limitations
  live in the ``Limitations`` field of each finding
- ``manifest.json`` -- SHA-256 hash per file in this package

## Verifying the manifest

``````powershell
`$manifest = Get-Content manifest.json -Raw | ConvertFrom-Json
foreach (`$entry in `$manifest.files) {
    `$actual = (Get-FileHash -Path `$entry.path -Algorithm SHA256).Hash.ToLower()
    if (`$actual -ne `$entry.sha256) {
        Write-Error "Hash mismatch on `$(`$entry.path)"
    }
}
``````
"@
        $readmePath = Join-Path -Path $tempDir -ChildPath 'README.md'
        Set-Content -Path $readmePath -Value $readme -Encoding UTF8
        $stagedFiles.Add($readmePath)

        # ----- 2. Build manifest.json with SHA-256 hash per staged file -----
        $manifestEntries = foreach ($p in $stagedFiles) {
            $name = Split-Path -Leaf $p
            $hash = (Get-FileHash -Path $p -Algorithm SHA256).Hash.ToLower()
            [ordered]@{
                path   = $name
                sha256 = $hash
                bytes  = (Get-Item $p).Length
            }
        }
        $manifest = [ordered]@{
            packageVersion = '1.0'
            generatedAtUtc = $stamp
            files          = @($manifestEntries)
        }
        $manifestPath = Join-Path -Path $tempDir -ChildPath 'manifest.json'
        $manifest | ConvertTo-Json -Depth 5 | Set-Content -Path $manifestPath -Encoding UTF8
        # NB: manifest.json is intentionally NOT included in itself -- the
        # auditor uses it to verify everything else.

        # ----- 3. Zip the staging directory -----
        if (Test-Path -Path $OutputPath) { Remove-Item -Path $OutputPath -Force }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::CreateFromDirectory($tempDir, $OutputPath)

        return $OutputPath
    }
    finally {
        if (Test-Path -Path $tempDir) {
            Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
