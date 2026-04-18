Describe 'New-M365BrandingConfig' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Common/New-M365BrandingConfig.ps1"
    }

    Context 'when called with no parameters' {
        It 'should return an empty hashtable' {
            $result = New-M365BrandingConfig
            $result | Should -BeOfType [hashtable]
            $result.Count | Should -Be 0
        }
    }

    Context 'when called with CompanyName only' {
        It 'should return a hashtable with only CompanyName' {
            $result = New-M365BrandingConfig -CompanyName 'Contoso Consulting'
            $result['CompanyName'] | Should -Be 'Contoso Consulting'
            $result.Count | Should -Be 1
        }
    }

    Context 'when called with all string parameters' {
        It 'should return a hashtable with all supplied keys' {
            $result = New-M365BrandingConfig `
                -CompanyName 'Contoso' `
                -ClientName 'Fabrikam' `
                -ReportTitle 'Security Assessment' `
                -SidebarSubtitle 'Prepared by Contoso' `
                -ReportNote 'Confidential' `
                -Disclaimer 'This report is confidential.' `
                -FooterText 'Assessment by Contoso' `
                -FooterUrl 'https://contoso.com'

            $result['CompanyName']     | Should -Be 'Contoso'
            $result['ClientName']      | Should -Be 'Fabrikam'
            $result['ReportTitle']     | Should -Be 'Security Assessment'
            $result['SidebarSubtitle'] | Should -Be 'Prepared by Contoso'
            $result['ReportNote']      | Should -Be 'Confidential'
            $result['Disclaimer']      | Should -Be 'This report is confidential.'
            $result['FooterText']      | Should -Be 'Assessment by Contoso'
            $result['FooterUrl']       | Should -Be 'https://contoso.com'
            $result.Count              | Should -Be 8
        }
    }

    Context 'when AccentColor is a valid 6-digit hex' {
        It 'should accept the color and include it in the result' {
            $result = New-M365BrandingConfig -AccentColor '#0078D4'
            $result['AccentColor'] | Should -Be '#0078D4'
        }
    }

    Context 'when AccentColor is a valid 3-digit hex' {
        It 'should accept the shorthand hex color' {
            $result = New-M365BrandingConfig -AccentColor '#F0F'
            $result['AccentColor'] | Should -Be '#F0F'
        }
    }

    Context 'when AccentColor is an invalid hex string' {
        It 'should throw a validation error' {
            { New-M365BrandingConfig -AccentColor 'blue' } | Should -Throw
        }

        It 'should throw when hash prefix is missing' {
            { New-M365BrandingConfig -AccentColor '0078D4' } | Should -Throw
        }
    }

    Context 'when PrimaryColor is a valid hex' {
        It 'should include PrimaryColor in the result' {
            $result = New-M365BrandingConfig -PrimaryColor '#1E3A5F'
            $result['PrimaryColor'] | Should -Be '#1E3A5F'
        }
    }

    Context 'when LogoPath is provided' {
        It 'should throw when the file does not exist' {
            { New-M365BrandingConfig -LogoPath 'C:\nonexistent\logo.png' } | Should -Throw
        }

        It 'should accept a path that resolves to an existing file' {
            $tempFile = [System.IO.Path]::GetTempFileName()
            try {
                $result = New-M365BrandingConfig -LogoPath $tempFile
                $result['LogoPath'] | Should -Be $tempFile
            }
            finally {
                Remove-Item -Path $tempFile -ErrorAction SilentlyContinue
            }
        }
    }

    Context 'when ClientLogoPath is provided' {
        It 'should throw when the file does not exist' {
            { New-M365BrandingConfig -ClientLogoPath 'C:\nonexistent\client.png' } | Should -Throw
        }

        It 'should accept a path that resolves to an existing file' {
            $tempFile = [System.IO.Path]::GetTempFileName()
            try {
                $result = New-M365BrandingConfig -ClientLogoPath $tempFile
                $result['ClientLogoPath'] | Should -Be $tempFile
            }
            finally {
                Remove-Item -Path $tempFile -ErrorAction SilentlyContinue
            }
        }
    }

    Context 'sparse population' {
        It 'should not include keys that were not passed' {
            $result = New-M365BrandingConfig -CompanyName 'Test'
            $result.ContainsKey('AccentColor')  | Should -Be $false
            $result.ContainsKey('LogoPath')     | Should -Be $false
            $result.ContainsKey('ClientName')   | Should -Be $false
        }
    }

    Context 'output type' {
        It 'should return a hashtable regardless of parameter count' {
            $result = New-M365BrandingConfig -CompanyName 'X' -AccentColor '#ABC'
            $result | Should -BeOfType [hashtable]
        }
    }
}
