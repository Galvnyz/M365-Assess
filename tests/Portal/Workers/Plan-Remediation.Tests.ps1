# Plan-Remediation.Tests.ps1
# Pester tests for T-0105 — remediation plan generation.
# Asserts: finding-status selection, automated/manual/undetermined classification,
# sub-number stripping, gate outcomes, plan mode, and that the worker performs no
# tenant writes (classification and gating are pure).

#Requires -Module Pester
Set-StrictMode -Version Latest

Describe 'New-RemediationPlan' {
    BeforeAll {
        . (Join-Path $PSScriptRoot '../../../portal/workers/M365Portal.Workers/Plan-Remediation.ps1')

        function New-Finding {
            param(
                [string]$Id = 'f1',
                [string]$CheckId = 'ENTRA-SECDEFAULT-001',
                [string]$Status = 'Fail'
            )
            return [PSCustomObject]@{ Id = $Id; CheckId = $CheckId; Status = $Status }
        }

        # Resolver seam driven by $script:ResolveMap so each test controls
        # classification without the real registry.
        $script:ResolveMap = @{}
        $script:ResolvedIds = [System.Collections.Generic.List[string]]::new()

        $script:Resolver = {
            param($CheckId)
            $script:ResolvedIds.Add([string]$CheckId) | Out-Null
            $key = [string]$CheckId -replace '\.\d+$', ''
            $entry = if ($script:ResolveMap.ContainsKey($key)) { $script:ResolveMap[$key] }
                     else { @{ mode = 'undetermined'; command = $null; portalPath = $null; steps = @() } }
            return [PSCustomObject]@{
                CheckId        = $CheckId
                RegistryKey    = $key
                Mode           = $entry.mode
                Command        = $entry.command
                PortalPath     = $entry.portalPath
                PortalSteps    = @($entry.steps)
                LicenseMinimum = $null
                Notes          = $null
            }
        }

        $script:GateDecision = 'planned'
        $script:GateReason = ''
        $script:Gate = {
            param($CheckId, $LicenseMinimum)
            return [PSCustomObject]@{
                CheckId  = $CheckId
                Decision = $script:GateDecision
                Reason   = $script:GateReason
            }
        }
    }

    BeforeEach {
        $script:ResolveMap = @{
            'ENTRA-SECDEFAULT-001' = @{ mode = 'automated'; command = 'Set-EntraSecurityDefaultsState'; portalPath = $null; steps = @() }
            'CA-REPORTONLY-001'    = @{ mode = 'manual'; command = $null; portalPath = 'entra/conditional-access'; steps = @('Open portal', 'Toggle setting') }
        }
        $script:ResolvedIds.Clear()
        $script:GateDecision = 'planned'
        $script:GateReason = ''
    }

    It 'selects only Fail, Warning, and Review findings' {
        $findings = @(
            (New-Finding -Id 'f1' -CheckId 'ENTRA-SECDEFAULT-001' -Status 'Fail'),
            (New-Finding -Id 'f2' -CheckId 'CA-REPORTONLY-001' -Status 'Warning'),
            (New-Finding -Id 'f3' -CheckId 'ENTRA-SECDEFAULT-001.1' -Status 'Review'),
            (New-Finding -Id 'f4' -CheckId 'ENTRA-SECDEFAULT-001' -Status 'Pass'),
            (New-Finding -Id 'f5' -CheckId 'ENTRA-SECDEFAULT-001' -Status 'Info'),
            (New-Finding -Id 'f6' -CheckId 'ENTRA-SECDEFAULT-001' -Status 'Skipped')
        )

        $result = New-RemediationPlan -Findings $findings -TenantId 't1' -RunId 'r1' `
            -ResolveRemediation $script:Resolver -EvaluateGate $script:Gate

        $result.Summary.total | Should -Be 3
        $result.Actions.Count | Should -Be 3
        ($result.Plan.findingIds -join ',') | Should -Be 'f1,f2,f3'
    }

    It 'classifies an automated finding with its command and a planned state' {
        $result = New-RemediationPlan -Findings @((New-Finding -CheckId 'ENTRA-SECDEFAULT-001')) `
            -TenantId 't1' -ResolveRemediation $script:Resolver -EvaluateGate $script:Gate

        $action = $result.Actions[0]
        $action.command | Should -Be 'Set-EntraSecurityDefaultsState'
        $action.state | Should -Be 'planned'
        $action.result.mode | Should -Be 'automated'
        $result.Plan.mode | Should -Be 'automated'
        $result.Summary.automated | Should -Be 1
    }

    It 'strips the sub-number for registry lookup but preserves the finding checkId' {
        $result = New-RemediationPlan -Findings @((New-Finding -CheckId 'CA-REPORTONLY-001.2')) `
            -TenantId 't1' -ResolveRemediation $script:Resolver -EvaluateGate $script:Gate

        # The resolver receives the original sub-numbered id; the resolver strips it.
        ($script:ResolvedIds -join ',') | Should -Be 'CA-REPORTONLY-001.2'
        $result.Actions[0].checkId | Should -Be 'CA-REPORTONLY-001.2'
        $result.Actions[0].result.registryKey | Should -Be 'CA-REPORTONLY-001'
    }

    It 'produces a ManualInstruction and a manual action for a portal-only finding' {
        $result = New-RemediationPlan -Findings @((New-Finding -CheckId 'CA-REPORTONLY-001')) `
            -TenantId 't1' -ResolveRemediation $script:Resolver -EvaluateGate $script:Gate

        $action = $result.Actions[0]
        $action.target | Should -Be 'entra/conditional-access'
        $action.command | Should -Be ''
        $action.result.mode | Should -Be 'manual'
        $result.Plan.mode | Should -Be 'manual'

        $result.Instructions.Count | Should -Be 1
        $result.Instructions[0].checkId | Should -Be 'CA-REPORTONLY-001'
        $result.Instructions[0].steps.Count | Should -Be 2
    }

    It 'flags an undetermined finding as a skipped action' {
        $result = New-RemediationPlan -Findings @((New-Finding -CheckId 'UNKNOWN-CHECK-001')) `
            -TenantId 't1' -ResolveRemediation $script:Resolver -EvaluateGate $script:Gate

        $result.Actions[0].state | Should -Be 'skipped'
        $result.Actions[0].result.mode | Should -Be 'undetermined'
        $result.Actions[0].error | Should -Match 'undetermined'
        $result.Summary.undetermined | Should -Be 1
    }

    It 'records a skipped state and the reason when a gate is unmet' {
        $script:GateDecision = 'skipped'
        $script:GateReason = 'not-allowlisted'

        $result = New-RemediationPlan -Findings @((New-Finding -CheckId 'ENTRA-SECDEFAULT-001')) `
            -TenantId 't1' -ResolveRemediation $script:Resolver -EvaluateGate $script:Gate

        $result.Actions[0].state | Should -Be 'skipped'
        $result.Actions[0].error | Should -Be 'not-allowlisted'
        $result.Actions[0].result.gateDecision | Should -Be 'skipped'
        $result.Summary.skipped | Should -Be 1
    }

    It 'reports a mixed plan when automated and manual findings coexist' {
        $result = New-RemediationPlan -Findings @(
            (New-Finding -Id 'f1' -CheckId 'ENTRA-SECDEFAULT-001'),
            (New-Finding -Id 'f2' -CheckId 'CA-REPORTONLY-001')
        ) -TenantId 't1' -ResolveRemediation $script:Resolver -EvaluateGate $script:Gate

        $result.Plan.mode | Should -Be 'mixed'
        $result.Summary.automated | Should -Be 1
        $result.Summary.manual | Should -Be 1
    }

    It 'returns an empty plan for no selected findings' {
        $result = New-RemediationPlan -Findings @((New-Finding -Status 'Pass')) `
            -TenantId 't1' -ResolveRemediation $script:Resolver -EvaluateGate $script:Gate

        $result.Summary.total | Should -Be 0
        $result.Actions.Count | Should -Be 0
        $result.Plan.findingIds.Count | Should -Be 0
    }

    It 'classifies through the real Resolve-Remediation under Set-StrictMode' {
        # Integration check: the default resolver path must not throw on registry
        # entries that omit optional fields (e.g. remediation.notes).
        $result = New-RemediationPlan -Findings @((New-Finding -CheckId 'ENTRA-SECDEFAULT-001.1')) `
            -TenantId 't1' -EvaluateGate $script:Gate

        $result.Actions[0].result.mode | Should -Be 'automated'
        $result.Actions[0].command | Should -Not -BeNullOrEmpty
        $result.Actions[0].result.registryKey | Should -Be 'ENTRA-SECDEFAULT-001'
    }
}

