# 0012 — Tenant identity uses GUID for new artifacts but reads both legacy and GUID folder shapes

- **Status:** Accepted
- **Date:** 2026-05-06

## Context

Baselines, drift reports, and the trend chart all need a stable per-tenant key — a string that says "this run and that run came from the same tenant" so a comparison is meaningful. Pre-v2.9.0, M365-Assess used the user-supplied `-TenantId` as that key, which produced folder names like `Q1-2026_contoso.com` or `Baseline_contoso.onmicrosoft.com`.

The user-supplied `TenantId` is a **bad canonical key** for several reasons:

1. **It's a free-text input.** The same tenant can be referred to as `contoso.com`, `contoso.onmicrosoft.com`, or `00000000-1111-2222-3333-444444444444`. Each spelling produces a different folder, and trend / drift comparisons silently miss because the keys don't match.
2. **Domain rebrands break history.** A tenant that renames from `acme.com` to `acme-corp.com` (or sells off a subsidiary keeping `oldname.onmicrosoft.com`) now has its baseline history split across two keys.
3. **No collision-resistant guarantee.** The `TenantId` value passes through unchanged into the filesystem, sanitized only to remove `[^\w\.\-]`. Two distinct tenants could in principle pick names that sanitize identically.

The right canonical key is the **tenant GUID** from `Get-MgContext.TenantId` after a Graph connect. It's stable across rebrands, immune to spelling variants, and globally unique by definition.

But there's a migration constraint: **users have years of pre-v2.9.0 baselines** sitting in `Baselines/Q1-2026_contoso.com`-shaped folders. Switching the canonical key to GUID would orphan all that history. The user opens the trend chart and sees only post-upgrade data, with the old chart silently gone.

## Decision

C1 #780: dual-shape support, asymmetric between read and write paths.

**Write side (canonical):** all new artifacts use the GUID as the folder-name suffix.

- `Resolve-TenantIdentity` resolves `Guid` from `Get-MgContext.TenantId` (source = `'Graph'`).
- If Graph isn't connected (pure AD-only run, weird auth state), fall back to a deterministic `SHA256(lowercase(TenantIdInput))` truncated to 32 hex chars, GUID-formatted (source = `'Fallback'`). This gives the same string every time for the same input — same key, just not a real GUID.
- New baselines are saved to `Baselines/<Label>_<Guid>/`.
- The baseline manifest stores `{ TenantGuid, DisplayName, PrimaryDomain }` so future readers have all three for matching.

**Read side (compatibility):**

- `Resolve-BaselineFolder` looks up a single named baseline by trying the GUID-keyed path first, then the legacy `TenantId`-keyed path.
- `Get-BaselineTrend` is more aggressive: it scans the `Baselines/` directory with **both** filters (`*_<sanitized-domain>` and `*_<sanitized-guid>`) and unions the results into a `Dictionary<string, DirectoryInfo>` keyed on full path so duplicates dedupe. Folder names are timestamp-based and unique, so the union doesn't double-count.
- The trend chart therefore shows pre- and post-v2.9.0 history continuously, even though the underlying folders are keyed differently.

See: [`src/M365-Assess/Common/Resolve-TenantIdentity.ps1`](../../src/M365-Assess/Common/Resolve-TenantIdentity.ps1) (the resolver + folder helper) and [`src/M365-Assess/Common/Get-BaselineTrend.ps1`](../../src/M365-Assess/Common/Get-BaselineTrend.ps1) (the dual-filter scan).

## Consequences

**Positive**

- New baselines are durable across rebrands, vanity-domain swaps, and free-text-spelling variants. Future trend comparisons stay coherent.
- Existing pre-v2.9.0 baselines remain visible in the trend chart with no manual migration step.
- The fallback hash means baselines work even in offline / non-Graph runs (e.g. `-SkipConnection` paths) by producing a deterministic per-input key. No silent data loss.
- The manifest carrying `TenantGuid` + `DisplayName` + `PrimaryDomain` is forward-flexible: future features that want to match by primary domain or display name have the data already in the file.

**Negative**

