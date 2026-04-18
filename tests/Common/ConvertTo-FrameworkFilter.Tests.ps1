Describe 'ConvertTo-FrameworkFilter' {
    BeforeAll {
        . (Join-Path $PSScriptRoot '../../src/M365-Assess/Common/ConvertTo-FrameworkFilter.ps1')
    }

    Context 'when given CIS with E5:L2 qualifier' {
        BeforeAll {
            $script:result = ConvertTo-FrameworkFilter -Frameworks @('CIS:E5:L2')
        }

        It 'should return one filter object' {
            $script:result | Should -HaveCount 1
        }
        It 'should set Family to CIS' {
            $script:result.Family | Should -Be 'CIS'
        }
        It 'should include all four CIS profiles cumulatively' {
            $script:result.Profiles | Should -Contain 'E3-L1'
            $script:result.Profiles | Should -Contain 'E3-L2'
            $script:result.Profiles | Should -Contain 'E5-L1'
            $script:result.Profiles | Should -Contain 'E5-L2'
        }
        It 'should set correct display label' {
            $script:result.DisplayLabel | Should -Be 'CIS E5 Level 2'
        }
        It 'should set HasSubLevel to true' {
            $script:result.HasSubLevel | Should -BeTrue
        }
    }

    Context 'when given CIS with E3:L1 qualifier' {
        BeforeAll {
            $script:result = ConvertTo-FrameworkFilter -Frameworks @('CIS:E3:L1')
        }

        It 'should include only E3-L1 profile' {
            $script:result.Profiles | Should -HaveCount 1
            $script:result.Profiles | Should -Contain 'E3-L1'
        }
        It 'should not include E5 profiles' {
            $script:result.Profiles | Should -Not -Contain 'E5-L1'
            $script:result.Profiles | Should -Not -Contain 'E5-L2'
        }
        It 'should set correct display label' {
            $script:result.DisplayLabel | Should -Be 'CIS E3 Level 1'
        }
    }

    Context 'when given CIS with E5:L1 qualifier' {
        BeforeAll {
            $script:result = ConvertTo-FrameworkFilter -Frameworks @('CIS:E5:L1')
        }

        It 'should include E3-L1 and E5-L1 profiles' {
            $script:result.Profiles | Should -Contain 'E3-L1'
            $script:result.Profiles | Should -Contain 'E5-L1'
        }
        It 'should not include L2 profiles' {
            $script:result.Profiles | Should -Not -Contain 'E3-L2'
            $script:result.Profiles | Should -Not -Contain 'E5-L2'
        }
    }

    Context 'when given CIS with no qualifier' {
        BeforeAll {
            $script:result = ConvertTo-FrameworkFilter -Frameworks @('CIS')
        }

        It 'should return a CIS filter with no profile restriction' {
            $script:result.Family | Should -Be 'CIS'
            $script:result.Profiles | Should -BeNullOrEmpty
        }
        It 'should set HasSubLevel to false' {
            $script:result.HasSubLevel | Should -BeFalse
        }
    }

    Context 'when given CMMC with L3 qualifier' {
        BeforeAll {
            $script:result = ConvertTo-FrameworkFilter -Frameworks @('CMMC:L3')
        }

        It 'should include L1, L2, and L3 levels cumulatively' {
            $script:result.Levels | Should -Contain 'L1'
            $script:result.Levels | Should -Contain 'L2'
            $script:result.Levels | Should -Contain 'L3'
        }
        It 'should set correct display label' {
            $script:result.DisplayLabel | Should -Be 'CMMC Level 3'
        }
        It 'should set HasSubLevel to true' {
            $script:result.HasSubLevel | Should -BeTrue
        }
    }

    Context 'when given CMMC with L2 qualifier' {
        BeforeAll {
            $script:result = ConvertTo-FrameworkFilter -Frameworks @('CMMC:L2')
        }

        It 'should include L1 and L2 but not L3' {
            $script:result.Levels | Should -Contain 'L1'
            $script:result.Levels | Should -Contain 'L2'
            $script:result.Levels | Should -Not -Contain 'L3'
        }
    }

    Context 'when given multiple frameworks' {
        BeforeAll {
            $script:result = ConvertTo-FrameworkFilter -Frameworks @('CIS:E5:L2', 'CMMC:L3')
        }

        It 'should return two filter objects' {
            $script:result | Should -HaveCount 2
        }
        It 'should have CIS as first entry' {
            $script:result[0].Family | Should -Be 'CIS'
        }
        It 'should have CMMC as second entry' {
            $script:result[1].Family | Should -Be 'CMMC'
        }
    }

    Context 'when given a non-tiered framework like NIST' {
        BeforeAll {
            $script:result = ConvertTo-FrameworkFilter -Frameworks @('NIST')
        }

        It 'should pass through with no profiles or levels' {
            $script:result.Family | Should -Be 'NIST'
            $script:result.Profiles | Should -BeNullOrEmpty
            $script:result.Levels | Should -BeNullOrEmpty
            $script:result.HasSubLevel | Should -BeFalse
        }
    }

    Context 'when given an invalid CIS qualifier' {
        It 'should warn and return a filter with no profile restriction' {
            Mock Write-Warning { }
            $result = ConvertTo-FrameworkFilter -Frameworks @('CIS:X9:L9')
            $result.Profiles | Should -BeNullOrEmpty
            $result.HasSubLevel | Should -BeFalse
            Should -Invoke Write-Warning -Times 1
        }
    }
}
