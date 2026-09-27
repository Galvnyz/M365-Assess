# Connect-WorkerTenant.ps1 - feature worker tenant sign-in (T-0826).
#
# Feature workers run in their own pwsh child and call Microsoft Graph (and, for a few,
# Exchange Online) against one tenant. The BFF puts a `credential` block in the job file:
# the credential reference and the non-secret credential row, never material. This
# resolves it inside the child with Resolve-TenantCredential (T-0011), connects each
# requested service through the module's Common/Connect-Service.ps1, and returns a session
# that Disconnect-WorkerTenant closes. Errors are coded (worker.credential_*,
# worker.connect_failed) and scrubbed of secret material.

$script:ConnectWorkerDirectory = $PSScriptRoot
. (Join-Path -Path $script:ConnectWorkerDirectory -ChildPath 'Resolve-TenantCredential.ps1')

function Get-DefaultConnectServiceScript {
    # portal/workers/M365Portal.Workers -> repo root -> src/M365-Assess/Common/Connect-Service.ps1
    $repoRoot = Split-Path -Path (Split-Path -Path (Split-Path -Path $script:ConnectWorkerDirectory -Parent) -Parent) -Parent
    return Join-Path -Path $repoRoot -ChildPath 'src/M365-Assess/Common/Connect-Service.ps1'
}

function Read-WorkerCredentialBlock {
    <#
    .SYNOPSIS
        Reads the tenant id and credential block from a feature job file.
    .PARAMETER JobFile
        Path to the job envelope JSON.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$JobFile
    )

    if (-not (Test-Path -LiteralPath $JobFile)) {
        throw "job envelope not found at '$JobFile' (code: worker.job_missing)"
    }
    $job = Get-Content -LiteralPath $JobFile -Raw | ConvertFrom-Json
    $tenantId = [string]$job.tenantId
    if (-not $tenantId) {
        throw "job envelope is missing 'tenantId' (code: worker.credential_missing)"
    }
    $credential = $job.credential
    if (-not $credential -or -not $credential.credentialRef -or -not $credential.record) {
        throw "job envelope for tenant '$tenantId' carries no credential block; the worker will not run unauthenticated (code: worker.credential_missing)"
    }
    return @{
        TenantId      = $tenantId
        CredentialRef = [string]$credential.credentialRef
        Record        = $credential.record
    }
}

function Connect-WorkerTenant {
    <#
    .SYNOPSIS
        Signs a feature worker in to its tenant from the job file's credential block.
    .DESCRIPTION
        Resolves the credential inside this process, connects each service in order, and
        returns a session for Disconnect-WorkerTenant. If a later service fails, services
        already connected are disconnected before the error is thrown.
    .PARAMETER JobFile
        Path to the job envelope JSON (tenantId plus credential { credentialRef, record }).
    .PARAMETER Service
        Services to connect: Graph (default) and/or ExchangeOnline.
    .PARAMETER CredentialStore
        Secret lookup for client-secret and PFX credentials (T-0827). Certificate-thumbprint
        credentials need none.
    .PARAMETER ConnectScript
        Path to Connect-Service.ps1; defaults to the module's copy. Tests pass a stub.
    .EXAMPLE
        $session = Connect-WorkerTenant -JobFile $JobFile -Service Graph
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$JobFile,

        [ValidateSet('Graph', 'ExchangeOnline')]
        [string[]]$Service = @('Graph'),

        [scriptblock]$CredentialStore,

        [string]$ConnectScript = ''
    )

    $block = Read-WorkerCredentialBlock -JobFile $JobFile
    $resolveParams = @{
        TenantId         = $block.TenantId
        CredentialRef    = $block.CredentialRef
        CredentialRecord = $block.Record
        # The resolver's secret-auth check speaks assessment sections; 'Email' is the one
        # that needs Exchange Online, so it trips the same client-secret rejection.
        Sections         = @(if ($Service -contains 'ExchangeOnline') { 'Email' })
    }
    if ($CredentialStore) { $resolveParams['CredentialStore'] = $CredentialStore }
    $auth = Resolve-TenantCredential @resolveParams

    if (-not $ConnectScript) { $ConnectScript = Get-DefaultConnectServiceScript }
    if (-not (Test-Path -LiteralPath $ConnectScript -PathType Leaf)) {
        throw "Connect-Service script not found at '$ConnectScript' (code: worker.connect_failed)"
    }

    $session = [pscustomobject]@{
        TenantId  = $block.TenantId
        Services  = [System.Collections.Generic.List[string]]::new()
    }
    foreach ($svc in $Service) {
        $connectParams = @{ Service = $svc; TenantId = $block.TenantId }
        foreach ($key in @('ClientId', 'CertificateThumbprint', 'Certificate', 'CertificatePath', 'CertificatePassword', 'ClientSecret', 'M365Environment')) {
            if ($null -ne $auth[$key] -and [string]$auth[$key] -ne '') { $connectParams[$key] = $auth[$key] }
        }
        try {
            $connected = & $ConnectScript @connectParams
            if ($connected -eq $false) { throw "Connect-Service returned false" }
            $session.Services.Add($svc)
        }
        catch {
            $message = Protect-WorkerSecret -Message $_.Exception.Message -Secrets @($auth.ClientSecret, $auth.CertificatePassword)
            Disconnect-WorkerTenant -Session $session
            throw "Failed to connect $svc for tenant '$($block.TenantId)' (code: worker.connect_failed): $message"
        }
    }
    return $session
}

function Disconnect-WorkerTenant {
    <#
    .SYNOPSIS
        Closes the services a Connect-WorkerTenant session opened. Safe to call with $null.
    .PARAMETER Session
        The session Connect-WorkerTenant returned, or $null when no connection was made.
    #>
    [CmdletBinding()]
    param(
        [AllowNull()]
        [object]$Session
    )

    if ($null -eq $Session) { return }
    foreach ($svc in @($Session.Services)) {
        try {
            if ($svc -eq 'Graph' -and (Get-Command -Name 'Disconnect-MgGraph' -ErrorAction SilentlyContinue)) {
                $null = Disconnect-MgGraph -ErrorAction SilentlyContinue
            }
            elseif ($svc -eq 'ExchangeOnline' -and (Get-Command -Name 'Disconnect-ExchangeOnline' -ErrorAction SilentlyContinue)) {
                Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue
            }
        }
        catch {
            Write-Verbose "Disconnect of $svc failed: $($_.Exception.Message)"
        }
    }
    $Session.Services.Clear()
}
