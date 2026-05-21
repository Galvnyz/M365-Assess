# Architecture Decision Records

Short records of decisions that shaped the project — why we did it this way, what we considered, and what we accept as the cost.

## Why this exists

M365-Assess has several non-obvious load-bearing decisions (CheckID sync vs. fork, sub-numbered CheckIds, DNS runs after other sections, separate licensing overlay, local-extensions merge step). Today those live as tribal knowledge or scattered CLAUDE.md lines. ADRs give them one home so a future contributor — or a future you — can read the reasoning instead of re-deriving it from a diff.

## When to write one

Write an ADR when a decision is **expensive to reverse** or **non-obvious from the code**. Examples that qualify:

- Picking one integration shape over another (sync vs. fork, push vs. pull, cron vs. event).
- Locking in a contract that callers depend on (status taxonomy, evidence schema, CheckId numbering scheme).
- Choosing to accept a tradeoff that will surprise readers (e.g. "we deliberately don't validate X").

Skip ADRs for: bug fixes, refactors that don't change a contract, dependency bumps, cosmetic changes. The commit message is enough for those.

## How to write one

1. Copy [`_template.md`](_template.md) to `NNNN-kebab-title.md` using the next free 4-digit number.
2. Fill in the 5 fields. Keep it short — half a page is normal, two pages is the cap.
3. Set `Status: Proposed` while opening the PR; flip to `Accepted` on merge.
4. Link it from the table below.

When a later ADR overrides an earlier one, set the old one's status to `Superseded by NNNN` and link forward; do not delete it. The history is the point.

## Index

| # | Title | Status | Date |
|---|---|---|---|
| [0001](0001-checkid-sync-vs-fork.md) | Consume CheckID via tagged-release sync, not a fork | Accepted | 2026-05-06 |
| [0002](0002-sub-numbered-check-ids.md) | Auto sub-number CheckIds at the setting level | Accepted | 2026-05-06 |
| [0003](0003-dns-section-runs-last-with-prefetch.md) | DNS section runs last, fed by a connect-time prefetch | Accepted | 2026-05-06 |
| [0004](0004-licensing-overlay-separate-from-registry.md) | Keep the licensing overlay separate from the upstream registry | Accepted | 2026-05-06 |
| [0005](0005-nine-status-taxonomy.md) | 9-value status taxonomy instead of binary Pass/Fail | Accepted | 2026-05-06 |
| [0006](0006-optional-structured-evidence-fields.md) | Extend the finding contract with optional structured evidence fields | Accepted | 2026-05-06 |
| [0007](0007-skip-collector-on-unavailable-service.md) | Skip individual collectors when their services are unavailable; never abort the run | Accepted | 2026-05-06 |
| [0008](0008-self-contained-html-report.md) | HTML report is a single self-contained file with no external runtime dependencies | Accepted | 2026-05-06 |
| [0009](0009-live-tenant-verification-hard-gate.md) | Live tenant verification is a hard precondition for every release | Accepted | 2026-05-06 |
| [0010](0010-baseline-diff-key-strategy.md) | Baseline diff keys on the sub-numbered CheckId; cross-version uses intersect-only mode | Accepted | 2026-05-06 |
| [0011](0011-framework-definitions-auto-discovered.md) | Framework definitions are auto-discovered per-framework JSON files | Accepted | 2026-05-06 |
| [0012](0012-tenant-identifier-dual-shape.md) | Tenant identity uses GUID for new artifacts but reads both legacy and GUID folder shapes | Accepted | 2026-05-06 |
| [0013](0013-unified-cmdlet-with-auth-parameter-sets.md) | One cmdlet, five auth modes, dispatched via PowerShell parameter sets | Accepted | 2026-05-06 |

---

## See also

- [`../INDEX.md`](../INDEX.md) — back to the docs index
- [`../../CLAUDE.md`](../../CLAUDE.md) — project intelligence (rules, paths, workflows)
- [`../../.claude/rules/`](../../.claude/rules/) — coding standards (path-scoped)
