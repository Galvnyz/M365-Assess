BeforeAll {
    . "$PSScriptRoot/../../src/M365-Assess/ValueOpportunity/Get-LicenseUtilization.ps1"
    $featureMapPath = Join-Path $PSScriptRoot '../../src/M365-Assess/controls/sku-feature-map.json'
    $script:featureMap = Get-Content $featureMapPath -Raw | ConvertFrom-Json
}

Describe 'Get-LicenseUtilization' {
    It 'Should mark premium features as licensed when tenant has required service plan' {
        $mockLicenses = @{
            ActiveServicePlans = [System.Collections.Generic.HashSet[string]]::new(
                [string[]]@('AAD_PREMIUM_P2', 'EXCHANGE_S_ENTERPRISE'),
                [System.StringComparer]::OrdinalIgnoreCase
            )
            SkuPartNumbers = [System.Collections.Generic.HashSet[string]]::new(
                [string[]]@('ENTERPRISEPREMIUM'),
                [System.StringComparer]::OrdinalIgnoreCase
            )
        }

        $results = Get-LicenseUtilization -TenantLicenses $mockLicenses -FeatureMap $script:featureMap
        $pim = $results | Where-Object { $_.FeatureId -eq 'privileged-identity-management' }
        $pim.IsLicensed | Should -Be $true
    }

    It 'Should mark premium features as not licensed when plan is missing' {
        $mockLicenses = @{
            ActiveServicePlans = [System.Collections.Generic.HashSet[string]]::new(
                [string[]]@('EXCHANGE_S_ENTERPRISE'),
                [System.StringComparer]::OrdinalIgnoreCase
            )
            SkuPartNumbers = [System.Collections.Generic.HashSet[string]]::new(
                [string[]]@('STANDARDPACK'),
                [System.StringComparer]::OrdinalIgnoreCase
            )
        }

        $results = Get-LicenseUtilization -TenantLicenses $mockLicenses -FeatureMap $script:featureMap
        $pim = $results | Where-Object { $_.FeatureId -eq 'privileged-identity-management' }
        $pim.IsLicensed | Should -Be $false
    }

    It 'Should mark features as licensed when tenant has the required service plan' {
        $mockLicenses = @{
            ActiveServicePlans = [System.Collections.Generic.HashSet[string]]::new(
                [string[]]@('AAD_PREMIUM'),
                [System.StringComparer]::OrdinalIgnoreCase
            )
            SkuPartNumbers = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        }

        $results = Get-LicenseUtilization -TenantLicenses $mockLicenses -FeatureMap $script:featureMap
        # Find a feature that requires AAD_PREMIUM
        $aadPremiumFeature = $results | Where-Object { $_.SourcePlans -match 'AAD_PREMIUM' } | Select-Object -First 1
        $aadPremiumFeature.IsLicensed | Should -Be $true
    }

    It 'Should return one row per feature' {
        $mockLicenses = @{
            ActiveServicePlans = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
            SkuPartNumbers = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        }

        $results = Get-LicenseUtilization -TenantLicenses $mockLicenses -FeatureMap $script:featureMap
        $results.Count | Should -Be @($script:featureMap.featureGroups.PSObject.Properties).Count
    }
}
