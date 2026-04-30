# CheckId System Guide

The CheckId system is the backbone of M365-Assess's multi-framework compliance reporting. Each security check gets a framework-agnostic identifier that maps to controls across 15 compliance frameworks simultaneously.

## What Is a CheckId?

A CheckId is a stable, human-readable identifier assigned to every security check in the assessment. Instead of referencing checks by CIS control numbers (which are framework-specific), CheckIds provide a universal key that works across all frameworks.

**Format**: `{COLLECTOR}-{AREA}-{NNN}`

| Part | Description | Examples |
|------|-------------|---------|
| Collector | Which M365 service | `ENTRA`, `EXO`, `DEFENDER`, `SPO`, `TEAMS`, `CA`, `DNS`, `INTUNE`, `COMPLIANCE` |
| Area | Security domain | `ADMIN`, `MFA`, `PASSWORD`, `SHARING`, `MEETING`, `HYBRID`, `SCRIPT`, `B2B` |
| NNN | Sequential number | `001`, `002`, `003` |

**Examples:**
- `ENTRA-ADMIN-001` -- Global administrator count check
- `ENTRA-HYBRID-001` -- Password hash sync for hybrid deployments
- `CA-BLOCK-001` -- Conditional Access policy evaluation
- `EXO-FORWARD-001` -- Auto-forwarding to external domains
- `DNS-SPF-001` -- SPF record validation
- `DEFENDER-ANTIPHISH-001` -- Anti-phishing policy settings
- `SPO-SHARING-004` -- Default sharing link type
- `SPO-SCRIPT-001` -- Custom script execution restriction
- `TEAMS-MEETING-003` -- Lobby bypass configuration
- `INTUNE-ENROLL-001` -- Device enrollment restrictions

### Sub-Numbering

When a single CheckId evaluates multiple settings (e.g., an anti-phishing policy has several configurable thresholds), collectors auto-append a sub-number:

- `DEFENDER-ANTIPHISH-001.1` -- Phishing email threshold
- `DEFENDER-ANTIPHISH-001.2` -- Spoof action
- `DEFENDER-ANTIPHISH-001.3` -- Mailbox intelligence action

This is handled automatically by the `Add-Setting` function's `$checkIdCounter` hash in each collector. The registry entry uses the base CheckId (`DEFENDER-ANTIPHISH-001`); the sub-numbers appear only in CSV output and the report.

### Manual Check Format

Controls not yet automated use the format `MANUAL-CIS-{controlId}` (e.g., `MANUAL-CIS-1-1-1`). When a manual check gets automated, the MANUAL entry receives a `supersededBy` field pointing to the new automated CheckId.

## How Many CheckIds Exist?

| Type | Count | Description |
|------|-------|-------------|
| Automated | 214 | Checked by collectors, appear in CSV output and reports |
| Superseded | 81 | Former manual checks now replaced by automated equivalents |
| Manual | 3 | CIS benchmark controls not yet automated, tracked for coverage |
| **Total** | **298** | Full registry across all frameworks |

## The Control Registry

All CheckIds live in `controls/registry.json`. Each entry contains:

