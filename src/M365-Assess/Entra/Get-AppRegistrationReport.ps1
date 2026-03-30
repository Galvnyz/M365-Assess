<#
.SYNOPSIS
    Lists all Entra ID app registrations with credential expiry information.
.DESCRIPTION
    Queries Microsoft Graph for all application registrations in the tenant and
    reports on credential (password and certificate) status including counts and
    earliest expiry dates. Identifies applications with expired credentials that
    may cause service interruptions. Critical for security assessments and
    certificate lifecycle management.

    Requires Microsoft.Graph.Applications module and Application.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'Application.Read.All'
    PS> .\Entra\Get-AppRegistrationReport.ps1

    Displays all app registrations with credential expiry details.
.EXAMPLE
    PS> .\Entra\Get-AppRegistrationReport.ps1 -OutputPath '.\app-registrations.csv'

    Exports app registration details to CSV for review.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

# Verify Graph connection
if (-not (Assert-GraphConnection)) { return }

# Ensure required Graph submodule is loaded (PS 7.x does not auto-import)
Import-Module -Name Microsoft.Graph.Applications -ErrorAction Stop

# Retrieve all app registrations
try {
    Write-Verbose "Retrieving all app registrations..."
    $applications = Get-MgApplication -All -Property 'Id','DisplayName','AppId','CreatedDateTime','SignInAudience','PasswordCredentials','KeyCredentials'
}
catch {
    Write-Error "Failed to retrieve app registrations: $_"
    return
}

$allApps = @($applications)
Write-Verbose "Processing $($allApps.Count) app registrations..."

if ($allApps.Count -eq 0) {
    Write-Verbose "No app registrations found"
    return
}

$now = Get-Date

$report = foreach ($app in $allApps) {
    $passwordCredCount = 0
    $keyCredCount = 0
    $expiredCount = 0
    $allExpiries = @()

    # Process password credentials (client secrets)
    if ($app.PasswordCredentials) {
        $passwordCredCount = $app.PasswordCredentials.Count
        foreach ($cred in $app.PasswordCredentials) {
            if ($cred.EndDateTime) {
                $allExpiries += $cred.EndDateTime
                if ($cred.EndDateTime -lt $now) {
                    $expiredCount++
                }
            }
        }
    }

    # Process key credentials (certificates)
    if ($app.KeyCredentials) {
        $keyCredCount = $app.KeyCredentials.Count
        foreach ($cred in $app.KeyCredentials) {
            if ($cred.EndDateTime) {
                $allExpiries += $cred.EndDateTime
                if ($cred.EndDateTime -lt $now) {
                    $expiredCount++
                }
            }
        }
    }

    # Find earliest expiry across all credentials
    $earliestExpiry = if ($allExpiries.Count -gt 0) {
        ($allExpiries | Sort-Object | Select-Object -First 1).ToString('yyyy-MM-dd HH:mm:ss')
    }
    else {
        ''
    }

    [PSCustomObject]@{
        DisplayName            = $app.DisplayName
        AppId                  = $app.AppId
        CreatedDateTime        = $app.CreatedDateTime
        SignInAudience         = $app.SignInAudience
        PasswordCredentialCount = $passwordCredCount
        KeyCredentialCount     = $keyCredCount
        EarliestExpiry         = $earliestExpiry
        ExpiredCredentials     = $expiredCount
    }
}

$report = @($report) | Sort-Object -Property DisplayName

Write-Verbose "Found $($report.Count) app registrations"

if ($OutputPath) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported app registration report ($($report.Count) apps) to $OutputPath"
}
else {
    Write-Output $report
}
