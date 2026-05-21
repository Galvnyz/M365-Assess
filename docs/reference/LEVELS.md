# Framework levels and license tiers — semantic reference

How M365-Assess interprets level/profile chips on framework panels and the FilterBar.

This doc was written in response to issue #844 (the "L2 ⊇ L3" inverted chip bug). It explicitly rejects an earlier approach that synthesized inheritance in code, after the user pointed out that level relationships are not always cumulative.

## Core principle: trust the registry, don't synthesize inheritance

Chip counts and filters use the registry's per-check designations **exactly as authored**. We do NOT impose code-level inheritance like "L2 must always include L1" because that assumption is wrong in practice:

- **CMMC L2 is not always a strict superset of L1.** Some L1 practices are replaced by stricter L2 alternatives.
- **CIS Profile Level 2 sometimes replaces L1 controls with more restrictive ones**, rather than purely adding.
- **NIST 800-53 Low / Mod / High baselines** each select their own set of controls, not strict additions.

If a check should appear at multiple levels, **the registry must tag it with each level explicitly**. Code does not infer.

## What "click L2" returns

For a check to appear under the L2 chip / filter, its `profiles` array must contain a tag whose string includes `L2` (e.g. `L2`, `E3-L2`, `E5-L2`). Same for L1, L3, Low, Mod, High.

| Click | Returns |
|---|---|
| `L1` | Checks tagged with `L1` (or any composite containing `L1` like `E3-L1`) |
| `L2` | Checks tagged with `L2` |
| `L3` | Checks tagged with `L3` |
| `Low` (NIST) | Checks tagged with `Low` |
| `Mod` | Checks tagged with `Moderate` or `Mod` |
| `High` | Checks tagged with `High` |
| `E3` (CIS) | Checks tagged with any `E3-` prefixed profile |
| `E5only` | Checks tagged with profiles, none of which start with `E3-` (i.e., E5-exclusive) |

Counts can go up OR down between levels. If L3 has fewer checks than L2 in your tenant, that's because the framework / registry designates fewer L3 checks — not a bug.

## License tiers (`E3` / `E5only`)

`E3` and `E5only` are **license-presence** flags, not maturity levels:
- `E3`: appears in any `E3-*` profile (a check the framework lists for E3 license)
- `E5only`: a check is profile-tagged but has NO `E3-*` profile (E5-exclusive)

These are mutually exclusive per check — a check is either covered by E3 or it's E5-exclusive.

## Inferring tenant scope: that's the user's job

If you want to know "what checks would my L3-targeting tenant evaluate," the answer depends on the framework's published guidance — which you read from the framework documentation itself. Use multi-select on the chips (e.g., click L1 + L2 + L3 to union them) if the framework you're reading targets multiple levels at once.

We chose this design over auto-inheritance because the alternative would silently misrepresent any framework whose level model isn't cumulative. The chip values stay aligned with the registry; if the registry is wrong, that's a data-quality issue (file an issue tagged `bug, research`), not a UI fix.

## Where this is enforced

| Location | Behavior |
|---|---|
| `src/M365-Assess/assets/report-app.jsx` — `matchProfileToken(profilesArr, token)` | Substring match per token. Special case for `E5only` (negation of E3 prefix). No inheritance synthesis. |
| `src/M365-Assess/assets/report-app.jsx` — `buildFrameworkData(fwId, activeProfiles)` | Per-framework count aggregation. Counts reflect explicit tags only. |
| `src/M365-Assess/assets/report-app.jsx` — FilterBar level row counter | Reuses `matchProfileToken` so chip counts agree with filter behavior. |
| `src/M365-Assess/controls/registry.json` | Source of truth for which checks apply at which level. Authoring decisions live here, not in JSX. |

## Common pitfall (corrected)

A previous version of this doc claimed CMMC uses "duplicative-downward tagging" (an L1 check is also tagged L2). **That's not a universal convention** — it happens to be what the current registry data looks like for some frameworks, but it's a per-check authoring decision, not a guarantee. Code should NOT depend on it.

If you want to assert that a specific check applies at L2, look at its `profiles` array directly. If it's wrong (the framework says L2 but the registry omits the tag), fix the registry.

## See also

- #844 — the original "L2 ⊇ L3" inverted chip bug. The chip is gone; this doc locks down the per-check semantic to prevent the same misframing from coming back via a "fix it in code" patch.
- `docs/SCORING.md` — denominator math (separate concern; profile chips affect WHICH checks count toward the denominator, not the math itself)
- `controls/frameworks/cis-m365-v6.json`, `cmmc.json` — per-framework JSON metadata; `groupBy` taxonomy is unrelated to levels but lives alongside
