BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-EntAppSecurityConfig' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

        Mock Import-Module { }

        Mock Invoke-MgGraphRequest {
            param($Method, $Uri)
            switch -Wildcard ($Uri) {
                '*/organization' {
                    return @{ value = @(
                        @{ id = 'tenant-id-001' }
                    )}
                }
                '*/servicePrincipals?*' {
                    return @{ value = @(
                        @{
                            id                       = 'sp-001'
                            appId                    = 'app-001'
                            displayName              = 'Internal App'
                            appOwnerOrganizationId   = 'tenant-id-001'
                            servicePrincipalType     = 'Application'
                            accountEnabled           = $true
                            keyCredentials           = @(@{ keyId = 'key-1' })
                            passwordCredentials      = @()
                        }
                        @{
                            id                       = 'sp-002'
                            appId                    = 'app-002'
                            displayName              = 'Foreign Risky App'
                            appOwnerOrganizationId   = 'foreign-tenant-999'
                            servicePrincipalType     = 'Application'
                            accountEnabled           = $true
                            keyCredentials           = @()
                            passwordCredentials      = @(@{ keyId = 'pwd-1' })
                        }
                        @{
                            id                       = 'sp-003'
                            appId                    = 'app-003'
                            displayName              = 'My Managed Identity'
                            appOwnerOrganizationId   = 'tenant-id-001'
                            servicePrincipalType     = 'ManagedIdentity'
                            accountEnabled           = $true
                            keyCredentials           = @()
                            passwordCredentials      = @()
                        }
                    )}
                }
                '*/roleManagement/directory/roleAssignments*' {
                    return @{ value = @() }
                }
                '*/servicePrincipals/sp-001/appRoleAssignments' {
                    return @{ value = @() }
                }
                '*/servicePrincipals/sp-002/appRoleAssignments' {
                    return @{ value = @() }
                }
                '*/servicePrincipals/sp-003/appRoleAssignments' {
                    return @{ value = @() }
                }
                '*/servicePrincipals/*/oauth2PermissionGrants' {
                    return @{ value = @() }
                }
                '*/servicePrincipals/*?*signInActivity*' {
                    return @{ signInActivity = @{ lastSignInDateTime = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssZ') } }
                }
                '*/policies/defaultAppManagementPolicy' {
                    return @{ isEnabled = $false }
                }
                default {
                    return @{ value = @() }
                }
            }
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Entra/Get-EntAppSecurityConfig.ps1"
    }

    It 'Returns a non-empty settings list' {
        $settings.Count | Should -BeGreaterThan 0
    }

    It 'All settings have required properties' {
        foreach ($s in $settings) {
            $s.PSObject.Properties.Name | Should -Contain 'Category'
            $s.PSObject.Properties.Name | Should -Contain 'Setting'
            $s.PSObject.Properties.Name | Should -Contain 'Status'
            $s.PSObject.Properties.Name | Should -Contain 'CurrentValue'
            $s.PSObject.Properties.Name | Should -Contain 'RecommendedValue'
            $s.PSObject.Properties.Name | Should -Contain 'CheckId'
        }
    }

    It 'All Status values are valid' {
        $validStatuses = @('Pass', 'Fail', 'Warning', 'Review', 'Info', 'N/A')
        foreach ($s in $settings) {
            $s.Status | Should -BeIn $validStatuses `
                -Because "Setting '$($s.Setting)' has status '$($s.Status)'"
        }
    }

    It 'All non-empty CheckIds follow naming convention' {
        $withCheckId = $settings | Where-Object { $_.CheckId -and $_.CheckId.Trim() -ne '' }
        $withCheckId.Count | Should -BeGreaterThan 0
        foreach ($s in $withCheckId) {
            $s.CheckId | Should -Match '^[A-Z]+(-[A-Z0-9]+)+-\d{3}(\.\d+)?$' `
                -Because "CheckId '$($s.CheckId)' should follow convention"
        }
    }

    It 'ENTRA-ENTAPP-001 check produces a result for apps with credentials' {
        $check = $settings | Where-Object { $_.CheckId -like 'ENTRA-ENTAPP-001*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Category | Should -Be 'Enterprise Applications'
    }

    It 'ENTRA-ENTAPP-003 check produces a result for foreign app permissions' {
        $check = $settings | Where-Object { $_.CheckId -like 'ENTRA-ENTAPP-003*' }
        $check | Should -Not -BeNullOrEmpty
    }

    It 'ENTRA-ENTAPP-008 check produces a result for managed identity permissions' {
        $check = $settings | Where-Object { $_.CheckId -like 'ENTRA-ENTAPP-008*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Category | Should -Be 'Managed Identities'
    }

    It 'ENTRA-ENTAPP-009 check produces a result for managed identity roles' {
        $check = $settings | Where-Object { $_.CheckId -like 'ENTRA-ENTAPP-009*' }
        $check | Should -Not -BeNullOrEmpty
    }

    It 'Produces settings across Enterprise Applications and Managed Identities categories' {
        $categories = $settings | Select-Object -ExpandProperty Category -Unique
        $categories | Should -Contain 'Enterprise Applications'
        $categories | Should -Contain 'Managed Identities'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-EntAppSecurityConfig - ENTRA-ENTAPP-020 Microsoft tenant exclusion' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }
        Mock Import-Module { }

        Mock Invoke-MgGraphRequest {
            param($Method, $Uri)
            switch -Wildcard ($Uri) {
                '*/organization' {
                    return @{ value = @(@{ id = 'tenant-id-001' }) }
                }
                '*/servicePrincipals?*' {
                    return @{ value = @(
                        # Legitimate Microsoft first-party SP — should NOT be flagged
                        @{
                            id                     = 'sp-ms-001'
                            appId                  = 'ms-app-001'
                            displayName            = 'Microsoft Intune Service Discovery'
                            appOwnerOrganizationId = 'f8cdef31-a31e-4b4a-93e4-5f571e91255a'
                            servicePrincipalType   = 'Application'
                            accountEnabled         = $true
                            keyCredentials         = @()
                            passwordCredentials    = @()
                        }
                        # Third-party SP with Microsoft-like name — SHOULD be flagged
                        @{
                            id                     = 'sp-evil-001'
                            appId                  = 'evil-app-001'
                            displayName            = 'Microsoft Defender Fake'
                            appOwnerOrganizationId = 'evil-tenant-999'
                            servicePrincipalType   = 'Application'
                            accountEnabled         = $true
                            keyCredentials         = @()
                            passwordCredentials    = @()
                        }
                    )}
                }
                '*/roleManagement/directory/roleAssignments*' { return @{ value = @() } }
                '*/policies/defaultAppManagementPolicy'        { return @{ isEnabled = $false } }
                default                                        { return @{ value = @() } }
            }
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Entra/Get-EntAppSecurityConfig.ps1"
    }

    It 'should not flag legitimate Microsoft first-party SPs from the Microsoft tenant' {
        $check = $settings | Where-Object { $_.Setting -eq 'Foreign Apps Impersonating Microsoft Names' }
        $check | Should -Not -BeNullOrEmpty
        $check.CurrentValue | Should -Not -Match 'Microsoft Intune Service Discovery'
    }

    It 'should flag genuinely foreign SPs with Microsoft-like names' {
        $check = $settings | Where-Object { $_.Setting -eq 'Foreign Apps Impersonating Microsoft Names' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
        $check.CurrentValue | Should -Match 'Microsoft Defender Fake'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}
