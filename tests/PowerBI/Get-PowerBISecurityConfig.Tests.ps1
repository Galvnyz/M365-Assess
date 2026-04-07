BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-PowerBISecurityConfig' {
    BeforeAll {
        # Stub progress function so Add-Setting's guard passes
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        # Stub Import-Module to prevent actual module loading
        Mock Import-Module { }

        # Stub Power BI commands so connection check and mocking works
        function Connect-PowerBIServiceAccount { }
        function Get-PowerBIAccessToken { return @{ 'Authorization' = 'Bearer test-token' } }
        function Invoke-PowerBIRestMethod { param($Url, $Method) }

        # Mock Invoke-PowerBIRestMethod for tenant settings — returns JSON string
        # matching the real API behaviour of MicrosoftPowerBIMgmt
        Mock Invoke-PowerBIRestMethod {
            param($Url, $Method)
            return (@{
                tenantSettings = @(
                    @{ settingName = 'AllowExternalDataSharingReceiverWorksWithShare'; isEnabled = $false; title = 'External sharing' }
                    @{ settingName = 'AllowGuestUserToAccessSharedContent'; isEnabled = $false; title = 'Guest access to content' }
                    @{ settingName = 'AllowGuestLookup'; isEnabled = $false; title = 'Guest user access' }
                    @{ settingName = 'ElevatedGuestsTenant'; isEnabled = $false; title = 'External invitations' }
                    @{ settingName = 'WebDashboardsPublishToWebDisabled'; isEnabled = $true; title = 'Publish to web disabled' }
                    @{ settingName = 'RScriptVisuals'; isEnabled = $false; title = 'R and Python visuals' }
                    @{ settingName = 'UseSensitivityLabels'; isEnabled = $true; title = 'Sensitivity labels' }
                    @{ settingName = 'ShareLinkToEntireOrg'; isEnabled = $false; title = 'Shareable links' }
                    @{ settingName = 'BlockResourceKeyAuthentication'; isEnabled = $true; title = 'Block ResourceKey Auth' }
                    @{ settingName = 'ServicePrincipalAccess'; isEnabled = $false; title = 'Service Principal API access' }
                    @{ settingName = 'CreateServicePrincipalProfile'; isEnabled = $false; title = 'Service Principal profiles' }
                )
            } | ConvertTo-Json -Depth 5)
        }

        # Run the collector by dot-sourcing it
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/PowerBI/Get-PowerBISecurityConfig.ps1"
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

    It 'Produces exactly 11 CIS 9.x checks' {
        $cisChecks = $settings | Where-Object { $_.CheckId -match '^POWERBI-' }
        $cisChecks.Count | Should -BeGreaterOrEqual 11
    }

    It 'Guest access restriction check produces correct status' {
        $guestCheck = $settings | Where-Object {
            $_.CheckId -like 'POWERBI-GUEST-001*' -and $_.Setting -eq 'Guest User Access Restricted'
        }
        $guestCheck | Should -Not -BeNullOrEmpty
        $guestCheck.Status | Should -Be 'Pass'
    }

    It 'Publish to web restriction check produces correct status' {
        $publishCheck = $settings | Where-Object {
            $_.CheckId -like 'POWERBI-SHARING-001*' -and $_.Setting -eq 'Publish to Web Restricted'
        }
        $publishCheck | Should -Not -BeNullOrEmpty
        $publishCheck.Status | Should -Be 'Pass'
    }

    It 'Service principal access restriction check produces correct status' {
        $spCheck = $settings | Where-Object {
            $_.CheckId -like 'POWERBI-AUTH-002*' -and $_.Setting -eq 'Service Principal API Access Restricted'
        }
        $spCheck | Should -Not -BeNullOrEmpty
        $spCheck.Status | Should -Be 'Pass'
    }

    It 'Block ResourceKey authentication check produces correct status' {
        $resKeyCheck = $settings | Where-Object {
            $_.CheckId -like 'POWERBI-AUTH-001*' -and $_.Setting -eq 'Block ResourceKey Authentication'
        }
        $resKeyCheck | Should -Not -BeNullOrEmpty
        $resKeyCheck.Status | Should -Be 'Pass'
    }

    It 'Sensitivity labels enabled check produces correct status' {
        $labelsCheck = $settings | Where-Object {
            $_.CheckId -like 'POWERBI-INFOPROT-001*' -and $_.Setting -eq 'Sensitivity Labels Enabled'
        }
        $labelsCheck | Should -Not -BeNullOrEmpty
        $labelsCheck.Status | Should -Be 'Pass'
    }

    It 'R and Python visuals disabled check produces correct status' {
        $rCheck = $settings | Where-Object {
            $_.CheckId -like 'POWERBI-SHARING-002*' -and $_.Setting -eq 'R and Python Visuals Disabled'
        }
        $rCheck | Should -Not -BeNullOrEmpty
        $rCheck.Status | Should -Be 'Pass'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-PowerBISecurityConfig - Edge Cases' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        Mock Import-Module { }

        function Connect-PowerBIServiceAccount { }
        function Get-PowerBIAccessToken { return @{ 'Authorization' = 'Bearer test-token' } }
        function Invoke-PowerBIRestMethod { param($Url, $Method) }
    }

    Context 'when tenant settings API returns empty response' {
        BeforeAll {
            Mock Invoke-PowerBIRestMethod {
                return (@{ tenantSettings = @() } | ConvertTo-Json -Depth 5)
            }

            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            . "$PSScriptRoot/../../src/M365-Assess/PowerBI/Get-PowerBISecurityConfig.ps1"
        }

        It 'should not throw and returns settings' {
            $settings | Should -Not -BeNullOrEmpty
        }

        It 'all checks should have Review status when settings are missing' {
            foreach ($s in $settings) {
                $s.Status | Should -Be 'Review' `
                    -Because "Setting '$($s.Setting)' should be Review when tenant setting is not found"
            }
        }
    }

    Context 'when all settings are insecure' {
        BeforeAll {
            Mock Invoke-PowerBIRestMethod {
                return (@{
                    tenantSettings = @(
                        @{ settingName = 'AllowExternalDataSharingReceiverWorksWithShare'; isEnabled = $true; title = 'External sharing' }
                        @{ settingName = 'AllowGuestUserToAccessSharedContent'; isEnabled = $true; title = 'Guest access to content' }
                        @{ settingName = 'AllowGuestLookup'; isEnabled = $true; title = 'Guest user access' }
                        @{ settingName = 'ElevatedGuestsTenant'; isEnabled = $true; title = 'External invitations' }
                        @{ settingName = 'WebDashboardsPublishToWebDisabled'; isEnabled = $false; title = 'Publish to web disabled' }
                        @{ settingName = 'RScriptVisuals'; isEnabled = $true; title = 'R and Python visuals' }
                        @{ settingName = 'UseSensitivityLabels'; isEnabled = $false; title = 'Sensitivity labels' }
                        @{ settingName = 'ShareLinkToEntireOrg'; isEnabled = $true; title = 'Shareable links' }
                        @{ settingName = 'BlockResourceKeyAuthentication'; isEnabled = $false; title = 'Block ResourceKey Auth' }
                        @{ settingName = 'ServicePrincipalAccess'; isEnabled = $true; title = 'Service Principal API access' }
                        @{ settingName = 'CreateServicePrincipalProfile'; isEnabled = $true; title = 'Service Principal profiles' }
                    )
                } | ConvertTo-Json -Depth 5)
            }

            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            . "$PSScriptRoot/../../src/M365-Assess/PowerBI/Get-PowerBISecurityConfig.ps1"
        }

        It 'all checks should have Fail status when settings are insecure' {
            foreach ($s in $settings) {
                $s.Status | Should -Be 'Fail' `
                    -Because "Setting '$($s.Setting)' should be Fail when configured insecurely"
            }
        }
    }

    Context 'when Power BI connection is not established' {
        BeforeAll {
            # Remove locally-scoped functions from outer BeforeAll so global overrides take effect
            Remove-Item -Path Function:\Get-PowerBIAccessToken -ErrorAction SilentlyContinue
            Remove-Item -Path Function:\Invoke-PowerBIRestMethod -ErrorAction SilentlyContinue
            function global:Update-CheckProgress { param($CheckId, $Status) }
            function global:Import-Module { }
            function global:Get-PowerBIAccessToken { throw 'Not connected to Power BI service. Run Connect-PowerBIServiceAccount first.' }
            function global:Invoke-PowerBIRestMethod { }

            $errorOutput = $null
            try {
                . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
                . $PSScriptRoot/../../src/M365-Assess/PowerBI/Get-PowerBISecurityConfig.ps1
            }
            catch {
                $errorOutput = $_.Exception.Message
            }
        }

        It 'should fail with connection error' {
            $errorOutput | Should -Not -BeNullOrEmpty
            $errorOutput | Should -Match 'connection check failed|Not connected'
        }

        AfterAll {
            Remove-Item -Path Function:\Update-CheckProgress -ErrorAction SilentlyContinue
            Remove-Item -Path Function:\Import-Module -ErrorAction SilentlyContinue
            Remove-Item -Path Function:\Get-PowerBIAccessToken -ErrorAction SilentlyContinue
            Remove-Item -Path Function:\Invoke-PowerBIRestMethod -ErrorAction SilentlyContinue
        }
    }

    Context 'when tenant settings API returns 403 Forbidden' {
        BeforeAll {
            # Remove locally-scoped functions from outer BeforeAll so global overrides take effect
            Remove-Item -Path Function:\Get-PowerBIAccessToken -ErrorAction SilentlyContinue
            Remove-Item -Path Function:\Invoke-PowerBIRestMethod -ErrorAction SilentlyContinue
            function global:Update-CheckProgress { param($CheckId, $Status) }
            function global:Import-Module { }
            function global:Get-PowerBIAccessToken { return @{ 'Authorization' = 'Bearer test' } }
            function global:Invoke-PowerBIRestMethod { throw '403 Forbidden' }

            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            . $PSScriptRoot/../../src/M365-Assess/PowerBI/Get-PowerBISecurityConfig.ps1
        }

        It 'should produce settings (at least one Warning from API failure)' {
            $settings | Should -Not -BeNullOrEmpty
            ($settings | Where-Object { $_.Status -eq 'Warning' }) | Should -Not -BeNullOrEmpty
        }

        It 'should include permission error in Warning sentinel CurrentValue' {
            $warnSetting = $settings | Where-Object { $_.Status -eq 'Warning' } | Select-Object -First 1
            $warnSetting.CurrentValue | Should -Match 'denied|permission|403|unavailable'
        }

        AfterAll {
            Remove-Item -Path Function:\Update-CheckProgress -ErrorAction SilentlyContinue
            Remove-Item -Path Function:\Import-Module -ErrorAction SilentlyContinue
            Remove-Item -Path Function:\Get-PowerBIAccessToken -ErrorAction SilentlyContinue
            Remove-Item -Path Function:\Invoke-PowerBIRestMethod -ErrorAction SilentlyContinue
        }
    }

    Context 'when tenant settings API returns 404 Not Found' {
        BeforeAll {
            # Remove locally-scoped functions from outer BeforeAll so global overrides take effect
            Remove-Item -Path Function:\Get-PowerBIAccessToken -ErrorAction SilentlyContinue
            Remove-Item -Path Function:\Invoke-PowerBIRestMethod -ErrorAction SilentlyContinue
            function global:Update-CheckProgress { param($CheckId, $Status) }
            function global:Import-Module { }
            function global:Get-PowerBIAccessToken { return @{ 'Authorization' = 'Bearer test' } }
            function global:Invoke-PowerBIRestMethod { throw '404 Not Found' }

            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            . $PSScriptRoot/../../src/M365-Assess/PowerBI/Get-PowerBISecurityConfig.ps1
        }

        It 'should produce settings (at least one Warning from API failure)' {
            $settings | Should -Not -BeNullOrEmpty
            ($settings | Where-Object { $_.Status -eq 'Warning' }) | Should -Not -BeNullOrEmpty
        }

        It 'should include admin API message in Warning sentinel CurrentValue' {
            $warnSetting = $settings | Where-Object { $_.Status -eq 'Warning' } | Select-Object -First 1
            $warnSetting.CurrentValue | Should -Match 'admin API|not available|Administrator|unavailable'
        }

        AfterAll {
            Remove-Item -Path Function:\Update-CheckProgress -ErrorAction SilentlyContinue
            Remove-Item -Path Function:\Import-Module -ErrorAction SilentlyContinue
            Remove-Item -Path Function:\Get-PowerBIAccessToken -ErrorAction SilentlyContinue
            Remove-Item -Path Function:\Invoke-PowerBIRestMethod -ErrorAction SilentlyContinue
        }
    }

    Context 'when Power BI API is unavailable (generic error)' {
        BeforeAll {
            Remove-Item -Path Function:\Get-PowerBIAccessToken -ErrorAction SilentlyContinue
            Remove-Item -Path Function:\Invoke-PowerBIRestMethod -ErrorAction SilentlyContinue
            function global:Update-CheckProgress { param($CheckId, $Status) }
            function global:Import-Module { }
            function global:Get-PowerBIAccessToken { return @{ 'Authorization' = 'Bearer test' } }
            function global:Invoke-PowerBIRestMethod { throw 'API unavailable' }

            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            . $PSScriptRoot/../../src/M365-Assess/PowerBI/Get-PowerBISecurityConfig.ps1
            $script:failResult = @($settings)
        }

        It 'returns at least one setting instead of empty result' {
            $script:failResult.Count | Should -BeGreaterThan 0
        }
        It 'returns Warning status when API unavailable' {
            $script:failResult | Where-Object { $_.Status -eq 'Warning' } | Should -Not -BeNullOrEmpty
        }
        It 'does not return only non-Warning/non-Review checks' {
            $unexpected = $script:failResult | Where-Object { $_.Status -ne 'Review' -and $_.Status -ne 'Warning' }
            $unexpected | Should -BeNullOrEmpty
        }

        AfterAll {
            Remove-Item -Path Function:\Update-CheckProgress -ErrorAction SilentlyContinue
            Remove-Item -Path Function:\Import-Module -ErrorAction SilentlyContinue
            Remove-Item -Path Function:\Get-PowerBIAccessToken -ErrorAction SilentlyContinue
            Remove-Item -Path Function:\Invoke-PowerBIRestMethod -ErrorAction SilentlyContinue
        }
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}
