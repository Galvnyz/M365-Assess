# Multi-Framework Compliance

The HTML report includes a **Compliance Overview** section that maps all assessed security controls across 15 compliance frameworks simultaneously. No parameters needed; all framework data is always included.

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
| FedRAMP | varies | Coverage mapping |
| Essential Eight | 8 | Coverage mapping |
| CIS Controls v8 | 153 | Coverage mapping |
| MITRE ATT&CK | varies | Coverage mapping |
| Entra ID STIG V1R1 | 10 | DISA security controls for Entra ID |

**CIS profiles** show a compliance score (pass rate against benchmarked controls). Other frameworks show coverage mapping, indicating which of your assessed findings align to that framework's controls.

## Compliance Overview Features

The report's Compliance Overview pane provides:

- **Framework selector** with checkbox controls to toggle which frameworks are visible (all on by default)
- **Coverage cards** showing pass rate for CIS profiles and mapped control coverage for other frameworks
- **Status filter** to filter findings by Pass, Fail, Warning, Review, or Info
- **Cross-reference matrix** table with every assessed finding and columns for each framework's mapped control IDs

### License-Aware Check Gating

Added in v1.5.0. When the assessment detects that a tenant lacks a specific service plan (e.g., `AAD_PREMIUM_P2` for Conditional Access authentication strengths), it skips checks that require that plan and marks them as "Not Licensed" in the report. This prevents false negatives for features the tenant cannot use. 25 checks are mapped to specific service plans in `controls/registry.json` via the `requiredServicePlans` field.

### Quick Scan Mode

The `-QuickScan` switch limits the assessment to Critical and High severity checks only, reducing execution time for rapid health checks. The report banner indicates when Quick Scan mode was used.

### Application Security Cluster

21 new `ENTRA-ENTAPP-*` checks audit enterprise application security including dangerous permissions, consent grants, credential hygiene, and app ownership.

### Value Opportunity Analysis

The `-Section ValueOpportunity` parameter enables license utilization and feature adoption analysis. Three collectors (`Get-LicenseUtilization`, `Get-FeatureAdoption`, `Get-FeatureReadiness`) assess which licensed M365 features are actively used, producing an adoption roadmap with quick wins.

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

The assessment suite includes **294 security checks** across 16 security config collectors (Entra, CA Evaluator, EntApp, EXO, DNS, Defender, Compliance, Stryker Readiness, Intune, SharePoint, Teams, Power BI, Forms, Purview Retention, SOC2, AzAssess), each mapped to one or more compliance frameworks.

## Control Registry

Framework mappings are defined in `controls/registry.json`, which contains **1106 control entries** (CheckID v2.21.0 upstream + ENTRA-DISABLED-001). Each entry specifies the check ID, description, and mappings to all applicable frameworks.

To view or edit mappings:

```powershell
# View a specific control
Get-Content .\controls\registry.json | ConvertFrom-Json | Where-Object { $_.checkId -eq 'ENTRA-ADMIN-001' }
```

Framework mappings are stored in two locations:

```
controls/
  registry.json              # Master registry (270 entries) -- contains all framework mappings inline
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
