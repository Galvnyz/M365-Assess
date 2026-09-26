# M365Portal.Workers — reusable per-tenant worker handlers (EPIC-001 SPEC.md §4.2).
# The child entrypoint (run-tenant.ps1) stays thin; every reusable behavior lives here
# so the supervisor and Pester can exercise it without spawning a process.

$script:WorkerRepoRoot = Split-Path -Path (Split-Path -Path (Split-Path -Path $PSScriptRoot -Parent) -Parent) -Parent
$script:RunContextScript = Join-Path -Path $script:WorkerRepoRoot -ChildPath 'src/M365-Assess/Common/RunContext.ps1'
$script:DefaultAssessmentScript = Join-Path -Path $script:WorkerRepoRoot -ChildPath 'src/M365-Assess/Invoke-M365Assessment.ps1'
$script:TenantCredentialScript = Join-Path -Path $PSScriptRoot -ChildPath 'Resolve-TenantCredential.ps1'

if (-not (Test-Path -LiteralPath $script:RunContextScript -PathType Leaf)) {
    throw "M365Portal.Workers: RunContext script not found: $script:RunContextScript"
}
. $script:RunContextScript

if (-not (Test-Path -LiteralPath $script:TenantCredentialScript -PathType Leaf)) {
    throw "M365Portal.Workers: Resolve-TenantCredential script not found: $script:TenantCredentialScript"
}
. $script:TenantCredentialScript

. (Join-Path -Path $PSScriptRoot -ChildPath 'Invoke-ReportRender.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'Invoke-SandboxedScript.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'Invoke-Standard.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'Invoke-Drift.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'Write-RunProgress.ps1')

function Read-WorkerRunContext {
    <#
    .SYNOPSIS
        Rehydrates a RunContext from the JSON file the supervisor wrote for this tenant.
    .DESCRIPTION
        Reads -ContextFile and converts it with ConvertFrom-RunContextJson. Secret-bearing
        auth members are never present in the serialized shape (see ConvertTo-RunContextJson);
        the child materializes credentials after rehydrating (EPIC-001 SPEC.md §4.4).
        The return type is deliberately undeclared: a module-private class literal would
        resolve in the caller's scope at bind time and fail there.
    .PARAMETER ContextFile
        Path to the context.json file for this tenant run.
    .EXAMPLE
        Read-WorkerRunContext -ContextFile './run/context.json'
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$ContextFile
    )

    if (-not (Test-Path -LiteralPath $ContextFile -PathType Leaf)) {
        throw "Worker context file not found: $ContextFile"
    }
    $json = Get-Content -LiteralPath $ContextFile -Raw -Encoding UTF8
    return ConvertFrom-RunContextJson -Json $json
}

function Get-WorkerArtifacts {
    <#
    .SYNOPSIS
        Enumerates assessment artifacts under an output folder as relative references.
    .DESCRIPTION
        Lists every file under -OutputFolder (recursively, since the assessment creates a
        timestamped subfolder) and returns paths relative to -OutputFolder. These become the
        result envelope artifactRefs the supervisor uses to index and serve artifacts.
    .PARAMETER OutputFolder
        Per-tenant output folder the assessment wrote into.
    .EXAMPLE
        Get-WorkerArtifacts -OutputFolder './run/tenant'
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$OutputFolder
    )

    if (-not (Test-Path -LiteralPath $OutputFolder)) {
        return @()
    }
    $root = (Resolve-Path -LiteralPath $OutputFolder).Path
    $files = Get-ChildItem -LiteralPath $root -File -Recurse -ErrorAction SilentlyContinue
    $refs = foreach ($file in $files) {
        $full = $file.FullName
        if ($full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
            $relative = $full.Substring($root.Length).TrimStart(
                [System.IO.Path]::DirectorySeparatorChar,
                [System.IO.Path]::AltDirectorySeparatorChar
            )
            if ($relative) { $relative }
        }
    }
    return @($refs | Sort-Object -Unique)
}

