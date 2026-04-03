function Resolve-TenantLicenses {
    <#
    .SYNOPSIS
        Resolves the active service plans for the connected tenant.
    .DESCRIPTION
        Queries Get-MgSubscribedSku and extracts unique ServicePlanName values
        where ProvisioningStatus is 'Success'. Returns a hashtable with a HashSet
        for O(1) lookup, used by Initialize-CheckProgress to gate checks by license.
    .EXAMPLE
        $licenses = Resolve-TenantLicenses
        $licenses.ActiveServicePlans.Contains('AAD_PREMIUM_P2')
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param()

    $activePlans = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    $skuPartNumbers = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )

    try {
        Write-Verbose "Resolving tenant license service plans..."
        $skus = Get-MgSubscribedSku -All -ErrorAction Stop

        foreach ($sku in $skus) {
            $null = $skuPartNumbers.Add($sku.SkuPartNumber)

            foreach ($plan in $sku.ServicePlans) {
                if ($plan.ProvisioningStatus -eq 'Success') {
                    $null = $activePlans.Add($plan.ServicePlanName)
                }
            }
        }

        Write-Verbose "Resolved $($activePlans.Count) active service plans from $($skus.Count) SKUs."
    }
    catch {
        Write-Warning "Could not resolve tenant licenses: $_. License-aware gating disabled."
    }

    return @{
        ActiveServicePlans = $activePlans
        SkuPartNumbers     = $skuPartNumbers
    }
}
