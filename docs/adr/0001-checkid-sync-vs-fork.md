# 0001 — Consume CheckID via tagged-release sync, not a fork

- **Status:** Accepted
- **Date:** 2026-05-06

## Context

The bulk of M365-Assess's value lives in its check registry — currently 253 entries spanning 15 compliance frameworks. The registry data (control definitions, framework mappings, SKU/feature maps, CMMC handoff data) is owned by the upstream [`Galvnyz/CheckID`](https://github.com/Galvnyz/CheckID) project, which evolves independently on its own release cadence.

We needed a way to keep registry data in step with CheckID without:

- Drifting silently when CheckID ships fixes or new framework mappings.
- Pulling in unreviewed mid-flight changes from CheckID's `main` branch.
- Losing the ~31 M365-Assess-specific extension checks that don't (yet) exist upstream.
- Adding a runtime dependency on CheckID for module consumers, since M365-Assess ships to PSGallery and must work offline.

The decision is non-obvious because three reasonable shapes exist (fork, vendor at HEAD, vendor at tag) and each has different failure modes around drift, review, and contributor experience.

## Decision

Vendor the CheckID registry by syncing from **tagged CheckID releases only**, via a workflow that:

1. Listens for a `checkid-released` `repository_dispatch` event from CheckID (stable channel — preview channel is intentionally ignored).
2. Downloads the registry, framework files, SKU map, and CMMC handoff data from `raw.githubusercontent.com/Galvnyz/CheckID/<tag>/data/`.
3. Normalizes encoding (CP1252 → UTF-8 fixups for known byte patterns).
4. Merges local extension checks from `controls/local-extensions.json` on top of the upstream registry, skipping any whose `checkId` already exists upstream.
5. Opens a PR (`chore/sync-checkid-<tag>`) for human review before any change reaches `main`.

Local extensions live in their own file (`local-extensions.json`), not interleaved with upstream entries in `registry.json`. The merge is one-way: upstream wins on conflicts, and we file fixes upstream rather than patching downstream.

See: [`.github/workflows/sync-checkid.yml`](../../.github/workflows/sync-checkid.yml).

## Consequences

**Positive**

- Registry changes always pass human review via a PR — no silent drift.
- We can pin to a known-good CheckID tag and skip a release if it's broken.
- M365-Assess works offline; PSGallery consumers never reach out to CheckID at runtime.
- Local extensions are visibly separate from upstream data, making the upstreaming pipeline obvious.
- Rolling back to a prior CheckID version is `git revert` on the sync PR.

**Negative**

- We lag behind CheckID HEAD by however long it takes us to merge each sync PR. Acceptable for a public-release posture, painful if a critical fix is in flight.
- Fixes go upstream first, downstream second — contributors must hold two repos in their head. CLAUDE.md and the auto-memory both point at this.
- Encoding normalization is brittle; the CP1252 fixup list is hand-maintained and has been wrong before.
- The merge step trusts `local-extensions.json` to stay accurate. If a local check graduates upstream, we must remove it locally or it will be merged as a duplicate (the merge skips by `checkId`, which mitigates but doesn't eliminate this).

**Failure modes and mitigations**

- *Preview-channel event leaks into the workflow* → defense-in-depth check fails the run with `::error::M365-Assess only consumes the stable channel`.
- *Encoding regression* → fixup runs only on files that fail UTF-8 decode, avoiding double-encoding of valid files.
- *Sync PR is forgotten* → the cron-triggered weekly sync surfaces stale PRs; the chore branch name is stable per tag, so re-runs update rather than fork.

## Alternatives considered

- **Fork CheckID into the M365-Assess org.** Rejected: doubles maintenance, splits the community, and makes upstream contribution friction higher.
- **Vendor at `main` HEAD.** Rejected: pulls in unreviewed in-flight changes; CheckID's release process is the contract we want to honor.
- **Runtime dependency (fetch registry at assessment time).** Rejected: breaks offline use, breaks air-gapped tenants, breaks reproducibility of historical reports, and adds a network failure mode to a tool that already has 6+ network dependencies.
- **Git submodule.** Rejected: PSGallery packaging is hostile to submodules, and the encoding/local-extensions transforms still need a workflow somewhere — the submodule would just move the problem.

---

## See also

- [`.github/workflows/sync-checkid.yml`](../../.github/workflows/sync-checkid.yml) — the workflow this ADR describes
- [`../../src/M365-Assess/controls/local-extensions.json`](../../src/M365-Assess/controls/local-extensions.json) — local extension checks merged on top
- [`../../CLAUDE.md`](../../CLAUDE.md) — project rules including "never load from CheckID main branch"
- [`README.md`](README.md) — back to the ADR index
