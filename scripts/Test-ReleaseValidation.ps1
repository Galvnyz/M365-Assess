#Requires -Version 7.6
<#
.SYNOPSIS
    Validates release artifacts offline using the checked-in sample assessment.
.DESCRIPTION
    Requires Pester 5.7.1, ImportExcel 7.8.10, Node.js and npm ci. Runs the real
    orchestrator and report exporters with fixture collectors and no service
    connections. Retains a unique output directory, console log and test results.
    This does not satisfy the separate human live-tenant release gate.
.PARAMETER OutputRoot
    Parent for new validation runs. Existing runs are never reused or deleted.
.EXAMPLE
    pwsh -NoProfile -File ./scripts/Test-ReleaseValidation.ps1
#>
[CmdletBinding()]
param(
    [string]$OutputRoot = (Join-Path -Path $PSScriptRoot -ChildPath '../M365-Assessment/release-validation')
)
$ErrorActionPreference = 'Stop'
Import-Module Pester -RequiredVersion 5.7.1 -ErrorAction Stop
Import-Module ImportExcel -RequiredVersion 7.8.10 -ErrorAction Stop
$null = Get-Command -Name node -ErrorAction Stop
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path -Path $repoRoot -ChildPath 'node_modules/jsdom/package.json'))) {
    throw 'Missing report validation dependencies. Run npm ci --ignore-scripts first.'
}
$runRoot = Join-Path -Path $OutputRoot -ChildPath ("run-{0}-{1}" -f (Get-Date -Format 'yyyyMMdd-HHmmss'), [guid]::NewGuid().ToString('N'))
$runRoot = (New-Item -Path $runRoot -ItemType Directory -ErrorAction Stop).FullName
Write-Host "Offline release validation artifacts: $runRoot"
Start-Transcript -Path (Join-Path -Path $runRoot -ChildPath 'console.txt') | Out-Null
try {
    $config = New-PesterConfiguration
    $config.Run.Container = New-PesterContainer -Path (Join-Path -Path $repoRoot -ChildPath 'tests/Release/Release-Validation.Tests.ps1') -Data @{ OutputRoot = $runRoot }
    $config.Run.PassThru = $true
    # These tests exercise files only; no Windows registry fixture is needed.
    $config.TestRegistry.Enabled = $false
    $config.Output.Verbosity = 'Detailed'
    $config.TestResult.Enabled = $true
    $config.TestResult.OutputFormat = 'JUnitXml'
    $config.TestResult.OutputPath = Join-Path -Path $runRoot -ChildPath 'test-results.xml'
    $result = Invoke-Pester -Configuration $config
    if ($result.Result -ne 'Passed' -or $result.PassedCount -eq 0 -or $result.SkippedCount -gt 0) {
        throw "Offline release validation failed. Inspect $runRoot"
    }
    Write-Host 'Offline fixture validation passed. Human live-tenant validation remains separate (docs/adr/0009).'
}
finally {
    Stop-Transcript | Out-Null
}
