Describe 'Export-AssessmentReport HTML structure' {
    BeforeAll {
        # Read the raw script source to verify embedded HTML/CSS/JS patterns.
        # Full execution requires a live assessment folder with CSV data, so we
        # verify the template strings are present in the script source instead.
        $scriptPath = "$PSScriptRoot/../../Common/Export-AssessmentReport.ps1"
        $html = Get-Content -Path $scriptPath -Raw
        $overviewPath = "$PSScriptRoot/../../Common/Export-ComplianceOverview.ps1"
        $overviewSrc = Get-Content -Path $overviewPath -Raw
    }

    Context 'Dual-metric framework cards' {
        It 'Should include coverage bar CSS classes in stylesheet' {
            $html | Should -Match 'coverage-bar'
            $html | Should -Match 'coverage-fill'
            $html | Should -Match 'coverage-label'
        }

        It 'Should include data-catalog-total attribute on framework cards' {
            $overviewSrc | Should -Match 'data-catalog-total'
        }

        It 'Should include stat-sublabel in card HTML generation' {
            $overviewSrc | Should -Match 'stat-sublabel'
        }
    }

    Context 'Expand/Collapse All buttons' {
        It 'Should include expand/collapse buttons in section panels' {
            $html | Should -Match 'expand-all-btn'
            $html | Should -Match 'collapse-all-btn'
            $html | Should -Match 'collector-detail'
        }

        It 'Should render expand/collapse buttons only for sections with multiple collectors' {
            $html | Should -Match "sectionCollectors\.Count -gt 1"
        }

        It 'Should include matrix-controls CSS class' {
            $html | Should -Match 'matrix-controls'
        }

        It 'Should hide matrix-controls in print media' {
            # Verify the print media block suppresses the buttons
            $html | Should -Match '\.matrix-controls \{ display: none; \}'
        }

        It 'Should wire expand button to open collector-detail panels in parent section' {
            $html | Should -Match "expand-all-btn"
            $html | Should -Match "d\.open = true"
        }

        It 'Should wire collapse button to close collector-detail panels in parent section' {
            $html | Should -Match "collapse-all-btn"
            $html | Should -Match "d\.open = false"
        }

        It 'Should use btn.closest to scope to parent section' {
            $html | Should -Match "btn\.closest\('\.section'\)"
        }
    }

    Context 'Section filter data preparation' {
        It 'Should include Section property in allCisFindings population' {
            $html | Should -Match "Section\s*=\s*\`$c\.Section"
        }

        It 'Should include data-section attribute on compliance table rows' {
            $overviewSrc | Should -Match "data-section="
        }

        It 'Should embed complianceData JSON blob' {
            $overviewSrc | Should -Match 'var complianceData\s*='
        }
    }

    Context 'Unified filter JavaScript' {
        It 'Should include unified applyAllFilters function' {
            $html | Should -Match 'function applyAllFilters'
        }

        It 'Should include recalculateCards function' {
            $html | Should -Match 'function recalculateCards'
        }

        It 'Should include recalculateStatusBar function' {
            $html | Should -Match 'function recalculateStatusBar'
        }

        It 'Should wire up section filter change handlers' {
            $html | Should -Match "getElementById\('sectionFilter'\)"
        }

        It 'Should not contain old independent filter functions' {
            $html | Should -Not -Match 'function applyFrameworkFilter'
            $html | Should -Not -Match 'function applyStatusFilter'
        }
    }

    Context 'Section filter UI' {
        It 'Should include section filter HTML structure in overview' {
            $overviewSrc | Should -Match "id='sectionFilter'"
            $overviewSrc | Should -Match 'section-checkbox'
            $overviewSrc | Should -Match "id='sectionSelectAll'"
            $overviewSrc | Should -Match "id='sectionSelectNone'"
        }

        It 'Should include no-results placeholder in overview' {
            $overviewSrc | Should -Match "id='complianceNoResults'"
            $overviewSrc | Should -Match 'no-results'
        }

        It 'Should include section filter CSS' {
            $html | Should -Match '\.section-filter'
            $html | Should -Match '\.section-checkbox'
        }
    }

    Context 'JSON-driven framework rendering' {
        It 'Should dot-source Import-FrameworkDefinitions' {
            $html | Should -Match 'Import-FrameworkDefinitions\.ps1'
        }

        It 'Should dot-source Export-ComplianceOverview' {
            $html | Should -Match 'Export-ComplianceOverview\.ps1'
        }

        It 'Should call Import-FrameworkDefinitions with FrameworksPath' {
            $html | Should -Match 'Import-FrameworkDefinitions\s+-FrameworksPath'
        }

        It 'Should call Export-ComplianceOverview with required parameters' {
            $html | Should -Match 'Export-ComplianceOverview\s+-Findings'
        }

        It 'Should include Frameworks hashtable in finding object' {
            $html | Should -Match 'Frameworks\s*=\s*\$fwHash'
        }

        It 'Should not contain legacy flat framework properties' {
            $html | Should -Not -Match 'CisE3L1\s*='
            $html | Should -Not -Match 'Nist80053Low\s*='
            $html | Should -Not -Match 'Nist80053Privacy\s*='
        }

        It 'Should not contain hardcoded frameworkLookup hashtable' {
            $html | Should -Not -Match '\$frameworkLookup\s*='
        }

        It 'Should not contain allFrameworkKeys array' {
            $html | Should -Not -Match '\$allFrameworkKeys\s*='
        }

        It 'Should not contain cisProfileKeys or nistProfileKeys arrays' {
            $html | Should -Not -Match '\$cisProfileKeys\s*='
            $html | Should -Not -Match '\$nistProfileKeys\s*='
        }

        It 'Should not contain catalog CSV loading' {
            $html | Should -Not -Match '\$catalogFiles\s*='
            $html | Should -Not -Match '\$catalogCounts\s*='
        }
    }

    Context 'Export-ComplianceOverview structure' {
        It 'Should accept Frameworks parameter as hashtable array' {
            $overviewSrc | Should -Match '\[hashtable\[\]\]\$Frameworks'
        }

        It 'Should use frameworkId for data-fw attributes' {
            $overviewSrc | Should -Match "data-fw='\`$\(\`$fw\.frameworkId\)'"
        }

        It 'Should use frameworkId for checkbox values' {
            $overviewSrc | Should -Match "value='\`$\(\`$fw\.frameworkId\)'"
        }

        It 'Should use totalControls from framework definition' {
            $overviewSrc | Should -Match '\$fw\.totalControls'
        }

        It 'Should check scoringMethod for profile-based cards' {
            $overviewSrc | Should -Match "scoringMethod\s*-eq\s*'profile-compliance'"
        }

        It 'Should access finding data via Frameworks hashtable' {
            $overviewSrc | Should -Match '\$finding\.Frameworks'
        }

        It 'Should apply FrameworkFilter internally' {
            $overviewSrc | Should -Match '\$FrameworkFilter'
            $overviewSrc | Should -Match 'filterFamily'
        }
    }

    Context 'DNS subsection divider' {
        It 'Should include dns-subsection-divider CSS class' {
            $html | Should -Match 'dns-subsection-divider'
        }

        It 'Should include DNS subsection heading text' {
            $html | Should -Match 'DNS Authentication'
        }

        It 'Should include source description for DNS tables' {
            $html | Should -Match 'public DNS queries'
        }
    }

    Context 'Data source badges' {
        It 'Should include source-badge CSS class' {
            $html | Should -Match 'source-badge'
        }

        It 'Should include EXO source badge' {
            $html | Should -Match 'source-exo'
        }

        It 'Should include DNS source badge' {
            $html | Should -Match 'source-dns'
        }
    }

    Context 'Copy-to-clipboard for remediation' {
        It 'Should include copyRemediation JavaScript function' {
            $html | Should -Match 'function copyRemediation'
        }

        It 'Should include copy button CSS' {
            $html | Should -Match '\.copy-btn'
        }

        It 'Should include cmdlet pattern for PowerShell detection' {
            $html | Should -Match 'Set\|Get\|New\|Remove\|Update\|Enable\|Disable'
        }

        It 'Should hide copy button in print styles' {
            $html | Should -Match '@media print[\s\S]*?\.copy-btn[\s\S]*?display:\s*none'
        }
    }
}
