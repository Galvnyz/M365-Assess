BeforeAll {
    . "$PSScriptRoot/../../src/M365-Assess/ValueOpportunity/Get-FeatureReadiness.ps1"
}

Describe 'Get-FeatureReadiness' {
    BeforeAll {
        $script:mockFeatureMap = [PSCustomObject]@{
            featureGroups = [PSCustomObject]@{
                'feature-a' = [PSCustomObject]@{
                    displayName     = 'Feature A'
                    category        = 'Identity & Access'
                    effortTier      = 'Quick Win'
                    servicePlans    = @('PLAN_A')
                    prerequisites   = @()
                    learnUrl        = 'https://learn.microsoft.com/test-a'
                    detectionChecks = @()
                }
                'feature-b' = [PSCustomObject]@{
                    displayName     = 'Feature B'
                    category        = 'Identity & Access'
                    effortTier      = 'Medium'
                    servicePlans    = @('PLAN_B')
                    prerequisites   = @('feature-a')
                    learnUrl        = 'https://learn.microsoft.com/test-b'
                    detectionChecks = @()
                }
            }
        }
    }

    It 'Should mark Ready when licensed and no blockers' {
        $license = @(
            [PSCustomObject]@{ FeatureId = 'feature-a'; IsLicensed = $true }
            [PSCustomObject]@{ FeatureId = 'feature-b'; IsLicensed = $true }
        )
        $adoption = @(
            [PSCustomObject]@{ FeatureId = 'feature-a'; AdoptionState = 'Adopted' }
            [PSCustomObject]@{ FeatureId = 'feature-b'; AdoptionState = 'NotAdopted' }
        )

        $results = Get-FeatureReadiness -LicenseUtilization $license -FeatureAdoption $adoption -FeatureMap $script:mockFeatureMap
        $b = $results | Where-Object { $_.FeatureId -eq 'feature-b' }
        $b.ReadinessState | Should -Be 'Ready'
    }

    It 'Should mark Blocked when prerequisite not adopted' {
        $license = @(
            [PSCustomObject]@{ FeatureId = 'feature-a'; IsLicensed = $true }
            [PSCustomObject]@{ FeatureId = 'feature-b'; IsLicensed = $true }
        )
        $adoption = @(
            [PSCustomObject]@{ FeatureId = 'feature-a'; AdoptionState = 'NotAdopted' }
            [PSCustomObject]@{ FeatureId = 'feature-b'; AdoptionState = 'NotAdopted' }
        )

        $results = Get-FeatureReadiness -LicenseUtilization $license -FeatureAdoption $adoption -FeatureMap $script:mockFeatureMap
        $b = $results | Where-Object { $_.FeatureId -eq 'feature-b' }
        $b.ReadinessState | Should -Be 'Blocked'
        $b.Blockers | Should -Match 'Feature A'
    }

    It 'Should mark NotLicensed when plan missing' {
        $license = @(
            [PSCustomObject]@{ FeatureId = 'feature-a'; IsLicensed = $false }
            [PSCustomObject]@{ FeatureId = 'feature-b'; IsLicensed = $false }
        )
        $adoption = @(
            [PSCustomObject]@{ FeatureId = 'feature-a'; AdoptionState = 'NotLicensed' }
            [PSCustomObject]@{ FeatureId = 'feature-b'; AdoptionState = 'NotLicensed' }
        )

        $results = Get-FeatureReadiness -LicenseUtilization $license -FeatureAdoption $adoption -FeatureMap $script:mockFeatureMap
        $a = $results | Where-Object { $_.FeatureId -eq 'feature-a' }
        $a.ReadinessState | Should -Be 'NotLicensed'
        $a.Blockers | Should -Match 'PLAN_A'
    }

    It 'Should return one row per feature' {
        $license = @(
            [PSCustomObject]@{ FeatureId = 'feature-a'; IsLicensed = $true }
            [PSCustomObject]@{ FeatureId = 'feature-b'; IsLicensed = $true }
        )
        $adoption = @(
            [PSCustomObject]@{ FeatureId = 'feature-a'; AdoptionState = 'Adopted' }
            [PSCustomObject]@{ FeatureId = 'feature-b'; AdoptionState = 'Adopted' }
        )

        $results = Get-FeatureReadiness -LicenseUtilization $license -FeatureAdoption $adoption -FeatureMap $script:mockFeatureMap
        $results.Count | Should -Be 2
    }
}
