<#
.SYNOPSIS
    Downloads the latest Microsoft SKU friendly-name CSV.
.DESCRIPTION
    Fetches the official product-name-to-SKU mapping from Microsoft and saves
    it to assets/sku-friendly-names.csv. Run this periodically (or before a
    release) to keep the bundled fallback current.

    Source: https://learn.microsoft.com/en-us/entra/identity/users/licensing-service-plan-reference
.EXAMPLE
    PS> .\assets\Update-SkuCsv.ps1

    Downloads the latest CSV and reports the unique SKU count.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$url = 'https://download.microsoft.com/download/e/3/e/e3e9faf2-f28b-490a-9ada-c6089a1fc5b0/Product%20names%20and%20service%20plan%20identifiers%20for%20licensing.csv'
$outPath = Join-Path -Path $PSScriptRoot -ChildPath 'sku-friendly-names.csv'

Write-Host "Downloading SKU CSV from Microsoft..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $url -OutFile $outPath -UseBasicParsing

$uniqueSkus = (Import-Csv -Path $outPath | Select-Object -Property String_Id -Unique).Count
Write-Host "Saved $outPath ($uniqueSkus unique SKUs)" -ForegroundColor Green
