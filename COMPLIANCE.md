# Multi-Framework Compliance

The HTML report includes a **Compliance Overview** section that maps all assessed security controls across 13 compliance frameworks simultaneously. No parameters needed; all framework data is always included.

## Supported Frameworks

| Framework | Controls | Type |
|-----------|----------|------|
| CIS M365 E3 Level 1 | 86 | CIS Benchmark v6.0.1 compliance score |
| CIS M365 E3 Level 2 | 34 | CIS Benchmark v6.0.1 compliance score |
| CIS M365 E5 Level 1 | 97 | CIS Benchmark v6.0.1 compliance score |
| CIS M365 E5 Level 2 | 43 | CIS Benchmark v6.0.1 compliance score |
| NIST 800-53 Rev 5 | 1,189 | Coverage mapping |
| NIST CSF 2.0 | 106 | Coverage mapping |
| ISO 27001:2022 | 93 | Coverage mapping |
| DISA STIG | 148 | Coverage mapping |
| PCI DSS v4.0.1 | 64 | Coverage mapping |
| CMMC 2.0 | 110 | Coverage mapping |
| HIPAA Security Rule | 45 | Coverage mapping |
| CISA SCuBA | 80 | Coverage mapping |
| SOC 2 TSC | varies | Coverage mapping |

**CIS profiles** show a compliance score (pass rate against benchmarked controls). Other frameworks show coverage mapping, indicating which of your assessed findings align to that framework's controls.

## Compliance Overview Features

The report's Compliance Overview pane provides:

- **Framework selector** with checkbox controls to toggle which frameworks are visible (all on by default)
- **Coverage cards** showing pass rate for CIS profiles and mapped control coverage for other frameworks
- **Status filter** to filter findings by Pass, Fail, Warning, Review, or Info
- **Cross-reference matrix** table with every assessed finding and columns for each framework's mapped control IDs

## CheckId System

Every security check has a unique identifier following the pattern `{COLLECTOR}-{AREA}-{NNN}`:

```
ENTRA-ADMIN-001      Entra ID admin role check #1
EXO-FORWARD-001      Exchange Online forwarding check #1
DEFENDER-SAFELINK-001  Defender Safe Links check #1
```

Individual settings within a check get sub-numbered for traceability:

```
ENTRA-ADMIN-001.1    First setting assessed under ENTRA-ADMIN-001
ENTRA-ADMIN-001.2    Second setting assessed under ENTRA-ADMIN-001
```

The assessment suite includes **149 automated security checks** across 10 security config collectors (Entra, CA Evaluator, EXO, DNS, Defender, Compliance, Intune, SharePoint, Teams, Power BI), each mapped to one or more compliance frameworks.

## Control Registry

Framework mappings are defined in `controls/registry.json`, which contains **233 control entries** (149 automated, 152 active). Each entry specifies the check ID, description, and mappings to all applicable frameworks.

To view or edit mappings:

```powershell
# View a specific control
Get-Content .\controls\registry.json | ConvertFrom-Json | Where-Object { $_.checkId -eq 'ENTRA-ADMIN-001' }
```

Framework mappings are stored in two locations:

```
controls/
  registry.json              # Master registry (233 entries) -- contains all framework mappings inline
  frameworks/
    cis-m365-v6.json         # CIS M365 v6.0.1 benchmark profiles
    soc2-tsc.json            # SOC 2 Trust Services Criteria
```

The master `registry.json` contains all framework mappings embedded in each control entry. The `frameworks/` directory holds supplemental profile definitions for frameworks that need additional metadata (CIS license/level profiles, SOC 2 audit evidence mappings).

## XLSX Compliance Matrix

In addition to the HTML report, the assessment exports an Excel workbook (`_Compliance-Matrix_<Tenant>.xlsx`) with two sheets:

1. **Compliance Matrix** - One row per finding with all framework mappings, color-coded status cells
2. **Summary** - Pass/fail counts and pass rate per framework

The XLSX export requires the [ImportExcel](https://github.com/dfinke/ImportExcel) module:

```powershell
Install-Module ImportExcel -Scope CurrentUser
```

If ImportExcel is not installed, the assessment runs normally but skips the XLSX export with a warning.
