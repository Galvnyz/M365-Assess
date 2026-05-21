# 0006 — Extend the finding contract with optional structured evidence fields

- **Status:** Accepted
- **Date:** 2026-05-06

## Context

Every finding M365-Assess emits answers two questions implicitly:

- *What was checked?* (`Setting` + `CheckId`)
- *What was found?* (`Status` + `CurrentValue`)

For a long time, that was the whole contract. The single `Evidence` parameter on `Add-SecuritySetting` was a free-form `PSCustomObject` — anything could go in, JSON-serialised at the report-render boundary. That worked for collectors but broke down for the audience the tool is actually serving:

- **Auditors** asked "how do you know?" and got a nameless object with whatever fields the collector author happened to choose.
- **Consultants** preparing remediation evidence couldn't filter findings by "show me everything that came from `Get-AdminAuditLogConfig`" because the source was buried inside an unstructured blob.
- **Future M365-Assess versions** wanting to surface confidence, permission paths, or collection methods had no contract to extend — only a free-form bag.

The conservative move was to add new typed fields. The hard part was *how* to add them without:

1. Forcing a sweeping rewrite of every existing collector to populate the new fields.
2. Breaking the existing `Evidence` parameter that some collectors had organically built rich blobs around.
3. Making the report ugly for findings that didn't (yet) carry the new fields.

## Decision

Issue D1 #785 added eight optional, typed fields to `Add-SecuritySetting`:

| Field | Purpose |
|---|---|
| `ObservedValue` | Machine-readable raw value from the tenant |
| `ExpectedValue` | Machine-readable benchmark value |
| `EvidenceSource` | Graph endpoint / EXO cmdlet / DNS query that produced the data |
| `EvidenceTimestamp` | UTC ISO-8601 collection time (only when the upstream API gives a real one) |
| `CollectionMethod` | `Direct` / `Derived` / `Inferred` / `''` |
| `PermissionRequired` | The Graph scope or RBAC role the data depended on |
| `Confidence` | `0.0`-`1.0` (nullable) — distinguishes "definitely Pass" from "best-effort given missing scopes" |
| `Limitations` | Free-text caveat (the sub-cause for `Unknown`, the explanation for non-1.0 `Confidence`) |

All eight are **optional**. The free-form `Evidence` parameter is preserved for backward compatibility. New collectors should prefer the typed fields; old collectors keep working unchanged.

The pipeline is "drop empty at every stage":

- Empty fields produce empty CSV cells.
- `Build-ReportData` emits an `evidence` object on each finding only when at least one field is populated; if every field is empty, `evidence` is `null` (not an empty object).
- The XLSX "Evidence Details" sheet only includes rows where at least one field is populated.
- The React Appendix `EvidenceBlock` only renders a row per non-empty field.

This means a collector that hasn't migrated produces no visible evidence section in the report rather than a section full of empty rows.

See: [`docs/dev/EVIDENCE-MODEL.md`](../dev/EVIDENCE-MODEL.md) (the migration cookbook), [`src/M365-Assess/Common/SecurityConfigHelper.ps1`](../../src/M365-Assess/Common/SecurityConfigHelper.ps1) (the contract).

## Consequences

**Positive**

- Auditors can answer "how do you know?" with structured per-field rows instead of a JSON dump.
- Findings filterable by `EvidenceSource` (which API produced this?) and `PermissionRequired` (was the scope I had enough?).
- `Confidence` lets the tool say "I'm 60% sure" out loud, instead of false-confident `Pass`. Pairs with `Unknown` from [ADR-0005](0005-nine-status-taxonomy.md): some checks land at `Pass` with low confidence rather than `Unknown`, which is more accurate when the data is partially there.
- Migration is incremental. Each collector that adopts the new fields adds value immediately; we don't have to convert all 250+ checks before any of them improve.
- The "drop empty" rule means the report doesn't pay a UX cost for half-migrated state.

**Negative**

- Two evidence paths exist now: free-form `Evidence` and typed fields. Code reviewers must catch collectors that mix them inconsistently. The doc says "prefer typed fields for new code", but enforcement is by review, not lint.
- The optional nature means evidence quality is collector-by-collector. A consultant comparing two findings can find one with full provenance and one with none. Until coverage is uniform, the absence of fields doesn't mean the data wasn't gathered — it might just mean the collector hasn't migrated.
- `EvidenceTimestamp` is the most-misused field. The doc explicitly says "don't synthesize `Get-Date` at the helper" because it would drift for late-stage `Add-Setting` calls; collector authors keep being tempted to fill it in anyway.
- `Confidence` numbers without calibration are theatre. The `feedback_no_fake_statistical_credibility` rule applies: `0.6` should mean "I had partial data and inferred from it", not "I felt 60% sure". Without explicit examples in the doc, this drifts.

**Failure modes and mitigations**

- *Collector populates `EvidenceTimestamp` with `Get-Date` at write-time, not collection-time* → audit trails become useless because every finding shares a timestamp. Mitigation: doc warning + code review.
- *Collector mixes free-form `Evidence` with typed fields and the report renders both* → noise. Mitigation: report layer renders typed fields when present, free-form `Evidence` only as a fallback.
- *Confidence is set without a corresponding `Limitations` explaining why it's < 1.0* → unverifiable claim. Mitigation: doc says "populate `Limitations` whenever Confidence < 1.0"; review-enforced.
- *D1 schema bumps required by adding a new field* → must update `EVIDENCE-MODEL.md`, the helper, the CSV column list, `Build-ReportData`, the React `EvidenceBlock`, and the XLSX sheet. Five-step bump checklist; same shape as the [ADR-0005](0005-nine-status-taxonomy.md) status-schema bump.

## Alternatives considered

- **Mandatory new fields.** Rejected: would force 250+ collector audit before any improvement shipped. Migration risk too high; we'd never ship D1.
- **Replace the free-form `Evidence` parameter outright.** Rejected: collectors had built useful per-section blobs (CA policy condition trees, DKIM record dumps) that don't fit the typed fields. Removing it would lose information.
- **Sidecar evidence file (separate JSON keyed by CheckId).** Rejected: doubles the I/O paths, breaks the single-CSV-per-collector contract that the rest of the orchestrator depends on, makes baseline diff harder.
- **Embed evidence as nested objects inside the existing `Evidence` blob with a known schema.** Rejected: still unstructured at the type level — no `[ValidateSet]` for `CollectionMethod`, no `[double]` range check for `Confidence`. The flat-typed-fields approach gives PowerShell's parameter validation for free.
- **Use one big "Provenance" hashtable parameter.** Considered. Rejected because hashtable parameters lose tab-completion and parameter validation in PowerShell. The eight separate parameters are uglier to type but catch errors at parse time.

---

## See also

- [`../dev/EVIDENCE-MODEL.md`](../dev/EVIDENCE-MODEL.md) — full schema, flow, migration cookbook
- [`../../src/M365-Assess/Common/SecurityConfigHelper.ps1`](../../src/M365-Assess/Common/SecurityConfigHelper.ps1) — `Add-SecuritySetting` (the contract)
- [`0005-nine-status-taxonomy.md`](0005-nine-status-taxonomy.md) — status taxonomy this evidence model complements
- [`README.md`](README.md) — back to the ADR index
