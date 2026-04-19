BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-AdminRoleReport' {
    BeforeAll {
        # Stub Get-MgContext so the connection check passes
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

        # Stub Import-Module to prevent actual module loading
        Mock Import-Module { }

        # Mock Get-MgDirectoryRole to return activated roles
        Mock Get-MgDirectoryRole {
            return @(
                [PSCustomObject]@{
                    Id          = 'role-ga-id'
                    DisplayName = 'Global Administrator'
                },
                [PSCustomObject]@{
                    Id          = 'role-ua-id'
                    DisplayName = 'User Administrator'
                }
            )
        }

        # Mock Get-MgDirectoryRoleMember to return members per role
        Mock Get-MgDirectoryRoleMember {
            param($DirectoryRoleId)
            switch ($DirectoryRoleId) {
                'role-ga-id' {
                    return @(
                        [PSCustomObject]@{
                            Id                   = 'user-1'
                            AdditionalProperties = @{
                                'displayName'       = 'Admin One'
                                'userPrincipalName' = 'admin1@contoso.com'
                                '@odata.type'       = '#microsoft.graph.user'
                            }
                        },
                        [PSCustomObject]@{
                            Id                   = 'sp-1'
                            AdditionalProperties = @{
                                'displayName'       = 'Automation App'
                                'userPrincipalName' = $null
                                '@odata.type'       = '#microsoft.graph.servicePrincipal'
                            }
                        }
                    )
                }
                'role-ua-id' {
                    return @(
                        [PSCustomObject]@{
                            Id                   = 'user-2'
                            AdditionalProperties = @{
                                'displayName'       = 'Admin Two'
                                'userPrincipalName' = 'admin2@contoso.com'
                                '@odata.type'       = '#microsoft.graph.user'
                            }
                        }
                    )
                }
            }
        }

        # Mock Get-MgUser for per-user OnPremisesSyncEnabled fetch
        Mock Get-MgUser {
            param($UserId)
            switch ($UserId) {
                'user-1' { return [PSCustomObject]@{ OnPremisesSyncEnabled = $true } }
                'user-2' { return [PSCustomObject]@{ OnPremisesSyncEnabled = $false } }
                default  { return [PSCustomObject]@{ OnPremisesSyncEnabled = $null } }
            }
        }

        # Run the collector
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $result = & "$PSScriptRoot/../../src/M365-Assess/Entra/Get-AdminRoleReport.ps1"
    }

    It 'Returns a non-empty role report' {
        $result | Should -Not -BeNullOrEmpty
    }

    It 'Output has expected properties' {
        $first = $result | Select-Object -First 1
        $first.PSObject.Properties.Name | Should -Contain 'RoleName'
        $first.PSObject.Properties.Name | Should -Contain 'MemberDisplayName'
        $first.PSObject.Properties.Name | Should -Contain 'MemberUPN'
        $first.PSObject.Properties.Name | Should -Contain 'MemberType'
        $first.PSObject.Properties.Name | Should -Contain 'OnPremisesSyncEnabled'
    }

    It 'Maps service principals to friendly type' {
        $sp = $result | Where-Object { $_.MemberDisplayName -eq 'Automation App' }
        $sp | Should -Not -BeNullOrEmpty
        $sp.MemberType | Should -Be 'ServicePrincipal'
    }

    It 'Populates OnPremisesSyncEnabled True for synced users' {
        $user = $result | Where-Object { $_.MemberId -eq 'user-1' }
        $user.OnPremisesSyncEnabled | Should -Be 'True'
    }

    It 'Populates OnPremisesSyncEnabled False for cloud-only users' {
        $user = $result | Where-Object { $_.MemberId -eq 'user-2' }
        $user.OnPremisesSyncEnabled | Should -Be 'False'
    }

    It 'Leaves OnPremisesSyncEnabled blank for service principals' {
        $sp = $result | Where-Object { $_.MemberType -eq 'ServicePrincipal' }
        $sp.OnPremisesSyncEnabled | Should -Be ''
    }

    It 'Includes members from all roles' {
        $roleNames = $result | Select-Object -ExpandProperty RoleName -Unique
        $roleNames | Should -Contain 'Global Administrator'
        $roleNames | Should -Contain 'User Administrator'
    }
}

Describe 'Get-AdminRoleReport - Edge Cases' {
    BeforeAll {
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }
        Mock Import-Module { }
    }

    Context 'when no directory roles are activated' {
        BeforeAll {
            Mock Get-MgDirectoryRole { return @() }
            Mock Get-MgDirectoryRoleMember { return @() }
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            $result = & "$PSScriptRoot/../../src/M365-Assess/Entra/Get-AdminRoleReport.ps1"
        }

        It 'Returns empty result without error' {
            $result | Should -BeNullOrEmpty
        }
    }

    Context 'when a role has no members' {
        BeforeAll {
            Mock Get-MgDirectoryRole {
                return @([PSCustomObject]@{ Id = 'empty-role'; DisplayName = 'Empty Role' })
            }
            Mock Get-MgDirectoryRoleMember { return @() }
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            $result = & "$PSScriptRoot/../../src/M365-Assess/Entra/Get-AdminRoleReport.ps1"
        }

        It 'Skips roles with no members' {
            $result | Should -BeNullOrEmpty
        }
    }
}
