BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-SharePointSecurityConfig' {
    BeforeAll {
        # Stub the progress function so Add-Setting's guard passes
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        # Stub Get-MgContext so the connection check passes
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

        # Mock Invoke-MgGraphRequest with realistic SharePoint settings
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri)
            switch -Wildcard ($Uri) {
                '*/v1.0/admin/sharepoint/settings' {
                    return @{
                        sharingCapability              = 'existingExternalUserSharingOnly'
                        isResharingByExternalUsersEnabled = $false
                        sharingDomainRestrictionMode    = 'allowList'
                        isUnmanagedSyncClientRestricted = $true
                        isMacSyncAppEnabled             = $true
                        isLoopEnabled                   = $true
                        oneDriveLoopSharingCapability   = 'disabled'
                        defaultSharingLinkType          = 'specificPeople'
                        externalUserExpirationRequired  = $true
                        externalUserExpireInDays        = 30
                        emailAttestationRequired        = $true
                        emailAttestationReAuthDays      = 15
                        defaultLinkPermission           = 'view'
                        legacyAuthProtocolsEnabled      = $false
                    }
                }
                '*/v1.0/policies/activityBasedTimeoutPolicies' {
                    return @{ value = @(
                        @{ id = 'policy-1'; displayName = 'Idle Timeout Policy' }
                    )}
                }
                '*/beta/admin/sharepoint/settings' {
                    return @{
                        isB2BIntegrationEnabled        = $true
                        oneDriveSharingCapability      = 'existingExternalUserSharingOnly'
                        disallowInfectedFileDownload   = $true
                        sharingCapability              = 'existingExternalUserSharingOnly'
                    }
                }
                default {
                    return @{ value = @() }
                }
            }
        }

        # Run the collector by dot-sourcing it
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Collaboration/Get-SharePointSecurityConfig.ps1"
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

    It 'All CheckIds use the SPO- prefix' {
        $withCheckId = $settings | Where-Object { $_.CheckId -and $_.CheckId.Trim() -ne '' }
        foreach ($s in $withCheckId) {
            $s.CheckId | Should -Match '^SPO-' `
                -Because "CheckId '$($s.CheckId)' should use SPO- prefix"
        }
    }

    It 'External sharing level passes for existingExternalUserSharingOnly' {
        $sharingCheck = $settings | Where-Object {
            $_.CheckId -like 'SPO-SHARING-001*' -and $_.Setting -eq 'SharePoint External Sharing Level'
        }
        $sharingCheck | Should -Not -BeNullOrEmpty
        $sharingCheck.Status | Should -Be 'Pass'
    }

    It 'Resharing by external users passes when disabled' {
        $reshareCheck = $settings | Where-Object {
            $_.CheckId -like 'SPO-SHARING-002*' -and $_.Setting -eq 'Resharing by External Users'
        }
        $reshareCheck | Should -Not -BeNullOrEmpty
        $reshareCheck.Status | Should -Be 'Pass'
    }

    It 'Default sharing link type passes for specificPeople' {
        $linkCheck = $settings | Where-Object {
            $_.CheckId -like 'SPO-SHARING-004*' -and $_.Setting -eq 'Default Sharing Link Type'
        }
        $linkCheck | Should -Not -BeNullOrEmpty
        $linkCheck.Status | Should -Be 'Pass'
    }

    It 'Legacy authentication passes when disabled' {
        $legacyCheck = $settings | Where-Object {
            $_.CheckId -like 'SPO-AUTH-001*' -and $_.Setting -eq 'Legacy Authentication Protocols'
        }
        $legacyCheck | Should -Not -BeNullOrEmpty
        $legacyCheck.Status | Should -Be 'Pass'
    }

    It 'Guest access expiration passes with 30 days or less' {
        $guestCheck = $settings | Where-Object {
            $_.CheckId -like 'SPO-SHARING-005*' -and $_.Setting -eq 'Guest Access Expiration'
        }
        $guestCheck | Should -Not -BeNullOrEmpty
        $guestCheck.Status | Should -Be 'Pass'
    }

    It 'Idle session timeout passes when configured' {
        $sessionCheck = $settings | Where-Object {
            $_.CheckId -like 'SPO-SESSION-001*' -and $_.Setting -eq 'Idle Session Timeout Policy'
        }
        $sessionCheck | Should -Not -BeNullOrEmpty
        $sessionCheck.Status | Should -Be 'Pass'
    }

    It 'B2B integration passes when enabled' {
        $b2bCheck = $settings | Where-Object {
            $_.CheckId -like 'SPO-B2B-001*' -and $_.Setting -eq 'SharePoint B2B Integration'
        }
        $b2bCheck | Should -Not -BeNullOrEmpty
        $b2bCheck.Status | Should -Be 'Pass'
    }

    It 'Infected file download blocked passes when enabled' {
        $malwareCheck = $settings | Where-Object {
            $_.CheckId -like 'SPO-MALWARE-002*' -and $_.Setting -eq 'Infected File Download Blocked'
        }
        $malwareCheck | Should -Not -BeNullOrEmpty
        $malwareCheck.Status | Should -Be 'Pass'
    }

    It 'Produces settings across multiple categories' {
        $categories = $settings | Select-Object -ExpandProperty Category -Unique
        $categories.Count | Should -BeGreaterOrEqual 3
    }

    It 'Returns at least 16 checks' {
        $settings.Count | Should -BeGreaterOrEqual 16
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}