Describe 'plan-remediation entrypoint' {
    BeforeAll {
        $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
        $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/plan-remediation.ps1'
        $script:handler = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Plan-Remediation.ps1'
    }

    It 'exists and is wired to the handler and result envelope' {
        Test-Path -LiteralPath $script:entrypoint -PathType Leaf | Should -BeTrue
        Test-Path -LiteralPath $script:handler -PathType Leaf | Should -BeTrue

        $text = Get-Content -LiteralPath $script:entrypoint -Raw
        $text | Should -Match 'New-RemediationPlan'
        $text | Should -Match 'Write-WorkerResult'
        $text | Should -Match "JobType 'remediation'"
        $text | Should -Match 'remediation-plan\.json'
    }

    Context 'when run on a portal job (T-0836)' {
        BeforeAll {
            function Invoke-PlanEntrypoint {
                param([hashtable]$Caller, [string]$Name)
                $folder = Join-Path -Path $TestDrive -ChildPath $Name
                New-Item -Path $folder -ItemType Directory -Force | Out-Null
                $payload = @{ contextRef = 'x'; outputRef = 'x'; credentialRef = 'x'; sectionRefs = @(); artifactRefs = @(); operation = 'plan'; planId = 'plan-1'; createdBy = 'user-1' }
                if ($Caller) { $payload['caller'] = $Caller }
                $job = @{ schemaVersion = 'v1'; jobId = 'job-1'; jobType = 'remediation'; tenantId = 't-a'; runId = 'run-1'; requestId = 'req-1'; correlationId = 'corr-1'; createdAt = '2026-09-27T00:00:00.000Z'; payload = $payload }
                $jobFile = Join-Path -Path $folder -ChildPath 'job.json'
                $job | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $jobFile
                $findingsFile = Join-Path -Path $folder -ChildPath 'findings.json'
                ConvertTo-Json -InputObject @(@{ id = 'run-1:0'; checkId = 'ENTRA-SECDEFAULT-001.1'; status = 'Fail' }) | Set-Content -LiteralPath $findingsFile
                $out = Join-Path -Path $folder -ChildPath 'out'
                & pwsh -NoProfile -File $script:entrypoint -JobFile $jobFile -OutputFolder $out -FindingsFile $findingsFile | Out-Null
                Get-Content -LiteralPath (Join-Path -Path $out -ChildPath 'remediation-plan.json') -Raw | ConvertFrom-Json
            }
        }

        It 'keeps the portal plan id and author' {
            $plan = Invoke-PlanEntrypoint -Name 'ids'
            $plan.Plan.id | Should -Be 'plan-1'
            $plan.Plan.createdBy | Should -Be 'user-1'
        }

        It 'rejects every action when the job carries no caller' {
            $plan = Invoke-PlanEntrypoint -Name 'no-caller'
            $plan.Actions[0].error | Should -Be 'rbac-denied'
        }

        It 'passes the caller''s apply right and scope to the gate' {
            $caller = @{ canApply = $true; tenantScope = @{ all = $false; tenantIds = @('t-a') } }
            $plan = Invoke-PlanEntrypoint -Name 'caller' -Caller $caller
            $plan.Actions[0].error | Should -Not -Be 'rbac-denied'
            $plan.Actions[0].error | Should -Not -Be 'tenant-out-of-scope'
        }
    }
}
