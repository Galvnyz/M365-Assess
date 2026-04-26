# Test fixtures

JSON snapshots of typical Graph / EXO / Intune responses, used by mocked-cmdlet tests so the existing collectors can be tested without a live tenant.

## Layout

```
tests/Fixtures/
├── Graph/         Microsoft Graph API responses (Get-MgUser, Get-MgSubscribedSku, etc.)
├── Exchange/      Exchange Online cmdlet outputs (Get-OrganizationConfig, Get-Mailbox, etc.)
├── Intune/        Microsoft Graph DeviceManagement responses
└── Reports/       Full-tenant fixtures used by end-to-end report tests
```

## Naming convention

`<resource>-<scenario>.json` — for example:

- `Graph/users-empty.json` — empty tenant, zero users
- `Graph/users-normal.json` — 5-10 users with realistic property mix
- `Graph/users-throttled.json` — represents a 429 throttle response (used to test retry behavior)
- `Graph/users-missing-permission.json` — represents a 403 (used to test the `Unknown` status path)

## Loading a fixture

```powershell
BeforeAll {
    . (Join-Path $PSScriptRoot '../../src/M365-Assess/Entra/Get-MfaReport.ps1')

    # Load a fixture file. $PSScriptRoot resolves to tests/<Domain>/.
    $fixturePath = Join-Path $PSScriptRoot '../Fixtures/Graph/users-normal.json'
    $script:users = Get-Content $fixturePath -Raw | ConvertFrom-Json
}

Describe 'Get-MfaReport' {
    It 'should classify users by MFA strength' {
        Mock Get-MgUser { return $script:users }
        $result = Get-MfaReport
        $result | Should -Not -BeNullOrEmpty
    }
}
```

## Why fixtures vs. inline mocks

Inline `Mock Get-MgUser { return @(@{...}, @{...}) }` is fine for one-off tests, but:

- **Real-shape coverage**: fixtures use the actual property names + types Graph returns (PascalCase, GUID strings, DateTime serializations). Inline mocks tend to drift toward simpler PowerShell-friendly shapes.
- **Reusability**: one fixture file feeds N tests. Editing the canonical "what does a normal tenant's user list look like" lives in one place.
- **Cross-platform CI** (B6 #777): the smoke lane on ubuntu/macos can run report-generation tests against checked-in fixtures without needing live-tenant access.
- **Per-scenario testing**: switching from `users-normal.json` to `users-throttled.json` in a single line lets a test exercise different error paths without rewriting the mock setup.

## Line endings

`.gitattributes` pins `tests/Fixtures/**/*.json` to LF so JSON parsing and any SHA-based comparisons stay deterministic across Windows / Linux / macOS runners.

## Adding a new fixture

1. Decide which API + scenario the fixture represents
2. Capture a real response (or hand-author one based on Microsoft Learn API docs) — strip any tenant-specific identifiers, replace with `00000000-0000-0000-0000-000000000000`-style placeholders
3. Pretty-print the JSON for review (`ConvertTo-Json -Depth 10`) and commit
4. Update at least one test to use it; verify with `Invoke-Pester`
5. Reference the fixture from `docs/TESTING.md`'s fixtures section if it represents a new error-path category

## Related

- [`docs/TESTING.md`](../../docs/TESTING.md) — testing conventions, including fixture pattern
- B6 #777 (cross-platform smoke lane) consumes fixtures for tenant-free report generation
- C5 #784 (behavioral tests) — behavior tests assert invariants across all collectors; some use fixtures for repeatable inputs
