BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-TeamsInventory' {
    BeforeAll {
        # Stub Graph cmdlets so Mock can find them
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

        # Mock Import-Module to prevent actual module loading
        Mock Import-Module { }

        # Mock Invoke-MgGraphRequest with switch for different endpoints
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri, $OutputFilePath, $Headers)
            switch -Wildcard ($Uri) {
                '*/groups?*resourceProvisioningOptions*' {
                    return @{
                        value = @(
                            @{
                                id              = 'team-001'
                                displayName     = 'Engineering'
                                description     = 'Engineering team'
                                visibility      = 'Private'
                                createdDateTime = '2023-06-01T00:00:00Z'
                                mail            = 'engineering@contoso.com'
                            }
                            @{
                                id              = 'team-002'
                                displayName     = 'Company Wide'
                                description     = 'All employees'
                                visibility      = 'Public'
                                createdDateTime = '2022-01-15T00:00:00Z'
                                mail            = 'companywide@contoso.com'
                            }
                        )
                        '@odata.nextLink' = $null
                    }
                }
                '*/teams/team-001' {
                    return @{ isArchived = $false }
                }
                '*/teams/team-002' {
                    return @{ isArchived = $true }
                }
                '*/groups/team-001/owners*' {
                    return @{
                        value = @(
                            @{ displayName = 'Alice Smith'; userPrincipalName = 'alice@contoso.com' }
                        )
                    }
                }
                '*/groups/team-002/owners*' {
                    return @{
                        value = @(
                            @{ displayName = 'Bob Jones'; userPrincipalName = 'bob@contoso.com' }
                            @{ displayName = 'Carol Davis'; userPrincipalName = 'carol@contoso.com' }
                        )
                    }
                }
                '*/groups/team-001/members?*' {
                    return @{ '@odata.count' = 15; value = @(@{ id = 'm1' }) }
                }
                '*/groups/team-002/members?*' {
                    return @{ '@odata.count' = 150; value = @(@{ id = 'm1' }) }
                }
                '*/teams/team-001/channels*' {
                    return @{
                        value = @(
                            @{ id = 'ch1'; displayName = 'General'; membershipType = 'standard' }
                            @{ id = 'ch2'; displayName = 'Design'; membershipType = 'private' }
                            @{ id = 'ch3'; displayName = 'Shared-Partners'; membershipType = 'shared' }
                        )
                    }
                }
                '*/teams/team-002/channels*' {
                    return @{
                        value = @(
                            @{ id = 'ch1'; displayName = 'General'; membershipType = 'standard' }
                        )
                    }
                }
                default {
                    return @{ value = @() }
                }
            }
        }

        # Dot-source the collector and capture pipeline output
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $script:results = . "$PSScriptRoot/../../src/M365-Assess/Inventory/Get-TeamsInventory.ps1"
    }

    It 'Returns a non-empty result list' {
        $script:results | Should -Not -BeNullOrEmpty
        $script:results.Count | Should -Be 2
    }

    It 'Each result has all expected properties' {
        $expectedProps = @(
            'DisplayName', 'Mail', 'Visibility', 'Description', 'CreatedDateTime',
            'IsArchived', 'OwnerCount', 'Owners', 'MemberCount', 'ChannelCount',
            'PrivateChannels', 'SharedChannels'
        )
        foreach ($result in $script:results) {
            foreach ($prop in $expectedProps) {
                $result.PSObject.Properties.Name | Should -Contain $prop `
                    -Because "result for '$($result.DisplayName)' should have property '$prop'"
            }
        }
    }

    It 'Correctly identifies archived status' {
        $eng = $script:results | Where-Object { $_.DisplayName -eq 'Engineering' }
        $eng.IsArchived | Should -Be $false

        $company = $script:results | Where-Object { $_.DisplayName -eq 'Company Wide' }
        $company.IsArchived | Should -Be $true
    }

    It 'Reports correct owner counts and owner list' {
        $eng = $script:results | Where-Object { $_.DisplayName -eq 'Engineering' }
        $eng.OwnerCount | Should -Be 1
        $eng.Owners | Should -Be 'alice@contoso.com'

        $company = $script:results | Where-Object { $_.DisplayName -eq 'Company Wide' }
        $company.OwnerCount | Should -Be 2
        $company.Owners | Should -Match 'bob@contoso.com'
    }

    It 'Reports correct channel counts including private and shared' {
        $eng = $script:results | Where-Object { $_.DisplayName -eq 'Engineering' }
        $eng.ChannelCount | Should -Be 3
        $eng.PrivateChannels | Should -Be 1
        $eng.SharedChannels | Should -Be 1

        $company = $script:results | Where-Object { $_.DisplayName -eq 'Company Wide' }
        $company.ChannelCount | Should -Be 1
        $company.PrivateChannels | Should -Be 0
        $company.SharedChannels | Should -Be 0
    }

    Context 'When not connected to Microsoft Graph' {
        It 'Writes an error' {
            function Get-MgContext { return $null }

            $caughtError = $null
            try {
                . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
                . "$PSScriptRoot/../../src/M365-Assess/Inventory/Get-TeamsInventory.ps1"
            }
            catch {
                $caughtError = $_
            }
            $caughtError | Should -Not -BeNullOrEmpty
            $caughtError.ToString() | Should -Match 'Not connected to Microsoft Graph'
        }
    }

    Context 'When no teams exist' {
        It 'Returns nothing' {
            function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

            Mock Invoke-MgGraphRequest {
                param($Method, $Uri)
                return @{ value = @(); '@odata.nextLink' = $null }
            }

            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            $output = . "$PSScriptRoot/../../src/M365-Assess/Inventory/Get-TeamsInventory.ps1"
            $output | Should -BeNullOrEmpty
        }
    }
}
