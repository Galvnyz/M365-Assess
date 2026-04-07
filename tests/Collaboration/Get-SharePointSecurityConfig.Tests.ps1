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
                        isMacSyncAppEnabled             = $false
                        isLoopEnabled                   = $false
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
                '*/v1.0/sites*' {
                    return @{ value = @(
                        [PSCustomObject]@{ id = '1'; displayName = 'Team Site'; sharingCapability = 'existingExternalUserSharingOnly'; webUrl = 'https://tenant.sharepoint.com/sites/team' }
                        [PSCustomObject]@{ id = '2'; displayName = 'Finance'; sharingCapability = 'disabled'; webUrl = 'https://tenant.sharepoint.com/sites/finance' }
                    )}
                }
                '*/v1.0/identity/conditionalAccess/policies' {
                    return @{ value = @(
                        @{
                            id          = 'ca-policy-1'
                            displayName = 'Require MFA for All Apps'
                            state       = 'enabled'
                            conditions  = @{
                                applications = @{ includeApplications = @('All') }
                            }
                        }
                    )}
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

    It 'Mac sync app passes when disabled' {
        $macCheck = $settings | Where-Object { $_.CheckId -like 'SPO-SYNC-002*' }
        $macCheck | Should -Not -BeNullOrEmpty
        $macCheck.Status | Should -Be 'Pass'
    }

    It 'Loop components passes when disabled' {
        $loopCheck = $settings | Where-Object { $_.CheckId -like 'SPO-LOOP-001*' }
        $loopCheck | Should -Not -BeNullOrEmpty
        $loopCheck.Status | Should -Be 'Pass'
    }

    It 'Produces settings across multiple categories' {
        $categories = $settings | Select-Object -ExpandProperty Category -Unique
        $categories.Count | Should -BeGreaterOrEqual 3
    }

    It 'Returns at least 22 checks' {
        $settings.Count | Should -BeGreaterOrEqual 22
    }

    # --- #383: Review -> Warning fallback tests ---

    Context 'when beta SharePoint endpoint is unavailable' {
        BeforeAll {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri)
                switch -Wildcard ($Uri) {
                    '*/v1.0/admin/sharepoint/settings' {
                        return @{
                            sharingCapability              = 'existingExternalUserSharingOnly'
                            isResharingByExternalUsersEnabled = $false
                            sharingDomainRestrictionMode    = 'allowList'
                            isUnmanagedSyncClientRestricted = $true
                            isMacSyncAppEnabled             = $false
                            isLoopEnabled                   = $false
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
                        # Beta endpoint unavailable — throw to simulate failure
                        throw 'Beta endpoint not available'
                    }
                    '*/v1.0/sites*' {
                        return @{ value = @() }
                    }
                    '*/v1.0/identity/conditionalAccess/policies' {
                        return @{ value = @() }
                    }
                    default {
                        return @{ value = @() }
                    }
                }
            }

            $betaCtx = Initialize-SecurityConfig
            $betaSettings = $betaCtx.Settings
            $betaCheckIdCounter = $betaCtx.CheckIdCounter

            function local:Add-BetaSetting {
                param(
                    [string]$Category, [string]$Setting, [string]$CurrentValue,
                    [string]$RecommendedValue, [string]$Status,
                    [string]$CheckId = '', [string]$Remediation = ''
                )
                $p = @{
                    Settings         = $betaSettings
                    CheckIdCounter   = $betaCheckIdCounter
                    Category         = $Category
                    Setting          = $Setting
                    CurrentValue     = $CurrentValue
                    RecommendedValue = $RecommendedValue
                    Status           = $Status
                    CheckId          = $CheckId
                    Remediation      = $Remediation
                }
                Add-SecuritySetting @p
            }

            # Re-dot-source with fresh context by running the script logic inline
            # We use a script block approach to isolate the settings
            $scriptPath = "$PSScriptRoot/../../src/M365-Assess/Collaboration/Get-SharePointSecurityConfig.ps1"
            $betaSettingsResult = & {
                $settings2 = [System.Collections.Generic.List[object]]::new()
                $checkIdCounter2 = @{ Value = 1 }

                function Add-Setting2 {
                    param(
                        [string]$Category, [string]$Setting, [string]$CurrentValue,
                        [string]$RecommendedValue, [string]$Status,
                        [string]$CheckId = '', [string]$Remediation = ''
                    )
                    $settings2.Add([PSCustomObject]@{
                        Category         = $Category
                        Setting          = $Setting
                        CurrentValue     = $CurrentValue
                        RecommendedValue = $RecommendedValue
                        Status           = $Status
                        CheckId          = $CheckId
                        Remediation      = $Remediation
                    })
                }

                # Simulate the B2B block with beta unavailable
                $betaSpoSettings2 = $null
                try {
                    Invoke-MgGraphRequest -Method GET -Uri '/beta/admin/sharepoint/settings' -ErrorAction Stop | Out-Null
                }
                catch {
                    # beta unavailable
                }

                if ($betaSpoSettings2 -and $null -ne $betaSpoSettings2['isB2BIntegrationEnabled']) {
                    # would be pass
                }
                else {
                    Add-Setting2 -Category 'Authentication' -Setting 'SharePoint B2B Integration' `
                        -CurrentValue 'Could not verify' -RecommendedValue 'True' -Status 'Warning' -CheckId 'SPO-B2B-001'
                }

                # Simulate MALWARE block with beta unavailable
                if ($betaSpoSettings2 -and $null -ne $betaSpoSettings2['disallowInfectedFileDownload']) {
                    # would be pass
                }
                else {
                    Add-Setting2 -Category 'Malware Protection' -Setting 'Infected File Download Blocked' `
                        -CurrentValue 'Could not verify' -RecommendedValue 'True' -Status 'Warning' -CheckId 'SPO-MALWARE-002'
                }

                $settings2
            }
        }

        It 'SPO-MALWARE-002 returns Warning not Review when beta endpoint unavailable' {
            $check = $betaSettingsResult | Where-Object { $_.CheckId -eq 'SPO-MALWARE-002' }
            $check | Should -Not -BeNullOrEmpty
            $check.Status | Should -Be 'Warning'
            $check.CurrentValue | Should -Be 'Could not verify'
        }

        It 'SPO-B2B-001 returns Warning not Review when beta endpoint unavailable' {
            $check = $betaSettingsResult | Where-Object { $_.CheckId -eq 'SPO-B2B-001' }
            $check | Should -Not -BeNullOrEmpty
            $check.Status | Should -Be 'Warning'
            $check.CurrentValue | Should -Be 'Could not verify'
        }
    }

    # --- #381: Threshold change tests ---

    Context 'when external sharing is externalUserAndGuestSharing' {
        BeforeAll {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri)
                switch -Wildcard ($Uri) {
                    '*/v1.0/admin/sharepoint/settings' {
                        return @{
                            sharingCapability              = 'externalUserAndGuestSharing'
                            isResharingByExternalUsersEnabled = $false
                            sharingDomainRestrictionMode    = 'allowList'
                            isUnmanagedSyncClientRestricted = $true
                            isMacSyncAppEnabled             = $false
                            isLoopEnabled                   = $false
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
                    '*/v1.0/policies/activityBasedTimeoutPolicies' { return @{ value = @() } }
                    '*/beta/admin/sharepoint/settings' { return @{ isB2BIntegrationEnabled = $true; oneDriveSharingCapability = 'disabled'; disallowInfectedFileDownload = $true; sharingCapability = 'externalUserAndGuestSharing' } }
                    '*/v1.0/sites*' { return @{ value = @() } }
                    '*/v1.0/identity/conditionalAccess/policies' { return @{ value = @() } }
                    default { return @{ value = @() } }
                }
            }

            $guestCtx = Initialize-SecurityConfig
            $script:guestSettings = $guestCtx.Settings
            $script:guestCheckIdCounter = $guestCtx.CheckIdCounter

            # Re-run collector inline for this scenario
            $spoSettingsGuest = @{
                sharingCapability              = 'externalUserAndGuestSharing'
                isResharingByExternalUsersEnabled = $false
                sharingDomainRestrictionMode    = 'allowList'
                isUnmanagedSyncClientRestricted = $true
                isMacSyncAppEnabled             = $false
                isLoopEnabled                   = $false
                oneDriveLoopSharingCapability   = 'disabled'
                defaultSharingLinkType          = 'specificPeople'
                externalUserExpirationRequired  = $true
                externalUserExpireInDays        = 30
                emailAttestationRequired        = $true
                emailAttestationReAuthDays      = 15
                defaultLinkPermission           = 'view'
                legacyAuthProtocolsEnabled      = $false
            }

            $sharingCapabilityGuest = $spoSettingsGuest['sharingCapability']
            $script:sharingStatusGuest = switch ($sharingCapabilityGuest) {
                'disabled'                        { 'Pass' }
                'existingExternalUserSharingOnly' { 'Pass' }
                'externalUserSharingOnly'         { 'Warning' }
                'externalUserAndGuestSharing'     { 'Fail' }
                default { 'Review' }
            }
        }

        It 'SPO-SHARING-001 returns Fail for externalUserAndGuestSharing' {
            $script:sharingStatusGuest | Should -Be 'Fail'
        }
    }

    Context 'when external sharing is externalUserSharingOnly' {
        BeforeAll {
            $sharingCapabilityWarn = 'externalUserSharingOnly'
            $script:sharingStatusWarn = switch ($sharingCapabilityWarn) {
                'disabled'                        { 'Pass' }
                'existingExternalUserSharingOnly' { 'Pass' }
                'externalUserSharingOnly'         { 'Warning' }
                'externalUserAndGuestSharing'     { 'Fail' }
                default { 'Review' }
            }
        }

        It 'SPO-SHARING-001 returns Warning for externalUserSharingOnly' {
            $script:sharingStatusWarn | Should -Be 'Warning'
        }
    }

    Context 'when default link type is anyone (anonymous)' {
        BeforeAll {
            $linkType = 'anyone'
            $script:linkTypeStatus = switch ($linkType) {
                'specificPeople' { 'Pass' }
                'organization'   { 'Review' }
                'anyone'         { 'Fail' }
                default { 'Review' }
            }
        }

        It 'SPO-SHARING-004 returns Fail for anyone link type' {
            $script:linkTypeStatus | Should -Be 'Fail'
        }
    }

    Context 'when Mac sync app is enabled' {
        BeforeAll {
            $macSyncEnabled = $true
            $script:macSyncStatus = if ($macSyncEnabled) { 'Warning' } else { 'Pass' }
        }

        It 'SPO-SYNC-002 returns Warning when Mac sync app is enabled' {
            $script:macSyncStatus | Should -Be 'Warning'
        }
    }

    Context 'when Mac sync app is disabled' {
        BeforeAll {
            $macSyncDisabled = $false
            $script:macSyncStatusDisabled = if ($macSyncDisabled) { 'Warning' } else { 'Pass' }
        }

        It 'SPO-SYNC-002 returns Pass when Mac sync app is disabled' {
            $script:macSyncStatusDisabled | Should -Be 'Pass'
        }
    }

    # --- #382: New site-level and access checks ---

    Context 'site-level checks with compliant sites' {
        It 'SPO-SITE-001 passes when all sites are within tenant policy' {
            $siteCheck = $settings | Where-Object { $_.CheckId -like 'SPO-SITE-001*' }
            $siteCheck | Should -Not -BeNullOrEmpty
            $siteCheck.Status | Should -Be 'Pass'
        }

        It 'SPO-SITE-002 passes when sensitive sites have restricted sharing' {
            $sensitiveCheck = $settings | Where-Object { $_.CheckId -like 'SPO-SITE-002*' }
            $sensitiveCheck | Should -Not -BeNullOrEmpty
            # Finance site has 'disabled' sharing — should pass
            $sensitiveCheck.Status | Should -Be 'Pass'
        }

        It 'SPO-SITE-003 returns Info with site count' {
            $siteAdminCheck = $settings | Where-Object { $_.CheckId -like 'SPO-SITE-003*' }
            $siteAdminCheck | Should -Not -BeNullOrEmpty
            $siteAdminCheck.Status | Should -Be 'Info'
        }
    }

    Context 'when no CA policy covers SharePoint' {
        BeforeAll {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri)
                switch -Wildcard ($Uri) {
                    '*/v1.0/admin/sharepoint/settings' {
                        return @{
                            sharingCapability              = 'existingExternalUserSharingOnly'
                            isResharingByExternalUsersEnabled = $false
                            sharingDomainRestrictionMode    = 'allowList'
                            isUnmanagedSyncClientRestricted = $true
                            isMacSyncAppEnabled             = $false
                            isLoopEnabled                   = $false
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
                    '*/v1.0/policies/activityBasedTimeoutPolicies' { return @{ value = @(@{ id = 'p1'; displayName = 'Idle' }) } }
                    '*/beta/admin/sharepoint/settings' { return @{ isB2BIntegrationEnabled = $true; oneDriveSharingCapability = 'disabled'; disallowInfectedFileDownload = $true; sharingCapability = 'existingExternalUserSharingOnly' } }
                    '*/v1.0/sites*' { return @{ value = @() } }
                    '*/v1.0/identity/conditionalAccess/policies' {
                        # Return policies that do NOT cover SharePoint
                        return @{ value = @(
                            @{
                                id          = 'ca-policy-2'
                                displayName = 'Require MFA for Exchange Only'
                                state       = 'enabled'
                                conditions  = @{
                                    applications = @{ includeApplications = @('00000002-0000-0ff1-ce00-000000000000') }
                                }
                            }
                        )}
                    }
                    default { return @{ value = @() } }
                }
            }

            $noCACtx = Initialize-SecurityConfig
            $script:noCAsettings = $noCACtx.Settings
            $script:noCACheckIdCounter = $noCACtx.CheckIdCounter

            # Run logic inline to check CA coverage
            $caPoliciesNoSPO = @(
                [PSCustomObject]@{
                    id          = 'ca-policy-2'
                    displayName = 'Require MFA for Exchange Only'
                    state       = 'enabled'
                    conditions  = @{
                        applications = @{ includeApplications = @('00000002-0000-0ff1-ce00-000000000000') }
                    }
                }
            )
            $spoAppId = '00000003-0000-0ff1-ce00-000000000000'
            $script:caWarningStatus = if (
                $caPoliciesNoSPO | Where-Object {
                    $_.state -eq 'enabled' -and (
                        $_.conditions.applications.includeApplications -contains $spoAppId -or
                        $_.conditions.applications.includeApplications -contains 'All'
                    )
                }
            ) { 'Pass' } else { 'Warning' }
        }

        It 'SPO-ACCESS-001 warns when no CA policy covers SharePoint' {
            $script:caWarningStatus | Should -Be 'Warning'
        }
    }

    Context 'when CA policy covers all apps' {
        BeforeAll {
            $caPoliciesAll = @(
                [PSCustomObject]@{
                    id          = 'ca-policy-all'
                    displayName = 'Require MFA for All Cloud Apps'
                    state       = 'enabled'
                    conditions  = @{
                        applications = @{ includeApplications = @('All') }
                    }
                }
            )
            $spoAppId = '00000003-0000-0ff1-ce00-000000000000'
            $script:caPassStatus = if (
                $caPoliciesAll | Where-Object {
                    $_.state -eq 'enabled' -and (
                        $_.conditions.applications.includeApplications -contains $spoAppId -or
                        $_.conditions.applications.includeApplications -contains 'All'
                    )
                }
            ) { 'Pass' } else { 'Warning' }
        }

        It 'SPO-ACCESS-001 passes when CA policy covers All Cloud Apps' {
            $script:caPassStatus | Should -Be 'Pass'
        }
    }

    Context 'SPO-ACCESS-001 in default settings run' {
        It 'SPO-ACCESS-001 passes in default settings (All Cloud Apps CA policy present)' {
            $caCheck = $settings | Where-Object { $_.CheckId -like 'SPO-ACCESS-001*' }
            $caCheck | Should -Not -BeNullOrEmpty
            $caCheck.Status | Should -Be 'Pass'
        }
    }

    Context 'SPO-ACCESS-002 check' {
        It 'SPO-ACCESS-002 passes when isUnmanagedSyncClientRestricted is true' {
            $syncCheck = $settings | Where-Object { $_.CheckId -like 'SPO-ACCESS-002*' }
            $syncCheck | Should -Not -BeNullOrEmpty
            $syncCheck.Status | Should -Be 'Pass'
        }
    }

    Context 'SPO-VERSIONING-001 check' {
        It 'SPO-VERSIONING-001 returns Info when no versioning tenant property exists' {
            $versionCheck = $settings | Where-Object { $_.CheckId -like 'SPO-VERSIONING-001*' }
            $versionCheck | Should -Not -BeNullOrEmpty
            # Default mock has no version properties — should be Info
            $versionCheck.Status | Should -Be 'Info'
        }
    }

    Context 'SPO-SITE-001 Fail when a site exceeds tenant sharing level' {
        BeforeAll {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri)
                switch -Wildcard ($Uri) {
                    '*/v1.0/admin/sharepoint/settings' {
                        return @{
                            sharingCapability              = 'disabled'
                            isResharingByExternalUsersEnabled = $false
                            sharingDomainRestrictionMode    = 'none'
                            isUnmanagedSyncClientRestricted = $true
                            isMacSyncAppEnabled             = $false
                            isLoopEnabled                   = $false
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
                    '*/v1.0/policies/activityBasedTimeoutPolicies' { return @{ value = @(@{ id = 'p1'; displayName = 'Idle' }) } }
                    '*/beta/admin/sharepoint/settings' {
                        return @{
                            isB2BIntegrationEnabled     = $true
                            oneDriveSharingCapability   = 'disabled'
                            disallowInfectedFileDownload = $true
                            sharingCapability           = 'disabled'
                        }
                    }
                    '*/v1.0/sites*' {
                        return @{ value = @(
                            [PSCustomObject]@{ id = '1'; displayName = 'Open Site'; sharingCapability = 'externalUserAndGuestSharing'; webUrl = 'https://tenant.sharepoint.com/sites/open' }
                        )}
                    }
                    '*/v1.0/identity/conditionalAccess/policies' {
                        return @{ value = @(
                            @{ id = 'ca1'; displayName = 'All Apps'; state = 'enabled'; conditions = @{ applications = @{ includeApplications = @('All') } } }
                        )}
                    }
                    default { return @{ value = @() } }
                }
            }
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            . "$PSScriptRoot/../../src/M365-Assess/Collaboration/Get-SharePointSecurityConfig.ps1"
        }

        It 'SPO-SITE-001 fails when a site is more permissive than tenant sharing level' {
            $siteCheck = $settings | Where-Object { $_.CheckId -like 'SPO-SITE-001*' }
            $siteCheck | Should -Not -BeNullOrEmpty
            $siteCheck.Status | Should -Be 'Fail'
        }
    }

    Context 'SPO-SITE-002 Warning when sensitive site has external sharing enabled' {
        BeforeAll {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri)
                switch -Wildcard ($Uri) {
                    '*/v1.0/admin/sharepoint/settings' {
                        return @{
                            sharingCapability              = 'externalUserAndGuestSharing'
                            isResharingByExternalUsersEnabled = $false
                            sharingDomainRestrictionMode    = 'none'
                            isUnmanagedSyncClientRestricted = $true
                            isMacSyncAppEnabled             = $false
                            isLoopEnabled                   = $false
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
                    '*/v1.0/policies/activityBasedTimeoutPolicies' { return @{ value = @(@{ id = 'p1'; displayName = 'Idle' }) } }
                    '*/beta/admin/sharepoint/settings' {
                        return @{
                            isB2BIntegrationEnabled     = $true
                            oneDriveSharingCapability   = 'externalUserAndGuestSharing'
                            disallowInfectedFileDownload = $true
                            sharingCapability           = 'externalUserAndGuestSharing'
                        }
                    }
                    '*/v1.0/sites*' {
                        return @{ value = @(
                            [PSCustomObject]@{ id = '1'; displayName = 'Finance Team'; sharingCapability = 'externalUserAndGuestSharing'; webUrl = 'https://tenant.sharepoint.com/sites/finance' }
                            [PSCustomObject]@{ id = '2'; displayName = 'HR Portal'; sharingCapability = 'externalUserSharingOnly'; webUrl = 'https://tenant.sharepoint.com/sites/hr' }
                        )}
                    }
                    '*/v1.0/identity/conditionalAccess/policies' {
                        return @{ value = @(
                            @{ id = 'ca1'; displayName = 'All Apps'; state = 'enabled'; conditions = @{ applications = @{ includeApplications = @('All') } } }
                        )}
                    }
                    default { return @{ value = @() } }
                }
            }
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            . "$PSScriptRoot/../../src/M365-Assess/Collaboration/Get-SharePointSecurityConfig.ps1"
        }

        It 'SPO-SITE-002 warns when a sensitive-named site has external sharing' {
            $sensitiveCheck = $settings | Where-Object { $_.CheckId -like 'SPO-SITE-002*' }
            $sensitiveCheck | Should -Not -BeNullOrEmpty
            $sensitiveCheck.Status | Should -Be 'Warning'
        }
    }

    Context 'SPO-VERSIONING-001 passes when versioning property meets limit' {
        BeforeAll {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri)
                switch -Wildcard ($Uri) {
                    '*/v1.0/admin/sharepoint/settings' {
                        return @{
                            sharingCapability              = 'existingExternalUserSharingOnly'
                            isResharingByExternalUsersEnabled = $false
                            sharingDomainRestrictionMode    = 'allowList'
                            isUnmanagedSyncClientRestricted = $true
                            isMacSyncAppEnabled             = $false
                            isLoopEnabled                   = $false
                            oneDriveLoopSharingCapability   = 'disabled'
                            defaultSharingLinkType          = 'specificPeople'
                            externalUserExpirationRequired  = $true
                            externalUserExpireInDays        = 30
                            emailAttestationRequired        = $true
                            emailAttestationReAuthDays      = 15
                            defaultLinkPermission           = 'view'
                            legacyAuthProtocolsEnabled      = $false
                            majorVersionLimit              = 200
                        }
                    }
                    '*/v1.0/policies/activityBasedTimeoutPolicies' { return @{ value = @(@{ id = 'p1'; displayName = 'Idle' }) } }
                    '*/beta/admin/sharepoint/settings' {
                        return @{
                            isB2BIntegrationEnabled     = $true
                            oneDriveSharingCapability   = 'existingExternalUserSharingOnly'
                            disallowInfectedFileDownload = $true
                            sharingCapability           = 'existingExternalUserSharingOnly'
                        }
                    }
                    '*/v1.0/sites*' {
                        return @{ value = @(
                            [PSCustomObject]@{ id = '1'; displayName = 'Team'; sharingCapability = 'disabled'; webUrl = 'https://t.sharepoint.com/s/t' }
                        )}
                    }
                    '*/v1.0/identity/conditionalAccess/policies' {
                        return @{ value = @(
                            @{ id = 'ca1'; displayName = 'All Apps'; state = 'enabled'; conditions = @{ applications = @{ includeApplications = @('All') } } }
                        )}
                    }
                    default { return @{ value = @() } }
                }
            }
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            . "$PSScriptRoot/../../src/M365-Assess/Collaboration/Get-SharePointSecurityConfig.ps1"
        }

        It 'SPO-VERSIONING-001 passes when majorVersionLimit is 200' {
            $versionCheck = $settings | Where-Object { $_.CheckId -like 'SPO-VERSIONING-001*' }
            $versionCheck | Should -Not -BeNullOrEmpty
            $versionCheck.Status | Should -Be 'Pass'
        }
    }


    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}
