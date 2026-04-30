# Scoring Model

## What this is

M365-Assess produces a primary headline score on every report (the "strict-rule Pass%"), and a set of secondary scoring views that consultants can toggle between to support different conversations: technical security, compliance audit, license-aware planning, quick wins, etc.

The headline score is **invariant** -- it doesn't change based on tab selection, so the auditor-facing number is stable. The tabs are exploration tools, not redefinitions of "score."

---

## Headline: Strict-Rule Pass%

```
Pass% = Pass / (Pass + Fail + Warning)
```

- Numerator: `Pass`
- Denominator: `Pass + Fail + Warning`
- **Excluded from both**: `Review`, `Info`, `Skipped`, `Unknown`, `NotApplicable`, `NotLicensed`

This is the rule from #802 / `docs/CHECK-STATUS-MODEL.md`. Every consumer of the score (KPI tiles, section bucket scores, framework totals, XLSX `Pass Rate %`) follows it.

The justification: not-collected results can never inflate or deflate the score. If you couldn't assess a control, the score doesn't pretend it was either passed or failed.

---

## Tab views (D2 #786)

The tabs appear in the executive-summary panel of the HTML report, below the headline. Three of the six are scoring formulas; three are curated finding lists.

### 1. Security Risk (default)

Same formula as the headline; included as a tab so consultants always see the strict-rule number even when they've toggled away.

```
Pass / (Pass + Fail + Warning)
```

### 2. Compliance Readiness

Counts `Review` findings as ready, since "needs review" usually means "auditor will accept with attestation."

```
(Pass + Review) / (Pass + Fail + Warning + Review)
```

`Skipped`, `Unknown`, `NotApplicable`, `NotLicensed` are still excluded -- you can't be ready for a control you literally cannot assess.

### 3. License-Adjusted

Strips `NotLicensed` from both numerator and denominator. SMBs without E5 don't get penalised for E5-only controls they cannot enable.

```
Pass / (Pass + Fail + Warning, where status != NotLicensed)
```

This view is most useful when discussing a customer's posture *given their current licenses* without conflating it with what they'd get if they upgraded.

### 4. Quick Wins (list)

Findings with `status = Fail` AND `effort` of `small` or `low`, sorted by severity (critical → high → medium → low → none → info). Top 8 shown; "more" link deep-links to the filtered findings table.

This is the consultant's "what should we fix first" answer. High-impact, low-effort failures are by definition the highest-leverage remediation.

### 5. Requires Licensing (list)

All `status = NotLicensed` findings. Surfaces controls blocked by missing license SKUs -- candidates for an upgrade discussion. Not penalised in the License-Adjusted score above; this list is the upsell counterpart to that score.

### 6. Manual Validation (list)

All `status = Review` findings. These need human verification (audit log review, evidence collection, attestation). Surfacing them as a list makes the consultant's manual-validation work visible up-front rather than buried in the findings table.

---

## Why three scores, not one weighted score

A weighted composite ("60% technical risk + 30% compliance + 10% license adjustment") would feel scientific but would obscure the trade-offs. Different conversations call for different framings:

| Audience | Right view |
|---|---|
| CISO / security architect | Security Risk |
| Compliance / audit lead | Compliance Readiness |
| Account exec / customer success | License-Adjusted |
| MSP technician planning the next sprint | Quick Wins |
| Sales engineer scoping an upgrade | Requires Licensing |
| Auditor preparing fieldwork | Manual Validation |

A single composite would force these conversations to reverse-engineer the weights. Surfacing them as named tabs lets each role pick the framing they care about.

---

## Framework taxonomy strategies (#751, #845)

Each supported framework's expanded panel groups checks by the framework's own native control families/sections — CIS sections, CMMC families, NIST CSF functions, ISO clauses, etc. — rather than by M365-Assess internal domains. Every framework JSON in `src/M365-Assess/controls/frameworks/*.json` either declares a `groupBy` strategy + `groups` map, OR declares `taxonomyDecision: "domain-fallback"` with a documented reason.

The strategy mapping is enumerated in `GROUP_EXTRACTORS` (`src/M365-Assess/assets/report-app.jsx`):

| Strategy | Frameworks using it | controlId shape | Group key |
|---|---|---|---|
| `section-prefix` | CIS M365 v6, CIS Controls v8, PCI DSS v4 | `5.2.2.5` | leading numeric section (`5`) |
| `family-letter-prefix` | CMMC, NIST 800-53 r5, FedRAMP r5 | `AC.L2-3.1.1`, `AC-1` | letter family (`AC`) |
| `dot-prefix` | NIST CSF 2.0 | `ID.AM-1`, `PR.AC-1` | function letters before first dot (`ID`) |
| `iso-clause-prefix` | ISO 27001, ISO 27002 | `A.5.1.1` | leading clause (`A.5`) |
| `hipaa-section` | HIPAA Security Rule | `164.308(a)(1)(ii)(A)` | subsection number (`308`) |
| `soc2-tsc-prefix` | SOC 2 Trust Services Criteria | `CC1.1`, `PI1.2-POF1` | TSC category — longest-match wins (`CC`/`PI` before `P`) |
| `essential-eight-practice` | ASD Essential Eight | `ML1-P3` | practice number (`3`) — maturity level intentionally NOT the grouping |
| `scuba-service` | CISA SCUBA | `MS.AAD.1.1v1` | service prefix (`MS.AAD`) |

### Deliberate fallbacks (no native taxonomy)

| Framework | Reason |
|---|---|
| **MITRE ATT&CK** | Technique IDs (`T1078.004`) don't encode tactics. M365-Assess checks map to 100+ techniques each (semicolon-separated controlIds), and a single technique can serve multiple tactics — any per-check tactic grouping is ambiguous. To enable: ship a technique → tactic lookup table + decide how to handle multi-tactic techniques. |
| **DISA STIG** | Rule IDs (`V-NNNNNN`) are opaque — no product, category, or severity encoded. CAT-I/II/III severity exists in the published XCCDF XML but is not carried per-check in the registry's framework mapping. To enable: extend the registry to carry per-check STIG severity, or maintain a rule-ID → category lookup. |

Both are flagged in their JSON via `taxonomyDecision: "domain-fallback"` + `taxonomyReason`. The Pester regression in `tests/Behavior/Framework-Taxonomy.Tests.ps1` enforces that every framework declares either `groupBy` or `taxonomyDecision: "domain-fallback"` so a future maintainer can't silently drop a taxonomy without an explicit decision.

---

## Where the math lives

- `src/M365-Assess/assets/report-app.jsx` -- the `SCORING_VIEWS` array near the top defines each view; helpers `computeSecurityRiskScore`, `computeComplianceReadinessScore`, `computeLicenseAdjustedScore`, `getQuickWins`, `getRequiresLicensing`, `getManualValidation` are pure functions of `FINDINGS`.
- `tests/Behavior/Report-Math.Tests.ps1` -- PowerShell-side regression for the strict-rule denominator (#802); lives at the data-layer boundary so the contract stays asserted across language seams.
- `docs/CHECK-STATUS-MODEL.md` -- the canonical taxonomy these formulas operate on.

---

## See also

- [`CHECK-STATUS-MODEL.md`](../reference/CHECK-STATUS-MODEL.md) -- the 9-status taxonomy and denominator rules
- [`REPORT-SCHEMA.md`](../dev/REPORT-INTERNALS.md) -- the `findings[]` shape these formulas read
- [`EVIDENCE-MODEL.md`](../dev/EVIDENCE-MODEL.md) -- the structured evidence schema (`Limitations` field can change how you interpret a Manual Validation finding)
