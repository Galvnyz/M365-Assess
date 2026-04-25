# Public API surface decision (C3)

**Status:** Recommendation pending user ratification. 2026-04-25 (Issue #782, milestone v2.9.0 — Trust Hardening).

**Recommendation:** Adopt model (a) **Invoke-only collectors** — remove the 13 `Get-M365*SecurityConfig` / `Get-M365*RetentionConfig` wrappers and route all collector access through `Invoke-M365Assessment -Section`. Operational cmdlets (Invoke, Compare-Baseline, Grant-Consent, the four profile cmdlets) stay public.

---

## Problem

The current public API has uneven coverage of the underlying collector surface:

| Surface | Count |
|---|---|
| Collector `.ps1` files in domain folders | 69 |
| Public collector wrappers in `M365-Assess.psm1` | 13 |
| Coverage | 19% |

The 13 wrappers are thin pass-throughs — each is a `[CmdletBinding()]` shell that splats `$PSBoundParameters` into `& "$PSScriptRoot\<domain>\<script>.ps1"`. They expose only `-OutputPath` (and in one case `-AcceptedDomains` / `-DkimConfigs`).

The middle ground is hard to defend:

- Users can't tell which collectors have wrappers without reading the manifest
- Wrappers don't add value beyond what `Invoke-M365Assessment -Section <X>` already provides
- Every wrapper is a versioning commitment — its parameter set becomes part of the public API
- Adding a new collector creates a tooling-versus-policy decision: do we wrap it? what's the rule?

The 2026-04-25 external review (§13) flagged this and asked for a clear model.

## Two viable models

### (a) Invoke-only collectors *(recommended)*

Remove the 13 collector wrappers. The public API becomes:

- `Invoke-M365Assessment` — single entry point; `-Section <Identity|Email|Security|...>` selects collector groups
- `Compare-M365Baseline` — drift comparison
- `Grant-M365AssessConsent` — setup helper
- `Get-M365ConnectionProfile`, `New-M365ConnectionProfile`, `Set-M365ConnectionProfile`, `Remove-M365ConnectionProfile` — connection profile management

7 public cmdlets. Collectors are internal scripts only.

**Pros**
- One supported entry point reduces docs surface, test surface, and PSGallery release-note surface
- `-Section` is already the documented public path for "run a subset of collectors"
- Removes 13 wrappers + 13 wrapper-test scaffolds
- Adding a new collector is purely internal; no public-API decision

**Cons**
- Breaking change for anyone calling `Get-M365EntraSecurityConfig` etc. directly (population unknown — likely small)
- Loses ability to invoke a single collector with no orchestration overhead (connection prefetch, registry load) — a use case more relevant to internal debugging than end-user workflows

**Migration path**
1. Publish a deprecation notice in v2.9.0 release notes
2. Keep the wrappers in v2.9.x with a `Write-Warning` directing users to `Invoke-M365Assessment -Section`
3. Remove wrappers in v3.0.0 (next major)

### (b) Full collector coverage

Generate a `Get-M365*` wrapper for every collector — ~56 new wrappers added to the existing 13.

**Pros**
- Consistent: every collector is reachable as a module-level cmdlet
- Power users / consultants get fine-grained access without `Invoke-M365Assessment`'s orchestration

**Cons**
- ~56 new wrappers to write, document, test, and maintain
- Each wrapper is a public API commitment forever
- Most wrappers will have identical signatures (`-OutputPath` only) so the duplication is mechanical rather than informative
- Adding a new collector requires shipping a wrapper alongside it — slows feature work

## Why we recommend (a)

1. **The 13 existing wrappers don't add user value.** They're equivalent to `Invoke-M365Assessment -Section <one collector>`. The orchestrator path is the documented public path; the wrappers compete with it.

2. **Population of users calling wrappers directly is small.** The dominant usage pattern is `Invoke-M365Assessment` (interactive wizard or non-interactive consultant runs). Wrappers exist mostly because they were added incrementally without a model decision.

3. **Maintenance asymmetry.** Removing 13 is small, well-scoped work. Adding 56 is a refactor that introduces 56 new public-API commitments without a clear consumer.

4. **`-Section` is more flexible than wrappers.** A wrapper exposes one collector; `-Section Identity` runs the whole identity batch with shared connection setup, registry loading, and reporting plumbing.

## Open questions for ratification

1. **Are there known external consumers of the 13 wrappers?** If so, the v2.9.x deprecation window may need to be longer than one release.

2. **Should the wrappers be deprecated immediately or carry the warning for a full minor cycle?** Recommendation: warn in v2.9.0, remove in v3.0.0.

3. **Should `Compare-M365Baseline` stay public, or fold into `Invoke-M365Assessment -Compare`?** Out of scope for this issue, but worth noting — the same uneven-surface argument applies.

## Implementation plan (if (a) is ratified)

1. Add a `Write-Warning` deprecation banner to each of the 13 wrapper functions in `M365-Assess.psm1`
2. Remove wrapper entries from `FunctionsToExport` in `M365-Assess.psd1`
3. Remove wrapper entries from `Export-ModuleMember` in `M365-Assess.psm1`
4. Remove the wrapper definitions themselves
5. Update `tests/` — remove wrapper-specific tests; keep collector-script tests intact
6. Update `cmdlet-reference.md` to reflect the trimmed public surface
7. Update README "Public Cmdlets" section
8. Note the deprecation in `CHANGELOG.md` v3.0.0 entry

## Related

- Issue #782
- External review at `M365-Assessment/reviews/2026-04-25_repo-review.md`, §13
- Module loader decision: `loader.md` (companion)
