Describe 'Export-AssessmentReport HTML structure' {
    BeforeAll {
        # Read the raw script source to verify embedded HTML/CSS/JS patterns.
        # Full execution requires a live assessment folder with CSV data, so we
        # verify the template strings are present in the script source instead.
        $scriptPath = "$PSScriptRoot/../../Common/Export-AssessmentReport.ps1"
        $html = Get-Content -Path $scriptPath -Raw
    }

    Context 'Dual-metric framework cards' {
        It 'Should include coverage bar CSS classes in stylesheet' {
            $html | Should -Match 'coverage-bar'
            $html | Should -Match 'coverage-fill'
            $html | Should -Match 'coverage-label'
        }

        It 'Should include data-catalog-total attribute on framework cards' {
            $html | Should -Match 'data-catalog-total'
        }

        It 'Should include stat-sublabel in card HTML generation' {
            $html | Should -Match 'stat-sublabel'
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
            $html | Should -Match "data-section="
        }

        It 'Should embed complianceData JSON blob' {
            $html | Should -Match 'var complianceData\s*='
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
        It 'Should include section filter HTML structure' {
            $html | Should -Match "id='sectionFilter'"
            $html | Should -Match 'section-checkbox'
            $html | Should -Match "id='sectionSelectAll'"
            $html | Should -Match "id='sectionSelectNone'"
        }

        It 'Should include no-results placeholder' {
            $html | Should -Match "id='complianceNoResults'"
            $html | Should -Match 'no-results'
        }

        It 'Should include section filter CSS' {
            $html | Should -Match '\.section-filter'
            $html | Should -Match '\.section-checkbox'
        }
    }

    Context 'NIST 800-53 baseline profiles' {
        It 'Should include NIST baseline keys in framework lookup' {
            $html | Should -Match "'NIST-Low'"
            $html | Should -Match "'NIST-Moderate'"
            $html | Should -Match "'NIST-High'"
            $html | Should -Match "'NIST-Privacy'"
        }

        It 'Should include nistProfileKeys variable' {
            $html | Should -Match '\$nistProfileKeys'
        }

        It 'Should include NIST profile columns in finding data' {
            $html | Should -Match 'Nist80053Low'
            $html | Should -Match 'Nist80053Moderate'
            $html | Should -Match 'Nist80053High'
            $html | Should -Match 'Nist80053Privacy'
        }

        It 'Should include all frameworks checked by default in framework selector' {
            $html | Should -Match "checked>"
        }

        It 'Should treat NIST baselines as profile cards' {
            $html | Should -Match 'cisProfileKeys.*-or.*nistProfileKeys'
        }

        It 'Should read NIST catalog counts from framework definition JSON' {
            $html | Should -Match 'nist-800-53-r5\.json'
            $html | Should -Match 'controlCount'
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
