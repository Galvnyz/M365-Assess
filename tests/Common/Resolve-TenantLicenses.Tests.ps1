BeforeAll {
    . "$PSScriptRoot/../../src/M365-Assess/Common/Resolve-TenantLicenses.ps1"
}

Describe 'Resolve-TenantLicenses' {
    Context 'when tenant has licensed SKUs with provisioned plans' {
        BeforeAll {
            Mock Get-MgSubscribedSku {
                return @(
                    [PSCustomObject]@{
                        SkuPartNumber = 'SPE_E5'
                        ServicePlans  = @(
                            [PSCustomObject]@{ ServicePlanName = 'AAD_PREMIUM_P2'; ProvisioningStatus = 'Success' }
                            [PSCustomObject]@{ ServicePlanName = 'INTUNE_A'; ProvisioningStatus = 'Success' }
                            [PSCustomObject]@{ ServicePlanName = 'DISABLED_PLAN'; ProvisioningStatus = 'Disabled' }
                        )
                    }
                    [PSCustomObject]@{
                        SkuPartNumber = 'EMS'
                        ServicePlans  = @(
                            [PSCustomObject]@{ ServicePlanName = 'MFA_PREMIUM'; ProvisioningStatus = 'Success' }
                        )
                    }
                )
            }
            $script:result = Resolve-TenantLicenses
        }

        It 'should return a hashtable' {
            $result | Should -BeOfType [hashtable]
        }

        It 'should contain ActiveServicePlans key' {
            $result.ContainsKey('ActiveServicePlans') | Should -Be $true
        }

        It 'should contain SkuPartNumbers key' {
            $result.ContainsKey('SkuPartNumbers') | Should -Be $true
        }

        It 'should include plans with Success provisioning status' {
            $result.ActiveServicePlans.Contains('AAD_PREMIUM_P2') | Should -Be $true
            $result.ActiveServicePlans.Contains('INTUNE_A') | Should -Be $true
            $result.ActiveServicePlans.Contains('MFA_PREMIUM') | Should -Be $true
        }

        It 'should exclude plans with non-Success provisioning status' {
            $result.ActiveServicePlans.Contains('DISABLED_PLAN') | Should -Be $false
        }

        It 'should include SKU part numbers' {
            $result.SkuPartNumbers.Contains('SPE_E5') | Should -Be $true
            $result.SkuPartNumbers.Contains('EMS') | Should -Be $true
        }
    }

    Context 'when case-insensitive lookup is used' {
        BeforeAll {
            Mock Get-MgSubscribedSku {
                return @(
                    [PSCustomObject]@{
                        SkuPartNumber = 'SPE_E5'
                        ServicePlans  = @(
                            [PSCustomObject]@{ ServicePlanName = 'AAD_PREMIUM_P2'; ProvisioningStatus = 'Success' }
                        )
                    }
                )
            }
            $script:result = Resolve-TenantLicenses
        }

        It 'should find plan using mixed case lookup' {
            $result.ActiveServicePlans.Contains('aad_premium_p2') | Should -Be $true
        }

        It 'should find SKU using mixed case lookup' {
            $result.SkuPartNumbers.Contains('spe_e5') | Should -Be $true
        }
    }

    Context 'when Get-MgSubscribedSku throws an exception' {
        BeforeAll {
            Mock Get-MgSubscribedSku { throw 'Graph connection error' }
            $script:result = Resolve-TenantLicenses
        }

        It 'should not throw -- returns empty result instead' {
            # The function should have returned without throwing
            $result | Should -Not -BeNullOrEmpty
        }

        It 'should return hashtable with ActiveServicePlans key' {
            $result.ContainsKey('ActiveServicePlans') | Should -Be $true
        }

        It 'should return empty ActiveServicePlans HashSet on exception' {
            $result.ActiveServicePlans.Count | Should -Be 0
        }

        It 'should return empty SkuPartNumbers HashSet on exception' {
            $result.SkuPartNumbers.Count | Should -Be 0
        }
    }

    Context 'when tenant has no licensed SKUs' {
        BeforeAll {
            Mock Get-MgSubscribedSku { return @() }
            $script:result = Resolve-TenantLicenses
        }

        It 'should return hashtable' {
            $result | Should -BeOfType [hashtable]
        }

        It 'should return empty ActiveServicePlans' {
            $result.ActiveServicePlans.Count | Should -Be 0
        }

        It 'should return empty SkuPartNumbers' {
            $result.SkuPartNumbers.Count | Should -Be 0
        }
    }
}