```json
{
  "checkId": "ENTRA-ADMIN-001",
  "name": "Ensure that between two and four global admins are designated",
  "category": "ADMIN",
  "collector": "Entra",
  "hasAutomatedCheck": true,
  "licensing": { "requiredServicePlans": [] },
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
- `hasAutomatedCheck` -- Whether a collector evaluates this check automatically
- `collector` -- Which collector script produces the result (see Collectors table below)
- `licensing.requiredServicePlans` -- Array of service plan names required (empty = no gating)
- `frameworks` -- Maps to every applicable compliance framework
- `supersededBy` -- (on MANUAL entries) Points to the automated CheckId that replaced it

### Collectors

| Registry Name | Script | Section |
|--------------|--------|---------|
| `Entra` | `Entra/Get-EntraSecurityConfig.ps1` | Identity |
| `CAEvaluator` | `Entra/Get-CASecurityConfig.ps1` | Identity |
| `EntApp` | `Entra/Get-EntAppSecurityConfig.ps1` | Identity |
| `ExchangeOnline` | `Exchange-Online/Get-ExoSecurityConfig.ps1` | Email |
| `DNS` | `Exchange-Online/Get-DnsSecurityConfig.ps1` | Email |
| `Defender` | `Security/Get-DefenderSecurityConfig.ps1` | Security |
| `Compliance` | `Security/Get-ComplianceSecurityConfig.ps1` | Security |
| `StrykerReadiness` | `Security/Get-StrykerIncidentReadiness.ps1` | Security |
| `Intune` | `Intune/Get-IntuneSecurityConfig.ps1` | Intune |
| `SharePoint` | `Collaboration/Get-SharePointSecurityConfig.ps1` | Collaboration |
| `Teams` | `Collaboration/Get-TeamsSecurityConfig.ps1` | Collaboration |
| `Forms` | `Collaboration/Get-FormsSecurityConfig.ps1` | Collaboration |
| `PowerBI` | `PowerBI/Get-PowerBISecurityConfig.ps1` | PowerBI |
| `PurviewRetention` | `Purview/Get-PurviewRetentionConfig.ps1` | Security |
| `SOC2` | `SOC2/Get-SOC2SecurityConfig.ps1` | SOC2 |

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
| HIPAA Security Rule | `hipaa` | Sec. 164.3xx references |
| CISA SCuBA | `cisa-scuba` | MS.AAD/EXO/DEFENDER/SPO/TEAMS baselines |
| SOC 2 TSC | `soc2` | Trust Services Criteria (CC/A/C/PI/P) |
| FedRAMP | `fedramp` | Federal Risk and Authorization Management Program |
| Essential Eight | `essential-eight` | Australian Cyber Security Centre maturity model |
| CIS Controls v8 | `cis-controls-v8` | CIS Critical Security Controls |
| MITRE ATT&CK | `mitre-attack` | Adversary techniques and mitigations |
| Entra ID STIG V1R1 | `entra-id-stig` | DISA security controls for Entra ID |

SOC 2 mappings are auto-derived from NIST 800-53 control families using rules in `controls/Build-Registry.ps1`.

## How It Works End-to-End

```
Collector runs          CSV output              Report generator
---------------        ----------              ----------------
Entra collector   ->  CheckId column in CSV  ->  Looks up CheckId
checks settings      (e.g., ENTRA-ADMIN-001)   in registry.json
                                                    |
                                                    v
                                              Extracts ALL framework
                                              mappings from one entry
                                                    |
                                                    v
                                              Populates 15 framework
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
| Fail | Violates benchmark -- CIS says "Ensure" and the setting is wrong | Counted in pass rate |
| Warning | Degraded security -- suboptimal but not a hard violation | Counted in pass rate |
| Review | Cannot determine automatically -- requires manual assessment | Counted in pass rate |
| Info | Informational data point -- no right/wrong answer | **Excluded** from scoring |

## Superseded Checks

When a manual check gets automated, the MANUAL entry is kept in the registry with a `supersededBy` field:

```json
{
  "checkId": "MANUAL-CIS-5-1-2-4",
  "name": "Ensure access to the Entra admin center is restricted",
  "hasAutomatedCheck": false,
  "supersededBy": "ENTRA-ADMIN-002",
  ...
}
```

Superseded entries are excluded from:
- Active check counts
- Compliance matrix pass rates
- Progress display totals

They remain in the registry for historical traceability and to prevent duplicate CheckId assignments.

## Building the Registry

The registry can be generated from two CSV source files:

```
Common/framework-mappings.csv     ->  CIS controls + framework cross-references
controls/check-id-mapping.csv     ->  CheckId assignments + collector mapping
                                         |
                                         v
                               controls/Build-Registry.ps1
                                         |
                                         v
                               controls/registry.json (298 entries)
```

To rebuild after editing the source CSVs:

```powershell
.\controls\Build-Registry.ps1
```

> **Note:** New automated checks added since v0.7.0 are typically added directly to `registry.json` rather than going through the CSV pipeline. Both approaches produce the same registry format.

## Adding a New CheckId

1. **Assign the CheckId** following the `{COLLECTOR}-{AREA}-{NNN}` convention
2. **Add the entry** to `controls/registry.json` with framework mappings
3. **If superseding a manual check**, add `"supersededBy": "YOUR-CHECK-001"` to the MANUAL entry
4. **Add the check** to the appropriate collector script using `Add-Setting -CheckId 'YOUR-CHECK-001'`
5. **Run tests** to validate: `Invoke-Pester -Path './tests/controls'`

### Checklist for New Checks

- [ ] CheckId follows `{COLLECTOR}-{AREA}-{NNN}` format
- [ ] Registry entry has `hasAutomatedCheck: true`, `collector`, `category`, and `licensing`
- [ ] All applicable framework mappings included (at minimum: `cis-m365-v6`, `nist-800-53`, `soc2`)
- [ ] Collector uses `Add-Setting` with `-CheckId` parameter
- [ ] Status logic: Pass/Fail for deterministic checks, Review for API gaps, Info for data points
- [ ] Remediation text includes specific portal path or PowerShell command
- [ ] MANUAL entry (if exists) has `supersededBy` pointing to new CheckId
- [ ] Registry integrity tests pass (7/7)

## Using CheckIds in Reports

The compliance matrix appears in both the HTML report and the XLSX export:

- **HTML report** -- Interactive table with framework column toggles and status filters
- **XLSX export** -- `_Compliance-Matrix_{tenant}.xlsx` with two sheets: full matrix + per-framework summary with pass rates

Both are driven by the same CheckId -> registry lookup. If a check has a CheckId and the registry has an entry, it appears in the compliance matrix automatically.