function Write-WorkerResult {
    <#
    .SYNOPSIS
        Writes result.json, the versioned result envelope (portal/contracts envelope.ts).
    .DESCRIPTION
        Emits the ResultEnvelope shape the supervisor parses: schemaVersion v1, job/run/tenant
        ids, status, UTC timestamps, numeric exit code, and artifact references. Field names
        stay camelCase to match the contract; a mismatched schemaVersion is rejected by the BFF.
    .PARAMETER OutputFolder
        Per-tenant output folder receiving result.json.
    .PARAMETER JobId
        Job id from the supervisor.
    .PARAMETER JobType
        Job type for the envelope. Defaults to assessment; the render worker passes report.
    .PARAMETER TenantId
        Tenant the assessment ran against.
    .PARAMETER RunId
        Run this tenant job belongs to.
    .PARAMETER RequestId
        Request id for log correlation.
    .PARAMETER CorrelationId
        Correlation id for log correlation.
    .PARAMETER Status
        Terminal status: succeeded, failed, or cancelled.
    .PARAMETER ExitCode
        Process exit code mirroring the status (0 on success).
    .PARAMETER ArtifactRefs
        Relative artifact references from Get-WorkerArtifacts.
    .PARAMETER StartedAt
        Run start timestamp (UTC ISO-8601).
    .PARAMETER FinishedAt
        Run finish timestamp (UTC ISO-8601).
    .PARAMETER ErrorCode
        Stable error code on failure (omitted on success).
    .PARAMETER ErrorMessage
        Human-readable failure detail (omitted on success).
    .PARAMETER Retryable
        Whether the supervisor should consider retrying the job.
    .EXAMPLE
        Write-WorkerResult -OutputFolder './run/tenant' -JobId 'job-1' -TenantId 't' -RunId 'r-1' -RequestId 'q-1' -CorrelationId 'c-1' -Status 'succeeded' -ExitCode 0 -StartedAt '2026-01-01T00:00:00.000Z' -FinishedAt '2026-01-01T00:05:00.000Z'
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$OutputFolder,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$JobId,

        [Parameter()]
        [ValidateSet('assessment', 'standards', 'drift', 'baseline', 'backup', 'remediation', 'custom-script', 'report')]
        [string]$JobType = 'assessment',

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$RunId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$RequestId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$CorrelationId,

        [Parameter(Mandatory)]
        [ValidateSet('succeeded', 'failed', 'cancelled')]
        [string]$Status,

        [Parameter(Mandatory)]
        [int]$ExitCode,

        [Parameter()]
        [string[]]$ArtifactRefs = @(),

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$StartedAt,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$FinishedAt,

        [Parameter()]
        [string]$ErrorCode = '',

        [Parameter()]
        [string]$ErrorMessage = '',

        [Parameter()]
        [bool]$Retryable = $false
    )

    $envelope = [ordered]@{
        schemaVersion = 'v1'
        jobId         = $JobId
        jobType       = $JobType
        tenantId      = $TenantId
        runId         = $RunId
        requestId     = $RequestId
        correlationId = $CorrelationId
        status        = $Status
        startedAt     = $StartedAt
        finishedAt    = $FinishedAt
        exitCode      = $ExitCode
        artifactRefs  = @($ArtifactRefs)
    }
    if ($ErrorCode) {
        $envelope['error'] = [ordered]@{
            code      = $ErrorCode
            message   = $ErrorMessage
            retryable = $Retryable
        }
    }

    New-Item -Path $OutputFolder -ItemType Directory -Force | Out-Null
    $resultPath = Join-Path -Path $OutputFolder -ChildPath 'result.json'
    $envelope | ConvertTo-Json -Depth 10 | Set-Content -Path $resultPath -Encoding UTF8
    return $resultPath
}

