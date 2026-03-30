BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-AppRegistrationReport' {
    BeforeAll {
        # Stub Get-MgContext so the connection check passes
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

        # Stub Import-Module to prevent actual module loading
        Mock Import-Module { }

        # Mock Get-MgApplication with realistic app registration data
        Mock Get-MgApplication {
            $now = Get-Date
            return @(
                [PSCustomObject]@{
                    DisplayName         = 'Test App One'
                    AppId               = '11111111-1111-1111-1111-111111111111'
                    CreatedDateTime     = '2024-06-01T10:00:00Z'
                    SignInAudience      = 'AzureADMyOrg'
                    PasswordCredentials = @(
                        @{ EndDateTime = $now.AddDays(30) },
                        @{ EndDateTime = $now.AddDays(-10) }
                    )
                    KeyCredentials      = @(
                        @{ EndDateTime = $now.AddDays(60) }
                    )
                },
                [PSCustomObject]@{
                    DisplayName         = 'No Credentials App'
                    AppId               = '22222222-2222-2222-2222-222222222222'
                    CreatedDateTime     = '2025-01-15T08:00:00Z'
                    SignInAudience      = 'AzureADMultipleOrgs'
                    PasswordCredentials = @()
                    KeyCredentials      = @()
                }
            )
        }

        # Run the collector
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $result = & "$PSScriptRoot/../../src/M365-Assess/Entra/Get-AppRegistrationReport.ps1"
    }

    It 'Returns a non-empty app report' {
        $result | Should -Not -BeNullOrEmpty
    }

    It 'Output has expected properties' {
        $first = $result | Select-Object -First 1
        $first.PSObject.Properties.Name | Should -Contain 'DisplayName'
        $first.PSObject.Properties.Name | Should -Contain 'AppId'
        $first.PSObject.Properties.Name | Should -Contain 'PasswordCredentialCount'
        $first.PSObject.Properties.Name | Should -Contain 'KeyCredentialCount'
        $first.PSObject.Properties.Name | Should -Contain 'ExpiredCredentials'
        $first.PSObject.Properties.Name | Should -Contain 'EarliestExpiry'
    }

    It 'Counts credentials correctly' {
        $appWithCreds = $result | Where-Object { $_.DisplayName -eq 'Test App One' }
        $appWithCreds.PasswordCredentialCount | Should -Be 2
        $appWithCreds.KeyCredentialCount | Should -Be 1
    }

    It 'Detects expired credentials' {
        $appWithCreds = $result | Where-Object { $_.DisplayName -eq 'Test App One' }
        $appWithCreds.ExpiredCredentials | Should -BeGreaterThan 0
    }

    It 'Handles apps with no credentials' {
        $noCreds = $result | Where-Object { $_.DisplayName -eq 'No Credentials App' }
        $noCreds.PasswordCredentialCount | Should -Be 0
        $noCreds.KeyCredentialCount | Should -Be 0
        $noCreds.EarliestExpiry | Should -Be ''
    }
}

Describe 'Get-AppRegistrationReport - Edge Cases' {
    BeforeAll {
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }
        Mock Import-Module { }
    }

    Context 'when no app registrations exist' {
        BeforeAll {
            Mock Get-MgApplication { return @() }
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            $result = & "$PSScriptRoot/../../src/M365-Assess/Entra/Get-AppRegistrationReport.ps1"
        }

        It 'Returns empty result without error' {
            $result | Should -BeNullOrEmpty
        }
    }
}
