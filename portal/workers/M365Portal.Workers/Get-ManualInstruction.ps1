# Get-ManualInstruction.ps1
# EPIC-006 SPEC.md §4.2, §5, §11 item 2 — manual instruction rendering. T-0106.
#
# Resolves the in-tool manual instruction for a check:
#   1. Strip the trailing sub-number (CA-REPORTONLY-001.1 -> CA-REPORTONLY-001).
#   2. Locate docs/portal-specs/02-controls/manual/NNN-<checkId>.md and parse its
#      portal path and numbered `## Steps`.
#   3. Fall back to the registry `remediation.portal.path` / `steps[]` when the
#      doc is absent (SPEC §11 item 2: hand-written docs override the registry).
#   4. When neither carries instructions, return the empty-state marker.
#
# Read-only: this handler never writes to a tenant or to storage.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:ManualInstructionDocRoot = Join-Path -Path $PSScriptRoot `
    '../../../docs/portal-specs/02-controls/manual'

$script:RemediationDomainRoot = Join-Path -Path $PSScriptRoot '../../../src/M365-Assess/Remediate'
if (Test-Path -LiteralPath $script:RemediationDomainRoot -PathType Container) {
    $resolveScript = Join-Path -Path $script:RemediationDomainRoot -ChildPath 'Resolve-Remediation.ps1'
    if (Test-Path -LiteralPath $resolveScript -PathType Leaf) {
        . $resolveScript
    }
}

function Get-InstructionOptionalProperty {
    param(
        [Parameter()][object]$Object,
        [Parameter(Mandatory)][string]$Name
    )
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Name)) { return $Object[$Name] }
        return $null
    }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -ne $property) { return $property.Value }
    return $null
}

function Get-ManualInstructionRegistryKey {
    param([Parameter(Mandatory)][string]$CheckId)
    return ($CheckId -replace '\.\d+$', '')
}

function ConvertFrom-ManualInstructionDoc {
    <#
    .SYNOPSIS
        Parses a manual instruction markdown doc into portal path, steps, notes.
    .DESCRIPTION
        Reads the first H1 as the title, the optional `- **Portal path:**` bullet
        as the portal path, the numbered lines under `## Steps` as the steps, and
        the body under `## Notes / caveats` as notes.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$CheckId
    )

    $lines = @(Get-Content -LiteralPath $Path)
    $title = $null
    $portalPath = $null
    $steps = New-Object System.Collections.Generic.List[string]
    $notesLines = New-Object System.Collections.Generic.List[string]
    $section = ''

    foreach ($line in $lines) {
        if ($line -match '^#\s+(.+?)\s*$') {
            if (-not $title) { $title = $Matches[1] }
            continue
        }
        if ($line -match '^##\s+(.+?)\s*$') {
            $section = $Matches[1].Trim()
            continue
        }
        if ($line -match '^\s*-\s+\*\*Portal path:\*\*\s*(.+?)\s*$') {
            $portalPath = $Matches[1]
            continue
        }

        switch -Regex ($section) {
            '^Steps$' {
                if ($line -match '^\s*\d+\.\s+(.+?)\s*$') {
                    $steps.Add($Matches[1]) | Out-Null
                }
            }
            '^Notes' {
                if (-not [string]::IsNullOrWhiteSpace($line)) {
                    $notesLines.Add($line.TrimEnd()) | Out-Null
                }
            }
        }
    }

    $notes = if ($notesLines.Count -gt 0) { ($notesLines -join "`n").Trim() } else { $null }

    return [PSCustomObject]@{
        CheckId    = $CheckId
        Title      = $title
        PortalPath = $portalPath
        Steps      = $steps.ToArray()
        Notes      = $notes
        DocPath    = $Path
    }
}

function Find-ManualInstructionDoc {
    <#
    .SYNOPSIS
        Locates manual/NNN-<checkId>.md for a registry key.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RegistryKey,
        [Parameter()][string]$ManualRoot
    )
    if (-not $ManualRoot) { $ManualRoot = $script:ManualInstructionDocRoot }
    if (-not (Test-Path -LiteralPath $ManualRoot -PathType Container)) { return $null }
    $match = Get-ChildItem -LiteralPath $ManualRoot -Filter "*-$RegistryKey.md" -File |
        Select-Object -First 1
    if ($null -eq $match) { return $null }
    return $match.FullName
}

