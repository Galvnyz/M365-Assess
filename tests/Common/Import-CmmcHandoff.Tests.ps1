Describe 'Import-CmmcHandoff' {
    BeforeAll {
        . (Join-Path $PSScriptRoot '../../src/M365-Assess/Common/Import-CmmcHandoff.ps1')

        # Synthetic fixture — 6 practices covering every classification + level
        # so summary math is exercised end-to-end without coupling to the
        # production handoff file's counts.
        $script:fixtureJson = @'
{
  "schemaVersion": "1.0.0",
  "generated": "2026-04-20",
  "description": "Synthetic fixture for Import-CmmcHandoff tests.",
  "coverage": { "totalL1Practices": 15, "totalL2Practices": 110, "totalL3Practices": 24 },
  "practices": [
    { "practiceId": "A.L1-1", "level": "L1", "domain": "Test",  "classification": "out-of-scope", "reason": "x", "ezCmmc": true },
    { "practiceId": "A.L1-2", "level": "L1", "domain": "Test",  "classification": "out-of-scope", "reason": "x", "ezCmmc": true },
    { "practiceId": "A.L2-1", "level": "L2", "domain": "Test",  "classification": "partial",      "reason": "x", "ezCmmc": true },
    { "practiceId": "A.L2-2", "level": "L2", "domain": "Test",  "classification": "inherent",     "reason": "x", "ezCmmc": false },
    { "practiceId": "A.L3-1", "level": "L3", "domain": "Test",  "classification": "coverable",    "reason": "x", "ezCmmc": false },
    { "practiceId": "A.L3-2", "level": "L3", "domain": "Test",  "classification": "coverable",    "reason": "x", "ezCmmc": false }
  ]
}
'@
    }

    Context 'when the handoff file loads successfully' {
        BeforeAll {
            $script:fixtureDir = Join-Path $TestDrive 'valid-controls'
            New-Item -Path $fixtureDir -ItemType Directory -Force | Out-Null
            Set-Content -Path (Join-Path $fixtureDir 'cmmc-ez-handoff.json') -Value $fixtureJson -NoNewline
            $script:result = Import-CmmcHandoff -ControlsPath $fixtureDir
        }

        It 'returns a hashtable with the expected top-level keys' {
            $result | Should -BeOfType [hashtable]
            $result.Keys | Should -Contain 'SchemaVersion'
            $result.Keys | Should -Contain 'Generated'
            $result.Keys | Should -Contain 'Description'
            $result.Keys | Should -Contain 'Coverage'
            $result.Keys | Should -Contain 'Practices'
            $result.Keys | Should -Contain 'Summary'
        }

        It 'passes through schema metadata' {
            $result.SchemaVersion | Should -Be '1.0.0'
            $result.Generated     | Should -Be '2026-04-20'
        }

        It 'returns the full practices array' {
            @($result.Practices).Count | Should -Be 6
        }

        It 'computes per-level classification counts' {
            $result.Summary.L1.outOfScope | Should -Be 2
            $result.Summary.L1.partial    | Should -Be 0
            $result.Summary.L2.partial    | Should -Be 1
            $result.Summary.L2.inherent   | Should -Be 1
            $result.Summary.L3.coverable  | Should -Be 2
        }

        It 'computes Total counts across all levels' {
            $result.Summary.Total.outOfScope | Should -Be 2
            $result.Summary.Total.partial    | Should -Be 1
            $result.Summary.Total.coverable  | Should -Be 2
            $result.Summary.Total.inherent   | Should -Be 1
            $result.Summary.Total.practices  | Should -Be 6
        }

        It 'keeps each level bucket independent (no reference aliasing)' {
            # Regression: if all level buckets pointed at the same hashtable,
            # incrementing L1 would also bump L2/L3. Assert the fixture's
            # deliberate asymmetry survives.
            $result.Summary.L1.coverable | Should -Be 0
            $result.Summary.L3.coverable | Should -Be 2
        }
    }

    Context 'when the handoff file is missing' {
        It 'returns $null instead of throwing' {
            $emptyDir = Join-Path $TestDrive 'missing-controls'
            New-Item -Path $emptyDir -ItemType Directory -Force | Out-Null
            $result = Import-CmmcHandoff -ControlsPath $emptyDir
            $result | Should -BeNullOrEmpty
        }
    }

    Context 'when the handoff file contains malformed JSON' {
        It 'throws from ConvertFrom-Json' {
            $badDir = Join-Path $TestDrive 'malformed-controls'
            New-Item -Path $badDir -ItemType Directory -Force | Out-Null
            Set-Content -Path (Join-Path $badDir 'cmmc-ez-handoff.json') -Value '{ not json' -NoNewline
            { Import-CmmcHandoff -ControlsPath $badDir } | Should -Throw
        }
    }

    Context 'when a practice carries an unknown classification' {
        It 'skips it silently rather than crashing the summary' {
            $oddDir = Join-Path $TestDrive 'unknown-class-controls'
            New-Item -Path $oddDir -ItemType Directory -Force | Out-Null
            $oddJson = @'
{
  "schemaVersion": "1.0.0",
  "generated": "2026-04-20",
  "practices": [
    { "practiceId": "X.L2-99", "level": "L2", "classification": "future-classification", "reason": "x" },
    { "practiceId": "X.L2-1",  "level": "L2", "classification": "partial",               "reason": "x" }
  ]
}
'@
            Set-Content -Path (Join-Path $oddDir 'cmmc-ez-handoff.json') -Value $oddJson -NoNewline
            $result = Import-CmmcHandoff -ControlsPath $oddDir
            $result.Summary.Total.practices | Should -Be 2
            $result.Summary.Total.partial   | Should -Be 1
            $result.Summary.L2.partial      | Should -Be 1
        }
    }

    Context 'when loading the production handoff file in the repo' {
        It 'loads without error and exposes Summary.Total.practices > 0' {
            $productionControls = Join-Path $PSScriptRoot '../../src/M365-Assess/controls'
            $result = Import-CmmcHandoff -ControlsPath $productionControls
            $result | Should -Not -BeNullOrEmpty
            $result.Summary.Total.practices | Should -BeGreaterThan 0
        }
    }
}
