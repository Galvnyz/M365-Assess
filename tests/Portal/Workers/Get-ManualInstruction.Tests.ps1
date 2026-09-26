# Get-ManualInstruction.Tests.ps1
# Pester tests for T-0106 — manual instruction rendering.
# Asserts: a doc's portal path + numbered steps; registry fallback when no doc
# exists; the empty state when neither is present; sub-numbered ids resolve to
# the same instruction as their base id.

#Requires -Module Pester
Set-StrictMode -Version Latest

Describe 'Get-ManualInstruction' {
    BeforeAll {
        . (Join-Path $PSScriptRoot '../../../portal/workers/M365Portal.Workers/Get-ManualInstruction.ps1')

        $script:manualRoot = Join-Path $TestDrive 'manual'
        New-Item -Path $script:manualRoot -ItemType Directory -Force | Out-Null

        $docWithPortalPath = @'
# TEST-CHECK-001 — Enable the thing

- **Mode:** manual
- **Portal path:** Test Admin Center > Settings > Thing

## Steps

1. Open the Test Admin Center.
2. Go to Settings > Thing.
3. Toggle it on.

## Notes / caveats

- Disruptive; communicate first.

## Verification

- Re-run the collector.
'@
        Set-Content -LiteralPath (Join-Path $script:manualRoot '001-TEST-CHECK-001.md') -Value $docWithPortalPath -Encoding UTF8

        $docWithoutPortalPath = @'
# TEST-NOPATH-001 — Do the manual thing

## Steps

1. First step.
2. Second step.
'@
        Set-Content -LiteralPath (Join-Path $script:manualRoot '002-TEST-NOPATH-001.md') -Value $docWithoutPortalPath -Encoding UTF8
    }

    It 'parses the portal path and numbered steps from a doc' {
        $result = Get-ManualInstruction -CheckId 'TEST-CHECK-001' -ManualRoot $script:manualRoot

        $result.Source | Should -Be 'doc'
        $result.Empty | Should -BeFalse
        $result.PortalPath | Should -Be 'Test Admin Center > Settings > Thing'
        $result.Steps.Count | Should -Be 3
        $result.Steps[0] | Should -Be 'Open the Test Admin Center.'
        $result.Steps[2] | Should -Be 'Toggle it on.'
        $result.Notes | Should -Match 'Disruptive'
    }

    It 'parses steps when the doc has no portal path bullet' {
        $result = Get-ManualInstruction -CheckId 'TEST-NOPATH-001' -ManualRoot $script:manualRoot

        $result.Source | Should -Be 'doc'
        $result.Steps.Count | Should -Be 2
        $result.Steps[1] | Should -Be 'Second step.'
        $result.PortalPath | Should -BeNullOrEmpty
    }

    It 'resolves a sub-numbered id to the same instruction as its base id' {
        $base = Get-ManualInstruction -CheckId 'TEST-CHECK-001' -ManualRoot $script:manualRoot
        $sub = Get-ManualInstruction -CheckId 'TEST-CHECK-001.3' -ManualRoot $script:manualRoot

        $sub.Source | Should -Be 'doc'
        $sub.RegistryKey | Should -Be 'TEST-CHECK-001'
        $sub.Steps.Count | Should -Be $base.Steps.Count
        $sub.PortalPath | Should -Be $base.PortalPath
        # The requested id is preserved on the result even though the doc is shared.
        $sub.CheckId | Should -Be 'TEST-CHECK-001.3'
    }

    It 'falls back to the registry when no doc exists' {
        # ENTRA-SECDEFAULT-001 has no doc in the isolated TestDrive root, so the
        # registry supplies the portal path/steps.
        $result = Get-ManualInstruction -CheckId 'ENTRA-GUEST-001' -ManualRoot $script:manualRoot

        $result.Source | Should -Be 'registry'
        $result.Empty | Should -BeFalse
        $result.PortalPath | Should -Not -BeNullOrEmpty
    }

    It 'returns the empty state when neither a doc nor registry instructions exist' {
        $result = Get-ManualInstruction -CheckId 'NOT-A-REAL-CHECK-999' -ManualRoot $script:manualRoot

        $result.Source | Should -Be 'none'
        $result.Empty | Should -BeTrue
        $result.PortalPath | Should -BeNullOrEmpty
        $result.Steps.Count | Should -Be 0
    }

    It 'uses the real shipped manual doc for ENTRA-SECDEFAULT-001' {
        $result = Get-ManualInstruction -CheckId 'ENTRA-SECDEFAULT-001'

        $result.Source | Should -Be 'doc'
        $result.Empty | Should -BeFalse
        $result.Steps.Count | Should -BeGreaterThan 0
        $result.DocPath | Should -Match '001-ENTRA-SECDEFAULT-001\.md'
        # The doc carries steps but no portal-path bullet; the registry fills it.
        $result.PortalPath | Should -Not -BeNullOrEmpty
    }
}

Describe 'get-remediation-instruction entrypoint' {
    BeforeAll {
        $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
        $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/get-remediation-instruction.ps1'
        $script:handler = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Get-ManualInstruction.ps1'
    }

    It 'exists and is wired to the handler and result envelope' {
        Test-Path -LiteralPath $script:entrypoint -PathType Leaf | Should -BeTrue
        Test-Path -LiteralPath $script:handler -PathType Leaf | Should -BeTrue

        $text = Get-Content -LiteralPath $script:entrypoint -Raw
        $text | Should -Match 'Get-ManualInstruction'
        $text | Should -Match 'Write-WorkerResult'
        $text | Should -Match "JobType 'remediation'"
        $text | Should -Match 'manual-instruction\.json'
    }
}
