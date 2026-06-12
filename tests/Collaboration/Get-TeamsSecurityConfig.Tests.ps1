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

Describe 'Get-TeamsSecurityConfig - Sovereign Cloud Teams Licenses (#940 gate)' {
    # The 2026-06-12 GCC High live run showed the license gate false-negativing on a
    # tenant with 5 assigned SPE_E5_USGOV_GCCHIGH seats: the gate only knew the
    # commercial TEAMS1 plan id (plus a GUID that is actually WHITEBOARD_PLAN3).
    # Sovereign clouds use distinct Teams service plans, verified against Microsoft's
    # licensing-service-plan-reference CSV:
    #   GCC      TEAMS_GOV         304767db-7d23-49e8-a945-4a7eb65f9f28
    #   GCC High TEAMS_AR_GCCHIGH  9953b155-8aef-4c56-92f3-72b0487fce41
    #   DoD      TEAMS_AR_DOD      fd500458-c24c-478e-856c-a6067a8376cd

    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function global:Get-MgContext {
            return @{
                TenantId = 'test-tenant-id'
                AuthType = 'Delegated'
                Account  = 'admin@contoso.com'
            }
        }

        Mock Invoke-MgGraphRequest {
            param($Method, $Uri)
            return @{ value = @() }
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
    }

    It 'should proceed with Teams checks when the tenant has <CloudName> licensing' -ForEach @(
        @{ CloudName = 'GCC';      SkuPart = 'M365_G5_GOV';          PlanId = '304767db-7d23-49e8-a945-4a7eb65f9f28' }
        @{ CloudName = 'GCC High'; SkuPart = 'SPE_E5_USGOV_GCCHIGH'; PlanId = '9953b155-8aef-4c56-92f3-72b0487fce41' }
        @{ CloudName = 'DoD';      SkuPart = 'SPE_E5_USGOV_DOD';     PlanId = 'fd500458-c24c-478e-856c-a6067a8376cd' }
    ) {
        $localSkuPart = $SkuPart
        $localPlanId  = $PlanId
        function global:Get-MgSubscribedSku {
            return @(
                @{
                    SkuPartNumber = $localSkuPart
                    ConsumedUnits = 5
                    ServicePlans  = @(
                        @{ ServicePlanId = $localPlanId; ProvisioningStatus = 'Success' }
                    )
                }
            )
        }

        $output = . "$PSScriptRoot/../../src/M365-Assess/Collaboration/Get-TeamsSecurityConfig.ps1"

        # The license gate must not skip — the collector should reach the checks
        # and emit settings (mocked Graph responses produce Review/Fail results).
        @($output).Count | Should -BeGreaterThan 0 `
            -Because "a $CloudName tenant with an assigned Teams service plan must not be skipped"
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-MgContext -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-MgSubscribedSku -ErrorAction SilentlyContinue
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
