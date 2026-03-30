<#
.SYNOPSIS
    Generates a report of Microsoft 365 license assignments and availability.
.DESCRIPTION
    Queries Microsoft Graph for all subscribed SKUs in the tenant and reports
    on total, assigned, and available license counts. Optionally exports per-user
    license assignments. Essential for client license audits and cost optimization.

    Requires Microsoft.Graph.Users module and Organization.Read.All permission.
.PARAMETER IncludeUserDetail
    Include per-user license assignment detail in the output. Without this flag,
    only the SKU summary is returned.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'Organization.Read.All'
    PS> .\Entra\Get-LicenseReport.ps1

    Displays a summary of all license SKUs with total, assigned, and available counts.
.EXAMPLE
    PS> .\Entra\Get-LicenseReport.ps1 -IncludeUserDetail -OutputPath '.\license-report.csv'

    Exports per-user license assignments to CSV.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [switch]$IncludeUserDetail,

    [Parameter()]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

# Verify Graph connection
if (-not (Assert-GraphConnection)) { return }

# Ensure required Graph submodules are loaded (PS 7.x does not auto-import)
Import-Module -Name Microsoft.Graph.Identity.DirectoryManagement -ErrorAction Stop
Import-Module -Name Microsoft.Graph.Users -ErrorAction Stop

# ------------------------------------------------------------------
# Build SKU friendly-name lookup
# Try Microsoft's live CSV first → bundled CSV fallback → raw SkuPartNumber.
# Source: https://learn.microsoft.com/en-us/entra/identity/users/licensing-service-plan-reference
# To refresh the bundled copy: run assets/Update-SkuCsv.ps1
# ------------------------------------------------------------------
$skuFriendlyNames = @{}
$skuCsvUrl = 'https://download.microsoft.com/download/e/3/e/e3e9faf2-f28b-490a-9ada-c6089a1fc5b0/Product%20names%20and%20service%20plan%20identifiers%20for%20licensing.csv'

# Helper — parse a CSV (text or file) into the lookup hashtable
function Import-SkuCsv {
    param([Parameter(Mandatory)][object[]]$CsvRows)
    foreach ($row in $CsvRows) {
        $stringId = $row.String_Id
        $displayName = $row.Product_Display_Name
        if ($stringId -and $displayName -and -not $skuFriendlyNames.ContainsKey($stringId)) {
            $skuFriendlyNames[$stringId] = $displayName
        }
    }
}

# 1) Try live download (latest from Microsoft)
try {
    Write-Verbose "Downloading SKU friendly-name list from Microsoft..."
    $csvText = (Invoke-WebRequest -Uri $skuCsvUrl -UseBasicParsing -TimeoutSec 10).Content
    Import-SkuCsv -CsvRows ($csvText | ConvertFrom-Csv)
    Write-Verbose "Loaded $($skuFriendlyNames.Count) SKU friendly names from Microsoft"
}
catch {
    Write-Verbose "Could not download SKU list ($($_.Exception.Message)). Trying bundled copy."
}

# 2) Fill gaps from bundled CSV (assets/sku-friendly-names.csv)
if ($skuFriendlyNames.Count -eq 0) {
    $bundledCsv = Join-Path -Path $PSScriptRoot -ChildPath '..\assets\sku-friendly-names.csv'
    if (Test-Path -Path $bundledCsv) {
        try {
            Import-SkuCsv -CsvRows (Import-Csv -Path $bundledCsv)
            Write-Verbose "Loaded $($skuFriendlyNames.Count) SKU friendly names from bundled CSV"
        }
        catch {
            Write-Verbose "Could not parse bundled SKU CSV: $($_.Exception.Message)"
        }
    }
}

try {
    Write-Verbose "Retrieving subscribed SKUs..."
    $skus = Get-MgSubscribedSku -All
}
catch {
    Write-Error "Failed to retrieve license information: $_"
    return
}

if (-not $IncludeUserDetail) {
    # SKU summary only
    $report = foreach ($sku in $skus) {
        $friendlyName = $skuFriendlyNames[$sku.SkuPartNumber]
        if (-not $friendlyName) { $friendlyName = $sku.SkuPartNumber }

        [PSCustomObject]@{
            License        = $friendlyName
            SkuPartNumber  = $sku.SkuPartNumber
            Total          = $sku.PrepaidUnits.Enabled
            Assigned       = $sku.ConsumedUnits
            Available      = $sku.PrepaidUnits.Enabled - $sku.ConsumedUnits
            Suspended      = $sku.PrepaidUnits.Suspended
            Warning        = $sku.PrepaidUnits.Warning
        }
    }

    $report = @($report) | Sort-Object -Property License

    if ($OutputPath) {
        $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
        Write-Output "Exported license summary ($($report.Count) SKUs) to $OutputPath"
    }
    else {
        Write-Output $report
    }
}
else {
    # Per-user license detail
    Write-Verbose "Retrieving per-user license assignments..."
    try {
        $users = Get-MgUser -Property 'Id','DisplayName','UserPrincipalName','AssignedLicenses' -All
    }
    catch {
        Write-Error "Failed to retrieve user license data: $_"
        return
    }

    # Build a SkuId-to-name lookup
    $skuLookup = @{}
    foreach ($sku in $skus) {
        $friendlyName = $skuFriendlyNames[$sku.SkuPartNumber]
        if (-not $friendlyName) { $friendlyName = $sku.SkuPartNumber }
        $skuLookup[$sku.SkuId] = $friendlyName
    }

    $report = foreach ($user in $users) {
        if ($user.AssignedLicenses.Count -eq 0) { continue }

        $licenseNames = foreach ($license in $user.AssignedLicenses) {
            $name = $skuLookup[$license.SkuId]
            if (-not $name) { $name = $license.SkuId }
            $name
        }

        [PSCustomObject]@{
            DisplayName       = $user.DisplayName
            UserPrincipalName = $user.UserPrincipalName
            LicenseCount      = $user.AssignedLicenses.Count
            Licenses          = $licenseNames -join '; '
        }
    }

    $report = @($report) | Sort-Object -Property DisplayName

    if ($OutputPath) {
        $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
        Write-Output "Exported per-user license detail ($($report.Count) users) to $OutputPath"
    }
    else {
        Write-Output $report
    }
}
