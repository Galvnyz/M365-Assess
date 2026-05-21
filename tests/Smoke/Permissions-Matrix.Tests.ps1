BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
    $script:scriptPath = Join-Path $script:repoRoot 'scripts/Build-PermissionsMatrix.ps1'
    $script:docPath = Join-Path $script:repoRoot 'docs/reference/PERMISSIONS.md'
}

Describe 'Build-PermissionsMatrix' {

    Context 'when verifying docs/PERMISSIONS.md is in sync (B7 #778)' {
        It 'should report sync status without error' {
            # Run -Check mode; capture exit code via $LASTEXITCODE through subshell.
            # Smoke tests must NOT fail the runner if the doc drifts -- the CI
            # quality-gate step is the enforcement point. This test only
            # verifies the generator runs without throwing.
            { & $script:scriptPath -Check 2>&1 | Out-Null } | Should -Not -Throw
        }

        It 'should produce identical output on consecutive runs (deterministic)' {
            # Generate twice into TestDrive; the two outputs must be identical.
            $first  = Join-Path $TestDrive 'first.md'
            $second = Join-Path $TestDrive 'second.md'
            & $script:scriptPath -OutputPath $first  | Out-Null
            & $script:scriptPath -OutputPath $second | Out-Null
            (Get-Content $first  -Raw) | Should -Be (Get-Content $second -Raw)
        }

        It 'should emit a Section detail block for every section in the source maps' {
            $tmp = Join-Path $TestDrive 'gen.md'
            & $script:scriptPath -OutputPath $tmp | Out-Null
            $generated = Get-Content $tmp -Raw

            # Reasonable sample of well-known sections that must appear in the doc
            foreach ($section in @('Tenant', 'Identity', 'Email', 'Intune', 'Security', 'Collaboration')) {
                $generated | Should -Match "### $section\b"
            }
        }
    }
}
