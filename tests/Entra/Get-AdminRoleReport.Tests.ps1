BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-AdminRoleReport' {
    BeforeAll {
        # Stub Get-MgContext so the connection check passes
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }
        function Get-MgDirectoryRole { param([switch]$All) }
        function Get-MgDirectoryRoleMember { param($DirectoryRoleId, [switch]$All) }
        function Invoke-GraphReadBatch { param($Requests) }

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

        Mock Invoke-GraphReadBatch {
            @{
                'user-1' = @{status=200;body=@{onPremisesSyncEnabled=$true}}
                'user-2' = @{status=200;body=@{onPremisesSyncEnabled=$false}}
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
        function Get-MgDirectoryRole { param([switch]$All) }
        function Get-MgDirectoryRoleMember { param($DirectoryRoleId, [switch]$All) }
        function Invoke-GraphReadBatch { param($Requests) }
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

    Context 'when users have repeated roles or unavailable sync evidence' {
        BeforeAll {
            Mock Get-MgDirectoryRole { @([pscustomobject]@{Id='a';DisplayName='A'},[pscustomobject]@{Id='b';DisplayName='B'}) }
            Mock Get-MgDirectoryRoleMember {
                @('known','denied','missing-value','null-value') | ForEach-Object {
                    [pscustomobject]@{Id=$_;AdditionalProperties=@{'@odata.type'='#microsoft.graph.user';displayName=$_}}
                }
            }
            Mock Invoke-GraphReadBatch {
                $Requests.Count | Should -Be 4
                @{
                    known=@{status=200;body=@{onPremisesSyncEnabled=$false}}
                    denied=@{status=403}
                    'missing-value'=@{status=200;body=@{id='missing-value'}}
                    'null-value'=@{status=200;body=@{onPremisesSyncEnabled=$null}}
                }
            }
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            $result = & "$PSScriptRoot/../../src/M365-Assess/Entra/Get-AdminRoleReport.ps1"
        }
        It 'resolves each unique user once while retaining all role assignments' {
            @($result).Count | Should -Be 8
            Should -Invoke Invoke-GraphReadBatch -Times 1 -Exactly -Scope Context
        }
        It 'does not turn missing or forbidden evidence into False' {
            @($result | Where-Object { $_.MemberId -in @('denied','missing-value') -and $_.OnPremisesSyncEnabled -ne '' }).Count | Should -Be 0
        }
        It 'preserves explicitly null Graph sync state as not currently synced' {
            @($result | Where-Object { $_.MemberId -eq 'null-value' -and $_.OnPremisesSyncEnabled -eq 'False' }).Count | Should -Be 2
        }
    }
}
