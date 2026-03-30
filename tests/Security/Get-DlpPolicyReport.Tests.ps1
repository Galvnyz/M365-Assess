BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-DlpPolicyReport' {
    BeforeAll {
        # Stub Purview/Compliance cmdlets so Mock can find them
        function Get-Label { }
        function Get-DlpCompliancePolicy { }
        function Get-DlpComplianceRule { }

        # Mock connection guard: Get-Label succeeds and returns at least one result
        Mock Get-Label {
            return @(
                [PSCustomObject]@{
                    DisplayName = 'Confidential'
                    Disabled    = $false
                    Priority    = 0
                    Tooltip     = 'Confidential data'
                    ParentId    = $null
                    ContentType = 'File, Email'
                }
                [PSCustomObject]@{
                    DisplayName = 'Highly Confidential'
                    Disabled    = $false
                    Priority    = 1
                    Tooltip     = 'Highly sensitive data'
                    ParentId    = $null
                    ContentType = 'File, Email'
                }
            )
        }

        # Mock Get-Command to indicate all three Purview cmdlets are available
        Mock Get-Command {
            param($Name, $ErrorAction)
            switch ($Name) {
                'Get-Label'               { return [PSCustomObject]@{ Name = 'Get-Label' } }
                'Get-DlpCompliancePolicy' { return [PSCustomObject]@{ Name = 'Get-DlpCompliancePolicy' } }
                'Get-DlpComplianceRule'   { return [PSCustomObject]@{ Name = 'Get-DlpComplianceRule' } }
                default                   { return $null }
            }
        }

        # DLP policies
        Mock Get-DlpCompliancePolicy {
            return @(
                [PSCustomObject]@{
                    Name                  = 'PCI DSS Policy'
                    Enabled               = $true
                    Mode                  = 'Enable'
                    Priority              = 0
                    ExchangeLocation      = @('All')
                    SharePointLocation    = @()
                    OneDriveLocation      = @()
                    TeamsLocation         = @()
                    EndpointDlpLocation   = @()
                }
                [PSCustomObject]@{
                    Name                  = 'HIPAA Policy'
                    Enabled               = $false
                    Mode                  = 'Disable'
                    Priority              = 1
                    ExchangeLocation      = @()
                    SharePointLocation    = @('All')
                    OneDriveLocation      = @('All')
                    TeamsLocation         = @()
                    EndpointDlpLocation   = @()
                }
            )
        }

        # DLP rules
        Mock Get-DlpComplianceRule {
            return @(
                [PSCustomObject]@{
                    Name                                = 'PCI DSS Rule - Low'
                    Disabled                            = $false
                    Priority                            = 0
                    ParentPolicyName                    = 'PCI DSS Policy'
                    BlockAccess                         = $false
                    NotifyUser                          = @('LastModifier', 'Owner')
                    ContentContainsSensitiveInformation = @(
                        [PSCustomObject]@{ Name = 'Credit Card Number' }
                    )
                }
                [PSCustomObject]@{
                    Name                                = 'HIPAA Rule - High'
                    Disabled                            = $true
                    Priority                            = 1
                    ParentPolicyName                    = 'HIPAA Policy'
                    BlockAccess                         = $true
                    NotifyUser                          = $null
                    ContentContainsSensitiveInformation = @()
                }
            )
        }

        # Run the script by dot-sourcing it; capture output
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $script:results = . "$PSScriptRoot/../../src/M365-Assess/Security/Get-DlpPolicyReport.ps1"
    }

    It 'Returns a non-empty results list' {
        $script:results.Count | Should -BeGreaterThan 0
    }

    It 'All results have required properties' {
        foreach ($r in $script:results) {
            $r.PSObject.Properties.Name | Should -Contain 'ItemType'
            $r.PSObject.Properties.Name | Should -Contain 'Name'
            $r.PSObject.Properties.Name | Should -Contain 'Enabled'
            $r.PSObject.Properties.Name | Should -Contain 'Priority'
            $r.PSObject.Properties.Name | Should -Contain 'Details'
        }
    }

    It 'ItemType values are only DlpPolicy, DlpRule, or SensitivityLabel' {
        $validTypes = @('DlpPolicy', 'DlpRule', 'SensitivityLabel')
        foreach ($r in $script:results) {
            $r.ItemType | Should -BeIn $validTypes `
                -Because "ItemType '$($r.ItemType)' is not a recognised type"
        }
    }

    It 'Returns DLP policies' {
        $policies = $script:results | Where-Object { $_.ItemType -eq 'DlpPolicy' }
        $policies.Count | Should -BeGreaterThan 0
    }

    It 'Returns DLP rules' {
        $rules = $script:results | Where-Object { $_.ItemType -eq 'DlpRule' }
        $rules.Count | Should -BeGreaterThan 0
    }

    It 'Returns sensitivity labels' {
        $labels = $script:results | Where-Object { $_.ItemType -eq 'SensitivityLabel' }
        $labels.Count | Should -BeGreaterThan 0
    }

    It 'DLP policy Name matches mock data' {
        $entry = $script:results | Where-Object { $_.ItemType -eq 'DlpPolicy' -and $_.Name -eq 'PCI DSS Policy' }
        $entry | Should -Not -BeNullOrEmpty
    }

    It 'DLP policy Enabled reflects Enabled property when set' {
        $entry = $script:results | Where-Object { $_.ItemType -eq 'DlpPolicy' -and $_.Name -eq 'PCI DSS Policy' }
        $entry.Enabled | Should -Be $true
    }

    It 'DLP policy Enabled is false when Mode is Disable' {
        $entry = $script:results | Where-Object { $_.ItemType -eq 'DlpPolicy' -and $_.Name -eq 'HIPAA Policy' }
        $entry | Should -Not -BeNullOrEmpty
        $entry.Enabled | Should -Be $false
    }

    It 'DLP policy Details includes Mode and Locations' {
        $entry = $script:results | Where-Object { $_.ItemType -eq 'DlpPolicy' -and $_.Name -eq 'PCI DSS Policy' }
        $entry.Details | Should -Match 'Mode='
        $entry.Details | Should -Match 'Locations='
    }

    It 'DLP policy with Exchange location includes Exchange in Details' {
        $entry = $script:results | Where-Object { $_.ItemType -eq 'DlpPolicy' -and $_.Name -eq 'PCI DSS Policy' }
        $entry.Details | Should -Match 'Exchange'
    }

    It 'DLP rule Enabled reflects negation of Disabled property' {
        $enabledRule = $script:results | Where-Object { $_.ItemType -eq 'DlpRule' -and $_.Name -eq 'PCI DSS Rule - Low' }
        $enabledRule.Enabled | Should -Be $true

        $disabledRule = $script:results | Where-Object { $_.ItemType -eq 'DlpRule' -and $_.Name -eq 'HIPAA Rule - High' }
        $disabledRule.Enabled | Should -Be $false
    }

    It 'DLP rule Details includes Policy name' {
        $entry = $script:results | Where-Object { $_.ItemType -eq 'DlpRule' -and $_.Name -eq 'PCI DSS Rule - Low' }
        $entry.Details | Should -Match 'Policy=PCI DSS Policy'
    }

    It 'DLP rule Details includes sensitive information type name' {
        $entry = $script:results | Where-Object { $_.ItemType -eq 'DlpRule' -and $_.Name -eq 'PCI DSS Rule - Low' }
        $entry.Details | Should -Match 'SensitiveInfo='
        $entry.Details | Should -Match 'Credit Card Number'
    }

    It 'Sensitivity label Name uses DisplayName from mock' {
        $entry = $script:results | Where-Object { $_.ItemType -eq 'SensitivityLabel' -and $_.Name -eq 'Confidential' }
        $entry | Should -Not -BeNullOrEmpty
    }

    It 'Sensitivity label Enabled reflects negation of Disabled property' {
        $entry = $script:results | Where-Object { $_.ItemType -eq 'SensitivityLabel' -and $_.Name -eq 'Confidential' }
        $entry.Enabled | Should -Be $true
    }

    It 'Sensitivity label Details includes Tooltip' {
        $entry = $script:results | Where-Object { $_.ItemType -eq 'SensitivityLabel' -and $_.Name -eq 'Confidential' }
        $entry.Details | Should -Match 'Tooltip='
    }

    It 'Returns 6 total items (2 policies + 2 rules + 2 labels)' {
        $script:results.Count | Should -Be 6
    }
}

Describe 'Get-DlpPolicyReport - Not Connected' {
    BeforeAll {
        function Get-Label { }
        function Get-DlpCompliancePolicy { }
        function Get-DlpComplianceRule { }

        # Both connection guard paths fail
        Mock Get-Label {
            throw 'The remote server returned an error: (401) Unauthorized.'
        }

        Mock Get-Command {
            param($Name, $ErrorAction)
            # Simulate Get-Label exists but Get-DlpCompliancePolicy does not
            switch ($Name) {
                'Get-Label' { return [PSCustomObject]@{ Name = 'Get-Label' } }
                default     { throw "CommandNotFoundException: $Name" }
            }
        }
    }

    It 'Writes an error and returns nothing when not connected' {
        # The script calls Write-Error with $ErrorActionPreference = 'Stop', so it throws.
        # Wrap in try/catch to absorb the terminating error; verify no PSCustomObject was emitted.
        $captured = @()
        try {
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            $captured = @(. "$PSScriptRoot/../../src/M365-Assess/Security/Get-DlpPolicyReport.ps1")
        }
        catch {
            # Expected — Write-Error throws when ErrorActionPreference is Stop
        }
        $objects = @($captured | Where-Object { $_ -is [PSCustomObject] })
        $objects.Count | Should -Be 0
    }
}

Describe 'Get-DlpPolicyReport - No Data in Tenant' {
    BeforeAll {
        function Get-Label { }
        function Get-DlpCompliancePolicy { }
        function Get-DlpComplianceRule { }

        # Connection guard: Get-Label returns one item (session active)
        Mock Get-Label {
            return @([PSCustomObject]@{
                DisplayName = 'Dummy'
                Disabled    = $false
                Priority    = 0
                Tooltip     = ''
                ParentId    = $null
                ContentType = $null
            })
        }

        Mock Get-Command {
            param($Name, $ErrorAction)
            switch ($Name) {
                'Get-Label'               { return [PSCustomObject]@{ Name = 'Get-Label' } }
                'Get-DlpCompliancePolicy' { return [PSCustomObject]@{ Name = 'Get-DlpCompliancePolicy' } }
                'Get-DlpComplianceRule'   { return [PSCustomObject]@{ Name = 'Get-DlpComplianceRule' } }
                default                   { return $null }
            }
        }

        # Return empty collections for all three data cmdlets
        Mock Get-DlpCompliancePolicy { return @() }
        Mock Get-DlpComplianceRule   { return @() }
    }

    It 'Still returns sensitivity labels even when policies and rules are empty' {
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $output = . "$PSScriptRoot/../../src/M365-Assess/Security/Get-DlpPolicyReport.ps1"
        $labels = @($output | Where-Object { $_.ItemType -eq 'SensitivityLabel' })
        $labels.Count | Should -BeGreaterThan 0
    }
}

Describe 'Get-DlpPolicyReport - OutputPath' {
    BeforeAll {
        function Get-Label { }
        function Get-DlpCompliancePolicy { }
        function Get-DlpComplianceRule { }

        Mock Get-Label {
            return @([PSCustomObject]@{
                DisplayName = 'Confidential'
                Disabled    = $false
                Priority    = 0
                Tooltip     = 'Confidential data'
                ParentId    = $null
                ContentType = 'File, Email'
            })
        }

        Mock Get-Command {
            param($Name, $ErrorAction)
            switch ($Name) {
                'Get-Label'               { return [PSCustomObject]@{ Name = 'Get-Label' } }
                'Get-DlpCompliancePolicy' { return [PSCustomObject]@{ Name = 'Get-DlpCompliancePolicy' } }
                'Get-DlpComplianceRule'   { return [PSCustomObject]@{ Name = 'Get-DlpComplianceRule' } }
                default                   { return $null }
            }
        }

        Mock Get-DlpCompliancePolicy { return @() }
        Mock Get-DlpComplianceRule   { return @() }

        $script:csvPath = [System.IO.Path]::GetTempFileName() -replace '\.tmp$', '.csv'
    }

    It 'Exports CSV when OutputPath is specified and writes confirmation message' {
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $msg = . "$PSScriptRoot/../../src/M365-Assess/Security/Get-DlpPolicyReport.ps1" -OutputPath $script:csvPath
        $msg | Should -Match 'Exported'
        Test-Path $script:csvPath | Should -Be $true
        $imported = Import-Csv -Path $script:csvPath
        $imported.Count | Should -BeGreaterThan 0
    }

    AfterAll {
        if (Test-Path $script:csvPath) {
            Remove-Item -Path $script:csvPath -Force
        }
    }
}
