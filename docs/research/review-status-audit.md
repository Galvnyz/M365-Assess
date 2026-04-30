# Audit: Review / Unknown / Skipped status emissions

Surfaced by issue #884. After PR #885 (#883 SPO-AUTH-001) discovered a check that ALWAYS returned `Review` due to a single-character property-name typo, the question became: **how many other checks return `Review` / `Unknown` / `Skipped` for reasons that look like "we couldn't measure" but are actually "the collector has a bug"?**

## Empirical scan

Snapshot taken 2026-04-30 from `src/M365-Assess/**/*.ps1`:

```powershell
Get-ChildItem -Path 'src/M365-Assess' -Recurse -Filter '*.ps1' |
    Select-String -Pattern "Status\s*=\s*'(Review|Unknown|Skipped)'"
```

| Status | Emissions | What it should mean |
|---|---|---|
| `Review` | 68 | Data was collected but a human needs to interpret the result. |
| `Skipped` | 28 | The check did not run (license-gated, permission-gated, or env-not-applicable). |
| `Unknown` | 1 | Data could not be collected; this is different from "Skipped". |
| **Total** | **97** | |

Per-collector breakdown:

| Collector | Review | Skipped | Unknown |
|---|---|---|---|
| `Entra/EntraUserGroupChecks.ps1` | 0 | 22 | 0 |
| `Entra/EntraPasswordAuthChecks.ps1` | 7 | 0 | 0 |
| `Entra/EntraAdminRoleChecks.ps1` | 5 | 0 | 1 |
| `Collaboration/Get-SharePointSecurityConfig.ps1` | 4 | 0 | 0 |
| `Exchange-Online/Get-DnsSecurityConfig.ps1` | 4 | 0 | 0 |
| `Exchange-Online/Get-ExoSecurityConfig.ps1` | 5 | 0 | 0 |
| `Collaboration/Get-TeamsSecurityConfig.ps1` | 2 | 0 | 0 |
| `Entra/Get-CASecurityConfig.ps1` | 2 | 0 | 0 |
| various Intune, Compliance, Defender collectors | ~30 | ~6 | 0 |

(Full per-site table available via `Get-ChildItem -Path 'src/M365-Assess' -Recurse -Filter '*.ps1' | Select-String -Pattern "Status\s*=\s*'(Review|Unknown|Skipped)'"`. Snapshot is intentionally not committed — it would rot quickly.)

## Triage classification

For each emission site, the question is one of three things:

| Class | Meaning | Action |
|---|---|---|
| **Genuine limitation** | The data truly isn't measurable via API (paper-trail process, manual attestation, license-gated and we correctly detected the gap). | Leave as-is. Surface clearly to user via CurrentValue. May feed into the attestation flow (#875). |
| **Collector bug** | API exposes the data but the collector queries the wrong field, the wrong endpoint, or doesn't handle the response correctly. | File as bug, fix in collector. |
| **Triage pending** | Need to investigate the specific check before classifying. | Schedule into ongoing v2.11.0 work. |

## Known examples

### Confirmed bugs (since fixed)

- **SPO-AUTH-001** (#883) — collector queried `legacyAuthProtocolsEnabled` when the v1.0 Graph property is `isLegacyAuthProtocolsEnabled`. Always returned Review with "Not available via API". Fixed in v2.10.1.
- **ENTRA-PIM-001** (#886) — collector queried only PIM-managed schedule instances, blind to direct GA assignments. Tenants without PIM onboarded passed incorrectly. Fixed via PR #890.

### Confirmed genuine limitations

- **`EntraUserGroupChecks.ps1` Skipped emissions (22 sites)** — most are conditional on Graph permissions or specific service-plan licensing. Skipped is the correct status for those scenarios.
- **EXO checks that depend on Connect-ExchangeOnline** — when EXO module isn't connected, checks Skip. Correct.

### Triage pending (representative — not exhaustive)

- `EntraPasswordAuthChecks.ps1` — 7 Review emissions; some may be the same shape as ENTRA-SSPR-001 (semantic mismatch with upstream registry name) — see #878.
- `Exchange-Online/Get-DnsSecurityConfig.ps1` — 4 Review emissions; verify whether they're genuinely manual-validation or if a Graph endpoint would resolve them.
- `Get-CASecurityConfig.ps1` — 2 Review emissions; given the CA admin-center reorg + #879 path rot, worth confirming the collector's data path.

## Lock-down regression

`tests/Behavior/Status-Emission-Audit.Tests.ps1` asserts the count of Review / Unknown / Skipped emissions stays at or below the current ceiling (68 / 28 / 1 = 97 total). When a new emission is added the test fails, forcing the contributor to:

1. Justify the new emission (genuine limitation? collector bug?)
2. Update this doc to add the new site to the audit catalogue
3. Bump the ceiling in the test

Without this guardrail, "I couldn't measure it, returning Review" silently accumulates in the codebase. The lock-down doesn't fix existing emissions — those are the ongoing audit work. It prevents the surface from growing unaudited.

## Workflow for individual audits

When a contributor (or a reader of customer reports) flags a specific Review/Unknown/Skipped emission:

1. **Reproduce**: identify the CheckId, the collector file/line, and the Graph endpoint being queried.
2. **Investigate**: does Graph (v1.0 or beta) expose the data? Run the query manually against a test tenant.
3. **Classify**:
   - If the property exists and the collector queries it incorrectly → **Collector bug**, file as bug issue, fix.
   - If the property exists but only with a different scope/license that we don't currently require → consider whether to add the scope/license guard, treat as Skipped.
   - If no Graph endpoint exists → **Genuine limitation**, document clearly.
4. **Update this doc**: add the audited check to the "Confirmed bugs" or "Confirmed genuine limitations" section.
5. **If the emission count drops** (a Review converted to Pass/Fail): update the lock-down ceiling in the regression test.

## Out of scope

Per-check exhaustive triage of all 97 emissions is multi-day content work. This PR delivers:
- The audit catalogue + classification framework (this doc)
- The lock-down Pester regression
- A handful of representative known-bug + known-limitation examples

Per-check triage of the remaining ~85 emissions is ongoing v2.11.0 (or follow-up milestone) work, filed as bug issues as they're triaged.

## Sources

- `src/M365-Assess/**/*.ps1` — empirical scan
- `docs/CHECK-STATUS-MODEL.md` — canonical status-value semantics (defines what each status MEANS)
- Issue #884 (this audit) + #875 (interactive attestation, downstream consumer of the "genuine limitation" subset)
