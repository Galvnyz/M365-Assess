BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-StrykerIncidentReadiness' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"

        function Get-MgContext { return @{ TenantId = 'test-tenant-id'; AuthType = 'Delegated' } }
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        # Stub Mg cmdlets so Pester's Mock can find them even when
        # Microsoft.Graph isn't imported (local runs); CI has them anyway.
        function Get-MgDirectoryRole { param($Filter) }
        function Get-MgDirectoryRoleMemberAsUser { param($DirectoryRoleId, [switch]$All) }
        function Get-MgIdentityConditionalAccessPolicy { param([switch]$All) }
        function Get-MgServicePrincipal { param($Filter, [switch]$All) }
        function Invoke-MgGraphRequest { param($Method, $Uri, $Body, $ErrorAction) }

        Mock Import-Module { }

        # Mock Graph calls for admin role checks
        Mock Get-MgDirectoryRole {
            return @(
                [PSCustomObject]@{ Id = 'ga-role-id'; DisplayName = 'Global Administrator'; RoleTemplateId = '62e90394-69f5-4237-9190-012177145e10' }
            )
        }
        Mock Get-MgDirectoryRoleMemberAsUser {
            return @(
                [PSCustomObject]@{
                    Id                = 'user-1'
                    DisplayName       = 'Admin One'
                    UserPrincipalName = 'admin1@contoso.com'
                    SignInActivity    = @{
                        LastSignInDateTime                = (Get-Date).AddDays(-10)
                        LastNonInteractiveSignInDateTime   = (Get-Date).AddDays(-5)
                    }
                    OnPremisesSyncEnabled = $false
                }
            )
        }

        # Mock CA policies
        Mock Get-MgIdentityConditionalAccessPolicy {
            return @(
                [PSCustomObject]@{
                    DisplayName   = 'Require MFA for admins'
                    State         = 'enabled'
                    Conditions    = @{
                        Users = @{
                            IncludeRoles    = @('62e90394-69f5-4237-9190-012177145e10')
                            ExcludeUsers    = @()
                            ExcludeGroups   = @()
                        }
                    }
                    GrantControls = @{
                        BuiltInControls        = @('mfa')
                        AuthenticationStrength = $null
                    }
                }
            )
        }

        # Mock Intune checks
        Mock Invoke-MgGraphRequest { return @{ value = @() } }

        # Mock service principal check
        Mock Get-MgServicePrincipal { return @() }

        . "$PSScriptRoot/../../src/M365-Assess/Security/Get-StrykerIncidentReadiness.ps1"
    }

    It 'Should produce a non-empty settings list' {
        $settings.Count | Should -BeGreaterThan 0
    }

    It 'Should have required properties on all settings' {
        foreach ($s in $settings) {
            $s.PSObject.Properties.Name | Should -Contain 'Category'
            $s.PSObject.Properties.Name | Should -Contain 'Setting'
            $s.PSObject.Properties.Name | Should -Contain 'Status'
        }
    }

    It 'Should include Stale Admin Detection category' {
        $categories = $settings | Select-Object -ExpandProperty Category -Unique
        $categories | Should -Contain 'Stale Admin Detection'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

# Issue #891: dedicated tests for ENTRA-BREAKGLASS-001 threshold logic.
# After #888 consolidation, the threshold became:
#   0 detected            -> Fail
#   1 detected            -> Warning (single point of failure)
#   2+ high confidence    -> Pass (name match)
#   2+ medium confidence  -> Warning (CA-exclusion-only)
# Each scenario re-mocks Get-MgDirectoryRoleMemberAsUser + (sometimes) the
# CA policy excludes, then dot-sources the collector and inspects the
# emitted ENTRA-BREAKGLASS-001 setting.

Describe 'ENTRA-BREAKGLASS-001 threshold (0 break-glass)' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        function Get-MgContext { return @{ TenantId = 'test-tenant-id'; AuthType = 'Delegated' } }
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        # Stub Mg cmdlets so Pester's Mock can find them even when
        # Microsoft.Graph isn't imported (local runs); CI has them anyway.
        function Get-MgDirectoryRole { param($Filter) }
        function Get-MgDirectoryRoleMemberAsUser { param($DirectoryRoleId, [switch]$All) }
        function Get-MgIdentityConditionalAccessPolicy { param([switch]$All) }
        function Get-MgServicePrincipal { param($Filter, [switch]$All) }
        function Invoke-MgGraphRequest { param($Method, $Uri, $Body, $ErrorAction) }
        Mock Import-Module { }
        Mock Get-MgDirectoryRole {
            @([PSCustomObject]@{ Id = 'ga-role-id'; DisplayName = 'Global Administrator'; RoleTemplateId = '62e90394-69f5-4237-9190-012177145e10' })
        }
        Mock Get-MgDirectoryRoleMemberAsUser {
            @(
                [PSCustomObject]@{ Id = 'user-1'; DisplayName = 'Daren Maranya';   UserPrincipalName = 'daren@contoso.com'; SignInActivity = @{ LastSignInDateTime = (Get-Date).AddDays(-1); LastNonInteractiveSignInDateTime = (Get-Date).AddDays(-1) }; OnPremisesSyncEnabled = $false }
                [PSCustomObject]@{ Id = 'user-2'; DisplayName = 'Admin Account';    UserPrincipalName = 'admin@contoso.com'; SignInActivity = @{ LastSignInDateTime = (Get-Date).AddDays(-1); LastNonInteractiveSignInDateTime = (Get-Date).AddDays(-1) }; OnPremisesSyncEnabled = $false }
            )
        }
        Mock Get-MgIdentityConditionalAccessPolicy { @() }
        Mock Invoke-MgGraphRequest { @{ value = @() } }
        Mock Get-MgServicePrincipal { @() }
        . "$PSScriptRoot/../../src/M365-Assess/Security/Get-StrykerIncidentReadiness.ps1"
    }

    It 'is Fail when no break-glass-named admin exists' {
        $bg = $settings | Where-Object { $_.CheckId -like 'ENTRA-BREAKGLASS-001*' -and $_.Setting -eq 'Break-glass emergency access account' } | Select-Object -First 1
        $bg | Should -Not -BeNullOrEmpty
        $bg.Status | Should -Be 'Fail'
        $bg.CurrentValue | Should -Match 'No break-glass account detected'
    }

    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}

