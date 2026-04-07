BeforeAll {
    # Show-InteractiveWizard uses Read-Host extensively. We stub it as a global function
    # before dot-sourcing so that all internal calls are interceptable via Mock.

    . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/Show-InteractiveWizard.ps1"
}

Describe 'Show-InteractiveWizard function definition' {
    It 'should be defined as a function' {
        (Get-Command -Name 'Show-InteractiveWizard' -ErrorAction SilentlyContinue) | Should -Not -BeNullOrEmpty
    }

    It 'should accept -PreSelectedSections parameter' {
        $cmd = Get-Command -Name 'Show-InteractiveWizard'
        $cmd.Parameters.ContainsKey('PreSelectedSections') | Should -Be $true
    }

    It 'should accept -PreSelectedOutputFolder parameter' {
        $cmd = Get-Command -Name 'Show-InteractiveWizard'
        $cmd.Parameters.ContainsKey('PreSelectedOutputFolder') | Should -Be $true
    }
}

Describe 'Show-InteractiveWizard - non-interactive paths' {
    BeforeAll {
        # Show-InteractiveWizard reads $ProjectRoot from its calling scope to locate profile helpers.
        # Setting it as a global avoids a null-path error in Join-Path at line 185.
        $global:ProjectRoot = $env:TEMP
        # Suppress filesystem checks -- no profile helpers on disk during tests
        Mock Test-Path { return $false }
        Mock Clear-Host { }
    }

    AfterAll {
        Remove-Variable -Name ProjectRoot -Scope Global -ErrorAction SilentlyContinue
    }

    Context 'when user quits at confirmation step' {
        BeforeAll {
            # With PreSelectedSections and PreSelectedOutputFolder, we skip sections and output steps.
            # We still need to respond to: Tenant, Auth, Report Options, Confirm.
            $script:readHostCallCount = 0
            Mock Read-Host {
                $script:readHostCallCount++
                switch ($script:readHostCallCount) {
                    1 { return 'testtenant.onmicrosoft.com' }  # Tenant step
                    2 { return '1' }                           # Auth: Interactive
                    3 { return '' }                            # UPN: skip
                    4 { return '' }                            # Report options: accept defaults
                    5 { return 'Q' }                           # Confirm: quit
                    default { return '' }
                }
            }

            $script:result = Show-InteractiveWizard `
                -PreSelectedSections @('Identity', 'Email') `
                -PreSelectedOutputFolder '.\TestOutput'
        }

        It 'should return null when user quits' {
            $result | Should -BeNullOrEmpty
        }
    }

    Context 'when user confirms with valid mocked inputs' {
        BeforeAll {
            $script:readHostCallCount = 0
            Mock Read-Host {
                $script:readHostCallCount++
                switch ($script:readHostCallCount) {
                    1 { return 'contoso.onmicrosoft.com' }  # Tenant
                    2 { return '4' }                        # Auth: Skip (already connected)
                    3 { return '' }                         # Report options: accept
                    4 { return '' }                         # Confirm: begin
                    default { return '' }
                }
            }
            Mock Clear-Host { }
            Mock Test-Path { return $false }

            $script:result = Show-InteractiveWizard `
                -PreSelectedSections @('Identity', 'Security') `
                -PreSelectedOutputFolder '.\Output'
        }

        It 'should return a hashtable' {
            $result | Should -BeOfType [hashtable]
        }

        It 'should include Section key with selected sections' {
            $result.ContainsKey('Section') | Should -Be $true
        }

        It 'should have Identity in selected sections' {
            $result.Section | Should -Contain 'Identity'
        }

        It 'should include OutputFolder key' {
            $result.ContainsKey('OutputFolder') | Should -Be $true
        }

        It 'should set SkipConnection when auth method is Skip' {
            $result.ContainsKey('SkipConnection') | Should -Be $true
            $result.SkipConnection | Should -Be $true
        }
    }

    Context 'when Interactive auth is chosen with a UPN' {
        BeforeAll {
            $script:readHostCallCount = 0
            Mock Read-Host {
                $script:readHostCallCount++
                switch ($script:readHostCallCount) {
                    1 { return 'contoso.onmicrosoft.com' }       # Tenant
                    2 { return '1' }                             # Auth: Interactive
                    3 { return 'admin@contoso.onmicrosoft.com' } # UPN
                    4 { return '' }                              # Report options
                    5 { return '' }                              # Confirm
                    default { return '' }
                }
            }
            Mock Clear-Host { }
            Mock Test-Path { return $false }

            $script:result = Show-InteractiveWizard `
                -PreSelectedSections @('Email') `
                -PreSelectedOutputFolder '.\Out'
        }

        It 'should set UserPrincipalName in result' {
            $result.ContainsKey('UserPrincipalName') | Should -Be $true
            $result.UserPrincipalName | Should -Be 'admin@contoso.onmicrosoft.com'
        }
    }

    Context 'when DeviceCode auth is chosen' {
        BeforeAll {
            $script:readHostCallCount = 0
            Mock Read-Host {
                $script:readHostCallCount++
                switch ($script:readHostCallCount) {
                    1 { return 'contoso.onmicrosoft.com' }  # Tenant
                    2 { return '2' }                        # Auth: DeviceCode
                    3 { return '' }                         # Report options
                    4 { return '' }                         # Confirm
                    default { return '' }
                }
            }
            Mock Clear-Host { }
            Mock Test-Path { return $false }

            $script:result = Show-InteractiveWizard `
                -PreSelectedSections @('Identity') `
                -PreSelectedOutputFolder '.\Out'
        }

        It 'should set UseDeviceCode in result' {
            $result.ContainsKey('UseDeviceCode') | Should -Be $true
            $result.UseDeviceCode | Should -Be $true
        }
    }

    Context 'when TenantId is provided in tenant step' {
        BeforeAll {
            $script:readHostCallCount = 0
            Mock Read-Host {
                $script:readHostCallCount++
                switch ($script:readHostCallCount) {
                    1 { return 'mytenant.onmicrosoft.com' }  # Tenant
                    2 { return '4' }                         # Auth: Skip
                    3 { return '' }                          # Report options
                    4 { return '' }                          # Confirm
                    default { return '' }
                }
            }
            Mock Clear-Host { }
            Mock Test-Path { return $false }

            $script:result = Show-InteractiveWizard `
                -PreSelectedSections @('Identity') `
                -PreSelectedOutputFolder '.\Out'
        }

        It 'should set TenantId from user input' {
            $result.ContainsKey('TenantId') | Should -Be $true
            $result.TenantId | Should -Be 'mytenant.onmicrosoft.com'
        }
    }

    Context 'when report options are toggled to exclude ComplianceOverview' {
        BeforeAll {
            $script:readHostCallCount = 0
            Mock Read-Host {
                $script:readHostCallCount++
                switch ($script:readHostCallCount) {
                    1 { return 'contoso.onmicrosoft.com' }  # Tenant
                    2 { return '4' }                        # Auth: Skip
                    3 { return '1' }                        # Toggle option 1 (ComplianceOverview off)
                    4 { return '' }                         # Accept report options
                    5 { return '' }                         # Confirm
                    default { return '' }
                }
            }
            Mock Clear-Host { }
            Mock Test-Path { return $false }

            $script:result = Show-InteractiveWizard `
                -PreSelectedSections @('Identity') `
                -PreSelectedOutputFolder '.\Out'
        }

        It 'should set SkipComplianceOverview when toggled off' {
            $result.ContainsKey('SkipComplianceOverview') | Should -Be $true
            $result.SkipComplianceOverview | Should -Be $true
        }
    }
}
