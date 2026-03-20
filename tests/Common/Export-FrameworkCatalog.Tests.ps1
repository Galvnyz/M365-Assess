Describe 'Export-FrameworkCatalog - Scoring Engine' {
    BeforeAll {
        . "$PSScriptRoot/../../Common/Import-FrameworkDefinitions.ps1"
        . "$PSScriptRoot/../../Common/Export-FrameworkCatalog.ps1"
        $frameworksPath = "$PSScriptRoot/../../controls/frameworks"
        $allFrameworks = Import-FrameworkDefinitions -FrameworksPath $frameworksPath
        $projectRoot = "$PSScriptRoot/../.."

        $regRaw = Get-Content "$projectRoot/controls/registry.json" -Raw | ConvertFrom-Json
        $registry = @{}
        foreach ($c in $regRaw.checks) { $registry[$c.checkId] = $c }

        function New-MockFinding {
            param([string]$CheckId, [string]$Status = 'Pass', [string]$Section = 'Identity')
            [PSCustomObject]@{
                CheckId = $CheckId; Setting = "Test Setting for $CheckId"
                Status = $Status; RiskSeverity = 'Medium'; Section = $Section
                Frameworks = if ($registry[$CheckId]) { $registry[$CheckId].frameworks } else { @{} }
            }
        }
    }

    Context 'function-coverage (NIST CSF)' {
        It 'Returns all 6 CSF function groups' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'nist-csf' }
            $findings = @(
                New-MockFinding -CheckId 'ENTRA-CLOUDADMIN-001' -Status 'Pass'
                New-MockFinding -CheckId 'CA-MFA-ADMIN-001' -Status 'Fail'
            )
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped
            $result.Groups | Should -Not -BeNullOrEmpty
            $result.Groups.Count | Should -Be 6
            $result.Groups | ForEach-Object { $_.Key | Should -BeIn @('GV','ID','PR','DE','RS','RC') }
            $result.Summary.MappedControls | Should -BeGreaterThan 0
        }
    }

    Context 'profile-compliance (NIST 800-53)' {
        It 'Groups findings by profile tags' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'nist-800-53' }
            $findings = @(New-MockFinding -CheckId 'ENTRA-CLOUDADMIN-001')
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped
            $result.Groups | Should -Not -BeNullOrEmpty
        }
    }

    Context 'control-coverage (ISO 27001)' {
        It 'Groups findings by clause number from A.{clause}.{control}' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'iso-27001' }
            $findings = @(New-MockFinding -CheckId 'ENTRA-CLOUDADMIN-001')
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped
            $result.Groups | Should -Not -BeNullOrEmpty
            $result.Groups | ForEach-Object { $_.Key | Should -BeIn @('5','6','7','8') }
        }
    }

    Context 'technique-coverage (MITRE ATT&CK)' {
        It 'Groups findings by tactic via technique-to-tactic map' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'mitre-attack' }
            $findings = @(New-MockFinding -CheckId 'ENTRA-CLOUDADMIN-001')
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped
            $result.Groups | Should -Not -BeNullOrEmpty
        }
    }

    Context 'maturity-level (Essential Eight)' {
        It 'Groups findings by maturity level prefix ML{n}' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'essential-eight' }
            $findings = @(New-MockFinding -CheckId 'ENTRA-CLOUDADMIN-001')
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped
            $result.Groups | Should -Not -BeNullOrEmpty
            $result.Groups | ForEach-Object { $_.Key | Should -BeIn @('ML1','ML2','ML3') }
        }
    }

    Context 'maturity-level (CMMC)' {
        It 'Returns groups for L1, L2, L3 levels' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'cmmc' }
            $findings = @(New-MockFinding -CheckId 'ENTRA-CLOUDADMIN-001')
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped
            $result.Groups | Should -Not -BeNullOrEmpty
        }
    }

    Context 'criteria-coverage (SOC 2)' {
        It 'Groups findings by exact criteria key (CC6.1, CC7.2, etc.)' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'soc2' }
            $findings = @(New-MockFinding -CheckId 'ENTRA-CLOUDADMIN-001')
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped
            $result.Groups | Should -Not -BeNullOrEmpty
            $hasCcKey = $result.Groups | Where-Object { $_.Key -match '^CC\d+\.\d+$' }
            $hasCcKey | Should -Not -BeNullOrEmpty
        }
    }

    Context 'criteria-coverage (HIPAA)' {
        It 'Groups findings by section extracted before parenthesis' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'hipaa' }
            $findings = @(New-MockFinding -CheckId 'ENTRA-CLOUDADMIN-001')
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped
            $result.Groups | Should -Not -BeNullOrEmpty
        }
    }

    Context 'requirement-compliance (PCI DSS)' {
        It 'Groups findings by requirement number' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'pci-dss' }
            $findings = @(New-MockFinding -CheckId 'ENTRA-CLOUDADMIN-001')
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped
            $result.Groups | Should -Not -BeNullOrEmpty
        }
    }

    Context 'policy-compliance (CISA SCuBA)' {
        It 'Groups findings by product from second segment of MS.{product}.*' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'cisa-scuba' }
            $findings = @(New-MockFinding -CheckId 'ENTRA-CLOUDADMIN-001')
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped
            $result.Groups | Should -Not -BeNullOrEmpty
        }
    }

    Context 'severity-coverage (STIG)' {
        It 'Groups findings by severity category' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'stig' }
            $findings = @(New-MockFinding -CheckId 'ENTRA-CLOUDADMIN-001')
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped
            $result.Groups | Should -Not -BeNullOrEmpty
        }
    }

    Context 'Edge cases' {
        It 'Returns zero-count GroupedResult when no findings map to framework' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'nist-csf' }
            $findings = @([PSCustomObject]@{
                CheckId = 'FAKE-001'; Setting = 'Fake'; Status = 'Pass'
                RiskSeverity = 'Low'; Section = 'Test'; Frameworks = @{}
            })
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped
            $result.Summary.MappedControls | Should -Be 0
        }

        It 'Falls back to control-coverage for unknown scoring method' {
            $fakeFw = @{
                frameworkId = 'test-unknown'; label = 'Test Unknown'; scoringMethod = 'unknown-method'
                totalControls = 10; scoringData = @{}; extraData = @{}; css = 'fw-default'
                filterFamily = 'TEST'; profiles = $null; description = ''; displayOrder = 99
            }
            $findings = @(New-MockFinding -CheckId 'ENTRA-CLOUDADMIN-001')
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fakeFw -ControlRegistry $registry -Mode Grouped -WarningAction SilentlyContinue
            $result | Should -Not -BeNullOrEmpty
        }
    }

    Context 'Inline mode - HTML output' {
        BeforeAll {
            $inlineCheckIds = @(
                'ENTRA-CLOUDADMIN-001', 'CA-MFA-ADMIN-001', 'CA-LEGACYAUTH-001',
                'EXO-AUDIT-001', 'EXO-FORWARD-001', 'DEFENDER-SAFELINK-001',
                'SPO-SHARING-001', 'TEAMS-EXTERNAL-001', 'DNS-SPF-001',
                'ENTRA-CONSENT-001', 'ENTRA-PASSWORD-001', 'CA-MFA-ALL-001'
            ) | Where-Object { $registry.ContainsKey($_) }
            $inlineFindings = @($inlineCheckIds | ForEach-Object { New-MockFinding -CheckId $_ })
        }

        It 'Returns HTML string containing framework label' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'nist-csf' }
            $html = Export-FrameworkCatalog -Findings $inlineFindings -Framework $fw -ControlRegistry $registry -Mode Inline
            $html | Should -BeOfType [string]
            $html | Should -Match 'NIST CSF'
            $html | Should -Match '<details'
            $html | Should -Match 'badge-success|badge-failed'
        }

        It 'Returns placeholder message for zero mapped findings' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'nist-csf' }
            $fakeFindings = @([PSCustomObject]@{
                CheckId = 'FAKE-001'; Setting = 'Fake'; Status = 'Pass'
                RiskSeverity = 'Low'; Section = 'Test'; Frameworks = @{}
            })
            $html = Export-FrameworkCatalog -Findings $fakeFindings -Framework $fw -ControlRegistry $registry -Mode Inline
            $html | Should -Match 'No assessed findings map to this framework'
        }

        It 'Contains coverage bar with percentage' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'nist-csf' }
            $html = Export-FrameworkCatalog -Findings $inlineFindings -Framework $fw -ControlRegistry $registry -Mode Inline
            $html | Should -Match 'coverage-bar'
            $html | Should -Match 'coverage-fill'
        }

        It 'Contains group breakdown table rows' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'nist-csf' }
            $html = Export-FrameworkCatalog -Findings $inlineFindings -Framework $fw -ControlRegistry $registry -Mode Inline
            $html | Should -Match '<table'
            $html | Should -Match '<tr'
        }

        It 'Contains findings detail table with CheckId column' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'nist-csf' }
            $html = Export-FrameworkCatalog -Findings $inlineFindings -Framework $fw -ControlRegistry $registry -Mode Inline
            $html | Should -Match 'CheckId|Check ID'
        }

        It 'Inline HTML for all 14 frameworks is valid' {
            foreach ($fw in $allFrameworks) {
                $html = Export-FrameworkCatalog -Findings $inlineFindings -Framework $fw -ControlRegistry $registry -Mode Inline -WarningAction SilentlyContinue
                $html | Should -BeOfType [string] -Because "$($fw.frameworkId) should return HTML"
                $html | Should -Match $fw.label -Because "$($fw.frameworkId) HTML should contain its label"
            }
        }
    }

    Context 'Standalone mode - HTML file output' {
        BeforeAll {
            $standaloneCheckIds = @(
                'ENTRA-CLOUDADMIN-001', 'CA-MFA-ADMIN-001', 'CA-LEGACYAUTH-001',
                'EXO-AUDIT-001', 'EXO-FORWARD-001', 'DEFENDER-SAFELINK-001',
                'SPO-SHARING-001', 'TEAMS-EXTERNAL-001', 'DNS-SPF-001',
                'ENTRA-CONSENT-001', 'ENTRA-PASSWORD-001', 'CA-MFA-ALL-001'
            ) | Where-Object { $registry.ContainsKey($_) }
            $standaloneFindings = @($standaloneCheckIds | ForEach-Object { New-MockFinding -CheckId $_ })
            $standaloneDir = Join-Path -Path $TestDrive -ChildPath 'standalone'
            New-Item -ItemType Directory -Path $standaloneDir -Force | Out-Null
        }

        It 'Writes a complete HTML file with DOCTYPE' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'nist-csf' }
            $outPath = Join-Path -Path $standaloneDir -ChildPath 'nist-csf-catalog.html'
            Export-FrameworkCatalog -Findings $standaloneFindings -Framework $fw -ControlRegistry $registry -Mode Standalone -OutputPath $outPath -TenantName 'TestTenant'
            Test-Path -Path $outPath | Should -BeTrue
            $content = Get-Content -Path $outPath -Raw
            $content | Should -Match '<!DOCTYPE html>'
            $content | Should -Match 'NIST CSF'
            $content | Should -Match 'TestTenant'
        }

        It 'Contains embedded CSS with theme variables' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'nist-csf' }
            $outPath = Join-Path -Path $standaloneDir -ChildPath 'nist-csf-css.html'
            Export-FrameworkCatalog -Findings $standaloneFindings -Framework $fw -ControlRegistry $registry -Mode Standalone -OutputPath $outPath -TenantName 'TestTenant'
            $content = Get-Content -Path $outPath -Raw
            $content | Should -Match '--m365a-primary'
            $content | Should -Match 'badge-success'
        }

        It 'Contains group breakdown table and findings' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'nist-csf' }
            $outPath = Join-Path -Path $standaloneDir -ChildPath 'nist-csf-tables.html'
            Export-FrameworkCatalog -Findings $standaloneFindings -Framework $fw -ControlRegistry $registry -Mode Standalone -OutputPath $outPath -TenantName 'TestTenant'
            $content = Get-Content -Path $outPath -Raw
            $content | Should -Match 'catalog-groups'
            $content | Should -Match 'catalog-findings'
        }

        It 'Includes dark theme toggle script' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'iso-27001' }
            $outPath = Join-Path -Path $standaloneDir -ChildPath 'iso-toggle.html'
            Export-FrameworkCatalog -Findings $standaloneFindings -Framework $fw -ControlRegistry $registry -Mode Standalone -OutputPath $outPath -TenantName 'TestTenant'
            $content = Get-Content -Path $outPath -Raw
            $content | Should -Match 'dark-theme|theme-toggle'
        }

        It 'Standalone works for all 14 frameworks' {
            foreach ($fw in $allFrameworks) {
                $safeName = $fw.frameworkId -replace '[^a-zA-Z0-9]', '-'
                $outPath = Join-Path -Path $standaloneDir -ChildPath "$safeName-all.html"
                Export-FrameworkCatalog -Findings $standaloneFindings -Framework $fw -ControlRegistry $registry -Mode Standalone -OutputPath $outPath -TenantName 'TestTenant' -WarningAction SilentlyContinue
                Test-Path -Path $outPath | Should -BeTrue -Because "$($fw.frameworkId) should write a file"
                $content = Get-Content -Path $outPath -Raw
                $content | Should -Match $fw.label -Because "$($fw.frameworkId) should contain its label"
                $content | Should -Match '<!DOCTYPE html>' -Because "$($fw.frameworkId) should be a complete HTML document"
            }
        }
    }

    Context 'Integration - all 14 frameworks' {
        It 'Produces valid GroupedResult for every framework' {
            $checkIds = @(
                'ENTRA-CLOUDADMIN-001', 'CA-MFA-ADMIN-001', 'CA-LEGACYAUTH-001',
                'EXO-AUDIT-001', 'EXO-FORWARD-001', 'DEFENDER-SAFELINK-001',
                'SPO-SHARING-001', 'TEAMS-EXTERNAL-001', 'DNS-SPF-001',
                'ENTRA-PIM-001', 'INTUNE-COMPLIANCE-001', 'POWERBI-GUEST-001',
                'ENTRA-CONSENT-001', 'ENTRA-PASSWORD-001', 'FORMS-PHISHING-001',
                'COMPLIANCE-AUDIT-001', 'CA-MFA-ALL-001', 'DEFENDER-ANTIPHISH-001',
                'PURVIEW-RETENTION-001', 'ENTRA-ADMIN-001'
            ) | Where-Object { $registry.ContainsKey($_) }
            $findings = @($checkIds | ForEach-Object { New-MockFinding -CheckId $_ })

            foreach ($fw in $allFrameworks) {
                $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped -WarningAction SilentlyContinue
                $result | Should -Not -BeNullOrEmpty -Because "Framework $($fw.frameworkId) should return a result"
                $result.Groups | Should -Not -BeNullOrEmpty -Because "Framework $($fw.frameworkId) should have groups"
                $result.Summary | Should -Not -BeNullOrEmpty -Because "Framework $($fw.frameworkId) should have summary"
                $result.Summary.TotalControls | Should -BeGreaterThan 0 -Because "Framework $($fw.frameworkId) should have totalControls"
            }
        }
    }
}
