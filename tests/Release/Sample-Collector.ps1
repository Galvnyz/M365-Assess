# Fixture-only replacement for network collectors; never calls a tenant service.
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$FixturePath,
    [switch]$ChangeFinding
)
$rows = @(Import-Csv -LiteralPath $FixturePath)
if ([IO.Path]::GetFileName($FixturePath) -eq '01-Tenant-Info.csv') {
    $rows[0].TenantId = '11111111-1111-1111-1111-111111111111'
}
if ($ChangeFinding -and [IO.Path]::GetFileName($FixturePath) -eq '07b-Entra-Security-Config.csv') {
    $rows[0].Status = 'Fail'
    $rows[0].CurrentValue = 'False'
}
$rows
