<#
.SYNOPSIS
    Reports MFA registration details for all users in Entra ID.
.DESCRIPTION
    Queries the Microsoft Graph authentication methods user registration details
    endpoint to produce a per-user MFA and SSPR registration report. Shows whether
    each user is MFA registered, MFA capable, passwordless capable, SSPR registered,
    SSPR capable, and which methods they have enrolled. Essential for security
    assessments and MFA/SSPR adoption tracking.

    Requires Microsoft.Graph.Reports module and the following permissions:
    AuditLog.Read.All, UserAuthenticationMethod.Read.All
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'AuditLog.Read.All','UserAuthenticationMethod.Read.All'
    PS> .\Entra\Get-MfaReport.ps1

    Displays MFA registration status for all users.
.EXAMPLE
    PS> .\Entra\Get-MfaReport.ps1 -OutputPath '.\mfa-report.csv'

    Exports MFA registration details to CSV for review.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

function Get-MfaMethodStrength {
    <#
    .SYNOPSIS
        Classifies the strongest MFA method from a list of registered methods.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter()]
        [string[]]$Methods
    )

    $phishingResistant = @(
        'fido2'
        'windowsHelloForBusiness'
        'x509CertificateMultiFactor'
        'passKeyDeviceBound'
        'passKeyDeviceBoundAuthenticator'
    )
    $standard = @(
        'microsoftAuthenticatorPush'
        'microsoftAuthenticatorPasswordless'
        'softwareOneTimePasscode'
    )
    $weak = @(
        'mobilePhone'
        'alternateMobilePhone'
        'voiceAlternateMobile'
        'email'
    )

    if (-not $Methods -or $Methods.Count -eq 0) { return 'None' }
    if ($Methods | Where-Object { $_ -in $phishingResistant }) { return 'Phishing-Resistant' }
    if ($Methods | Where-Object { $_ -in $standard }) { return 'Standard' }
    if ($Methods | Where-Object { $_ -in $weak }) { return 'Weak' }
    return 'Unknown'
}

# Verify Graph connection
if (-not (Assert-GraphConnection)) { return }

# Ensure required Graph submodule is loaded (PS 7.x does not auto-import)
Import-Module -Name Microsoft.Graph.Reports -ErrorAction Stop

# Retrieve MFA registration details
try {
    Write-Verbose "Retrieving authentication method registration details..."
    $registrationDetails = Get-MgReportAuthenticationMethodUserRegistrationDetail -All -ErrorAction Stop
}
catch {
    Write-Warning "Could not retrieve MFA registration details (requires Microsoft Entra ID P1/P2): $($_.Exception.Message)"
    return
}

$allDetails = @($registrationDetails)
Write-Verbose "Processing MFA details for $($allDetails.Count) users..."

if ($allDetails.Count -eq 0) {
    Write-Verbose "No MFA registration details found"
    return
}

$report = foreach ($detail in $allDetails) {
    $methodsRegistered = if ($detail.MethodsRegistered) {
        ($detail.MethodsRegistered | Sort-Object) -join '; '
    }
    else {
        ''
    }

    [PSCustomObject]@{
        UserPrincipalName     = $detail.UserPrincipalName
        UserDisplayName       = $detail.UserDisplayName
        IsMfaRegistered       = $detail.IsMfaRegistered
        IsMfaCapable          = $detail.IsMfaCapable
        IsPasswordlessCapable = $detail.IsPasswordlessCapable
        IsSsprRegistered      = $detail.IsSsprRegistered
        IsSsprCapable         = $detail.IsSsprCapable
        MethodsRegistered     = $methodsRegistered
        DefaultMfaMethod      = $detail.DefaultMfaMethod
        MfaStrength           = (Get-MfaMethodStrength -Methods @($detail.MethodsRegistered))
        IsAdmin               = $detail.IsAdmin
    }
}

$report = @($report) | Sort-Object -Property UserPrincipalName

Write-Verbose "Found $($report.Count) user MFA registration records"

if ($OutputPath) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported MFA report ($($report.Count) users) to $OutputPath"
}
else {
    Write-Output $report
}
