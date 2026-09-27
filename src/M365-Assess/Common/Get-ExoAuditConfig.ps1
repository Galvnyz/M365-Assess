function Get-ExoAuditConfig {
    <#
    .SYNOPSIS
        Reads unified audit ingestion from an identified Exchange Online connection.
    .DESCRIPTION
        Resolves the cmdlet from the connection's own temporary module. Purview
        connections are never authoritative for UnifiedAuditLogIngestionEnabled.
        Ambiguous or unidentified connections fail closed for manual verification.
    .EXAMPLE
        $audit = Get-ExoAuditConfig
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param()

    $connections = @(Get-ConnectionInformation -ErrorAction Stop | Where-Object {
        $_.State -eq 'Connected' -and $_.IsEopSession -eq $false -and $_.ModuleName
    })
    if ($connections.Count -ne 1) {
        throw 'Exactly one identifiable Exchange Online connection is required to verify audit ingestion.'
    }
    $connection = $connections[0]
    $moduleName = Split-Path -Path $connection.ModuleName -Leaf
    $moduleName = $moduleName -replace '\.(psm1|psd1)$', ''
    $commandName = 'Get-' + $connection.ModulePrefix + 'AdminAuditLogConfig'
    $commands = @(Get-Command -Name $commandName -Module $moduleName -ErrorAction Stop)
    if ($commands.Count -ne 1) { throw 'Exchange Online audit command could not be resolved unambiguously.' }
    $config = & $commands[0] -ErrorAction Stop
    if ($config.UnifiedAuditLogIngestionEnabled -isnot [bool]) {
        throw 'Exchange Online returned no authoritative boolean audit-ingestion value.'
    }
    [PSCustomObject]@{
        Enabled = $config.UnifiedAuditLogIngestionEnabled
        Source = "$($connection.ConnectionUri) / $commandName"
        CollectedAt = [datetime]::UtcNow.ToString('o')
    }
}
