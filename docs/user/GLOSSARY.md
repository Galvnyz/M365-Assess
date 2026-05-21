# Glossary

Terms used in the M365-Assess HTML report, the registry, and these docs. One short definition per term, alphabetical, with a pointer to the canonical doc when one exists.

---

### Baseline

A snapshot of an assessment, captured automatically (`-AutoBaseline`) or on demand. Used to compare two runs and surface drift (newly-failing checks, newly-passing checks, status flips). Lives under `M365-Assessment/Baselines/`.

### Check

One observation produced by a collector — e.g., "MFA is enabled on all admin accounts." Each check has a unique **CheckId** (e.g., `ENTRA-ADMIN-001`), a **status** (Pass / Fail / Review / etc.), and a **finding** (the human-readable result).

Compare to **Control** below — a Check is what M365-Assess runs; a Control is what a framework expects.

### CheckId

The stable identifier for a check (e.g., `ENTRA-ADMIN-001`). Defined upstream in CheckID and synced into M365-Assess's registry. CheckIds are sub-numbered when a single check produces multiple findings (e.g., `ENTRA-ADMIN-001.1`, `ENTRA-ADMIN-001.2`).

See [`dev/CheckId-Guide.md`](../dev/CheckId-Guide.md) for the naming convention.

### Collector

A PowerShell script that connects to a Microsoft 365 service and produces checks. Lives under `src/M365-Assess/<domain>/Get-*.ps1`. Multiple collectors compose a [Section](#section).

### Control

A requirement defined by a compliance framework (e.g., CIS M365 1.1.1, NIST 800-53 IA-2). M365-Assess [Checks](#check) map to one or more Controls via the registry's `frameworks` field.

### Finding

The user-visible outcome of a check — title, status, current value, recommended value, remediation. Renders as one row in the findings table.

### Framework

A compliance standard or benchmark M365-Assess maps findings to. There are 15: CIS Controls v8, CIS M365 v6, NIST 800-53 r5, NIST CSF, CMMC, ISO 27001, ISO 27002, SOC 2, PCI-DSS v4, HIPAA, FedRAMP, MITRE ATT&CK, STIG, CISA SCUBA, Essential Eight.

### Lane

The remediation horizon assigned to a Fail finding: **Now** (immediate), **Next** (within sprint), **Later** (backlog), or **Done** (Pass — no remediation needed). Computed by `Get-RemediationLane.ps1` based on severity, license tier, and effort.

Synonym in the report: **Sequence** (see below).

### Level

A maturity classification within a framework. CIS uses **L1 / L2 / L3** (basic / intermediate / advanced); CMMC uses the same; CIS Controls v8 uses **IG1 / IG2 / IG3** (Implementation Group 1 through 3). The FilterBar's profile chips slice findings by level.

### Profile

In some frameworks (CIS Controls v8, CMMC), Profile is the formal name for what the report calls Level. Treat them as synonyms.

### Registry

The canonical catalog of all checks M365-Assess can run, including each check's framework mappings, severity, license requirements, and remediation guidance. Lives at `src/M365-Assess/controls/registry.json` and is synced from upstream CheckID weekly.

### Section

A grouping of related collectors run together — e.g., **Identity**, **Email**, **Security**. The report's home view surfaces sections as the top-level navigation. Configurable via `-Section` on `Invoke-M365Assessment`.

See [`SCOPE.md`](SCOPE.md) for the full section catalog.

### Sequence

The user-facing label for a finding's [Lane](#lane). Renders as a colour-coded pill in the findings table: **Now** (red) / **Next** (amber) / **Later** (blue) / **Done** (green).

### Severity

The risk level of a Fail finding: **Critical / High / Medium / Low / Info**. Set per-check in `risk-severity.json`. Drives the order findings appear in default-sorted views and influences the [Lane](#lane) computation.

### Status

The outcome category of a check: **Pass**, **Fail**, **Warning**, **Review**, **Info**, **Skipped**, **Unknown**, **NotApplicable**, **NotLicensed**.

Pass / Fail / Warning count toward the Pass% denominator; the others don't. See [`UNDERSTANDING-RESULTS.md`](UNDERSTANDING-RESULTS.md) for the user-facing explanation and [`reference/CHECK-STATUS-MODEL.md`](../reference/CHECK-STATUS-MODEL.md) for the implementer detail.

---

## See also

- [`UNDERSTANDING-RESULTS.md`](UNDERSTANDING-RESULTS.md) — what each status means for you
- [`SCOPE.md`](SCOPE.md) — section catalog and what's in / out of scope
- [`REPORT-USER-GUIDE.md`](REPORT-USER-GUIDE.md) — using the HTML report
- [`INDEX.md`](../INDEX.md) — back to the docs index