Describe 'ENTRA-BREAKGLASS-001 threshold (1 break-glass — single point of failure)' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        function Get-MgContext { return @{ TenantId = 'test-tenant-id'; AuthType = 'Delegated' } }
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        # Stub Mg cmdlets so Pester's Mock can find them even when
        # Microsoft.Graph isn't imported (local runs); CI has them anyway.
        function Get-MgDirectoryRole { param($Filter) }
        function Get-MgDirectoryRoleMemberAsUser { param($DirectoryRoleId, [switch]$All) }
        function Get-MgIdentityConditionalAccessPolicy { param([switch]$All) }
        function Get-MgServicePrincipal { param($Filter, [switch]$All) }
        function Invoke-MgGraphRequest { param($Method, $Uri, $Body, $ErrorAction) }
        Mock Import-Module { }
        Mock Get-MgDirectoryRole {
            @([PSCustomObject]@{ Id = 'ga-role-id'; DisplayName = 'Global Administrator'; RoleTemplateId = '62e90394-69f5-4237-9190-012177145e10' })
        }
        Mock Get-MgDirectoryRoleMemberAsUser {
            @(
                [PSCustomObject]@{ Id = 'user-1'; DisplayName = 'Daren Maranya'; UserPrincipalName = 'daren@contoso.com'; SignInActivity = @{ LastSignInDateTime = (Get-Date).AddDays(-1); LastNonInteractiveSignInDateTime = (Get-Date).AddDays(-1) }; OnPremisesSyncEnabled = $false }
                [PSCustomObject]@{ Id = 'user-2'; DisplayName = 'Break Glass Admin'; UserPrincipalName = 'bgadmin@contoso.com'; SignInActivity = @{ LastSignInDateTime = $null; LastNonInteractiveSignInDateTime = $null }; OnPremisesSyncEnabled = $false }
            )
        }
        Mock Get-MgIdentityConditionalAccessPolicy { @() }
        Mock Invoke-MgGraphRequest { @{ value = @() } }
        Mock Get-MgServicePrincipal { @() }
        . "$PSScriptRoot/../../src/M365-Assess/Security/Get-StrykerIncidentReadiness.ps1"
    }

    It 'is Warning with single-point-of-failure messaging when only 1 break-glass is detected' {
        $bg = $settings | Where-Object { $_.CheckId -like 'ENTRA-BREAKGLASS-001*' -and $_.Setting -eq 'Break-glass emergency access account' } | Select-Object -First 1
        $bg | Should -Not -BeNullOrEmpty
        $bg.Status | Should -Be 'Warning'
        $bg.CurrentValue | Should -Match 'single point of failure'
    }

    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}

