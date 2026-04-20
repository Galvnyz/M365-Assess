Describe 'Import-ControlRegistry' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Common/Import-ControlRegistry.ps1"
        $testRoot = "$PSScriptRoot/../../src/M365-Assess/controls"
    }

    It 'Returns a hashtable keyed by CheckId' {
        $registry = Import-ControlRegistry -ControlsPath $testRoot
        $registry | Should -BeOfType [hashtable]
        $registry.Keys | Should -Contain 'ENTRA-ADMIN-001'
    }

    It 'Each entry contains frameworks object' {
        $registry = Import-ControlRegistry -ControlsPath $testRoot
        $entry = $registry['ENTRA-ADMIN-001']
        $entry.frameworks | Should -Not -BeNullOrEmpty
        $entry.frameworks.'cis-m365-v6'.controlId | Should -Not -BeNullOrEmpty
    }

    It 'Builds a reverse lookup from CIS control ID to CheckId' {
        $registry = Import-ControlRegistry -ControlsPath $testRoot
        $reverseLookup = $registry['__cisReverseLookup']
        $reverseLookup['1.1.3'] | Should -Not -BeNullOrEmpty
        $reverseLookup['1.1.3'] | Should -Match '^[A-Z]+-[A-Z]+-\d{3}$'
    }

    It 'Returns empty hashtable when registry not found' {
        $result = Import-ControlRegistry -ControlsPath (Join-Path $TestDrive 'nonexistent') -WarningAction SilentlyContinue
        $result.Count | Should -Be 0
    }

    It 'Applies risk severity overlay from risk-severity.json' {
        $registry = Import-ControlRegistry -ControlsPath $testRoot
        # At least one check should have a non-default severity
        $severities = @($registry.Keys | Where-Object { $_ -ne '__cisReverseLookup' } |
            ForEach-Object { $registry[$_].riskSeverity } | Sort-Object -Unique)
        $severities.Count | Should -BeGreaterThan 1 -Because 'risk-severity.json should override some defaults'
    }

    It 'Applies learnMore overlay from learn-more.json' {
        $registry = Import-ControlRegistry -ControlsPath $testRoot
        $withUrl = @($registry.Keys | Where-Object { $_ -ne '__cisReverseLookup' } |
            Where-Object { $registry[$_].learnMore })
        $withUrl.Count | Should -BeGreaterThan 0 -Because 'learn-more.json should populate learnMore on at least one check'
        $registry['CA-LEGACYAUTH-001'].learnMore | Should -Match '^https://learn\.microsoft\.com'
    }

    It 'Accepts CisFrameworkId parameter for reverse lookup' {
        $registry = Import-ControlRegistry -ControlsPath $testRoot -CisFrameworkId 'cis-m365-v6'
        $reverseLookup = $registry['__cisReverseLookup']
        $reverseLookup.Count | Should -BeGreaterThan 0
    }

    It 'Falls back to local JSON when CheckID module is not available' {
        # This test verifies the fallback path works (CheckID module unlikely
        # to be installed in CI). The function should load from controls/registry.json.
        $registry = Import-ControlRegistry -ControlsPath $testRoot
        $registry.Keys.Count | Should -BeGreaterThan 10 -Because 'local registry.json should load as fallback'
    }

    Context 'SCF and impact data passthrough' {
        It 'passes scf object through for v2.0.0 entries' {
            $registry = Import-ControlRegistry -ControlsPath $testRoot
            $withScf = @($registry.Keys | Where-Object { $_ -ne '__cisReverseLookup' } |
                ForEach-Object { $registry[$_] } | Where-Object { $null -ne $_.scf })
            $withScf.Count | Should -BeGreaterThan 0 -Because 'CheckID v2.0.0 entries carry scf objects'
            $withScf[0].scf.domain | Should -Not -BeNullOrEmpty
            $withCsfFunction = @($withScf | Where-Object { $null -ne $_.scf.csfFunction })
            $withCsfFunction.Count | Should -BeGreaterThan 0 -Because 'CheckID v2.0.0 entries should carry scf.csfFunction'
            $withCsfFunction[0].scf.csfFunction | Should -Not -BeNullOrEmpty
        }

        It 'passes impactRating object through for v2.0.0 entries' {
            $registry = Import-ControlRegistry -ControlsPath $testRoot
            $withImpact = @($registry.Keys | Where-Object { $_ -ne '__cisReverseLookup' } |
                ForEach-Object { $registry[$_] } | Where-Object { $null -ne $_.impactRating })
            $withImpact.Count | Should -BeGreaterThan 0 -Because 'CheckID v2.0.0 entries carry impactRating objects'
            # Hashtable iteration order is non-deterministic; validate all entries, not just [0]
            # 'Informational' is valid per CheckID v2.0.0 schema (e.g. SPO-SITE-003, TEAMS-INFO-001)
            $validSeverities = @('Critical', 'High', 'Medium', 'Low', 'Informational')
            foreach ($entry in $withImpact) {
                $entry.impactRating.severity | Should -BeIn $validSeverities `
                    -Because "impactRating.severity for '$($entry.checkId)' must be a known severity"
                $entry.impactRating.rationale | Should -Not -BeNullOrEmpty `
                    -Because "impactRating.rationale for '$($entry.checkId)' must be present"
            }
        }

        It 'scf and impactRating are null for local extension entries without upstream data' {
            $tmpDir = Join-Path $TestDrive 'controls-local-ext'
            New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
            $reg = @{
                schemaVersion = '1.x'
                checks        = @(
                    @{ checkId = 'LOCAL-001'; name = 'Local Check'; category = 'X'; collector = 'X'
                       hasAutomatedCheck = $true
                       licensing = @{ requiredServicePlans = @() }
                       frameworks = [PSCustomObject]@{} }
                )
            }
            $reg | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $tmpDir 'registry.json')
            $result = Import-ControlRegistry -ControlsPath $tmpDir
            $result['LOCAL-001'].scf         | Should -BeNullOrEmpty
            $result['LOCAL-001'].impactRating | Should -BeNullOrEmpty
        }
    }

    Context 'licensing normalization' {
        It 'every entry exposes licensing.requiredServicePlans as an array' {
            $registry = Import-ControlRegistry -ControlsPath $testRoot
            $entries = $registry.Keys | Where-Object { $_ -ne '__cisReverseLookup' } |
                ForEach-Object { $registry[$_] }
            # Note: $entry.licensing is a hashtable, so PSObject.Properties.Name won't enumerate
            # its keys. Check the value directly — -isnot [array] catches both $null and wrong type.
            $nonArray = @($entries | Where-Object {
                $_.licensing -eq $null -or
                $_.licensing.requiredServicePlans -isnot [array]
            })
            $nonArray.Count | Should -Be 0 -Because 'Show-CheckProgress expects licensing.requiredServicePlans on every entry'
        }

        It 'applies licensing-overlay.json — AAD_PREMIUM_P2 checks are gated' {
            $registry = Import-ControlRegistry -ControlsPath $testRoot
            $entry = $registry['ENTRA-PIM-001']
            if ($null -ne $entry) {
                $entry.licensing.requiredServicePlans | Should -Contain 'AAD_PREMIUM_P2'
            }
        }

        It 'applies licensing-overlay.json — ATP_ENTERPRISE checks are gated' {
            $registry = Import-ControlRegistry -ControlsPath $testRoot
            $entry = $registry['DEFENDER-SAFELINKS-001']
            if ($null -ne $entry) {
                $entry.licensing.requiredServicePlans | Should -Contain 'ATP_ENTERPRISE'
            }
        }

        It 'applies licensing-overlay.json — LOCKBOX_ENTERPRISE check is gated' {
            $registry = Import-ControlRegistry -ControlsPath $testRoot
            $entry = $registry['EXO-LOCKBOX-001']
            if ($null -ne $entry) {
                $entry.licensing.requiredServicePlans | Should -Contain 'LOCKBOX_ENTERPRISE'
            }
        }

        It 'E3 checks have empty requiredServicePlans' {
            $registry = Import-ControlRegistry -ControlsPath $testRoot
            # ENTRA-ADMIN-001 is a core E3 check with no licensing gate
            $entry = $registry['ENTRA-ADMIN-001']
            $entry | Should -Not -BeNullOrEmpty
            @($entry.licensing.requiredServicePlans).Count | Should -Be 0
        }

        It 'works without licensing-overlay.json — all entries still have requiredServicePlans array' {
            $tmpDir = Join-Path $TestDrive 'controls-no-overlay'
            New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
            $reg = @{
                schemaVersion = '2.0.0'
                dataVersion   = '2026-01-01'
                checks        = @(
                    @{ checkId = 'TEST-001'; name = 'Test'; category = 'X'; collector = 'X'
                       hasAutomatedCheck = $true
                       licensing = @{ minimum = 'E5' }
                       frameworks = [PSCustomObject]@{} }
                )
            }
            $reg | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $tmpDir 'registry.json')
            $result = Import-ControlRegistry -ControlsPath $tmpDir
            # Capture to local var before asserting type — piping @() through the pipeline
            # sends nothing (empty array emits 0 items), making Should see $null.
            $plans = $result['TEST-001'].licensing.requiredServicePlans
            ($plans -is [array]) | Should -BeTrue -Because 'requiredServicePlans must be an array, not null'
            @($plans).Count | Should -Be 0
        }
    }
}
