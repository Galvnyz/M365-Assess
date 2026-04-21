Describe 'Get-ReportTemplate — function contract' {
    BeforeAll {
        $script:src = "$PSScriptRoot/../../src/M365-Assess/Common/Get-ReportTemplate.ps1"
        $script:content = Get-Content $script:src -Raw
    }

    It 'source file exists' {
        Test-Path $script:src | Should -Be $true
    }

    It 'defines Get-ReportTemplate function' {
        $script:content | Should -Match 'function Get-ReportTemplate'
    }

    It 'declares Mandatory ReportDataJson parameter' {
        $script:content | Should -Match '\[Parameter\(Mandatory\)\]'
        $script:content | Should -Match '\[string\]\$ReportDataJson'
    }

    It 'declares ReportTitle parameter' {
        $script:content | Should -Match '\[string\]\$ReportTitle'
    }

    It 'loads report-themes.css from assets' {
        $script:content | Should -Match "report-themes\.css"
    }

    It 'loads report-shell.css from assets' {
        $script:content | Should -Match "report-shell\.css"
    }

    It 'loads react.production.min.js from assets' {
        $script:content | Should -Match "react\.production\.min\.js"
    }

    It 'loads react-dom.production.min.js from assets' {
        $script:content | Should -Match "react-dom\.production\.min\.js"
    }

    It 'loads report-app.js from assets' {
        $script:content | Should -Match "report-app\.js"
    }

    It 'uses StringBuilder for safe asset concatenation' {
        $script:content | Should -Match 'StringBuilder'
    }

    It 'emits root div target for React mount' {
        $script:content | Should -Match 'id="root"'
    }

    It 'embeds ReportDataJson in a script block' {
        $script:content | Should -Match '\$ReportDataJson'
        $script:content | Should -Match '<script>'
    }

    It 'produces a DOCTYPE declaration' {
        $script:content | Should -Match '<!DOCTYPE html>'
    }

    It 'does not reference old sectionHtml variables' {
        $script:content | Should -Not -Match '\$sectionHtml'
        $script:content | Should -Not -Match '\$tocHtml'
        $script:content | Should -Not -Match '\$complianceHtml'
    }

    It 'does not reference old branding variables' {
        $script:content | Should -Not -Match '\$brandName'
        $script:content | Should -Not -Match '\$logoBase64'
        $script:content | Should -Not -Match 'ConvertTo-HtmlSafe'
    }

    It 'starts assets directory from PSScriptRoot' {
        $script:content | Should -Match '\$PSScriptRoot'
    }

    It 'derives anti-FOUC JS theme list from ValidateSet via reflection — no hardcoded list' {
        # The source must use MyInvocation reflection, not a hardcoded string literal
        $script:content | Should -Match '\$MyInvocation\.MyCommand\.Parameters\[.DefaultTheme.\]'
        $script:content | Should -Match 'ValidateSetAttribute'
        # Must NOT contain the old hardcoded array literal
        $script:content | Should -Not -Match "v=\['neon','console','saas','high-contrast'\]"
    }
}

Describe 'Get-ReportTemplate — output validation' {
    BeforeAll {
        # Load the function; mock Get-Content so asset files don't need to exist on disk
        . "$PSScriptRoot/../../src/M365-Assess/Common/Get-ReportTemplate.ps1"

        Mock Get-Content {
            param([string]$Path)
            switch -Wildcard ($Path) {
                '*report-themes.css'           { ':root { --test-themes: 1; }' }
                '*report-shell.css'            { 'body { margin: 0; }' }
                '*react.production.min.js'     { '/* react stub */' }
                '*react-dom.production.min.js' { '/* react-dom stub */ var ReactDOM = {};' }
                '*report-app.js'               { '/* app stub */ document.getElementById("app-root");' }
                default                        { '' }
            }
        } -ParameterFilter { $Path -and $Raw }
    }

    It 'returns a non-empty string' {
        $result = Get-ReportTemplate -ReportDataJson 'window.REPORT_DATA = {};' -ReportTitle 'Test'
        $result | Should -BeOfType [string]
        $result.Length | Should -BeGreaterThan 100
    }

    It 'output contains DOCTYPE declaration' {
        $result = Get-ReportTemplate -ReportDataJson 'window.REPORT_DATA = {};' -ReportTitle 'Test'
        $result | Should -Match '<!DOCTYPE html>'
    }

    It 'output contains root div' {
        $result = Get-ReportTemplate -ReportDataJson 'window.REPORT_DATA = {};' -ReportTitle 'Test'
        $result | Should -Match 'id="root"'
    }

    It 'output embeds the report data JSON' {
        $json = 'window.REPORT_DATA = {"test":true};'
        $result = Get-ReportTemplate -ReportDataJson $json -ReportTitle 'Test'
        $result.Contains($json) | Should -Be $true
    }

    It 'output contains report title' {
        $result = Get-ReportTemplate -ReportDataJson 'window.REPORT_DATA = {};' -ReportTitle 'Contoso Report'
        $result | Should -Match 'Contoso Report'
    }

    It 'output contains themes CSS' {
        $result = Get-ReportTemplate -ReportDataJson 'window.REPORT_DATA = {};' -ReportTitle 'Test'
        $result | Should -Match '--test-themes: 1'
    }

    It 'output contains shell CSS' {
        $result = Get-ReportTemplate -ReportDataJson 'window.REPORT_DATA = {};' -ReportTitle 'Test'
        $result | Should -Match 'margin: 0'
    }

    It 'output contains react-dom stub' {
        $result = Get-ReportTemplate -ReportDataJson 'window.REPORT_DATA = {};' -ReportTitle 'Test'
        $result | Should -Match 'react-dom stub'
    }

    It 'output contains app stub' {
        $result = Get-ReportTemplate -ReportDataJson 'window.REPORT_DATA = {};' -ReportTitle 'Test'
        $result | Should -Match 'app stub'
    }

    It 'uses default title when ReportTitle omitted' {
        $result = Get-ReportTemplate -ReportDataJson 'window.REPORT_DATA = {};'
        $result | Should -Match 'M365 Security Assessment'
    }

    It 'anti-FOUC JS contains every theme from the DefaultTheme ValidateSet' {
        $result = Get-ReportTemplate -ReportDataJson 'window.REPORT_DATA = {};'
        $validThemes = (Get-Command Get-ReportTemplate).Parameters['DefaultTheme'].Attributes |
            Where-Object { $_ -is [System.Management.Automation.ValidateSetAttribute] } |
            Select-Object -ExpandProperty ValidValues
        foreach ($theme in $validThemes) {
            $result | Should -Match "'$theme'" -Because "theme '$theme' must appear in the anti-FOUC allowlist"
        }
    }
}