function Invoke-WorkerAssessment {
    <#
    .SYNOPSIS
        Runs the assessment for a rehydrated RunContext inside this worker process.
    .DESCRIPTION
        Maps the RunContext back onto Invoke-M365Assessment CLI parameters. The orchestrator
        builds its context from CLI input rather than accepting one, so the worker translates
        explicitly instead of reaching into orchestrator internals. Auth secrets travel only
        in memory within this process; the serialized context file never carries them.
    .PARAMETER Context
        Rehydrated RunContext for this tenant. Typed as object because a module-private
        class literal would resolve in the caller's scope at bind time and fail there.
    .PARAMETER OutputFolder
        Per-tenant output folder; overrides the serialized path so the supervisor controls layout.
    .PARAMETER AssessmentScript
        Assessment script to invoke. Defaults to Invoke-M365Assessment.ps1; tests pass a stub.
    .EXAMPLE
        Invoke-WorkerAssessment -Context $ctx -OutputFolder './run/tenant'
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [object]$Context,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$OutputFolder,

        [Parameter()]
        [string]$AssessmentScript = ''
    )

    if (-not $AssessmentScript) {
        $AssessmentScript = $script:DefaultAssessmentScript
    }
    if (-not (Test-Path -LiteralPath $AssessmentScript -PathType Leaf)) {
        throw "Assessment script not found: $AssessmentScript"
    }

    $splat = @{ OutputFolder = $OutputFolder }
    if ($Context.Tenant.TenantId) {
        $splat['TenantId'] = $Context.Tenant.TenantId
    }
    $sections = @($Context.Scope.Sections)
    if ($sections.Count -gt 0) {
        $splat['Section'] = $sections
    }
    if ($Context.Auth.M365Environment) {
        $splat['M365Environment'] = $Context.Auth.M365Environment
    }
    if ($Context.Auth.ClientId) {
        $splat['ClientId'] = $Context.Auth.ClientId
    }
    if ($Context.Auth.CertificateThumbprint) {
        $splat['CertificateThumbprint'] = $Context.Auth.CertificateThumbprint
    }
    if ($null -ne $Context.Auth.Certificate) {
        $splat['Certificate'] = $Context.Auth.Certificate
    }
    if ($Context.Auth.CertificatePath) {
        $splat['CertificatePath'] = $Context.Auth.CertificatePath
    }
    if ($null -ne $Context.Auth.CertificatePassword) {
        $splat['CertificatePassword'] = $Context.Auth.CertificatePassword
    }
    if ($null -ne $Context.Auth.ClientSecret) {
        $splat['ClientSecret'] = $Context.Auth.ClientSecret
    }
    if ($Context.Auth.UserPrincipalName) {
        $splat['UserPrincipalName'] = $Context.Auth.UserPrincipalName
    }
    if ($Context.Auth.ManagedIdentity) {
        $splat['ManagedIdentity'] = $true
    }
    if ($Context.Auth.UseDeviceCode) {
        $splat['UseDeviceCode'] = $true
    }
    if ($Context.Scope.QuickScan) {
        $splat['QuickScan'] = $true
    }
    # A service child has no one to answer prompts; a missing module must fail the run, not hang.
    $splat['NonInteractive'] = $true

    & $AssessmentScript @splat
}

Export-ModuleMember -Function @(
    'Read-WorkerRunContext',
    'Get-WorkerArtifacts',
    'Write-WorkerResult',
    'Invoke-WorkerAssessment',
    'Resolve-TenantCredential',
    'Protect-WorkerSecret',
    'Invoke-ReportRender',
    'Get-PinnedChromiumVersion',
    'Invoke-SandboxedScript',
    'Test-SandboxedScript',
    'Invoke-Standard',
    'Invoke-Drift',
    'Write-RunProgress',
    'Reset-RunProgressSequence',
    'Register-RunProgressBridge',
    'Complete-RunProgressBridge',
    'Step-RunSectionProgress',
    'Get-RunProgressSection'
)
