BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-TeamsSecurityConfig' {
    BeforeAll {
        # Stub the progress function so Add-Setting's guard passes
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        # Stub Get-MgContext so the connection check passes (delegated auth)
        function Get-MgContext {
            return @{
                TenantId = 'test-tenant-id'
                AuthType = 'Delegated'
                Account  = 'admin@contoso.com'
            }
        }

        # Stub Get-MgSubscribedSku to return a Teams-capable license
        function Get-MgSubscribedSku {
            return @(
                @{
                    SkuPartNumber = 'SPE_E5'
                    ConsumedUnits = 5
                    ServicePlans  = @(
                        @{ ServicePlanId = '57ff2da0-773e-42df-b2af-ffb7a2317929'; ProvisioningStatus = 'Success' }
                    )
                }
            )
        }

        # Mock Invoke-MgGraphRequest with realistic Teams data
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri)
            switch -Wildcard ($Uri) {
                '*/v1.0/teamwork/teamsAppSettings' {
                    return @{
                        isChatResourceSpecificConsentEnabled = $false
                    }
                }
                '*/beta/teamwork/teamsClientConfiguration' {
                    return @{
                        allowTeamsConsumer        = $false
                        allowTeamsConsumerInbound = $false
                        allowDropBox              = $false
                        allowBox                  = $false
                        allowGoogleDrive          = $false
                        allowShareFile            = $false
                        allowEgnyte               = $false
                        allowEmailIntoChannel     = $false
                        allowFederatedUsers       = $false
                        allowedDomains            = @()
                        allowPublicUsers          = $false
                    }
                }
                '*/beta/teamwork/teamsMeetingPolicy' {
                    return @{
                        allowAnonymousUsersToJoinMeeting            = $false
                        allowAnonymousUsersToStartMeeting           = $false
                        autoAdmittedUsers                           = 'EveryoneInCompanyExcludingGuests'
                        allowPSTNUsersToBypassLobby                 = $false
                        allowExternalParticipantGiveRequestControl  = $false
                        meetingChatEnabledType                      = 'EnabledExceptAnonymous'
                        designatedPresenterRoleMode                 = 'OrganizerOnlyUserOverride'
                        allowExternalNonTrustedMeetingChat          = $false
                        allowCloudRecording                         = $false
                    }
                }
                '*/v1.0/teamwork' {
                    return @{ id = 'teamwork' }
                }
                default {
                    return @{ value = @() }
                }
            }
        }

        # Run the collector by dot-sourcing it
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Collaboration/Get-TeamsSecurityConfig.ps1"
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

    It 'All CheckIds use the TEAMS- prefix' {
        $withCheckId = $settings | Where-Object { $_.CheckId -and $_.CheckId.Trim() -ne '' }
        foreach ($s in $withCheckId) {
            $s.CheckId | Should -Match '^TEAMS-' `
                -Because "CheckId '$($s.CheckId)' should use TEAMS- prefix"
        }
    }

    It 'Chat resource-specific consent passes when disabled' {
        $appCheck = $settings | Where-Object {
            $_.CheckId -like 'TEAMS-APPS-001*' -and $_.Setting -eq 'Chat Resource-Specific Consent'
        }
        $appCheck | Should -Not -BeNullOrEmpty
        $appCheck.Status | Should -Be 'Pass'
    }

    It 'Communication with unmanaged Teams users passes when disabled' {
        $consumerCheck = $settings | Where-Object {
            $_.CheckId -like 'TEAMS-EXTACCESS-001*' -and $_.Setting -eq 'Communication with Unmanaged Teams Users'
        }
        $consumerCheck | Should -Not -BeNullOrEmpty
        $consumerCheck.Status | Should -Be 'Pass'
    }

    It 'Anonymous users join meeting passes when disabled' {
        $anonCheck = $settings | Where-Object {
            $_.CheckId -like 'TEAMS-MEETING-001*' -and $_.Setting -eq 'Anonymous Users Can Join Meeting'
        }
        $anonCheck | Should -Not -BeNullOrEmpty
        $anonCheck.Status | Should -Be 'Pass'
    }

    It 'Third-party cloud storage passes when all disabled' {
        $cloudCheck = $settings | Where-Object {
            $_.CheckId -like 'TEAMS-CLIENT-001*' -and $_.Setting -eq 'Third-Party Cloud Storage'
        }
        $cloudCheck | Should -Not -BeNullOrEmpty
        $cloudCheck.Status | Should -Be 'Pass'
    }

    It 'External domain access passes when disabled' {
        $extDomain = $settings | Where-Object {
            $_.CheckId -like 'TEAMS-EXTACCESS-003*' -and $_.Setting -eq 'External Domain Access'
        }
        $extDomain | Should -Not -BeNullOrEmpty
        $extDomain.Status | Should -Be 'Pass'
    }

    It 'Default presenter role passes when OrganizerOnlyUserOverride' {
        $presenterCheck = $settings | Where-Object {
            $_.CheckId -like 'TEAMS-MEETING-007*' -and $_.Setting -eq 'Default Presenter Role'
        }
        $presenterCheck | Should -Not -BeNullOrEmpty
        $presenterCheck.Status | Should -Be 'Pass'
    }

    It 'Produces settings across multiple categories' {
        $categories = $settings | Select-Object -ExpandProperty Category -Unique
        $categories.Count | Should -BeGreaterOrEqual 3
    }

    It 'Returns at least 17 checks' {
        $settings.Count | Should -BeGreaterOrEqual 17
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-TeamsSecurityConfig - App-Only Auth Early Exit' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        # Stub Get-MgContext as app-only auth (no Account, has AppName)
        function Get-MgContext {
            return @{
                TenantId = 'test-tenant-id'
                AuthType = 'AppOnly'
                AppName  = 'TestApp'
            }
        }

        # Capture the output from the collector
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $script:collectorOutput = . "$PSScriptRoot/../../src/M365-Assess/Collaboration/Get-TeamsSecurityConfig.ps1"
    }

    It 'Returns empty array for app-only auth' {
        @($script:collectorOutput).Count | Should -Be 0
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-TeamsSecurityConfig - No Teams License' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        # Stub Get-MgContext as delegated auth
        function Get-MgContext {
            return @{
                TenantId = 'test-tenant-id'
                AuthType = 'Delegated'
                Account  = 'admin@contoso.com'
            }
        }

        # Return SKUs with no Teams service plans
        function Get-MgSubscribedSku {
            return @(
                @{
                    SkuPartNumber = 'EXCHANGESTANDARD'
                    ConsumedUnits = 5
                    ServicePlans  = @(
                        @{ ServicePlanId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'; ProvisioningStatus = 'Success' }
                    )
                }
            )
        }

        # Capture the output from the collector
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $script:collectorOutput = . "$PSScriptRoot/../../src/M365-Assess/Collaboration/Get-TeamsSecurityConfig.ps1"
    }

    It 'Returns empty array when no Teams license is detected' {
        @($script:collectorOutput).Count | Should -Be 0
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}
