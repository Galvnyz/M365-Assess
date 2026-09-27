BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:workersDir = Join-Path $script:repoRoot 'portal/workers'
    . (Join-Path $script:workersDir 'M365Portal.Workers/Connect-WorkerTenant.ps1')

    function global:Disconnect-MgGraph { param([switch]$ErrorAction) }
    function global:Disconnect-ExchangeOnline { param([switch]$Confirm, $ErrorAction) }

    # A stand-in Connect-Service.ps1 that records each call and fails on request.
    $script:connectScript = Join-Path $TestDrive 'Connect-Service.ps1'
    Set-Content -LiteralPath $script:connectScript -Value @'
param(
    [string]$Service, [string]$TenantId, [string]$ClientId, [string]$CertificateThumbprint,
    $Certificate, [string]$CertificatePath, $CertificatePassword, $ClientSecret, [string]$M365Environment
)
$global:ConnectCalls.Add([pscustomobject]@{
    Service = $Service; TenantId = $TenantId; ClientId = $ClientId
    CertificateThumbprint = $CertificateThumbprint; M365Environment = $M365Environment
    HasSecret = ($null -ne $ClientSecret)
})
if ($global:FailService -eq $Service) { throw "connect failed: $global:FailDetail" }
'@

    function New-JobFile {
        param([hashtable]$Job)
        $path = Join-Path $TestDrive ("job-{0}.json" -f [guid]::NewGuid())
        $Job | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $path
        return $path
    }

    $script:thumbprintJob = @{
        tenantId   = 'tenant-a'
        credential = @{
            credentialRef = 'tenants/tenant-a/credential'
            record        = @{ tenantId = 'tenant-a'; authMethod = 'certificate'; clientId = 'app-1'; thumbprint = 'ABC123'; environment = 'commercial' }
        }
    }
}

