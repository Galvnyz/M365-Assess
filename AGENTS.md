# M365-Assess contributor guidance

M365-Assess is a PowerShell module for read-only Microsoft 365 security assessments.
It produces HTML, XLSX, and JSON evidence. Start with [README.md](README.md) and the
[documentation index](docs/INDEX.md). Dated research is historical context, not the
current implementation contract.

## Sources of truth

- Version and dependencies: `src/M365-Assess/M365-Assess.psd1`.
- Entry point: `src/M365-Assess/Invoke-M365Assessment.ps1`.
- Connections, permissions, and execution: `src/M365-Assess/Orchestrator/`.
- Collector contract: `src/M365-Assess/Common/SecurityConfigHelper.ps1`.
- Check metadata and mappings: `src/M365-Assess/controls/`.
- Generated coverage: [docs/reference/COVERAGE.md](docs/reference/COVERAGE.md).
- Validation gates: `.github/workflows/ci.yml` and `PSScriptAnalyzerSettings.psd1`.
- Decisions: [docs/user/ASSESSOR-DECISIONS.md](docs/user/ASSESSOR-DECISIONS.md).

Avoid copying changing check counts, file lengths, or versions into guidance.

## Collector and evidence conventions

Use shared `Initialize-SecurityConfig`, `Add-Setting`, and
`Export-SecurityConfigReport` functions for security checks. Stored CheckIds may
have numeric suffixes; select test findings by Setting or explicitly account for
suffixes rather than assuming an unchanged base CheckId.

Supported statuses are `Pass`, `Fail`, `Warning`, `Review`, `Info`, `Skipped`,
`Unknown`, `NotApplicable`, and `NotLicensed`. Failed collection must not become a
Pass or silently disappear. Assessor decisions preserve collected observations.

Use the shared Graph helper for pagination/retry. Keep endpoints and authentication
compatible with supported clouds. New checks need registry metadata, applicable
licensing/severity data, and meaningful regression coverage. Use synthetic fixtures.

## CheckID synchronization

Use tagged CheckID releases, never upstream main. The dedicated
`.github/workflows/sync-checkid.yml` runs on release dispatch or manual invocation.
Scheduled CI's fallback is a separate drift check, not a publishing sync.

Preserve M365 scope in `controls/sync-scope.json`, local extensions in
`controls/local-extensions.json`, and local overlays/taxonomy. Never commit an
unpartitioned upstream registry. Review preservation logic for new local extensions
and regenerate affected documentation.

## Validation

Use PowerShell 7 (`pwsh`) from the repository root. CI pins Pester 5.7.1; load it
explicitly rather than relying on an older installed default.

```powershell
Import-Module Pester -RequiredVersion 5.7.1 -Force
Invoke-Pester -Path './tests' -Output Detailed
Invoke-ScriptAnalyzer -Path './src/M365-Assess' -Recurse -Settings './PSScriptAnalyzerSettings.psd1'
```

Scope development tests to affected domains; follow CI for full coverage and
release gates. For report/build-tool changes run `npm ci`, `npm test`, and
`npm run build`; commit the generated bundle when it changes.

Run source assessments in a fresh PowerShell process after edits to avoid stale
module state. Follow the documented import workflow; importing is not prohibited.

## Change and release discipline

- Do not change the module version without explicit maintainer approval.
- Follow manifest, README badge, changelog, and workflow consistency checks for
  approved releases. Runtime version readers use the manifest.
- Use pull requests; never force-push main.
- Keep tenant identifiers, credentials, assessment outputs, and unredacted logs
  out of commits, issues, and PRs.
- Preserve unrelated local work and use recoverable backups before cleanup.
- Keep AI-tool names out of branch names, commit messages, and PR titles/bodies.
- Do not assume private rule files or agent definitions exist outside this repo.
