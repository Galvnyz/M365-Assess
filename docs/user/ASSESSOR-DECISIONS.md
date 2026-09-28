# Assessor decisions

Collected observations and assessor decisions are separate records. An accepted
risk leaves the observed Fail or Warning visible, and a manual attestation leaves
the observed Review visible. Neither increases the observed pass rate. Active
decisions remove matching findings from the actionable queue and remediation
roadmap; the assessor panel and XLSX matrix retain the decision and its evidence.

In the HTML report, enable edit mode and use **Assessor decisions**. Select a
finding and provide a justification, approver, evidence reference, and expiry.
Fail/Warning findings support accepted risk; Review findings support a manual
attestation. An attestation records that an assessor reviewed the control; it is
not an automated verification or certification. Unknown, skipped, unlicensed,
and automated Pass/Fail findings cannot receive manual attestations.

Use **Export decisions JSON** to save the sidecar. Use **Finalize** to save an
HTML copy containing the decisions. Unsaved browser edits do not survive closing
the report. Existing XLSX and JSON files are updated by report regeneration,
not by editing the browser report.

```powershell
Invoke-M365Assessment -TenantId '<tenant>' -AssessmentDecisionsPath './decisions.json'

# Regenerate all report outputs from an existing assessment folder:
& './src/M365-Assess/Common/Export-AssessmentReport.ps1' `
    -AssessmentFolder './assessment' -AssessmentDecisionsPath './decisions.json'
```

The CLI validates and copies the sidecar into the assessment folder before saving
baselines. Report regeneration also discovers `_Assessment-Decisions.json` in
that folder. Keep the exported file and pass it explicitly on later assessments.
The tenant GUID must match the collected tenant; tenant display names are not
identity keys. Invalid or mismatched sidecars stop processing.

Decisions match a base CheckId and exact Setting, not the row's changing numeric
suffix. Ambiguous matches remain inactive. Accepted risk also requires the same
observed value. Expired, future, ineligible, ambiguous, unmatched, or changed-
evidence decisions remain visible for review and cannot suppress actionable work.
Baseline comparisons report decision-only changes as **Modified**, separately
from improved or regressed observations. Expiry is evaluated when reports are
generated or opened; a saved artifact represents its evaluation time.

The sidecar uses `schemas/assessment-decisions.schema.json`, version 1.0. Each
decision includes `checkId`, `setting`, `type`, `observedValue`, `justification`,
`approvedBy`, `approvedAt`, `expiresAt`, and `evidence`. Timestamps use ISO 8601
with timezone. Evidence is a reference or explanatory text, not an uploaded file.

Collection completeness is shown independently. A high observed pass rate does
not compensate for failed collectors, unavailable findings, or pending review.
The Collection Status workbook sheet and JSON collection block preserve those
limitations, even when a failed collector emitted no findings.
