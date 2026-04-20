BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'EntraPasswordAuthChecks' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function global:Get-MgContext {
            return @{ TenantId = 'test-tenant-id' }
        }

        Mock Import-Module { }

        Mock Invoke-MgGraphRequest {
            param($Method, $Uri, $Headers, $ErrorAction)
            switch -Wildcard ($Uri) {
                '*/identitySecurityDefaultsEnforcementPolicy' {
                    return @{ isEnabled = $false }
                }
                '*/identity/conditionalAccess/policies' {
                    return @{ value = @(
                        @{
                            id           = 'ca-1'
                            displayName  = 'Require MFA for all users'
                            state        = 'enabled'
                            conditions   = @{
                                users            = @{ includeUsers = @('All') }
                                clientAppTypes   = @()
                                applications     = @{ includeApplications = @() }
                            }
                            grantControls = @{ builtInControls = @('mfa') }
                        }
                        @{
                            id           = 'ca-2'
                            displayName  = 'Block legacy auth'
                            state        = 'enabled'
                            conditions   = @{
                                users          = @{ includeUsers = @('All') }
                                clientAppTypes = @('exchangeActiveSync', 'other')
                                applications   = @{ includeApplications = @() }
                            }
                            grantControls = @{ builtInControls = @('block') }
                        }
                        @{
                            id           = 'ca-3'
                            displayName  = 'Admin MFA'
                            state        = 'enabled'
                            conditions   = @{
                                users          = @{ includeRoles = @('62e90394-69f5-4237-9190-012177145e10') }
                                clientAppTypes = @()
                                applications   = @{ includeApplications = @() }
                            }
                            grantControls = @{ builtInControls = @('mfa') }
                        }
                        @{
                            id           = 'ca-4'
                            displayName  = 'Azure Management MFA'
                            state        = 'enabled'
                            conditions   = @{
                                users          = @{ includeUsers = @('All') }
                                clientAppTypes = @()
                                applications   = @{ includeApplications = @('797f4846-ba00-4fd7-ba43-dac1f8f63013') }
                            }
                            grantControls = @{ builtInControls = @('mfa') }
                        }
                    )}
                }
                '*/policies/authenticationMethodsPolicy' {
                    return @{
                        authenticationMethodConfigurations = @(
                            @{
                                id    = 'MicrosoftAuthenticator'
                                state = 'enabled'
                                '@odata.type' = '#microsoft.graph.microsoftAuthenticatorAuthenticationMethodConfiguration'
                                featureSettings = @{
                                    numberMatchingRequiredState        = @{ state = 'enabled' }
                                    displayAppInformationRequiredState = @{ state = 'enabled' }
                                }
                            }
                            @{ id = 'Sms'; state = 'disabled'; '@odata.type' = '#microsoft.graph.smsAuthenticationMethodConfiguration' }
                            @{ id = 'Voice'; state = 'disabled'; '@odata.type' = '#microsoft.graph.voiceAuthenticationMethodConfiguration' }
                            @{ id = 'Email'; state = 'disabled'; '@odata.type' = '#microsoft.graph.emailAuthenticationMethodConfiguration' }
                        )
                        registrationEnforcement = @{
                            authenticationMethodsRegistrationCampaign = @{
                                state          = 'enabled'
                                includeTargets = @( @{ id = 'all_users'; targetType = 'group' } )
                            }
                        }
                        systemCredentialPreferences = @{ state = 'enabled' }
                    }
                }
                '*/v1.0/settings' {
                    return @{ value = @(
                        @{
                            displayName = 'Password Rule Settings'
                            values      = @(
                                @{ name = 'EnableBannedPasswordCheck'; value = 'True' }
                                @{ name = 'BannedPasswordList'; value = 'password1,letmein,welcome1' }
                                @{ name = 'LockoutThreshold'; value = '10' }
                                @{ name = 'EnableBannedPasswordCheckOnPremises'; value = 'True' }
                            )
                        }
                    )}
                }
                '*/v1.0/domains' {
                    return @{ value = @(
                        @{ id = 'contoso.com'; isVerified = $true; passwordValidityPeriodInDays = 2147483647 }
                    )}
                }
                '*/v1.0/organization' {
                    return @{ value = @(
                        @{ onPremisesSyncEnabled = $false; onPremisesLastPasswordSyncDateTime = $null }
                    )}
                }
                '*/beta/reports/authenticationMethods/userRegistrationDetails*' {
                    return @{ value = @() }
                }
                default {
                    return @{ value = @() }
                }
            }
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Common/SecurityConfigHelper.ps1"

        $ctx            = Initialize-SecurityConfig
        $settings       = $ctx.Settings
        $checkIdCounter = $ctx.CheckIdCounter

        function Add-Setting {
            param([string]$Category, [string]$Setting, [string]$CurrentValue,
                  [string]$RecommendedValue, [string]$Status,
                  [string]$CheckId = '', [string]$Remediation = '')
            Add-SecuritySetting -Settings $settings -CheckIdCounter $checkIdCounter `
                -Category $Category -Setting $Setting -CurrentValue $CurrentValue `
                -RecommendedValue $RecommendedValue -Status $Status `
                -CheckId $CheckId -Remediation $Remediation
        }

        $sspr       = $null
        $orgSettings = $null
        $pwSettings  = $null

        . "$PSScriptRoot/../../src/M365-Assess/Entra/EntraPasswordAuthChecks.ps1"
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

    It 'Auth method registration campaign passes when enabled' {
        $check = $settings | Where-Object { $_.Setting -eq 'Auth Method Registration Campaign' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'SMS authentication passes when disabled' {
        $check = $settings | Where-Object { $_.Setting -eq 'SMS Authentication' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Email OTP authentication passes when disabled' {
        $check = $settings | Where-Object { $_.Setting -eq 'Email OTP Authentication' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Authenticator fatigue protection passes when both enabled' {
        $check = $settings | Where-Object { $_.Setting -eq 'Authenticator Fatigue Protection' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'System-preferred MFA passes when enabled' {
        $check = $settings | Where-Object { $_.Setting -eq 'System-Preferred MFA' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Password expiration passes when set to never expire' {
        $check = $settings | Where-Object { $_.Setting -like 'Password Expiration:*' }
        $check | Should -Not -BeNullOrEmpty
        $check[0].Status | Should -Be 'Pass'
    }

    It 'Custom banned password list passes when enforced' {
        $check = $settings | Where-Object { $_.Setting -eq 'Custom Banned Password List Enforced' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Security defaults enabled check passes when SD is off but CA policies are active' {
        $check = $settings | Where-Object { $_.Setting -eq 'Security Defaults Enabled' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass' -Because 'CA policies provide equivalent coverage'
        $check.CurrentValue | Should -Match 'Conditional Access active'
    }

    It 'Security defaults gap analysis passes when all areas covered by CA' {
        $check = $settings | Where-Object { $_.Setting -eq 'Security Defaults Gap Analysis' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'All checks use ENTRA- prefix' {
        $withCheckId = $settings | Where-Object { $_.CheckId -and $_.CheckId.Trim() -ne '' }
        foreach ($s in $withCheckId) {
            $s.CheckId | Should -Match '^ENTRA-' `
                -Because "CheckId '$($s.CheckId)' should start with ENTRA-"
        }
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-MgContext -ErrorAction SilentlyContinue
        Remove-Item Function:\Add-Setting -ErrorAction SilentlyContinue
    }
}