Describe 'ENTRA-BREAKGLASS-001 threshold (2+ high-confidence name match)' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        function Get-MgContext { return @{ TenantId = 'test-tenant-id'; AuthType = 'Delegated' } }
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        # Stub Mg cmdlets so Pester's Mock can find them even when
        # Microsoft.Graph isn't imported (local runs); CI has them anyway.
        function Get-MgDirectoryRole { param($Filter) }
        function Get-MgDirectoryRoleMemberAsUser { param($DirectoryRoleId, [switch]$All) }
        function Get-MgIdentityConditionalAccessPolicy { param([switch]$All) }
        function Get-MgServicePrincipal { param($Filter, [switch]$All) }
        function Invoke-MgGraphRequest { param($Method, $Uri, $Body, $ErrorAction) }
        Mock Import-Module { }
        Mock Get-MgDirectoryRole {
            @([PSCustomObject]@{ Id = 'ga-role-id'; DisplayName = 'Global Administrator'; RoleTemplateId = '62e90394-69f5-4237-9190-012177145e10' })
        }
        Mock Get-MgDirectoryRoleMemberAsUser {
            @(
                [PSCustomObject]@{ Id = 'user-1'; DisplayName = 'Break Glass Admin 1'; UserPrincipalName = 'bgadmin1@contoso.onmicrosoft.com'; SignInActivity = @{ LastSignInDateTime = $null; LastNonInteractiveSignInDateTime = $null }; OnPremisesSyncEnabled = $false }
                [PSCustomObject]@{ Id = 'user-2'; DisplayName = 'Emergency Access 02';  UserPrincipalName = 'bgadmin2@contoso.onmicrosoft.com'; SignInActivity = @{ LastSignInDateTime = $null; LastNonInteractiveSignInDateTime = $null }; OnPremisesSyncEnabled = $false }
            )
        }
        Mock Get-MgIdentityConditionalAccessPolicy { @() }
        Mock Invoke-MgGraphRequest { @{ value = @() } }
        Mock Get-MgServicePrincipal { @() }
        . "$PSScriptRoot/../../src/M365-Assess/Security/Get-StrykerIncidentReadiness.ps1"
    }

    It 'is Pass when 2+ name-matched break-glass accounts are detected' {
        $bg = $settings | Where-Object { $_.CheckId -like 'ENTRA-BREAKGLASS-001*' -and $_.Setting -eq 'Break-glass emergency access account' } | Select-Object -First 1
        $bg | Should -Not -BeNullOrEmpty
        $bg.Status | Should -Be 'Pass'
        $bg.CurrentValue | Should -Match 'confidence: High'
        $bg.CurrentValue | Should -Match 'bgadmin1@contoso.onmicrosoft.com'
        $bg.CurrentValue | Should -Match 'bgadmin2@contoso.onmicrosoft.com'
    }

    It 'recommends at least 2 enabled break-glass accounts (post-#888)' {
        $bg = $settings | Where-Object { $_.CheckId -like 'ENTRA-BREAKGLASS-001*' -and $_.Setting -eq 'Break-glass emergency access account' } | Select-Object -First 1
        $bg.RecommendedValue | Should -Match '^At least 2'
    }

    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}

Describe 'ENTRA-BREAKGLASS-001 threshold (2+ medium-confidence CA-exclusion fallback)' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        function Get-MgContext { return @{ TenantId = 'test-tenant-id'; AuthType = 'Delegated' } }
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        # Stub Mg cmdlets so Pester's Mock can find them even when
        # Microsoft.Graph isn't imported (local runs); CI has them anyway.
        function Get-MgDirectoryRole { param($Filter) }
        function Get-MgDirectoryRoleMemberAsUser { param($DirectoryRoleId, [switch]$All) }
        function Get-MgIdentityConditionalAccessPolicy { param([switch]$All) }
        function Get-MgServicePrincipal { param($Filter, [switch]$All) }
        function Invoke-MgGraphRequest { param($Method, $Uri, $Body, $ErrorAction) }
        Mock Import-Module { }
        Mock Get-MgDirectoryRole {
            @([PSCustomObject]@{ Id = 'ga-role-id'; DisplayName = 'Global Administrator'; RoleTemplateId = '62e90394-69f5-4237-9190-012177145e10' })
        }
        # 2 GAs with non-break-glass-looking names → name-match fails, fallback
        # to CA-exclusion pattern. Both are excluded from the active CA policy.
        Mock Get-MgDirectoryRoleMemberAsUser {
            @(
                [PSCustomObject]@{ Id = 'user-1'; DisplayName = 'Service Account A'; UserPrincipalName = 'svc-a@contoso.onmicrosoft.com'; SignInActivity = @{ LastSignInDateTime = $null; LastNonInteractiveSignInDateTime = $null }; OnPremisesSyncEnabled = $false }
                [PSCustomObject]@{ Id = 'user-2'; DisplayName = 'Service Account B'; UserPrincipalName = 'svc-b@contoso.onmicrosoft.com'; SignInActivity = @{ LastSignInDateTime = $null; LastNonInteractiveSignInDateTime = $null }; OnPremisesSyncEnabled = $false }
            )
        }
        Mock Get-MgIdentityConditionalAccessPolicy {
            @([PSCustomObject]@{
                DisplayName   = 'Require MFA for all'
                State         = 'enabled'
                Conditions    = @{ Users = @{ IncludeRoles = @(); ExcludeUsers = @('user-1','user-2'); ExcludeGroups = @() } }
                GrantControls = @{ BuiltInControls = @('mfa'); AuthenticationStrength = $null }
            })
        }
        Mock Invoke-MgGraphRequest { @{ value = @() } }
        Mock Get-MgServicePrincipal { @() }
        . "$PSScriptRoot/../../src/M365-Assess/Security/Get-StrykerIncidentReadiness.ps1"
    }

    It 'is Warning when 2+ break-glass detected only via CA-exclusion pattern' {
        $bg = $settings | Where-Object { $_.CheckId -like 'ENTRA-BREAKGLASS-001*' -and $_.Setting -eq 'Break-glass emergency access account' } | Select-Object -First 1
        $bg | Should -Not -BeNullOrEmpty
        $bg.Status | Should -Be 'Warning'
        $bg.CurrentValue | Should -Match 'confidence: Medium'
        $bg.CurrentValue | Should -Match 'CA exclusion pattern'
    }

    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}