function Get-ManualInstruction {
    <#
    .SYNOPSIS
        Resolves the manual instruction for a check (doc overrides registry).
    .PARAMETER CheckId
        Finding check id, with or without a sub-number suffix.
    .PARAMETER ManualRoot
        Override for the manual docs directory (tests).
    .PARAMETER RegistryPath
        Passed through to Resolve-Remediation for the registry fallback.
    .OUTPUTS
        [PSCustomObject] with CheckId, RegistryKey, PortalPath, Steps, Notes,
        Source (doc|registry|none), Empty, Title, DocPath.
    .EXAMPLE
        Get-ManualInstruction -CheckId 'ENTRA-SECDEFAULT-001.1'
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory, ValueFromPipeline, ValueFromPipelineByPropertyName)]
        [ValidateNotNullOrEmpty()]
        [string]$CheckId,

        [Parameter()]
        [string]$ManualRoot,

        [Parameter()]
        [string]$RegistryPath
    )

    process {
        $registryKey = Get-ManualInstructionRegistryKey -CheckId $CheckId
        $docPath = Find-ManualInstructionDoc -RegistryKey $registryKey -ManualRoot $ManualRoot

        # Registry resolution (SPEC §11 item 2): the doc overrides, the registry
        # fills any gap the doc leaves (e.g. a doc with steps but no portal path).
        $resolved = $null
        if (Get-Command -Name Resolve-Remediation -ErrorAction SilentlyContinue) {
            $resolveParams = @{ CheckId = $CheckId }
            if (-not [string]::IsNullOrWhiteSpace($RegistryPath)) { $resolveParams['RegistryPath'] = $RegistryPath }
            $resolved = Resolve-Remediation @resolveParams
        }
        $registryPortalPath = [string](Get-InstructionOptionalProperty -Object $resolved -Name 'PortalPath')
        $registrySteps = @(Get-InstructionOptionalProperty -Object $resolved -Name 'PortalSteps')
        $registryNotes = [string](Get-InstructionOptionalProperty -Object $resolved -Name 'Notes')

        if ($docPath) {
            $parsed = ConvertFrom-ManualInstructionDoc -Path $docPath -CheckId $CheckId
            if ($parsed.Steps.Count -gt 0 -or $parsed.PortalPath) {
                $portalPath = if ($parsed.PortalPath) { $parsed.PortalPath }
                    elseif ($registryPortalPath) { $registryPortalPath } else { $null }
                $steps = if ($parsed.Steps.Count -gt 0) { @($parsed.Steps) } else { @($registrySteps) }
                $notes = if ($parsed.Notes) { $parsed.Notes }
                    elseif ($registryNotes) { $registryNotes } else { $null }
                return [PSCustomObject]@{
                    CheckId     = $CheckId
                    RegistryKey = $registryKey
                    PortalPath  = $portalPath
                    Steps       = $steps
                    Notes       = $notes
                    Source      = 'doc'
                    Empty       = $false
                    Title       = $parsed.Title
                    DocPath     = $docPath
                }
            }
        }

        if ($registryPortalPath -or $registrySteps.Count -gt 0) {
            return [PSCustomObject]@{
                CheckId     = $CheckId
                RegistryKey = $registryKey
                PortalPath  = if ($registryPortalPath) { $registryPortalPath } else { $null }
                Steps       = @($registrySteps)
                Notes       = if ($registryNotes) { $registryNotes } else { $null }
                Source      = 'registry'
                Empty       = $false
                Title       = $null
                DocPath     = $null
            }
        }

        # Empty state (undetermined: nothing to render).
        return [PSCustomObject]@{
            CheckId     = $CheckId
            RegistryKey = $registryKey
            PortalPath  = $null
            Steps       = @()
            Notes       = $null
            Source      = 'none'
            Empty       = $true
            Title       = $null
            DocPath     = $null
        }
    }
}
