# 0002 — Auto sub-number CheckIds at the setting level

- **Status:** Accepted
- **Date:** 2026-05-06

## Context

CheckID upstream gives one identifier per *check* — a control-level concept (e.g. `CA-REPORTONLY-001` for "Conditional Access policies are not stuck in report-only mode"). But what M365-Assess actually emits to the report is a stream of *settings* — individual evaluations against a single tenant artifact. A single CheckID upstream check often expands to many setting-level findings: the report-only check runs once per CA policy, the PIM eligibility check runs once per privileged role, the SPO sharing check runs once per top-level setting.

We needed each setting-level finding to be:

- Distinguishable in the HTML/XLSX reports (so a user can point at "this exact row").
- Traceable back to its parent CheckID upstream control (for framework mapping, remediation guidance, registry licensing rules).
- Stable across runs against the same tenant (so a baseline diff isn't dominated by spurious ID churn).

We also wanted to do this **without forking the upstream registry** — adding 50+ synthetic IDs per check upstream to cover every possible setting permutation would be impossible to maintain and would diverge wildly from CheckID's control-centric model.

## Decision

`Add-SecuritySetting` (in `Common/SecurityConfigHelper.ps1`) auto-suffixes the upstream `CheckId` with a `.N` counter, where `N` increments each time the same base CheckId is recorded within a single assessment run. The counter lives on a `CheckIdCounter` hashtable owned by the collector context.

Example: a single `CA-REPORTONLY-001` upstream check becomes `CA-REPORTONLY-001.1`, `CA-REPORTONLY-001.2`, ... in the emitted report — one sub-numbered row per CA policy evaluated.

The base ID before the dot is what the registry, framework matrix, licensing overlay, and remediation lookups all key on. The full sub-numbered ID is what shows up in the report, the adoption-signals hashtable, and the progress tracker.

See: [`src/M365-Assess/Common/SecurityConfigHelper.ps1`](../../src/M365-Assess/Common/SecurityConfigHelper.ps1) (function `Add-SecuritySetting`).

## Consequences

**Positive**

- One CheckID upstream control can fan out to N setting-level findings without touching the registry.
- Reports show distinct rows users can click into, while the "Group by CheckId base" view still rolls them up correctly.
- Registry lookups (frameworks, severity, remediation, licensing) work on the base ID — no duplication needed.
- Counter state is per-collector-context (not global), so collectors don't cross-contaminate.

**Negative**

- Sub-numbering is **order-dependent** within a run — `CA-REPORTONLY-001.1` is "the first CA policy the collector saw", not a stable property of any specific policy. Two runs against the same tenant can shuffle if the upstream Graph response order changes. Baseline diffing has to key on the underlying object (policy displayName, role definition ID, etc.), not on the sub-numbered CheckId.
- Test code has to filter by `$_.Setting` (human-readable name) NOT by `$_.CheckId`, since the stored CheckId is the sub-numbered form. This footgun has burned us; CLAUDE.md and `.claude/rules/pester.md` both warn against it.
- Anyone reading raw CSV output sees `.1`/`.2`/`.3` suffixes that aren't documented in the upstream CheckID schema. The report layer hides this; CSV consumers see it.

**Failure modes and mitigations**

- *Test filters by sub-numbered CheckId* → tests pass on first add, fail when a second is added. Caught by `.claude/rules/pester.md` rule and reinforced in CLAUDE.md.
- *Adoption-signal lookup uses base ID instead of sub-numbered ID* → returns null silently; mitigated by keying adoption signals on the sub-numbered ID and consumers iterating instead of point-looking-up.
- *Order shuffle between runs* → handled by baseline diff keying on stable identifiers (object name/ID), not on the sub-numbered CheckId.

## Alternatives considered

- **One row per upstream CheckId, with all settings concatenated into a single Evidence field.** Rejected: makes the report illegible and breaks per-finding remediation, status, and framework mapping.
- **Mint bespoke local CheckIds for every setting permutation.** Rejected: combinatorial explosion (CIS lists *one* check for "MFA enforced for admins"; in practice we evaluate 6 admin roles × 4 policy types). Local IDs would also drift from upstream and make framework mapping a nightmare.
- **Push the sub-numbered IDs upstream into CheckID.** Rejected: the upstream model is deliberately control-centric; sub-numbering is an artifact of how we *evaluate* a control, not a property of the control itself. CheckID stays clean if this transformation lives downstream.
- **Use a separate ID column (e.g. `FindingId`) alongside the unmodified `CheckId`.** Considered. Rejected for now because every existing consumer (report templates, baseline diff, adoption signals, progress tracker) already keys on the suffixed CheckId; a parallel column would double the write paths without removing the old one. Worth revisiting if we ever break the report contract for v3.

---

## See also

- [`../../src/M365-Assess/Common/SecurityConfigHelper.ps1`](../../src/M365-Assess/Common/SecurityConfigHelper.ps1) — `Add-SecuritySetting` (the sub-numbering logic)
- [`../../.claude/rules/pester.md`](../../.claude/rules/pester.md) — the test-filtering rule this decision implies
- [`../dev/CheckId-Guide.md`](../dev/CheckId-Guide.md) — naming + numbering conventions
- [`README.md`](README.md) — back to the ADR index
