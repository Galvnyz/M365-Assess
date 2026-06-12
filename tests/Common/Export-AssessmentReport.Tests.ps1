Describe 'Export-AssessmentReport.ps1 — pipeline contract' {
    BeforeAll {
        $script:src     = "$PSScriptRoot/../../src/M365-Assess/Common/Export-AssessmentReport.ps1"
        $script:content = Get-Content $script:src -Raw
    }

    Context 'Parameter declarations' {
        It 'source file exists' {
            Test-Path $script:src | Should -Be $true
        }

        It 'declares Mandatory AssessmentFolder parameter' {
            $script:content | Should -Match '\[Parameter\(Mandatory\)\]'
            $script:content | Should -Match '\$AssessmentFolder'
        }

        It 'declares WhiteLabel switch' {
            $script:content | Should -Match '\[switch\]\$WhiteLabel'
        }

        It 'declares OutputPath parameter' {
            $script:content | Should -Match '\$OutputPath'
        }

        It 'declares OpenReport switch' {
            $script:content | Should -Match '\[switch\]\$OpenReport'
        }

        It 'declares DriftReport parameter' {
            $script:content | Should -Match '\$DriftReport'
        }

        It 'declares HeadlineFramework string array parameter (#963)' {
            $script:content | Should -Match '\[string\[\]\]\$HeadlineFramework'
        }
    }

    Context 'v2.0 pipeline — dot-sources and function calls' {
        It 'dot-sources Build-ReportData.ps1' {
            $script:content | Should -Match 'Build-ReportData\.ps1'
        }

        It 'dot-sources Build-SectionHtml.ps1' {
            $script:content | Should -Match 'Build-SectionHtml\.ps1'
        }

        It 'dot-sources Get-ReportTemplate.ps1' {
            $script:content | Should -Match 'Get-ReportTemplate\.ps1'
        }

        It 'calls Build-ReportDataJson' {
            $script:content | Should -Match 'Build-ReportDataJson'
        }

        It 'passes HeadlineFrameworks and AssessedAt to Build-ReportDataJson (#963)' {
            $script:content | Should -Match 'HeadlineFrameworks\s*=\s*\$HeadlineFramework'
            $script:content | Should -Match 'AssessedAt\s*=\s*\$assessedAt'
        }

        It 'filters unknown HeadlineFramework ids with a warning (#963)' {
            $script:content | Should -Match 'Ignoring unknown -HeadlineFramework'
        }

        It 'calls Get-ReportTemplate' {
            $script:content | Should -Match 'Get-ReportTemplate\s'
        }

        It 'writes HTML via Set-Content' {
            $script:content | Should -Match 'Set-Content'
        }

        It 'dot-sources Import-FrameworkDefinitions.ps1' {
            $script:content | Should -Match 'Import-FrameworkDefinitions\.ps1'
        }

        It 'dot-sources Import-ControlRegistry.ps1' {
            $script:content | Should -Match 'Import-ControlRegistry\.ps1'
        }
    }

    Context 'v2.0 pipeline — removed legacy patterns' {
        It 'does not reference old sectionHtml variable' {
            $script:content | Should -Not -Match '\$sectionHtml'
        }

        It 'does not reference old tocHtml variable' {
            $script:content | Should -Not -Match '\$tocHtml'
        }

        It 'does not reference old complianceHtml variable' {
            $script:content | Should -Not -Match '\$complianceHtml'
        }

        It 'does not call Build-RemediationPlanHtml' {
            $script:content | Should -Not -Match 'Build-RemediationPlanHtml'
        }

        It 'does not call Build-ValueOpportunityHtml' {
            $script:content | Should -Not -Match 'Build-ValueOpportunityHtml'
        }

        It 'does not load logo/wave asset base64' {
            $script:content | Should -Not -Match 'Get-AssetBase64'
            $script:content | Should -Not -Match '\$logoBase64'
            $script:content | Should -Not -Match '\$waveBase64'
        }

        It 'does not reference ReportHelpers.ps1' {
            $script:content | Should -Not -Match 'ReportHelpers\.ps1'
        }
    }

    Context 'XLSX filename and report title' {
        It 'computes xlsxName relative filename' {
            $script:content | Should -Match '_Compliance-Matrix_'
        }

        It 'passes XlsxFileName to Build-ReportDataJson' {
            $script:content | Should -Match 'XlsxFileName'
        }

        It 'passes FrameworkDefs to Build-ReportDataJson' {
            $script:content | Should -Match 'FrameworkDefs'
        }

        It 'passes AllFindings from allCisFindings' {
            $script:content | Should -Match 'allCisFindings'
        }

        It 'passes SectionData from sectionData' {
            $script:content | Should -Match '\$sectionData'
        }
    }

    Context 'Tenant name and output path resolution' {
        It 'reads TenantName from 01-Tenant-Info.csv when not provided' {
            $script:content | Should -Match '01-Tenant-Info\.csv'
            $script:content | Should -Match 'OrgDisplayName'
        }

        It 'reads domain prefix from assessment log' {
            $script:content | Should -Match '_Assessment-Log'
            $script:content | Should -Match 'Domain:\s*\\S\+'
        }

        It 'derives OutputPath from reportDomainPrefix' {
            $script:content | Should -Match '_Assessment-Report'
        }
    }
}
