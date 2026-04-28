# Framework levels and license tiers — semantic reference

How M365-Assess interprets level/profile chips on framework panels and the FilterBar. Sets the contract that every level-aware UI surface (chip counts, relationship indicators, FilterBar chips, family breakdown counts) must follow.

This doc was written in response to issue #844 — the prior inversion bug — to lock the meaning down so future changes don't drift.

## TL;DR

- **Maturity levels** (CMMC `L1` / `L2` / `L3`; CIS `L1` / `L2`; NIST 800-53 `Low` / `Mod` / `High`) are **CUMULATIVE**. Higher levels INHERIT all checks from lower levels.
  - `L3 ⊇ L2 ⊇ L1`. Click L3 → see every check an L3 tenant evaluates (L1 + L2 + L3 explicit). Counts go UP as the level rises.
- **License tiers** (CIS `E3` / `E5only`) are **ORTHOGONAL** to maturity levels. Each tier has its own check set; an E5 license activates `E3 ∪ E5only`. They're additive, not nested.
- **Per-finding tagging** in `controls/registry.json` is **DUPLICATIVE DOWNWARD** — a CMMC finding that applies at L3 ALSO carries the L2 tag (and the L1 tag if applicable). The runtime cumulative semantics rely on this convention.

## What "click L2" means

The user's mental model: "if my tenant targets level X, how many checks am I going to evaluate?"

For maturity levels, the answer is cumulative-up:

| Click | Returns | Reasoning |
|---|---|---|
| `L1` chip | All checks tagged with L1 | L1 is the foundational baseline; L2 and L3 tenants ALSO evaluate these |
| `L2` chip | All checks tagged with L1 OR L2 | L2 inherits L1 + adds L2-specific checks |
| `L3` chip | All checks tagged with L1 OR L2 OR L3 | L3 inherits L2 + adds L3-specific checks |
| `Low` chip (NIST) | All checks tagged with Low | Foundational baseline |
| `Mod` chip | Low ∪ Mod | Moderate baseline inherits Low |
| `High` chip | Low ∪ Mod ∪ High | High baseline inherits Mod |
| `E3` chip (CIS) | All checks tagged with `E3-*` | Checks an E3-licensed tenant evaluates |
| `E5only` chip | All checks NOT tagged with `E3-*` | Checks exclusive to E5 (extras over E3) |

Clicking E3 + E5only together = full E5 license set (orthogonal).

Clicking L1 alone shows the smallest set. Clicking L3 alone shows the largest. **L1 ≤ L2 ≤ L3** is the invariant the test suite asserts.

## Where this is enforced

| Location | Why it matters |
|---|---|
| `src/M365-Assess/assets/report-app.jsx` — `matchProfileToken(profilesArr, token)` | Single source of truth for "does this finding's profile array match the requested level?" Used by FilterBar level chips AND by `buildFrameworkData`'s per-framework set construction |
| `src/M365-Assess/assets/report-app.jsx` — `buildFrameworkData(fwId, activeProfiles)` | Per-framework count aggregation. Calls `matchProfileToken` for the `activeProfiles` filter, then applies cumulative inheritance to the `profileSets` so chip displays (`L1: 117`, `L2: 236`, `L3: 1080`) reflect the cumulative size |
| `src/M365-Assess/assets/report-app.jsx` — FilterBar level row counter | Reuses `matchProfileToken` so chip counts agree with the filter behavior |
| `src/M365-Assess/controls/registry.json` | Source data — uses duplicative-downward tagging convention. A finding at L3 carries `L2` and `L1` tags too, so `matchProfileToken('L2')` matches it without needing inheritance computation at the call site |

## Common pitfall

If a future contributor adds a finding tagged `L3` only (no L1 or L2), the cumulative invariant breaks (L3 finding wouldn't show up in L2 chip). The duplicative-downward tagging convention requires registry authors to ALWAYS tag with every applicable level. Pester regression `tests/Behavior/Levels-Cumulative.Tests.ps1` asserts the L1 ≤ L2 ≤ L3 invariant and fails if violated.

If you NEED to express "this check is L3-only and not for L2 tenants", that's a different model (exclusive levels, like security baselines that intentionally drop coverage at higher tiers). M365-Assess does not currently support that — file an issue first to design the schema.

## See also

- #844 — the original inversion bug that prompted this doc
- `docs/SCORING.md` — denominator math (different concern; profile chips affect WHAT counts toward the denominator, not the math itself)
- `controls/frameworks/cis-m365-v6.json`, `cmmc.json` — per-framework JSON metadata; `groupBy` taxonomy is unrelated to levels but lives alongside
