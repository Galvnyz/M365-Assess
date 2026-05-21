# 0004 — Keep the licensing overlay separate from the upstream registry

- **Status:** Accepted
- **Date:** 2026-05-06

## Context

CheckID v2.0.0 carries license-tier information at a deliberately coarse granularity: each check declares `licensing.minimum` as `"E3"` or `"E5"` (or omits it entirely). That's the right level of abstraction for CheckID — it's a vendor-agnostic compliance project, and "this check requires E5" is enough for most consumers.

M365-Assess needs more precision than that. To decide whether to *run* a check on a given tenant, we need to know which **exact Microsoft service plan IDs** it depends on:

- "PIM eligibility" requires `AAD_PREMIUM_P2` specifically — Entra ID P2, not just any E5 SKU.
- "Defender Safe Attachments" requires `ATP_ENTERPRISE` — Defender for Office Plan 2, which can ship with E5 *or* be purchased standalone.
- "Customer Lockbox" requires `LOCKBOX_ENTERPRISE` — bundled into E5 but not the only path to having it.

A coarse "E5" gate would either:
- Skip checks on tenants that have the right add-on but no full E5 (false negative — we miss findings the customer wanted).
- Run checks on tenants with E5 but missing the specific add-on (false positive — checks throw "Forbidden" or return empty data we mis-interpret as `Pass`).

We could fix this by adding `requiredServicePlans` arrays to the upstream registry. We deliberately don't, because:

1. CheckID is a public project with non-Microsoft consumers; pushing M365-specific service plan IDs into upstream entries is a layering violation.
2. The mapping changes faster than the underlying check — Microsoft renames service plans, splits them, retires them. Decoupling lets us update overlay precision without re-syncing CheckID.
3. We sync from CheckID **tagged releases** (see [ADR-0001](0001-checkid-sync-vs-fork.md)). A registry edit to add service plan IDs would be either lost on next sync (if applied locally) or require maintaining a fork (which 0001 explicitly rejected).

## Decision

Maintain `controls/licensing-overlay.json` as a separate file, owned by M365-Assess, never touched by the CheckID sync workflow. Its shape:

```json
{
  "checks": {
    "ENTRA-PIM-001": ["AAD_PREMIUM_P2"],
    "DEFENDER-SAFEATTACH-001": ["ATP_ENTERPRISE"],
    "...": ["..."]
  }
}
```

Resolution semantics (in `Common/Import-ControlRegistry.ps1`):

1. Load `registry.json` (synced from CheckID).
2. Load `licensing-overlay.json` (local).
3. For each check, if the overlay has an entry → use those service plan IDs. Else if the upstream check has v1.x-style `requiredServicePlans` → use that. Else → empty array (runs on all tenants).
4. The runtime gating logic only consults the merged result; it never sees `licensing.minimum`.

Checks **omitted from the overlay** run on all tenants regardless of license. This is the conservative default: we'd rather emit a finding the user can ignore than silently skip a check.

See: [`src/M365-Assess/controls/licensing-overlay.json`](../../src/M365-Assess/controls/licensing-overlay.json) and the merge logic in [`src/M365-Assess/Common/Import-ControlRegistry.ps1`](../../src/M365-Assess/Common/Import-ControlRegistry.ps1).

## Consequences

**Positive**

- CheckID sync is one-directional and doesn't trample license data. Sync PRs are diff-readable because they only ever change upstream-owned files.
- We can refine service plan IDs (add a new SKU mapping, fix a wrong plan ID) with a single-file PR, no CheckID release dependency.
- `NotLicensed` status is meaningful: it's keyed on a specific service plan we know we depend on, not on a coarse tier guess.
- New checks default to "runs everywhere" rather than "skipped because no overlay entry" — fail-open posture matches the conservative-assessment goal.

**Negative**

- Two files to maintain instead of one. When CheckID adds a new E5 check, someone has to remember to add the overlay entry — there's no schema-level enforcement that "every E5-tier upstream check has an overlay row".
- The split makes it harder for a contributor reading `registry.json` to understand "what does this check actually need?" — they have to cross-reference the overlay file.
- Service plan IDs are not human-readable (`AAD_PREMIUM_P2`, `ATP_ENTERPRISE` etc.). Without a comment column in the JSON, the overlay file is opaque to non-Microsoft-internal readers.
- We lose CheckID's `licensing.minimum` signal entirely in the runtime path — if a future check arrives upstream with `minimum: "E5"` but no overlay row, we'll happily run it against an E1 tenant, which may produce noise.

**Failure modes and mitigations**

- *Upstream adds a new E5 check; we forget the overlay row* → check runs on E1 tenants, returns "Forbidden" or empty data, lands as `Fail`/`Unknown`. Mitigation: a sync-PR review step where a human eyeballs new check IDs against the overlay (currently manual; could be automated by diffing `registry.json` for new IDs and warning if they have `minimum: "E5"` and no overlay entry).
- *Service plan ID renamed by Microsoft* → overlay entry stops matching tenant licenses, check runs on tenants that shouldn't run it (or skips on tenants that should). Mitigation: covered by integration test fixtures in `tests/Common/Test-ServicePlanResolution`, plus the sku-feature-map sync from CheckID.
- *Overlay file gets deleted or fails to parse* → `Import-ControlRegistry` falls through to upstream `requiredServicePlans` (which v2.0.0 doesn't have) → empty array → all checks run on all tenants. Loud failure: noisy output, easy to spot in QA.

## Alternatives considered

- **Push service plan IDs upstream into CheckID.** Rejected: layering violation. CheckID's audience is wider than M365-Assess and shouldn't carry vendor SKU metadata.
- **Patch `registry.json` post-sync to splice service plan IDs in.** Rejected: makes diffs noisy on every sync, and any merge conflict reverts the overlay silently. The whole point of [ADR-0001](0001-checkid-sync-vs-fork.md) is that `registry.json` is upstream-owned and immutable downstream.
- **Embed service plan IDs in `local-extensions.json`.** Rejected: that file is for *new* checks not yet upstream, not for *additional metadata on existing upstream checks*. Mixing the two roles makes the file's contract incoherent.
- **Use the coarse `licensing.minimum` directly and accept the false-positive/false-negative tradeoff.** Rejected: the false-positive case (running an E5-only check against E3) was the most-frequent v2.6 user complaint. Fixing it was the motivating force behind the overlay.

---

## See also

- [`../../src/M365-Assess/controls/licensing-overlay.json`](../../src/M365-Assess/controls/licensing-overlay.json) — the file this ADR is about
- [`../../src/M365-Assess/Common/Import-ControlRegistry.ps1`](../../src/M365-Assess/Common/Import-ControlRegistry.ps1) — overlay merge at registry-load time
- [`0001-checkid-sync-vs-fork.md`](0001-checkid-sync-vs-fork.md) — why we don't patch `registry.json` directly
- [`README.md`](README.md) — back to the ADR index