- The dual-read path is fragile. `Get-BaselineTrend` knows about both shapes; any new code that scans the baselines directory must remember to do the same union or it will silently miss legacy baselines. We have no lint check for this; relies on convention and reviewer attention.
- The fallback hash *looks like* a GUID (it's GUID-shaped) but isn't one. A reader debugging a baseline folder may confuse a fallback hash for a real tenant GUID and misidentify the tenant. The `Source: 'Fallback'` field on the resolver output is the only signal, and it lives in memory, not on disk.
- Over time the legacy support becomes pure dead weight — most tenants will eventually have only GUID-keyed baselines, and the legacy filter scan still runs every time. Performance impact is negligible (one extra `Get-ChildItem -Filter`) but the cognitive overhead persists.
- The user-supplied `-TenantId` is still the human-facing identifier in logs, error messages, and the assessment folder name. The split between "what the user sees" (TenantId) and "what the tool persists" (TenantGuid) is potentially confusing.
- A tenant that runs assessments against the same M365 tenant from two different cloud environments (commercial vs. GCC) gets the same `TenantGuid` in both. The `Environment` field on the identity object distinguishes them in memory but isn't part of the folder key. Edge case; not yet a real-world problem.

**Failure modes and mitigations**

- *Graph context unavailable when `Resolve-TenantIdentity` runs* → fallback hash kicks in; Source field is `'Fallback'`. Caller can warn. Used baseline file remains usable across runs against the same input.
- *User changes spelling of `-TenantId` between runs but Graph is connected both times* → `Get-MgContext.TenantId` returns the same GUID regardless of how the user spelled the input. Folder is the GUID-keyed one, history continuous.
- *User changes `-TenantId` AND Graph is unavailable both times* → fallback hash differs between the two inputs, history splits. Not preventable without Graph; documented in the resolver synopsis.
- *Sync workflow accidentally re-creates a legacy folder* → harmless, just reads as a duplicate by `Get-BaselineTrend`'s union (deduped by path). Would only be a problem if a write path produced one — and it shouldn't.

## Alternatives considered

- **Migrate all legacy baselines to GUID-keyed folders on first run.** Rejected: requires a Graph connect to know the GUID, requires write permission to the user's baseline directory, and irreversibly mutates user data. The dual-read approach is non-destructive.
- **Stay on `TenantId` as the canonical key forever.** Rejected: the rebrand-resilience and spelling-variants problems are real, and they manifested in user reports before C1 #780.
- **Use `PrimaryDomain` as the canonical key.** Rejected: still mutable across tenant lifetime (rebrands), still spelling-sensitive, and not always available (Graph may be reachable but `Get-MgOrganization` may fail on minimal scopes).
- **Demand a real GUID, refuse to run on the fallback path.** Rejected: kills `-SkipConnection` use cases, breaks AD-only runs, makes the tool brittle for the 5% of edge cases where Graph isn't usable.
- **Store both keys in the folder name (`<Label>_<Guid>_<TenantId>`).** Rejected: makes the directory listing ugly, doubles the path-length budget on Windows (already tight at 260 chars), and doesn't actually help the dual-shape read problem because legacy folders predate the format.

---

## See also

- [`../../src/M365-Assess/Common/Resolve-TenantIdentity.ps1`](../../src/M365-Assess/Common/Resolve-TenantIdentity.ps1) — `Resolve-TenantIdentity` + `Resolve-BaselineFolder`
- [`../../src/M365-Assess/Common/Get-BaselineTrend.ps1`](../../src/M365-Assess/Common/Get-BaselineTrend.ps1) — dual-filter scan of legacy + GUID folders
- [`../../src/M365-Assess/Orchestrator/Export-AssessmentBaseline.ps1`](../../src/M365-Assess/Orchestrator/Export-AssessmentBaseline.ps1) — write path (always GUID-keyed)
- [`0010-baseline-diff-key-strategy.md`](0010-baseline-diff-key-strategy.md) — diff key strategy that operates inside one baseline (vs. this ADR's choice of how baselines are addressed)
- [`README.md`](README.md) — back to the ADR index
