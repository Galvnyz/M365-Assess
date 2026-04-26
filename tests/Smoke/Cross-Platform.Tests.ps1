# tests/Smoke/Cross-Platform.Tests.ps1 — B6 #777
#
# Catches platform-shaped bugs (path separators, case-sensitivity in dot-source
# paths, line-ending differences) without paying the heavy install cost of
# Microsoft.Graph / ExchangeOnlineManagement / Microsoft.PowerApps modules.
# Pester-on-Windows remains the source of truth; this lane just verifies that
# the parts of the module that DON'T require the Graph SDK still load and
# behave on Linux + macOS.

BeforeAll {
    $script:repoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
    $script:moduleRoot = Join-Path $script:repoRoot 'src/M365-Assess'
    $script:manifestPath = Join-Path $script:moduleRoot 'M365-Assess.psd1'
}

Describe 'Cross-platform smoke (B6 #777)' {

    Context 'Manifest parses without platform-specific assumptions' {
        It 'should parse via Import-PowerShellDataFile on the current platform' {
            $manifest = Import-PowerShellDataFile -Path $script:manifestPath
            $manifest.ModuleVersion | Should -Match '^\d+\.\d+\.\d+$'
            $manifest.RootModule    | Should -BeLike '*.psm1'
        }

        It 'FileList entries resolve case-correctly (Linux is case-sensitive)' {
            $manifest = Import-PowerShellDataFile -Path $script:manifestPath
            $missing = @()
            foreach ($rel in $manifest.FileList) {
                # The case of the file as listed in the manifest must match the
                # case on disk. Linux runners reject mismatches that Windows + macOS
                # silently accept, so a stale FileList entry surfaces here first.
                $candidate = Join-Path $script:moduleRoot $rel
                if (-not (Test-Path $candidate)) {
                    $missing += $rel
                }
            }
            if ($missing.Count -gt 0) {
                throw "FileList contains $($missing.Count) entry(ies) that don't resolve on this platform:`n$(($missing | Select-Object -First 10) -join "`n")"
            }
        }
    }

    Context 'Control registry imports cleanly' {
        It 'should load registry.json + framework JSONs without parse errors' {
            . (Join-Path $script:moduleRoot 'Common/Import-ControlRegistry.ps1')
            . (Join-Path $script:moduleRoot 'Common/Import-FrameworkDefinitions.ps1')

            $registry = Import-ControlRegistry -ControlsPath (Join-Path $script:moduleRoot 'controls')
            $registry | Should -Not -BeNullOrEmpty
            $registry.Count | Should -BeGreaterThan 100

            $frameworks = Import-FrameworkDefinitions -FrameworksPath (Join-Path $script:moduleRoot 'controls/frameworks')
            $frameworks | Should -Not -BeNullOrEmpty
            ($frameworks | Measure-Object).Count | Should -BeGreaterThan 5
        }
    }

    Context 'SecurityConfigHelper contract works on this platform' {
        It 'should accept findings via Add-SecuritySetting and export them' {
            . (Join-Path $script:moduleRoot 'Common/SecurityConfigHelper.ps1')

            $ctx = Initialize-SecurityConfig
            Add-SecuritySetting -Settings $ctx.Settings -CheckIdCounter $ctx.CheckIdCounter `
                -Category 'Smoke' -Setting 'cross-platform check' -CurrentValue 'ok' `
                -RecommendedValue 'ok' -Status 'Pass' -CheckId 'SMOKE-001'

            $ctx.Settings.Count | Should -Be 1
            $ctx.Settings[0].Status | Should -Be 'Pass'
            $ctx.Settings[0].CheckId | Should -Be 'SMOKE-001.1'
        }
    }

    Context 'Build-ReportDataJson produces valid output from synthetic findings' {
        It 'should emit a well-formed window.REPORT_DATA assignment without tenant calls' {
            . (Join-Path $script:moduleRoot 'Common/Build-ReportData.ps1')

            $synthetic = @(
                [PSCustomObject]@{
                    CheckId          = 'SMOKE-001.1'
                    Category         = 'Smoke'
                    Setting          = 'platform parity'
                    CurrentValue     = 'ok'
                    RecommendedValue = 'ok'
                    Status           = 'Pass'
                    Remediation      = ''
                    Section          = 'Smoke'
                }
            )

            $json = Build-ReportDataJson -AllFindings $synthetic
            $json | Should -Not -BeNullOrEmpty
            $json | Should -Match '^window\.REPORT_DATA\s*='
            # The closing semicolon is required for the inline <script> contract.
            $json.TrimEnd() | Should -Match ';\s*$'
        }
    }
}