Describe 'Connect-WorkerTenant (T-0826)' {
    BeforeEach {
        $global:ConnectCalls = [System.Collections.Generic.List[object]]::new()
        $global:FailService = ''
        $global:FailDetail = ''
    }

    Context 'credential block' {
        It 'refuses a job without a credential block instead of running unauthenticated' {
            $job = New-JobFile -Job @{ tenantId = 'tenant-a' }
            { Connect-WorkerTenant -JobFile $job -ConnectScript $script:connectScript } | Should -Throw '*worker.credential_missing*'
            $global:ConnectCalls.Count | Should -Be 0
        }

        It 'refuses a job without a tenant id' {
            $job = New-JobFile -Job @{ credential = $script:thumbprintJob.credential }
            { Connect-WorkerTenant -JobFile $job -ConnectScript $script:connectScript } | Should -Throw '*worker.credential_missing*'
        }

        It 'refuses a credential row that belongs to another tenant' {
            $mismatch = @{ tenantId = 'tenant-b'; credential = $script:thumbprintJob.credential }
            { Connect-WorkerTenant -JobFile (New-JobFile -Job $mismatch) -ConnectScript $script:connectScript } |
                Should -Throw '*worker.credential_ref_mismatch*'
        }
    }

    Context 'connecting' {
        It 'connects Graph with the resolved certificate credential' {
            $session = Connect-WorkerTenant -JobFile (New-JobFile -Job $script:thumbprintJob) -ConnectScript $script:connectScript
            @($session.Services) | Should -Be @('Graph')
            $session.TenantId | Should -Be 'tenant-a'
            $global:ConnectCalls[0] | Should -Not -BeNullOrEmpty
            $global:ConnectCalls[0].Service | Should -Be 'Graph'
            $global:ConnectCalls[0].TenantId | Should -Be 'tenant-a'
            $global:ConnectCalls[0].ClientId | Should -Be 'app-1'
            $global:ConnectCalls[0].CertificateThumbprint | Should -Be 'ABC123'
            $global:ConnectCalls[0].M365Environment | Should -Be 'commercial'
        }

        It 'connects each requested service in order' {
            $session = Connect-WorkerTenant -JobFile (New-JobFile -Job $script:thumbprintJob) -Service Graph, ExchangeOnline -ConnectScript $script:connectScript
            @($global:ConnectCalls | ForEach-Object { $_.Service }) | Should -Be @('Graph', 'ExchangeOnline')
            @($session.Services) | Should -Be @('Graph', 'ExchangeOnline')
        }

        It 'disconnects what it already opened when a later service fails' {
            Mock Disconnect-MgGraph { }
            $global:FailService = 'ExchangeOnline'
            { Connect-WorkerTenant -JobFile (New-JobFile -Job $script:thumbprintJob) -Service Graph, ExchangeOnline -ConnectScript $script:connectScript } |
                Should -Throw '*Failed to connect ExchangeOnline*worker.connect_failed*'
            Should -Invoke Disconnect-MgGraph -Times 1
        }

        It 'scrubs secret material from connection errors' {
            $secretJob = @{
                tenantId   = 'tenant-a'
                credential = @{
                    credentialRef = 'ref://tenant-a/secret'
                    record        = @{ tenantId = 'tenant-a'; authMethod = 'client-secret'; clientId = 'app-1'; secretRef = 'ref://tenant-a/secret' }
                }
            }
            $global:FailService = 'Graph'
            $global:FailDetail = 's3cret-value'
            $store = { param($SecretRef) 's3cret-value' }
            $err = $null
            try {
                Connect-WorkerTenant -JobFile (New-JobFile -Job $secretJob) -CredentialStore $store -ConnectScript $script:connectScript
            }
            catch { $err = $_.Exception.Message }
            $err | Should -Match 'worker.connect_failed'
            $err | Should -Not -Match 's3cret-value'
            $global:ConnectCalls[0].HasSecret | Should -BeTrue
        }

        It 'rejects client-secret credentials for Exchange Online before connecting' {
            $secretJob = @{
                tenantId   = 'tenant-a'
                credential = @{
                    credentialRef = 'ref://tenant-a/secret'
                    record        = @{ tenantId = 'tenant-a'; authMethod = 'client-secret'; clientId = 'app-1'; secretRef = 'ref://tenant-a/secret' }
                }
            }
            { Connect-WorkerTenant -JobFile (New-JobFile -Job $secretJob) -Service ExchangeOnline -CredentialStore { 'x' } -ConnectScript $script:connectScript } |
                Should -Throw
            $global:ConnectCalls.Count | Should -Be 0
        }
    }

    Context 'Disconnect-WorkerTenant' {
        It 'is a no-op for a null session' {
            { Disconnect-WorkerTenant -Session $null } | Should -Not -Throw
        }

        It 'disconnects each connected service once' {
            Mock Disconnect-MgGraph { }
            Mock Disconnect-ExchangeOnline { }
            $session = Connect-WorkerTenant -JobFile (New-JobFile -Job $script:thumbprintJob) -Service Graph, ExchangeOnline -ConnectScript $script:connectScript
            Disconnect-WorkerTenant -Session $session
            Disconnect-WorkerTenant -Session $session
            Should -Invoke Disconnect-MgGraph -Times 1
            Should -Invoke Disconnect-ExchangeOnline -Times 1
        }
    }

    Context 'entrypoint convention' {
        It 'every Graph- or Exchange-calling entrypoint connects and disconnects its tenant' {
            $offenders = foreach ($entry in Get-ChildItem -LiteralPath $script:workersDir -Filter '*.ps1') {
                $source = Get-Content -LiteralPath $entry.FullName -Raw
                $workers = [regex]::Matches($source, "M365Portal\.Workers/([A-Za-z-]+)\.ps1") | ForEach-Object { $_.Groups[1].Value } |
                    Where-Object { $_ -ne 'Connect-WorkerTenant' }
                $callsTenant = $false
                foreach ($w in $workers) {
                    $workerSource = Get-Content -LiteralPath (Join-Path $script:workersDir "M365Portal.Workers/$w.ps1") -Raw
                    if ($workerSource -match 'Invoke-MgGraphRequest|Update-Mg[A-Z]|Set-(Mailbox|DistributionGroup|UnifiedGroup)|Get-(Mailbox|InboxRule|UnifiedGroup)') {
                        $callsTenant = $true
                    }
                }
                if ($entry.Name -eq 'get-intune-policies.ps1' -or $entry.Name -eq 'set-intune-policy.ps1') { $callsTenant = $true }
                if ($callsTenant -and ($source -notmatch 'Connect-WorkerTenant -JobFile' -or $source -notmatch 'finally \{\s+Disconnect-WorkerTenant -Session')) {
                    $entry.Name
                }
            }
            @($offenders) | Should -Be @()
        }
    }
}
