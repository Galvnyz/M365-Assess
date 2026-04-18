BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Export-ComplianceOverview' {
    BeforeAll {
        # Stub helper functions that Export-ComplianceOverview expects to be in scope
        function ConvertTo-HtmlSafe { param([string]$Text) return $Text }
        function Get-SvgHorizontalBar { return '<svg></svg>' }

        . "$PSScriptRoot/../../src/M365-Assess/Common/Export-ComplianceOverview.ps1"
    }

    Context 'when findings and frameworks are provided' {
        BeforeAll {
            $findings = @(
                [PSCustomObject]@{
                    CheckId      = 'ENTRA-ADMIN-001'
                    Setting      = 'Global Admin Count'
                    Status       = 'Pass'
                    RiskSeverity = 'High'
                    Section      = 'Identity'
                    Frameworks   = @{ 'cis-m365-v6' = @{ controlId = '1.1.3' } }
                }
                [PSCustomObject]@{
                    CheckId      = 'ENTRA-ADMIN-002'
                    Setting      = 'Admin Center Restricted'
                    Status       = 'Fail'
                    RiskSeverity = 'High'
                    Section      = 'Identity'
                    Frameworks   = @{ 'cis-m365-v6' = @{ controlId = '5.1.2.4' } }
                }
            )
            $controlRegistry = @{
                'ENTRA-ADMIN-001' = @{ checkId = 'ENTRA-ADMIN-001'; name = 'Global Admin Count'; hasAutomatedCheck = $true; frameworks = @{ 'cis-m365-v6' = @{ controlId = '1.1.3' } } }
                'ENTRA-ADMIN-002' = @{ checkId = 'ENTRA-ADMIN-002'; name = 'Admin Center'; hasAutomatedCheck = $true; frameworks = @{ 'cis-m365-v6' = @{ controlId = '5.1.2.4' } } }
            }
            $frameworks = @(
                @{
                    frameworkId    = 'cis-m365-v6'
                    name           = 'CIS Microsoft 365 Foundations Benchmark'
                    label          = 'CIS M365 v6.0.1'
                    filterFamily   = 'CIS'
                    scoringMethod  = 'profile-compliance'
                    totalControls  = 140
                    description    = 'CIS Benchmark for M365'
                    profiles       = @(@{ name = 'E3-L1'; label = 'E3 Level 1' })
                    controls       = @(
                        @{ controlId = '1.1.3'; title = 'GA Count'; profiles = @('E3-L1') }
                        @{ controlId = '5.1.2.4'; title = 'Admin Center'; profiles = @('E3-L1') }
                    )
                }
            )

            $result = Export-ComplianceOverview -Findings $findings -ControlRegistry $controlRegistry -Frameworks $frameworks -Sections @('Identity')
        }

        It 'should return HTML content' {
            $result | Should -Not -BeNullOrEmpty
        }

        It 'should contain Compliance Overview heading' {
            $result | Should -Match 'Compliance Overview'
        }

        It 'should include framework label' {
            $result | Should -Match 'CIS'
        }
    }

    Context 'when FrameworkFilter limits output' {
        BeforeAll {
            $findings = @(
                [PSCustomObject]@{ CheckId = 'X-001'; Setting = 'Test'; Status = 'Pass'; RiskSeverity = 'Low'; Section = 'Identity'; Frameworks = @{} }
            )
            $controlRegistry = @{ 'X-001' = @{ checkId = 'X-001'; hasAutomatedCheck = $true; frameworks = @{} } }
            $frameworks = @(
                @{ frameworkId = 'cis-m365-v6'; name = 'CIS'; label = 'CIS'; filterFamily = 'CIS'; scoringMethod = 'pass-rate'; controls = @(); totalControls = 0 }
                @{ frameworkId = 'nist-csf'; name = 'NIST CSF'; label = 'NIST CSF'; filterFamily = 'NIST'; scoringMethod = 'pass-rate'; controls = @(); totalControls = 0 }
            )

            $result = Export-ComplianceOverview -Findings $findings -ControlRegistry $controlRegistry -Frameworks $frameworks -FrameworkFilter @('CIS') -Sections @('Identity')
        }

        It 'should include the filtered framework' {
            $result | Should -Match 'CIS'
        }
    }

    Context 'when WhiteLabel is set with FrameworkFilters (single sub-level)' {
        BeforeAll {
            $findings = @(
                [PSCustomObject]@{ CheckId = 'ENTRA-001'; Setting = 'Test'; Status = 'Fail'; RiskSeverity = 'High'; Section = 'Identity'; Frameworks = @{ 'cis-m365-v6' = @{ controlId = '1.1' } } }
            )
            $controlRegistry = @{ 'ENTRA-001' = @{ checkId = 'ENTRA-001'; hasAutomatedCheck = $true; frameworks = @{} } }
            $frameworks = @(
                @{ frameworkId = 'cis-m365-v6'; name = 'CIS'; label = 'CIS M365'; filterFamily = 'CIS'; scoringMethod = 'pass-rate'; controls = @(); totalControls = 0 }
            )
            $frameworkFilters = @(
                [PSCustomObject]@{ Family = 'CIS'; FilterFamily = 'CIS'; Profiles = @('E3-L1','E3-L2','E5-L1','E5-L2'); Levels = $null; DisplayLabel = 'CIS E5 Level 2'; HasSubLevel = $true }
            )

            $result = Export-ComplianceOverview -Findings $findings -ControlRegistry $controlRegistry -Frameworks $frameworks -WhiteLabel -FrameworkFilters $frameworkFilters -Sections @('Identity')
        }

        It 'should rename heading to "{DisplayLabel} Compliance"' {
            $result | Should -Match 'CIS E5 Level 2 Compliance'
        }

        It 'should not show default Compliance Overview heading' {
            $result | Should -Not -Match '>Compliance Overview<'
        }

        It 'should hide the framework selector row' {
            $result | Should -Match "id='fwSelector'[^>]*display:none"
        }
    }

    Context 'when WhiteLabel is set with multiple sub-level FrameworkFilters' {
        BeforeAll {
            $findings = @(
                [PSCustomObject]@{ CheckId = 'ENTRA-001'; Setting = 'Test'; Status = 'Pass'; RiskSeverity = 'Low'; Section = 'Identity'; Frameworks = @{} }
            )
            $controlRegistry = @{ 'ENTRA-001' = @{ checkId = 'ENTRA-001'; hasAutomatedCheck = $true; frameworks = @{} } }
            $frameworks = @(
                @{ frameworkId = 'cis-m365-v6'; name = 'CIS'; label = 'CIS M365'; filterFamily = 'CIS'; scoringMethod = 'pass-rate'; controls = @(); totalControls = 0 }
            )
            $frameworkFilters = @(
                [PSCustomObject]@{ Family = 'CIS';  FilterFamily = 'CIS';  Profiles = @('E3-L1','E5-L1'); Levels = $null; DisplayLabel = 'CIS E5 Level 1'; HasSubLevel = $true }
                [PSCustomObject]@{ Family = 'CMMC'; FilterFamily = 'CMMC'; Profiles = $null; Levels = @('L1','L2','L3'); DisplayLabel = 'CMMC Level 3'; HasSubLevel = $true }
            )

            $result = Export-ComplianceOverview -Findings $findings -ControlRegistry $controlRegistry -Frameworks $frameworks -WhiteLabel -FrameworkFilters $frameworkFilters -Sections @('Identity')
        }

        It 'should combine labels in heading' {
            $result | Should -Match 'CIS E5 Level 1 / CMMC Level 3 Compliance'
        }
    }

    Context 'when WhiteLabel is not set (standard mode)' {
        BeforeAll {
            $findings = @(
                [PSCustomObject]@{ CheckId = 'ENTRA-001'; Setting = 'Test'; Status = 'Pass'; RiskSeverity = 'Low'; Section = 'Identity'; Frameworks = @{ 'cis-m365-v6' = @{ controlId = '1.1' } } }
            )
            $controlRegistry = @{ 'ENTRA-001' = @{ checkId = 'ENTRA-001'; hasAutomatedCheck = $true; frameworks = @{} } }
            $frameworks = @(
                @{ frameworkId = 'cis-m365-v6'; name = 'CIS'; label = 'CIS M365'; filterFamily = 'CIS'; scoringMethod = 'pass-rate'; controls = @(); totalControls = 0 }
            )

            $result = Export-ComplianceOverview -Findings $findings -ControlRegistry $controlRegistry -Frameworks $frameworks -Sections @('Identity')
        }

        It 'should use default Compliance Overview heading' {
            $result | Should -Match 'Compliance Overview'
        }

        It 'should show the visible framework selector' {
            $result | Should -Match "id='fwSelector'"
            $result | Should -Not -Match "id='fwSelector'[^>]*display:none"
        }
    }

    Context 'CMMC sub-filter includes L3 button' {
        BeforeAll {
            $findings = @(
                [PSCustomObject]@{ CheckId = 'ENTRA-001'; Setting = 'Test'; Status = 'Pass'; RiskSeverity = 'Low'; Section = 'Identity'; Frameworks = @{} }
            )
            $controlRegistry = @{ 'ENTRA-001' = @{ checkId = 'ENTRA-001'; hasAutomatedCheck = $true; frameworks = @{} } }
            $frameworks = @(
                @{ frameworkId = 'cmmc'; name = 'CMMC'; label = 'CMMC 2.0'; filterFamily = 'CMMC'; scoringMethod = 'pass-rate'; controls = @(); totalControls = 0 }
            )

            $result = Export-ComplianceOverview -Findings $findings -ControlRegistry $controlRegistry -Frameworks $frameworks -Sections @('Identity')
        }

        It 'should include CMMC L3 filter button' {
            $result | Should -Match "data-cmmc-level='L3'"
        }

        It 'should include L1, L2, and L3 buttons' {
            $result | Should -Match "data-cmmc-level='L1'"
            $result | Should -Match "data-cmmc-level='L2'"
            $result | Should -Match "data-cmmc-level='L3'"
        }
    }

    Context 'when no frameworks match filter' {
        BeforeAll {
            $findings = @(
                [PSCustomObject]@{ CheckId = 'X-001'; Setting = 'Test'; Status = 'Pass'; RiskSeverity = 'Low'; Section = 'Identity'; Frameworks = @{} }
            )
            $controlRegistry = @{ 'X-001' = @{ checkId = 'X-001'; hasAutomatedCheck = $true; frameworks = @{} } }
            $frameworks = @(
                @{ id = 'cis-m365-v6'; name = 'CIS'; filterFamily = 'CIS'; controls = @() }
            )

            $result = Export-ComplianceOverview -Findings $findings -ControlRegistry $controlRegistry -Frameworks $frameworks -FrameworkFilter @('HIPAA')
        }

        It 'should return empty string' {
            $result | Should -Be ''
        }
    }
}
