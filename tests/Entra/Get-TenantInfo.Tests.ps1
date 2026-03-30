BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-TenantInfo' {
    BeforeAll {
        # Stub Get-MgContext so the connection check passes
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

        # Stub Import-Module to prevent actual module loading
        Mock Import-Module { }

        # Mock Get-MgOrganization with realistic org data
        Mock Get-MgOrganization {
            return @(
                [PSCustomObject]@{
                    DisplayName     = 'Contoso Corporation'
                    Id              = '00000000-0000-0000-0000-000000000001'
                    CreatedDateTime = '2020-01-01T00:00:00Z'
                }
            )
        }

        # Mock Get-MgDomain with verified and unverified domains
        Mock Get-MgDomain {
            return @(
                [PSCustomObject]@{
                    Id         = 'contoso.com'
                    IsDefault  = $true
                    IsVerified = $true
                },
                [PSCustomObject]@{
                    Id         = 'contoso.onmicrosoft.com'
                    IsDefault  = $false
                    IsVerified = $true
                },
                [PSCustomObject]@{
                    Id         = 'pending.contoso.com'
                    IsDefault  = $false
                    IsVerified = $false
                }
            )
        }

        # Mock Invoke-MgGraphRequest for security defaults
        Mock Invoke-MgGraphRequest {
            return @{ isEnabled = $false }
        }

        # Run the collector
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $result = & "$PSScriptRoot/../../src/M365-Assess/Entra/Get-TenantInfo.ps1"
    }

    It 'Returns a non-empty tenant report' {
        $result | Should -Not -BeNullOrEmpty
    }

    It 'Output has expected properties' {
        $first = $result | Select-Object -First 1
        $first.PSObject.Properties.Name | Should -Contain 'OrgDisplayName'
        $first.PSObject.Properties.Name | Should -Contain 'TenantId'
        $first.PSObject.Properties.Name | Should -Contain 'VerifiedDomains'
        $first.PSObject.Properties.Name | Should -Contain 'DefaultDomain'
        $first.PSObject.Properties.Name | Should -Contain 'SecurityDefaultsEnabled'
    }

    It 'Only includes verified domains in VerifiedDomains field' {
        $first = $result | Select-Object -First 1
        $first.VerifiedDomains | Should -Match 'contoso\.com'
        $first.VerifiedDomains | Should -Not -Match 'pending\.contoso\.com'
    }

    It 'Identifies the default domain correctly' {
        $first = $result | Select-Object -First 1
        $first.DefaultDomain | Should -Be 'contoso.com'
    }

    It 'Reports security defaults status' {
        $first = $result | Select-Object -First 1
        $first.SecurityDefaultsEnabled | Should -Be $false
    }
}

Describe 'Get-TenantInfo - Edge Cases' {
    BeforeAll {
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }
        Mock Import-Module { }
    }

    Context 'when security defaults endpoint fails' {
        BeforeAll {
            Mock Get-MgOrganization {
                return @([PSCustomObject]@{
                    DisplayName     = 'Test Org'
                    Id              = '00000000-0000-0000-0000-000000000002'
                    CreatedDateTime = '2021-06-01T00:00:00Z'
                })
            }
            Mock Get-MgDomain {
                return @([PSCustomObject]@{
                    Id = 'test.onmicrosoft.com'; IsDefault = $true; IsVerified = $true
                })
            }
            Mock Invoke-MgGraphRequest { throw 'Forbidden' }

            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            $result = & "$PSScriptRoot/../../src/M365-Assess/Entra/Get-TenantInfo.ps1"
        }

        It 'Falls back to N/A for security defaults' {
            $first = $result | Select-Object -First 1
            $first.SecurityDefaultsEnabled | Should -Be 'N/A'
        }
    }
}
