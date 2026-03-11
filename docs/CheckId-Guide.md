# CheckId System Guide

The CheckId system is the backbone of M365-Assess's multi-framework compliance reporting. Each security check gets a framework-agnostic identifier that maps to controls across 13 compliance frameworks simultaneously.

## What Is a CheckId?

A CheckId is a stable, human-readable identifier assigned to every security check in the assessment. Instead of referencing checks by CIS control numbers (which are framework-specific), CheckIds provide a universal key that works across all frameworks.

**Format**: `{COLLECTOR}-{AREA}-{NNN}`

| Part | Description | Examples |
|------|-------------|---------|
| Collector | Which M365 service | `ENTRA`, `EXO`, `DEFENDER`, `SPO`, `TEAMS` |
| Area | Security domain | `ADMIN`, `MFA`, `PASSWORD`, `SHARING`, `MEETING` |
| NNN | Sequential number | `001`, `002`, `003` |

**Examples:**
- `ENTRA-ADMIN-001` — Global administrator count check
- `EXO-FORWARD-001` — Auto-forwarding to external domains
- `DEFENDER-ANTIPHISH-001` — Anti-phishing policy settings
- `SPO-SHARING-004` — Default sharing link type
- `TEAMS-MEETING-003` — Lobby bypass configuration

Manual checks (not yet automated) use the format `MANUAL-CIS-{controlId}` (e.g., `MANUAL-CIS-1-1-1`).

## How Many CheckIds Exist?

| Type | Count | Description |
|------|-------|-------------|
| Automated | 57 | Checked by collectors, appear in CSV output and reports |
| Manual | 94 | CIS benchmark controls not yet automated, tracked for coverage |
| **Total** | **151** | Full registry across all frameworks |

## The Control Registry

All CheckIds live in `controls/registry.json`. Each entry contains:

```json
{
  "checkId": "ENTRA-ADMIN-001",
  "name": "Ensure that between two and four global admins are designated",
  "category": "ADMIN",
  "collector": "Entra",
  "hasAutomatedCheck": true,
  "licensing": { "minimum": "E3" },
  "frameworks": {
    "cis-m365-v6": {
      "controlId": "1.1.3",
      "title": "Ensure that between two and four global admins are designated",
      "profiles": ["E3-L1", "E5-L1"]
    },
    "nist-800-53": { "controlId": "AC-2;AC-6" },
    "nist-csf": { "controlId": "PR.AA-05" },
    "iso-27001": { "controlId": "A.5.15;A.5.18;A.8.2" },
    "stig": { "controlId": "V-260335" },
    "pci-dss": { "controlId": "8.2.x" },
    "cmmc": { "controlId": "3.1.5;3.1.6" },
    "hipaa": { "controlId": "§164.312(a)(1);§164.308(a)(4)(i)" },
    "cisa-scuba": { "controlId": "MS.AAD.7.1v1" },
    "soc2": { "controlId": "CC6.1;CC6.2;CC6.3", "evidenceType": "config-export" }
  }
}
```

**Key fields:**
- `hasAutomatedCheck` — Whether a collector evaluates this check automatically
- `collector` — Which collector script produces the result (Entra, ExchangeOnline, Defender, SharePoint, Teams)
- `licensing.minimum` — E3 or E5 license required
- `frameworks` — Maps to every applicable compliance framework

## Supported Frameworks

| Framework | Registry Key | Notes |
|-----------|-------------|-------|
| CIS M365 v6.0.1 | `cis-m365-v6` | 4 profiles: E3-L1, E3-L2, E5-L1, E5-L2 |
| NIST 800-53 Rev 5 | `nist-800-53` | Control families (AC, AU, IA, CM, etc.) |
| NIST CSF 2.0 | `nist-csf` | Functions and categories (PR.AC, DE.CM, etc.) |
| ISO 27001:2022 | `iso-27001` | Annex A controls |
| DISA STIG | `stig` | Vulnerability IDs (V-xxxxxx) |
| PCI DSS v4.0.1 | `pci-dss` | Requirements |
| CMMC 2.0 | `cmmc` | Practices (3.x.x) |
| HIPAA Security Rule | `hipaa` | §164.3xx references |
| CISA SCuBA | `cisa-scuba` | MS.AAD/EXO/DEFENDER/SPO/TEAMS baselines |
| SOC 2 TSC | `soc2` | Trust Services Criteria (CC/A/C/PI/P) |

SOC 2 mappings are auto-derived from NIST 800-53 control families using rules in `controls/Build-Registry.ps1`.

## How It Works End-to-End

```
Collector runs          CSV output              Report generator
─────────────          ──────────              ────────────────
Entra collector   →  CheckId column in CSV  →  Looks up CheckId
checks settings      (e.g., ENTRA-ADMIN-001)   in registry.json
                                                    │
                                                    ▼
                                              Extracts ALL framework
                                              mappings from one entry
                                                    │
                                                    ▼
                                              Populates 13 framework
                                              columns in compliance
                                              matrix (HTML + XLSX)
```

1. **Collectors** evaluate security settings and tag each finding with a CheckId
2. **CSV output** contains the CheckId as a column alongside Status, Setting, Remediation
3. **Report generator** loads the control registry, looks up each CheckId, and extracts all framework mappings
4. **Compliance matrix** shows one row per check with columns for every framework's control IDs

## Status Values

Each check produces one of five statuses:

| Status | Meaning | Scoring |
|--------|---------|---------|
| Pass | Meets benchmark requirement | Counted in pass rate |
| Fail | Violates benchmark — CIS says "Ensure" and the setting is wrong | Counted in pass rate |
| Warning | Degraded security — suboptimal but not a hard violation | Counted in pass rate |
| Review | Cannot determine automatically — requires manual assessment | Counted in pass rate |
| Info | Informational data point — no right/wrong answer | **Excluded** from scoring |

## Building the Registry

The registry is generated from two CSV source files:

```
Common/framework-mappings.csv     →  CIS controls + framework cross-references
controls/check-id-mapping.csv     →  CheckId assignments + collector mapping
                                         │
                                         ▼
                               controls/Build-Registry.ps1
                                         │
                                         ▼
                               controls/registry.json (151 entries)
```

To rebuild after editing the source CSVs:

```powershell
.\controls\Build-Registry.ps1
```

## Adding a New CheckId

1. **Assign the CheckId** following the `{COLLECTOR}-{AREA}-{NNN}` convention
2. **Add to `controls/check-id-mapping.csv`** with the CIS control (if applicable), collector, area, and name
3. **Add framework mappings** to the corresponding row in `Common/framework-mappings.csv`
4. **Run `Build-Registry.ps1`** to regenerate `registry.json`
5. **Add the check** to the appropriate collector script using `Add-Setting -CheckId 'YOUR-CHECK-001'`
6. **Run tests** to validate: `Invoke-Pester -Path './tests/controls'`

## Using CheckIds in Reports

The compliance matrix appears in both the HTML report and the XLSX export:

- **HTML report** — Interactive table with framework column toggles and status filters
- **XLSX export** — `_Compliance-Matrix_{tenant}.xlsx` with two sheets: full matrix + per-framework summary with pass rates

Both are driven by the same CheckId → registry lookup. If a check has a CheckId and the registry has an entry, it appears in the compliance matrix automatically.
