Describe 'Get-ReportTemplate.ps1 - structural validation' {
    BeforeAll {
        $script:sourceFile = "$PSScriptRoot/../../src/M365-Assess/Common/Get-ReportTemplate.ps1"
        $script:content = Get-Content $script:sourceFile -Raw
    }

    It 'should exist on disk' {
        Test-Path $script:sourceFile | Should -Be $true
    }

    It 'should produce the $html variable' {
        $script:content | Should -Match '\$html\s*='
    }

    It 'should contain DOCTYPE declaration in html template' {
        $script:content | Should -Match '<!DOCTYPE html>'
    }

    It 'should contain html element' {
        $script:content | Should -Match '<html'
    }

    It 'should contain closing html tag' {
        $script:content | Should -Match '</html>'
    }

    It 'should include meta charset' {
        $script:content | Should -Match 'charset'
    }

    It 'should reference TenantName variable' {
        $script:content | Should -Match '\$TenantName'
    }

    It 'should reference sectionHtml variable' {
        $script:content | Should -Match '\$sectionHtml'
    }

    It 'should contain CSS style blocks' {
        $script:content | Should -Match '<style>'
    }

    It 'should contain JavaScript script block' {
        $script:content | Should -Match '<script'
    }

    It 'should reference ConvertTo-HtmlSafe for XSS prevention' {
        $script:content | Should -Match 'ConvertTo-HtmlSafe'
    }

    It 'should include cover page or cover section' {
        $script:content | Should -Match 'cover'
    }

    It 'should reference brandName for white-labeling' {
        $script:content | Should -Match '\$brandName'
    }

    It 'should include dark mode CSS variables or media query' {
        $script:content | Should -Match 'dark|prefers-color-scheme'
    }

    It 'should include navigation or table of contents reference' {
        $script:content | Should -Match 'tocHtml|toc'
    }
}
