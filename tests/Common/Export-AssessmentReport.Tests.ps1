Describe 'Export-AssessmentReport HTML structure' {
    BeforeAll {
        # Read the raw script source to verify embedded HTML/CSS/JS patterns.
        # Full execution requires a live assessment folder with CSV data, so we
        # verify the template strings are present in the script source instead.
        # After decomposition (#235), patterns are spread across 4 files.
        $commonDir = "$PSScriptRoot/../../src/M365-Assess/Common"
        $html = @(
            (Get-Content -Path "$commonDir/Export-AssessmentReport.ps1" -Raw),
            (Get-Content -Path "$commonDir/ReportHelpers.ps1" -Raw),
            (Get-Content -Path "$commonDir/Build-SectionHtml.ps1" -Raw),
            (Get-Content -Path "$commonDir/Get-ReportTemplate.ps1" -Raw)
        ) -join "`n"
        $overviewPath = "$commonDir/Export-ComplianceOverview.ps1"
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

        It 'Should include callout-row flex container CSS' {
            $html | Should -Match 'callout-row'
        }

        It 'Should include collector-grid CSS class' {
            $html | Should -Match 'collector-grid'
        }

        It 'Should stack callout-row in print media' {
            $html | Should -Match '\.callout-row \{ display: block; \}'
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

    Context 'DKIM mismatch rendering' {
        It 'Should include dkim-mismatch CSS class for mismatch styling' {
            $html | Should -Match 'dkim-mismatch'
        }

        It 'Should include dkim-exo-confirmed CSS class' {
            $html | Should -Match 'dkim-exo-confirmed'
        }

        It 'Should include EXO Confirmed badge text in conditional rendering' {
            $html | Should -Match 'EXO Confirmed'
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

    Context 'Service area breakdown chart' {
        It 'Should include service-area-chart CSS class in stylesheet' {
            $html | Should -Match '\.service-area-chart'
        }

        It 'Should include service-area-chart h3 styling' {
            $html | Should -Match '\.service-area-chart h3'
        }

        It 'Should include Get-SvgStackedBar function in ReportHelpers' {
            $html | Should -Match 'function Get-SvgStackedBar'
        }

        It 'Should compute sectionStatusCounts from allCisFindings' {
            $html | Should -Match '\$sectionStatusCounts'
        }

        It 'Should group findings by Section for status counts' {
            $html | Should -Match 'Group-Object -Property Section'
        }

        It 'Should render service-area-chart div when data exists' {
            $html | Should -Match "id=""service-area-chart"""
        }

        It 'Should include print CSS for service-area-chart' {
            $html | Should -Match '\.service-area-chart \{ page-break-inside: avoid'
        }

        It 'Should use CSS variables for SVG fill colors in stacked bar' {
            $html | Should -Match "var\(--m365a-success\)"
            $html | Should -Match "var\(--m365a-danger\)"
            $html | Should -Match "var\(--m365a-warning\)"
            $html | Should -Match "var\(--m365a-review\)"
        }
    }

    Context 'Paginated report navigation' {
        It 'Should include report-layout wrapper div' {
            $html | Should -Match 'class="report-layout"'
            $html | Should -Match 'id="reportLayout"'
        }

        It 'Should include sidebar navigation element' {
            $html | Should -Match 'class="report-nav"'
            $html | Should -Match 'id="reportNav"'
        }

        It 'Should include nav list with nav items' {
            $html | Should -Match 'class="nav-list"'
            $html | Should -Match 'class=.nav-item'
            $html | Should -Match 'data-page='
        }

        It 'Should include Show All toggle button' {
            $html | Should -Match 'id="navShowAll"'
            $html | Should -Match 'nav-show-all'
        }

        It 'Should include theme toggle in sidebar' {
            $html | Should -Match 'id="navThemeToggle"'
            $html | Should -Match 'nav-theme-btn'
        }

        It 'Should wrap sections in report-page containers' {
            $html | Should -Match "class='report-page'"
            $html | Should -Match "data-page='section-"
        }

        It 'Should include report-page CSS for page visibility' {
            $html | Should -Match '\.report-page \{ display: none'
            $html | Should -Match '\.report-page\.page-active \{ display: block'
            $html | Should -Match '\.show-all-mode \.report-page \{ display: block'
        }

        It 'Should include navigation JavaScript with navigateTo function' {
            $html | Should -Match 'function navigateTo'
            $html | Should -Match 'function setActiveNav'
            $html | Should -Match 'function getInitialPage'
        }

        It 'Should handle browser history with popstate listener' {
            $html | Should -Match "addEventListener\('popstate'"
        }

        It 'Should support keyboard navigation with arrow keys' {
            $html | Should -Match 'ArrowDown'
            $html | Should -Match 'ArrowUp'
        }

        It 'Should include mobile hamburger toggle' {
            $html | Should -Match 'id="navToggleMobile"'
            $html | Should -Match 'nav-toggle'
        }

        It 'Should include mobile overlay element' {
            $html | Should -Match 'id="navOverlay"'
            $html | Should -Match 'nav-overlay'
        }

        It 'Should hide sidebar and show all pages in print styles' {
            $html | Should -Match '@media print[\s\S]*?\.report-nav \{ display: none'
            $html | Should -Match '@media print[\s\S]*?\.report-page \{ display: block !important'
        }

        It 'Should include mobile responsive CSS' {
            $html | Should -Match '@media \(max-width: 768px\)'
            $html | Should -Match '\.report-nav\.nav-open'
        }

        It 'Should include nav badge CSS classes' {
            $html | Should -Match '\.nav-badge-pass'
            $html | Should -Match '\.nav-badge-fail'
        }

        It 'Should wrap compliance overview in report-page container' {
            $html | Should -Match 'data-page="compliance-overview"'
        }

        It 'Should wrap framework catalogs in report-page container' {
            $html | Should -Match 'data-page="framework-catalogs"'
        }

        It 'Should wrap technical issues in report-page container' {
            $html | Should -Match 'data-page="issues"'
        }

        It 'Should wrap appendix in report-page container' {
            $html | Should -Match 'data-page="appendix-checks-run"'
        }

        It 'Should close report-layout div before closing body' {
            $html | Should -Match 'close report-layout'
        }
    }
}