Describe 'EntraPasswordAuthChecks - Security Defaults ON' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function global:Get-MgContext {
            return @{ TenantId = 'test-tenant-id' }
        }

        Mock Import-Module { }

        Mock Invoke-MgGraphRequest {
            param($Method, $Uri, $Headers, $ErrorAction)
            switch -Wildcard ($Uri) {
                '*/identitySecurityDefaultsEnforcementPolicy' {
                    return @{ isEnabled = $true }
                }
                '*/policies/authenticationMethodsPolicy' {
                    return @{
                        authenticationMethodConfigurations = @()
                        registrationEnforcement            = @{
                            authenticationMethodsRegistrationCampaign = @{
                                state          = 'disabled'
                                includeTargets = @()
                            }
                        }
                    }
                }
                '*/v1.0/settings' { return @{ value = @() } }
                '*/v1.0/domains' {
                    return @{ value = @(
                        @{ id = 'contoso.com'; isVerified = $true; passwordValidityPeriodInDays = 90 }
                    )}
                }
                '*/v1.0/organization' {
                    return @{ value = @(
                        @{ onPremisesSyncEnabled = $false }
                    )}
                }
                default { return @{ value = @() } }
            }
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Common/SecurityConfigHelper.ps1"

        $ctx            = Initialize-SecurityConfig
        $settings       = $ctx.Settings
        $checkIdCounter = $ctx.CheckIdCounter

        function Add-Setting {
            param([string]$Category, [string]$Setting, [string]$CurrentValue,
                  [string]$RecommendedValue, [string]$Status,
                  [string]$CheckId = '', [string]$Remediation = '')
            Add-SecuritySetting -Settings $settings -CheckIdCounter $checkIdCounter `
                -Category $Category -Setting $Setting -CurrentValue $CurrentValue `
                -RecommendedValue $RecommendedValue -Status $Status `
                -CheckId $CheckId -Remediation $Remediation
        }

        $sspr       = $null
        $orgSettings = $null
        $pwSettings  = $null

        . "$PSScriptRoot/../../src/M365-Assess/Entra/EntraPasswordAuthChecks.ps1"
    }

    It 'Security defaults passes when enabled' {
        $check = $settings | Where-Object { $_.Setting -eq 'Security Defaults Enabled' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Password expiration fails when not set to never expire' {
        $check = $settings | Where-Object { $_.Setting -like 'Password Expiration:*' }
        $check | Should -Not -BeNullOrEmpty
        $check[0].Status | Should -Be 'Fail'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-MgContext -ErrorAction SilentlyContinue
        Remove-Item Function:\Add-Setting -ErrorAction SilentlyContinue
    }
}

Describe 'EntraPasswordAuthChecks - Security Defaults OFF no CA' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function global:Get-MgContext {
            return @{ TenantId = 'test-tenant-id' }
        }

        Mock Import-Module { }

        Mock Invoke-MgGraphRequest {
            param($Method, $Uri, $Headers, $ErrorAction)
            switch -Wildcard ($Uri) {
                '*/identitySecurityDefaultsEnforcementPolicy' {
                    return @{ isEnabled = $false }
                }
                '*/identity/conditionalAccess/policies' {
                    return @{ value = @() }
                }
                '*/policies/authenticationMethodsPolicy' {
                    return @{
                        authenticationMethodConfigurations = @()
                        registrationEnforcement            = @{
                            authenticationMethodsRegistrationCampaign = @{
                                state          = 'disabled'
                                includeTargets = @()
                            }
                        }
                    }
                }
                '*/v1.0/settings' { return @{ value = @() } }
                '*/v1.0/domains' {
                    return @{ value = @(
                        @{ id = 'contoso.com'; isVerified = $true; passwordValidityPeriodInDays = 2147483647 }
                    )}
                }
                '*/v1.0/organization' {
                    return @{ value = @(
                        @{ onPremisesSyncEnabled = $false; onPremisesLastPasswordSyncDateTime = $null }
                    )}
                }
                default { return @{ value = @() } }
            }
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Common/SecurityConfigHelper.ps1"

        $ctx            = Initialize-SecurityConfig
        $settings       = $ctx.Settings
        $checkIdCounter = $ctx.CheckIdCounter

        function Add-Setting {
            param([string]$Category, [string]$Setting, [string]$CurrentValue,
                  [string]$RecommendedValue, [string]$Status,
                  [string]$CheckId = '', [string]$Remediation = '')
            Add-SecuritySetting -Settings $settings -CheckIdCounter $checkIdCounter `
                -Category $Category -Setting $Setting -CurrentValue $CurrentValue `
                -RecommendedValue $RecommendedValue -Status $Status `
                -CheckId $CheckId -Remediation $Remediation
        }

        $sspr       = $null
        $orgSettings = $null
        $pwSettings  = $null

        . "$PSScriptRoot/../../src/M365-Assess/Entra/EntraPasswordAuthChecks.ps1"
    }

    It 'Security defaults enabled check fails when SD is off and no CA policies exist' {
        $check = $settings | Where-Object { $_.Setting -eq 'Security Defaults Enabled' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail' -Because 'no MFA control is active'
        $check.CurrentValue | Should -Be 'False'
    }

    It 'Security defaults gap analysis fails when no CA areas are covered' {
        $check = $settings | Where-Object { $_.Setting -eq 'Security Defaults Gap Analysis' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-MgContext -ErrorAction SilentlyContinue
        Remove-Item Function:\Add-Setting -ErrorAction SilentlyContinue
    }
}
