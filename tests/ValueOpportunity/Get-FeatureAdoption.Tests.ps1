BeforeAll {
    . "$PSScriptRoot/../../src/M365-Assess/ValueOpportunity/Get-FeatureAdoption.ps1"
}

Describe 'Get-FeatureAdoption' {
    BeforeAll {
        # Use a small mock feature map with known structure
        $script:mockFeatureMap = @{
            features = @(
                @{
                    featureId = 'test-feature'
                    name = 'Test Feature'
                    category = 'identity-access'
                    checkIds = @('TEST-001', 'TEST-002')
                    csvSignals = @()
                    requiredServicePlans = @('PLAN_A')
                }
            )
            categories = @(@{ id = 'identity-access'; name = 'Identity & Access' })
        }
    }

    It 'Should score Adopted when all checks pass' {
        $signals = @{
            'TEST-001.1' = @{ Status = 'Pass'; Setting = 'S1'; CurrentValue = 'V1'; Category = 'C1' }
            'TEST-002.1' = @{ Status = 'Pass'; Setting = 'S2'; CurrentValue = 'V2'; Category = 'C2' }
        }
        $license = @([PSCustomObject]@{ FeatureId = 'test-feature'; IsLicensed = $true })

        $results = Get-FeatureAdoption -AdoptionSignals $signals -LicenseUtilization $license -FeatureMap $script:mockFeatureMap -AssessmentFolder 'C:\nonexistent'
        $results[0].AdoptionState | Should -Be 'Adopted'
        $results[0].AdoptionScore | Should -Be 100
        $results[0].PassedChecks | Should -Be 2
        $results[0].TotalChecks | Should -Be 2
    }

    It 'Should score Partial when some checks pass' {
        $signals = @{
            'TEST-001.1' = @{ Status = 'Pass'; Setting = 'S1'; CurrentValue = 'V1'; Category = 'C1' }
            'TEST-002.1' = @{ Status = 'Fail'; Setting = 'S2'; CurrentValue = 'V2'; Category = 'C2' }
        }
        $license = @([PSCustomObject]@{ FeatureId = 'test-feature'; IsLicensed = $true })

        $results = Get-FeatureAdoption -AdoptionSignals $signals -LicenseUtilization $license -FeatureMap $script:mockFeatureMap -AssessmentFolder 'C:\nonexistent'
        $results[0].AdoptionState | Should -Be 'Partial'
        $results[0].AdoptionScore | Should -Be 50
    }

    It 'Should score NotAdopted when all checks fail' {
        $signals = @{
            'TEST-001.1' = @{ Status = 'Fail'; Setting = 'S1'; CurrentValue = 'V1'; Category = 'C1' }
            'TEST-002.1' = @{ Status = 'Fail'; Setting = 'S2'; CurrentValue = 'V2'; Category = 'C2' }
        }
        $license = @([PSCustomObject]@{ FeatureId = 'test-feature'; IsLicensed = $true })

        $results = Get-FeatureAdoption -AdoptionSignals $signals -LicenseUtilization $license -FeatureMap $script:mockFeatureMap -AssessmentFolder 'C:\nonexistent'
        $results[0].AdoptionState | Should -Be 'NotAdopted'
        $results[0].AdoptionScore | Should -Be 0
    }

    It 'Should score NotLicensed when feature is not licensed' {
        $signals = @{}
        $license = @([PSCustomObject]@{ FeatureId = 'test-feature'; IsLicensed = $false })

        $results = Get-FeatureAdoption -AdoptionSignals $signals -LicenseUtilization $license -FeatureMap $script:mockFeatureMap -AssessmentFolder 'C:\nonexistent'
        $results[0].AdoptionState | Should -Be 'NotLicensed'
    }

    It 'Should score Unknown when no signals exist for licensed feature' {
        $signals = @{}
        $license = @([PSCustomObject]@{ FeatureId = 'test-feature'; IsLicensed = $true })

        $results = Get-FeatureAdoption -AdoptionSignals $signals -LicenseUtilization $license -FeatureMap $script:mockFeatureMap -AssessmentFolder 'C:\nonexistent'
        $results[0].AdoptionState | Should -Be 'Unknown'
    }

    It 'Should handle multiple sub-checks per base CheckId' {
        $signals = @{
            'TEST-001.1' = @{ Status = 'Pass'; Setting = 'S1a'; CurrentValue = 'V1'; Category = 'C1' }
            'TEST-001.2' = @{ Status = 'Pass'; Setting = 'S1b'; CurrentValue = 'V2'; Category = 'C1' }
            'TEST-002.1' = @{ Status = 'Fail'; Setting = 'S2';  CurrentValue = 'V3'; Category = 'C2' }
        }
        $license = @([PSCustomObject]@{ FeatureId = 'test-feature'; IsLicensed = $true })

        $results = Get-FeatureAdoption -AdoptionSignals $signals -LicenseUtilization $license -FeatureMap $script:mockFeatureMap -AssessmentFolder 'C:\nonexistent'
        $results[0].AdoptionState | Should -Be 'Partial'
        $results[0].PassedChecks | Should -Be 2
        $results[0].TotalChecks | Should -Be 3
    }

    It 'Should return correct category name from feature map' {
        $signals = @{
            'TEST-001.1' = @{ Status = 'Pass'; Setting = 'S1'; CurrentValue = 'V1'; Category = 'C1' }
        }
        $license = @([PSCustomObject]@{ FeatureId = 'test-feature'; IsLicensed = $true })

        $results = Get-FeatureAdoption -AdoptionSignals $signals -LicenseUtilization $license -FeatureMap $script:mockFeatureMap -AssessmentFolder 'C:\nonexistent'
        $results[0].Category | Should -Be 'Identity & Access'
    }

    It 'Should handle multiple features in the map' {
        $multiMap = @{
            features = @(
                @{
                    featureId = 'feature-a'
                    name = 'Feature A'
                    category = 'identity-access'
                    checkIds = @('A-001')
                    csvSignals = @()
                    requiredServicePlans = @('PLAN_A')
                },
                @{
                    featureId = 'feature-b'
                    name = 'Feature B'
                    category = 'email-security'
                    checkIds = @('B-001')
                    csvSignals = @()
                    requiredServicePlans = @('PLAN_B')
                }
            )
            categories = @(
                @{ id = 'identity-access'; name = 'Identity & Access' },
                @{ id = 'email-security'; name = 'Email Security' }
            )
        }
        $signals = @{
            'A-001.1' = @{ Status = 'Pass'; Setting = 'SA'; CurrentValue = 'VA'; Category = 'CA' }
            'B-001.1' = @{ Status = 'Fail'; Setting = 'SB'; CurrentValue = 'VB'; Category = 'CB' }
        }
        $license = @(
            [PSCustomObject]@{ FeatureId = 'feature-a'; IsLicensed = $true },
            [PSCustomObject]@{ FeatureId = 'feature-b'; IsLicensed = $true }
        )

        $results = Get-FeatureAdoption -AdoptionSignals $signals -LicenseUtilization $license -FeatureMap $multiMap -AssessmentFolder 'C:\nonexistent'
        $results.Count | Should -Be 2
        ($results | Where-Object { $_.FeatureId -eq 'feature-a' }).AdoptionState | Should -Be 'Adopted'
        ($results | Where-Object { $_.FeatureId -eq 'feature-b' }).AdoptionState | Should -Be 'NotAdopted'
    }

    It 'Should not fail when CSV signal file does not exist' {
        $csvMap = @{
            features = @(
                @{
                    featureId = 'csv-feature'
                    name = 'CSV Feature'
                    category = 'identity-access'
                    checkIds = @('CSV-001')
                    csvSignals = @(
                        @{ file = 'nonexistent.csv'; metric = 'count'; column = 'Status'; pattern = 'Pass'; label = 'Passes' }
                    )
                    requiredServicePlans = @('PLAN_A')
                }
            )
            categories = @(@{ id = 'identity-access'; name = 'Identity & Access' })
        }
        $signals = @{
            'CSV-001.1' = @{ Status = 'Pass'; Setting = 'S1'; CurrentValue = 'V1'; Category = 'C1' }
        }
        $license = @([PSCustomObject]@{ FeatureId = 'csv-feature'; IsLicensed = $true })

        $results = Get-FeatureAdoption -AdoptionSignals $signals -LicenseUtilization $license -FeatureMap $csvMap -AssessmentFolder 'C:\nonexistent'
        $results[0].AdoptionState | Should -Be 'Adopted'
        $results[0].DepthMetric | Should -Be ''
    }
}
