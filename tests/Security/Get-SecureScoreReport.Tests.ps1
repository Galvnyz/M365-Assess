BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-SecureScoreReport' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"

        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }
        function Get-MgSecuritySecureScore { }
        function Get-MgSecuritySecureScoreControlProfile { }
        Mock Import-Module { }

        Mock Get-MgSecuritySecureScore {
            return @(
                [PSCustomObject]@{
                    CurrentScore             = 72
                    MaxScore                 = 100
                    CreatedDateTime          = (Get-Date).AddDays(-1)
                    AverageComparativeScores = @(
                        [PSCustomObject]@{ Basis = 'AllTenants'; AverageScore = 55 }
                    )
                    ControlScores            = @(
                        [PSCustomObject]@{
                            ControlName  = 'MFARegistrationV2'
                            Score        = 10
                            Description  = 'Register all users for MFA'
                            ControlCategory = 'Identity'
                        },
                        [PSCustomObject]@{
                            ControlName  = 'AdminMFAV2'
                            Score        = 10
                            Description  = 'Require MFA for admins'
                            ControlCategory = 'Identity'
                        }
                    )
                }
            )
        }

        Mock Get-MgSecuritySecureScoreControlProfile {
            return @(
                [PSCustomObject]@{
                    Id               = 'MFARegistrationV2'
                    MaxScore         = 10
                    ImplementationCost = 'Low'
                    UserImpact         = 'Low'
                    Rank               = 1
                    Threats            = @('AccountBreach')
                    RemediationImpact  = 'High'
                }
            )
        }

        $script:result = & "$PSScriptRoot/../../src/M365-Assess/Security/Get-SecureScoreReport.ps1"
    }

    It 'Should return Secure Score data' {
        $script:result | Should -Not -BeNullOrEmpty
    }

    It 'Should include current score percentage' {
        $script:result.CurrentScore | Should -Be 72
    }

    It 'Should include max score' {
        $script:result.MaxScore | Should -Be 100
    }

    It 'Should include percentage calculation' {
        $script:result.Percentage | Should -Be 72
    }

    It 'Should include average comparative score' {
        $script:result.AverageComparativeScore | Should -Be 55
    }
}

Describe 'Get-SecureScoreReport - AdditionalProperties fallback' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"

        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }
        function Get-MgSecuritySecureScore { }
        Mock Import-Module { }

        Mock Get-MgSecuritySecureScore {
            return @(
                [PSCustomObject]@{
                    CurrentScore             = 60
                    MaxScore                 = 100
                    CreatedDateTime          = (Get-Date).AddDays(-1)
                    AverageComparativeScores = @(
                        [PSCustomObject]@{
                            Basis              = $null
                            AverageScore       = $null
                            AdditionalProperties = @{
                                'basis'        = 'AllTenants'
                                'averageScore' = 48.2
                            }
                        }
                    )
                    ControlScores            = @()
                }
            )
        }

        $script:result = & "$PSScriptRoot/../../src/M365-Assess/Security/Get-SecureScoreReport.ps1"
    }

    It 'Should extract average from AdditionalProperties' {
        $script:result.AverageComparativeScore | Should -Be 48.2
    }
}

Describe 'Get-SecureScoreReport - No Data' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"

        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }
        function Get-MgSecuritySecureScore { }
        Mock Import-Module { }
        Mock Get-MgSecuritySecureScore { return @() }
    }

    It 'Should handle empty Secure Score gracefully' {
        $result = & "$PSScriptRoot/../../src/M365-Assess/Security/Get-SecureScoreReport.ps1" -WarningAction SilentlyContinue
        $result | Should -BeNullOrEmpty
    }
}
