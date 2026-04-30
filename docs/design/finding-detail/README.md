# Finding-detail panel redesign — design handoff

Frozen snapshot of the design package exported from [Claude Design](https://claude.ai/design) on 2026-04-28. This is the source-of-truth spec for **issue #863** (Finding-detail panel redesign — Direction D hybrid).

Replaces the closed #674 (the prior detail-panel redesign attempt that was rejected as "too busy without adding actual info or value"). Direction D addresses that critique by being structurally denser, not just visually busier — it makes room for value-bearing fields the report doesn't currently expose.

## What's in here

| File | Purpose |
|---|---|
| **`direction-d.jsx`** | **The implementation reference.** Final design after the user iterated through 3 alternates (A — narrative-first, B — structured-claim, C — workflow-state). Direction D synthesizes the strongest pieces of each into one shippable pattern. |
| `fd-host.jsx` | Surrounding harness (table → expanded row container) showing how `<FindingDetail/>` is mounted. Useful for understanding the parent contract, not part of the redesign itself. |
| `mock-findings.js` | Three realistic mock findings (ENTRA-MFA-001 boolean shape, DEFENDER-SAFELINKS-001 multi-setting shape, CA-EXCLUSION-001 list-shape) covering the structured-claim variations the typed evidence table needs to render. |
| `styles.css` | All new CSS classes used by Direction D (`.fd-*` and `.fdd-*` namespaces). The implementer should fold these into `src/M365-Assess/assets/report-shell.css` and adapt to the existing CSS-variable theme contract. |
| `redesign.css` | Snapshot of base styles from the canvas standalone. Most overlap with the live `report-shell.css`; the new bits live in `styles.css`. |
| `index.html` | Canvas host that loads the design standalone in a browser. Useful for visual review before implementation. |
| `design-canvas.jsx` | Canvas chrome (artboard + section). Not implementation-relevant — surrounding harness. |

## Not included (deliberately)

The original design bundle contained `report-shell.css` and `report-themes.css` so the canvas could load standalone. **Those are not duplicated here** — they live at `src/M365-Assess/assets/report-shell.css` and `report-themes.css`. The design intent is captured in `styles.css` only; the existing report styles are referenced from the live source.

## How to view the canvas

```bash
cd docs/design/finding-detail
cp ../../../src/M365-Assess/assets/report-shell.css .
cp ../../../src/M365-Assess/assets/report-themes.css .
start index.html   # Windows
open index.html    # macOS
xdg-open index.html # Linux
```

(Don't commit those copies — they would drift from the live source.)

You don't need to render the canvas to implement — the JSX/CSS source IS the spec.

## Layout summary

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Row 1: STATE STRIP                                                        │
│  Horizon · Effort · Affected · Owner · Ticket                             │
├──────────────────────────────────────────────────────────────────────────┤
│ Row 2: RISK NARRATIVE (red-tinted)                                        │
│  Risk:           one paragraph — what an attacker can do                  │
│  Why it matters: audit/compliance consequence, framework count, mandates  │
│  (right meta:    MITRE T-codes)                                           │
├────────────────────────────────────┬─────────────────────────────────────┤
│ Row 3a: STRUCTURED CLAIM           │ Row 3b: SIDE RAIL                   │
│  one-line typed assertion          │  Mappings (frameworks + controlIds) │
│  OBSERVED / EXPECTED / DELTA       │  Trend pips (last N runs)           │
│  typed table; sample chips for     │  Related findings (cluster)         │
│  list-shaped values                │  Learn more (refs)                  │
│  Action tabs:                      │                                     │
│   [Portal] [PowerShell] [Verify]   │                                     │
├──────────────────────────────────────────────────────────────────────────┤
│ Footer: PROVENANCE (collapsible)                                          │
│  Source · Timestamp · Confidence · Permission · Raw evidence              │
└──────────────────────────────────────────────────────────────────────────┘
```

## Schema additions

The current finding object carries: `checkId`, `setting`, `status`, `severity`, `domain`, `current`, `recommended`, `remediation`, `frameworks`, `fwMeta`, `evidence`, `references`. Direction D requires these **new** fields:

| Field | Type | Source / how to populate |
|---|---|---|
| `lane` | `'now' \| 'soon' \| 'later'` | Already computed via `Get-RemediationLane.ps1` (#715); just surface on the finding object |
| `effort` | `'small' \| 'medium' \| 'large'` | Per-check field in `controls/registry.json` (some entries already have it) |
| `owner` | `string \| null` | NEW — opt-in user-assignment in edit mode (persists via `REPORT_OVERRIDES`) |
| `ticket` | `{ system, id, status } \| null` | NEW — opt-in user-assignment in edit mode |
| `history` | `[{ date, status, note }]` | NEW — derived from baseline-trend data |
| `affectedObjects` | `{ kind, count, sample[] }` | NEW — populated by collectors when known |
| `riskNarrative` | `string` | NEW — separate from `whyItMatters` (split current narrative into "what attacker does" + "audit consequence") |
| `mitre` | `string[]` | NEW — per-check field where applicable (e.g., T1078) |
| `relatedFindings` | `checkId[]` | NEW — derived clustering OR explicit |
| `remediation` (structured) | `{ portal: string[], ps: string, verify: string }` | NEW — restructure the freeform `remediation` string |
| `evidence` (typed) | `{ observedValue, expectedValue, evidenceSource, evidenceTimestamp, collectionMethod, permissionRequired, confidence, limitations, raw }` | Already present (D1 #785); thread through new layout |

## Phased implementation plan

The redesign is large enough that it ships in phases. Each phase degrades gracefully when later-phase fields are missing.

| Phase | Scope | Status |
|---|---|---|
| **1. Schema groundwork** | Extend collectors + registry + `Build-ReportData.ps1` to surface new fields where derivable. | TODO |
| **2. UI shell** | Row 1 (state strip) + Row 2 (risk narrative split) + collapsible provenance footer. Renders off existing fields with graceful empty-state. | TODO — first implementation PR after this docs handoff |
| **3. Typed observed/expected + tabbed actions** | Requires typed `evidence.observedValue` / `expectedValue` + remediation restructure. | TODO |
| **4. Side rail** | Mappings (existing) + Trend (needs baseline integration) + Related (clustering) + Learn more. | TODO |
| **5. Owner / ticket assignment** | Edit-mode metadata overlay similar to `<HideableBlock>` (#712). | TODO |

## Implementation guidance

The polished JSX in `direction-d.jsx` should be **adapted, not copied verbatim** into `src/M365-Assess/assets/report-app.jsx`. Adapt:

- Data sources: `direction-d.jsx` references locally-defined helpers; live code uses `STATUS_COLORS`, `STATUS_TIERS`, etc.
- Hook names: align with existing `useState` / `useMemo` conventions
- CSS class merging: fold `styles.css` into `src/M365-Assess/assets/report-shell.css` and adapt to the live theme variable contract
- Edit-mode integration: hideable wrapper from #712, edit-mode context already in scope

See **issue #863** for the full per-phase implementation plan.

## Related design handoffs

- `docs/design/framework-redesign/` (#856 / shipped via #855) — the framework coverage redesign followed the same handoff pattern. Use it as the structural template.
