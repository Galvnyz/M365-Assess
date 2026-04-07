Describe 'Build-SectionHtml.ps1 - structural validation' {
    BeforeAll {
        $script:sourceFile = "$PSScriptRoot/../../src/M365-Assess/Common/Build-SectionHtml.ps1"
        $script:content = Get-Content $script:sourceFile -Raw
    }

    It 'should exist on disk' {
        Test-Path $script:sourceFile | Should -Be $true
    }

    It 'should define $sectionHtml variable' {
        $script:content | Should -Match '\$sectionHtml'
    }

    It 'should define $tocHtml variable' {
        $script:content | Should -Match '\$tocHtml'
    }

    It 'should define $sectionDescriptions hashtable' {
        $script:content | Should -Match '\$sectionDescriptions'
    }

    It 'should define $sectionCallouts' {
        $script:content | Should -Match '\$sectionCallouts'
    }

    It 'should include Identity in section descriptions' {
        $script:content | Should -Match "'Identity'"
    }

    It 'should include Email in section descriptions' {
        $script:content | Should -Match "'Email'"
    }

    It 'should include Security in section descriptions' {
        $script:content | Should -Match "'Security'"
    }

    It 'should reference AssessmentFolder for CSV data paths' {
        $script:content | Should -Match '\$AssessmentFolder'
    }

    It 'should use StringBuilder for sectionHtml' {
        $script:content | Should -Match 'StringBuilder'
    }

    It 'should reference Export-ComplianceOverview' {
        $script:content | Should -Match 'Export-ComplianceOverview'
    }

    It 'should reference Export-FrameworkCatalog' {
        $script:content | Should -Match 'Export-FrameworkCatalog'
    }

    It 'should contain section loop or foreach pattern' {
        $script:content | Should -Match 'foreach.*Sections|foreach.*section'
    }
}
