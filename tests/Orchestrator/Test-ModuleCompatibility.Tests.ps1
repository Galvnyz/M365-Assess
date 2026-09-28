BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Test-ModuleCompatibility' {
    BeforeAll {
        function Get-MgContext { }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/Test-ModuleCompatibility.ps1"

        # Some CI runner images ship PowerShell without PowerShellGet's Install-Module on
        # the command path (the PSResourceGet migration). Pester's Mock requires the command
        # to exist, so define a no-op stub with the parameters the collector actually passes
        # when the real cmdlet is absent. Real environments keep the genuine cmdlet, so this
        # branch is a no-op locally and only engages on a stripped-down runner.
        if (-not (Get-Command -Name Install-Module -ErrorAction SilentlyContinue)) {
            function Install-Module {
                [CmdletBinding()]
                param(
                    [string]$Name,
                    [string]$RequiredVersion,
                    [string]$Scope,
                    [switch]$Force
                )
            }
        }

        Mock Test-ExoRuntimeSupported { $true }
        Mock Write-Host { }
        Mock Write-AssessmentLog { }
        Mock Get-Module { $null } -ParameterFilter { $Name -eq 'ExchangeOnlineManagement' -and -not $ListAvailable }

        $sectionServiceMap = @{
            'Identity' = @('Graph')
            'Email'    = @('ExchangeOnline')
            'PowerBI'  = @()
        }
    }

    Context 'when all required modules are installed and compatible' {
        BeforeAll {
            Mock Get-Module {
                [PSCustomObject]@{ Version = [version]'2.35.0'; ModuleBase = 'C:\fake\graph' }
            } -ParameterFilter { $Name -eq 'Microsoft.Graph.Authentication' }

            Mock Get-Module {
                [PSCustomObject]@{ Version = [version]'3.10.1'; ModuleBase = 'C:\fake\exo' }
            } -ParameterFilter { $Name -eq 'ExchangeOnlineManagement' -and $ListAvailable }

            Mock Get-Module { $null } -ParameterFilter { $Name -eq 'MicrosoftPowerBIMgmt' }
            Mock Get-Module {
                [PSCustomObject]@{ Version = [version]'7.8.0' }
            } -ParameterFilter { $Name -eq 'ImportExcel' }
        }

        It 'should return Passed = true' {
            $result = Test-ModuleCompatibility -Section @('Identity', 'Email') -SectionServiceMap $sectionServiceMap -NonInteractive
            $result.Passed | Should -Be $true
        }

        It 'should preserve the Section list' {
            $result = Test-ModuleCompatibility -Section @('Identity', 'Email') -SectionServiceMap $sectionServiceMap -NonInteractive
            $result.Section | Should -Contain 'Identity'
            $result.Section | Should -Contain 'Email'
        }
    }

    Context 'when Graph module is missing (NonInteractive)' {
        BeforeAll {
            Mock Get-Module { $null } -ParameterFilter { $Name -eq 'Microsoft.Graph.Authentication' }
            Mock Get-Module {
                [PSCustomObject]@{ Version = [version]'3.10.1'; ModuleBase = 'C:\fake\exo' }
            } -ParameterFilter { $Name -eq 'ExchangeOnlineManagement' -and $ListAvailable }
            Mock Get-Module { $null } -ParameterFilter { $Name -eq 'MicrosoftPowerBIMgmt' }
            Mock Get-Module { $null } -ParameterFilter { $Name -eq 'ImportExcel' }
            Mock Install-Module { }
            Mock Write-Error { }
        }

        It 'should return nothing (fatal)' {
            $result = Test-ModuleCompatibility -Section @('Identity') -SectionServiceMap $sectionServiceMap -NonInteractive
            $result | Should -BeNullOrEmpty
        }

        It 'should write an error' {
            Test-ModuleCompatibility -Section @('Identity') -SectionServiceMap $sectionServiceMap -NonInteractive
            Should -Invoke Write-Error -Times 1
        }
    }

    Context 'when EXO module is missing (NonInteractive)' {
        BeforeAll {
            Mock Get-Module {
                [PSCustomObject]@{ Version = [version]'2.35.0'; ModuleBase = 'C:\fake\graph' }
            } -ParameterFilter { $Name -eq 'Microsoft.Graph.Authentication' }
            Mock Get-Module { $null } -ParameterFilter { $Name -eq 'ExchangeOnlineManagement' -and $ListAvailable }
            Mock Get-Module { $null } -ParameterFilter { $Name -eq 'MicrosoftPowerBIMgmt' }
            Mock Get-Module { $null } -ParameterFilter { $Name -eq 'ImportExcel' }
            Mock Install-Module { }
            Mock Write-Error { }
        }

        It 'should return nothing (fatal)' {
            $result = Test-ModuleCompatibility -Section @('Email') -SectionServiceMap $sectionServiceMap -NonInteractive
            $result | Should -BeNullOrEmpty
        }
    }

    Context 'when EXO is below the supported baseline (NonInteractive)' {
        BeforeAll {
            Mock Get-Module {
                [PSCustomObject]@{ Version = [version]'2.35.0'; ModuleBase = 'C:\fake\graph' }
            } -ParameterFilter { $Name -eq 'Microsoft.Graph.Authentication' }
            Mock Get-Module {
                [PSCustomObject]@{ Version = [version]'3.8.0'; ModuleBase = 'C:\fake\exo' }
            } -ParameterFilter { $Name -eq 'ExchangeOnlineManagement' -and $ListAvailable }
            Mock Get-Module { $null } -ParameterFilter { $Name -eq 'MicrosoftPowerBIMgmt' }
            Mock Get-Module { $null } -ParameterFilter { $Name -eq 'ImportExcel' }
            Mock Install-Module { }
            Mock Write-Error { }
        }

        It 'should return nothing (unsupported EXO version)' {
            $result = Test-ModuleCompatibility -Section @('Email') -SectionServiceMap $sectionServiceMap -NonInteractive
            $result | Should -BeNullOrEmpty
        }

        It 'should prescribe a side-by-side install, never an uninstall (#231)' {
            Test-ModuleCompatibility -Section @('Email') -SectionServiceMap $sectionServiceMap -NonInteractive
            Should -Invoke Write-AssessmentLog -ParameterFilter {
                $Message -match 'Install-Module -Name ExchangeOnlineManagement -RequiredVersion 3\.10\.1' -and
                $Message -notmatch 'Uninstall-Module'
            }
        }
    }

    Context 'when the baseline EXO version is installed side-by-side with an older one (#231)' {
        BeforeAll {
            Mock Get-Module {
                [PSCustomObject]@{ Version = [version]'2.35.0'; ModuleBase = 'C:\fake\graph' }
            } -ParameterFilter { $Name -eq 'Microsoft.Graph.Authentication' }
            Mock Get-Module {
                @(
                    [PSCustomObject]@{ Version = [version]'3.9.2'; ModuleBase = 'C:\fake\exo392' }
                    [PSCustomObject]@{ Version = [version]'3.10.1'; ModuleBase = 'C:\fake\exo371' }
                )
            } -ParameterFilter { $Name -eq 'ExchangeOnlineManagement' -and $ListAvailable }
            Mock Get-Module { $null } -ParameterFilter { $Name -eq 'MicrosoftPowerBIMgmt' }
            Mock Get-Module {
                [PSCustomObject]@{ Version = [version]'7.8.0' }
            } -ParameterFilter { $Name -eq 'ImportExcel' }
            Mock Install-Module { }
            Mock Write-Error { }
        }

        It 'should pass without requiring an upgrade' {
            $result = Test-ModuleCompatibility -Section @('Email') -SectionServiceMap $sectionServiceMap -NonInteractive
            $result.Passed | Should -Be $true
        }

        It 'should not write an error or demand any install' {
            Test-ModuleCompatibility -Section @('Email') -SectionServiceMap $sectionServiceMap -NonInteractive
            Should -Invoke Write-Error -Times 0
            Should -Invoke Install-Module -Times 0
        }

        It 'should log which version the session pins' {
            Test-ModuleCompatibility -Section @('Email') -SectionServiceMap $sectionServiceMap -NonInteractive
            Should -Invoke Write-AssessmentLog -ParameterFilter { $Message -match 'selects 3\.10\.1' }
        }
    }

    Context 'Get-CompatibleExoModule' {
        It 'returns the newest supported stable version when several are installed' {
            Mock Get-Module {
                @(
                    [PSCustomObject]@{ Version = [version]'3.9.2'; ModuleBase = 'C:\fake\exo392' }
                    [PSCustomObject]@{ Version = [version]'3.10.1'; ModuleBase = 'C:\fake\exo371' }
                    [PSCustomObject]@{ Version = [version]'3.6.0'; ModuleBase = 'C:\fake\exo360' }
                )
            } -ParameterFilter { $Name -eq 'ExchangeOnlineManagement' -and $ListAvailable }

            (Get-CompatibleExoModule).Version | Should -Be ([version]'3.10.1')
        }

        It 'returns nothing when only older versions are installed' {
            Mock Get-Module {
                [PSCustomObject]@{ Version = [version]'3.9.2'; ModuleBase = 'C:\fake\exo392' }
            } -ParameterFilter { $Name -eq 'ExchangeOnlineManagement' -and $ListAvailable }

            Get-CompatibleExoModule | Should -BeNullOrEmpty
        }

        It 'returns nothing when EXO is not installed' {
            Mock Get-Module { $null } -ParameterFilter { $Name -eq 'ExchangeOnlineManagement' -and $ListAvailable }

            Get-CompatibleExoModule | Should -BeNullOrEmpty
        }
    }

    Context 'when the runtime or preloaded session is incompatible' {
        BeforeEach {
            Mock Write-Error { }
            Mock Install-Module { }
            Mock Get-Module { [PSCustomObject]@{ Version = [version]'3.10.1' } } -ParameterFilter { $Name -eq 'ExchangeOnlineManagement' -and $ListAvailable }
        }
        It 'rejects an older runtime before attempting module repair' {
            Mock Test-ExoRuntimeSupported { $false }
            Test-ModuleCompatibility -Section Email -SectionServiceMap $sectionServiceMap -NonInteractive | Should -BeNullOrEmpty
            Should -Invoke Write-Error -ParameterFilter { $Message -match 'PowerShell 7.6' }
            Should -Invoke Install-Module -Times 0
        }
        It 'rejects EXO already loaded without an authenticated Graph context' {
            Mock Get-Module { [PSCustomObject]@{ Version = [version]'3.10.1' } } -ParameterFilter { $Name -eq 'ExchangeOnlineManagement' -and -not $ListAvailable }
            Test-ModuleCompatibility -Section Email -SectionServiceMap $sectionServiceMap -NonInteractive | Should -BeNullOrEmpty
            Should -Invoke Write-Error -ParameterFilter { $Message -match 'fresh pwsh' }
        }
    }

    Context 'when only Graph-using sections are selected and EXO is not needed' {
        BeforeAll {
            Mock Get-Module {
                [PSCustomObject]@{ Version = [version]'2.35.0'; ModuleBase = 'C:\fake\graph' }
            } -ParameterFilter { $Name -eq 'Microsoft.Graph.Authentication' }
            Mock Get-Module { $null } -ParameterFilter { $Name -eq 'ExchangeOnlineManagement' -and $ListAvailable }
            Mock Get-Module { $null } -ParameterFilter { $Name -eq 'MicrosoftPowerBIMgmt' }
            Mock Get-Module {
                [PSCustomObject]@{ Version = [version]'7.8.0' }
            } -ParameterFilter { $Name -eq 'ImportExcel' }
        }

        It 'should pass without requiring EXO' {
            $result = Test-ModuleCompatibility -Section @('Identity') -SectionServiceMap $sectionServiceMap -NonInteractive
            $result.Passed | Should -Be $true
        }
    }

    Context 'when recommended modules are missing (NonInteractive auto-install)' {
        BeforeAll {
            Mock Get-Module {
                [PSCustomObject]@{ Version = [version]'2.35.0'; ModuleBase = 'C:\fake\graph' }
            } -ParameterFilter { $Name -eq 'Microsoft.Graph.Authentication' }
            Mock Get-Module { $null } -ParameterFilter { $Name -eq 'ExchangeOnlineManagement' -and $ListAvailable }
            Mock Get-Module { $null } -ParameterFilter { $Name -eq 'MicrosoftPowerBIMgmt' }
            Mock Get-Module { $null } -ParameterFilter { $Name -eq 'ImportExcel' }
            Mock Install-Module { }
        }

        It 'should auto-install recommended modules' {
            Test-ModuleCompatibility -Section @('Identity', 'PowerBI') -SectionServiceMap $sectionServiceMap -NonInteractive
            Should -Invoke Install-Module -Times 2
        }
    }

    Context 'when no sections need any services' {
        BeforeAll {
            $emptyServiceMap = @{ 'ActiveDirectory' = @() }
            Mock Get-Module { $null } -ParameterFilter { $Name -eq 'Microsoft.Graph.Authentication' }
            Mock Get-Module { $null } -ParameterFilter { $Name -eq 'ExchangeOnlineManagement' -and $ListAvailable }
            Mock Get-Module { $null } -ParameterFilter { $Name -eq 'MicrosoftPowerBIMgmt' }
            Mock Get-Module { $null } -ParameterFilter { $Name -eq 'ImportExcel' }
            Mock Install-Module { }
        }

        It 'should pass even with no modules installed' {
            $result = Test-ModuleCompatibility -Section @('ActiveDirectory') -SectionServiceMap $emptyServiceMap -NonInteractive
            # ImportExcel will be flagged as recommended but auto-installed; result should still pass
            $result.Passed | Should -Be $true
        }
    }
}
