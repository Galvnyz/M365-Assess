BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'DefenderHelpers' {
    BeforeAll {
        function global:Get-EOPProtectionPolicyRule { }
        function global:Get-ATPProtectionPolicyRule { }

        # No preset policy rules active
        Mock Get-Command {
            param($Name, $ErrorAction)
            return $null
        }

        . "$PSScriptRoot/../../src/M365-Assess/Security/DefenderHelpers.ps1"
    }

    Describe 'Test-PresetPolicy' {
        It 'Returns null when policy name is not in preset map' {
            $result = Test-PresetPolicy -PolicyName 'Default'
            $result | Should -BeNullOrEmpty
        }

        It 'Returns null for unknown policy names' {
            $result = Test-PresetPolicy -PolicyName 'SomeRandomPolicy'
            $result | Should -BeNullOrEmpty
        }
    }

    It 'Initializes eopRules to empty array when cmdlet not available' {
        $script:eopRules.Count | Should -Be 0
    }

    It 'Initializes presetPolicyNames to empty hashtable when cmdlet not available' {
        $script:presetPolicyNames.Count | Should -Be 0
    }

    AfterAll {
        Remove-Item Function:\Get-EOPProtectionPolicyRule -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-ATPProtectionPolicyRule -ErrorAction SilentlyContinue
    }
}

Describe 'DefenderHelpers - With Preset Policies' {
    BeforeAll {
        function global:Get-EOPProtectionPolicyRule { }
        function global:Get-ATPProtectionPolicyRule { }

        Mock Get-Command {
            param($Name, $ErrorAction)
            switch ($Name) {
                'Get-EOPProtectionPolicyRule' { return [PSCustomObject]@{ Name = 'Get-EOPProtectionPolicyRule' } }
                'Get-ATPProtectionPolicyRule' { return [PSCustomObject]@{ Name = 'Get-ATPProtectionPolicyRule' } }
                default { return $null }
            }
        }

        Mock Get-EOPProtectionPolicyRule {
            return @(
                [PSCustomObject]@{
                    Identity                  = 'Standard Preset Security Policy'
                    State                     = 'Enabled'
                    HostedContentFilterPolicy = 'Standard Preset Security Policy1234567890'
                    AntiPhishPolicy           = 'Standard AntiPhish Policy9876543210'
                    MalwareFilterPolicy       = $null
                }
                [PSCustomObject]@{
                    Identity                  = 'Strict Preset Security Policy'
                    State                     = 'Enabled'
                    HostedContentFilterPolicy = 'Strict Preset Security Policy5551234567'
                    AntiPhishPolicy           = 'Strict AntiPhish Policy5559876543'
                    MalwareFilterPolicy       = $null
                }
            )
        }

        Mock Get-ATPProtectionPolicyRule {
            return @(
                [PSCustomObject]@{
                    Identity             = 'Standard Preset Security Policy'
                    State                = 'Enabled'
                    SafeLinksPolicy      = 'Standard Safe Links Policy111'
                    SafeAttachmentPolicy = 'Standard Safe Attachments Policy222'
                }
            )
        }

        . "$PSScriptRoot/../../src/M365-Assess/Security/DefenderHelpers.ps1"
    }

    It 'Test-PresetPolicy returns Standard for standard-managed spam policy' {
        $result = Test-PresetPolicy -PolicyName 'Standard Preset Security Policy1234567890'
        $result | Should -Be 'Standard'
    }

    It 'Test-PresetPolicy returns Strict for strict-managed phish policy' {
        $result = Test-PresetPolicy -PolicyName 'Strict AntiPhish Policy5559876543'
        $result | Should -Be 'Strict'
    }

    It 'Test-PresetPolicy returns Standard for standard-managed Safe Links policy' {
        $result = Test-PresetPolicy -PolicyName 'Standard Safe Links Policy111'
        $result | Should -Be 'Standard'
    }

    It 'Test-PresetPolicy returns null for non-preset policy' {
        $result = Test-PresetPolicy -PolicyName 'Default'
        $result | Should -BeNullOrEmpty
    }

    It 'eopRules contains the returned rules' {
        $script:eopRules.Count | Should -BeGreaterThan 0
    }

    AfterAll {
        Remove-Item Function:\Get-EOPProtectionPolicyRule -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-ATPProtectionPolicyRule -ErrorAction SilentlyContinue
    }
}
