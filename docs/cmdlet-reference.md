# M365-Assess Cmdlet Reference

> Module version: 1.2.0 | PowerShell 7.0+ required
>
> All 15 exported functions from the `M365-Assess` module.

## Table of Contents

### Core

- [Invoke-M365Assessment](#invoke-m365assessment) -- Main orchestrator

### Identity

- [Get-M365EntraSecurityConfig](#get-m365entrasecurityconfig) -- Entra ID settings
- [Get-M365CASecurityConfig](#get-m365casecurityconfig) -- Conditional Access policies
- [Get-M365EntAppSecurityConfig](#get-m365entappsecurityconfig) -- Enterprise app posture

### Email

- [Get-M365ExoSecurityConfig](#get-m365exosecurityconfig) -- Exchange Online settings
- [Get-M365DnsSecurityConfig](#get-m365dnssecurityconfig) -- SPF, DKIM, DMARC evaluation

### Security

- [Get-M365DefenderSecurityConfig](#get-m365defendersecurityconfig) -- Defender for Office 365
- [Get-M365ComplianceSecurityConfig](#get-m365compliancesecurityconfig) -- Purview/Compliance settings
- [Get-M365IntuneSecurityConfig](#get-m365intunesecurityconfig) -- Intune/Endpoint Manager

### Collaboration

- [Get-M365SharePointSecurityConfig](#get-m365sharepointsecurityconfig) -- SharePoint and OneDrive
- [Get-M365TeamsSecurityConfig](#get-m365teamssecurityconfig) -- Microsoft Teams
- [Get-M365FormsSecurityConfig](#get-m365formssecurityconfig) -- Microsoft Forms

### Power BI

- [Get-M365PowerBISecurityConfig](#get-m365powerbisecurityconfig) -- Power BI tenant settings

### Purview

- [Get-M365PurviewRetentionConfig](#get-m365purviewretentionconfig) -- Retention compliance policies

### Setup

- [Grant-M365AssessConsent](#grant-m365assessconsent) -- App registration provisioning

---

## Core

### Invoke-M365Assessment

Runs a comprehensive read-only Microsoft 365 environment assessment.

**Description:**
Orchestrates all M365 assessment collector scripts to produce a folder of CSV reports covering identity, email, security, devices, collaboration, and hybrid sync. Each section runs independently -- failures in one section do not block others. All operations are strictly read-only (Get-* cmdlets only). Designed for IT consultants assessing SMB clients (10-500 users) with Microsoft-based cloud environments.

**Required Permissions:** Varies by section. The orchestrator connects to Microsoft Graph, Exchange Online, Purview, and Power BI as needed. Use `Grant-M365AssessConsent` to pre-provision all required permissions.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `Section` | string[] | No | One or more sections to run. Valid: `Tenant`, `Identity`, `Licensing`, `Email`, `Intune`, `Security`, `Collaboration`, `PowerBI`, `Hybrid`, `Inventory`, `ActiveDirectory`, `SOC2`. Defaults to all standard sections. `Inventory`, `ActiveDirectory`, and `SOC2` are opt-in only. |
| `TenantId` | string | No | Tenant ID or domain (e.g., `contoso.onmicrosoft.com`). |
| `OutputFolder` | string | No | Root folder for assessment output. A timestamped subfolder is created automatically. Defaults to `.\M365-Assessment`. |
| `SkipConnection` | switch | No | Use pre-existing service connections instead of connecting automatically. |
| `ClientId` | string | No | Application (client) ID for app-only authentication. |
| `CertificateThumbprint` | string | No | Certificate thumbprint for app-only authentication. |
| `ClientSecret` | SecureString | No | Client secret for app-only auth. Less secure than certificate -- prefer `-CertificateThumbprint` for production. |
| `UserPrincipalName` | string | No | UPN (e.g., `admin@contoso.onmicrosoft.com`) for interactive auth to EXO/Purview. Bypasses WAM broker errors on some systems. |
| `ManagedIdentity` | switch | No | Use Azure managed identity auth. Requires running on an Azure resource with managed identity. Purview and Power BI fall back with a warning. |
| `UseDeviceCode` | switch | No | Use device code auth flow. Displays a code and URL for browser-based auth -- useful on multi-profile machines. Purview does not support device code and falls back. |
| `M365Environment` | string | No | Target cloud: `commercial`, `gcc`, `gcchigh`, `dod`. Auto-detected from tenant metadata when not specified. |
| `NoBranding` | switch | No | Suppress branding in the HTML report. |
| `SkipDLP` | switch | No | Skip DLP policy collector and Purview connection (saves ~46s of latency). |
| `SkipComplianceOverview` | switch | No | Omit the Compliance Overview section from the HTML report. |
| `SkipCoverPage` | switch | No | Omit the branded cover page from the HTML report. |
| `SkipExecutiveSummary` | switch | No | Omit the executive summary hero panel from the HTML report. |
| `SkipPdf` | switch | No | Skip PDF generation even when wkhtmltopdf is available. |
| `OpenReport` | switch | No | Open the HTML report in the default browser after generation. |
| `FrameworkFilter` | string[] | No | Limit compliance overview to specific frameworks: `CIS`, `NIST`, `ISO`, `STIG`, `PCI`, `CMMC`, `HIPAA`, `CISA`, `SOC2`, `FedRAMP`, `Essential8`, `MITRE`, `CISv8`. |
| `CustomBranding` | hashtable | No | White-label reports. Keys: `CompanyName`, `LogoPath`, `AccentColor`. |
| `FrameworkExport` | string[] | No | Generate standalone per-framework HTML catalog exports. Specify framework families or `All`. |
| `CisBenchmarkVersion` | string | No | CIS benchmark version for rendering. Defaults to `v6`. Set to `v7` when v7 data is available. |
| `NonInteractive` | switch | No | Suppress all interactive prompts. Missing required modules log the fix command and exit. Missing optional modules skip the section with a warning. Use for CI/CD and headless environments. |

**Output:** Assessment folder containing CSV reports, an HTML report, optional XLSX compliance matrix, and optional PDF.

**Examples:**

```powershell
# Full assessment with interactive auth
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com'

# Identity and Email sections only
Invoke-M365Assessment -Section Identity,Email -TenantId 'contoso.onmicrosoft.com'

# Use pre-existing connections
Invoke-M365Assessment -SkipConnection

# Certificate-based app-only auth
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' `
    -ClientId '00000000-0000-0000-0000-000000000000' `
    -CertificateThumbprint 'ABC123'

# UPN-based auth (avoids WAM broker errors)
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' `
    -UserPrincipalName 'admin@contoso.onmicrosoft.com'

# Device code auth for multi-profile machines
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.us' -UseDeviceCode
```

---

## Identity

### Get-M365EntraSecurityConfig

Collects Entra ID security configuration settings for M365 assessment.

**Description:**
Queries Microsoft Graph for security-relevant Entra ID configuration settings including user consent policies, admin consent workflow, application registration policies, self-service password reset, password protection, and global admin counts. Returns a structured inventory of settings with current values and recommendations. Aligned with CIS Microsoft 365 Foundations Benchmark v6.0.1.

**Required Permissions:** Microsoft Graph -- `Policy.Read.All`, `User.Read.All`, `RoleManagement.Read.Directory`, `Directory.Read.All`. Requires `Microsoft.Graph.Identity.DirectoryManagement` and `Microsoft.Graph.Identity.SignIns` modules.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `OutputPath` | string | No | Path to export results as CSV. If not specified, results are returned to the pipeline. |

**Output:** Array of security setting objects with Category, Setting, CurrentValue, RecommendedValue, Status, CheckId, and Remediation properties.

**Examples:**

```powershell
# Display Entra ID security settings
Get-M365EntraSecurityConfig

# Export to CSV
Get-M365EntraSecurityConfig -OutputPath '.\entra-security-config.csv'
```

---

### Get-M365CASecurityConfig

Evaluates Conditional Access policies against CIS Microsoft 365 Foundations Benchmark requirements.

**Description:**
Fetches all Conditional Access policies via Microsoft Graph and evaluates them against CIS 5.2.2.x requirements. Each check filters enabled policies for specific condition and grant/session control combinations. Detects Security Defaults and adjusts verdicts accordingly. Aligned with CIS Microsoft 365 Foundations Benchmark v6.0.1.

**Required Permissions:** Microsoft Graph -- `Policy.Read.All`.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `OutputPath` | string | No | Path to export results as CSV. If not specified, results are returned to the pipeline. |

**Output:** Array of security setting objects with Category, Setting, CurrentValue, RecommendedValue, Status, CheckId, and Remediation properties.

**Examples:**

```powershell
# Display CA policy evaluation
Get-M365CASecurityConfig

# Export to CSV
Get-M365CASecurityConfig -OutputPath '.\ca-security-config.csv'
```

---

### Get-M365EntAppSecurityConfig

Evaluates enterprise application and service principal security posture in Entra ID.

**Description:**
Queries Microsoft Graph for service principals, their credentials, application role assignments, delegated permissions, and managed identity configurations. Identifies risky permission patterns including foreign apps with dangerous permissions, stale credentials, excessive permission counts, and managed identity over-provisioning.

**Required Permissions:** Microsoft Graph -- `Application.Read.All`, `Directory.Read.All`.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `OutputPath` | string | No | Path to export results as CSV. If not specified, results are returned to the pipeline. |

**Output:** Array of security setting objects with Category, Setting, CurrentValue, RecommendedValue, Status, CheckId, and Remediation properties.

**Examples:**

```powershell
# Display enterprise app security posture
Get-M365EntAppSecurityConfig

# Export to CSV
Get-M365EntAppSecurityConfig -OutputPath '.\entapp-security-config.csv'
```

---

## Email

### Get-M365ExoSecurityConfig

Collects Exchange Online security configuration settings for M365 assessment.

**Description:**
Queries Exchange Online for security-relevant configuration settings including modern authentication, audit status, external sender identification, mail forwarding controls, OWA policies, and MailTips. Returns a structured inventory of settings with current values and CIS benchmark recommendations. Aligned with CIS Microsoft 365 Foundations Benchmark v6.0.1.

**Required Permissions:** Active Exchange Online connection (`Connect-ExchangeOnline`). The `View-Only Organization Management` role group provides sufficient access.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `OutputPath` | string | No | Path to export results as CSV. If not specified, results are returned to the pipeline. |

**Output:** Array of security setting objects with Category, Setting, CurrentValue, RecommendedValue, Status, CheckId, and Remediation properties.

**Examples:**

```powershell
# Display Exchange Online security settings
Get-M365ExoSecurityConfig

# Export to CSV
Get-M365ExoSecurityConfig -OutputPath '.\exo-security-config.csv'
```

---

### Get-M365DnsSecurityConfig

Evaluates DNS authentication records (SPF, DKIM, DMARC) against CIS requirements.

**Description:**
Checks all authoritative accepted domains for proper SPF, DKIM, and DMARC configuration. Produces pass/fail verdicts for each protocol per domain. Uses a cross-platform DNS resolver (Resolve-DnsName on Windows, dig on macOS/Linux). Aligned with CIS Microsoft 365 Foundations Benchmark v6.0.1.

**Required Permissions:** Active Exchange Online connection for `Get-AcceptedDomain` and `Get-DkimSigningConfig`, unless pre-cached data is provided via parameters.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `OutputPath` | string | No | Path to export results as CSV. If not specified, results are returned to the pipeline. |
| `AcceptedDomains` | object[] | No | Pre-cached accepted domain objects from the orchestrator. Skips the `Get-AcceptedDomain` call when provided. |
| `DkimConfigs` | object[] | No | Pre-cached DKIM signing configuration objects. Skips the `Get-DkimSigningConfig` call when provided. |

**Output:** Array of security setting objects with Category, Setting, CurrentValue, RecommendedValue, Status, CheckId, and Remediation properties.

**Examples:**

```powershell
# Evaluate DNS authentication for all accepted domains
Get-M365DnsSecurityConfig

# Export to CSV
Get-M365DnsSecurityConfig -OutputPath '.\dns-security-config.csv'
```

---

## Security

### Get-M365DefenderSecurityConfig

Collects Microsoft Defender for Office 365 security configuration settings for M365 assessment.

**Description:**
Queries Exchange Online Protection and Defender for Office 365 policies to evaluate security configuration including anti-phishing (impersonation protection, DMARC enforcement), anti-spam (threshold levels, bulk filtering), anti-malware (common attachment filter, ZAP), Safe Links, and Safe Attachments. Handles tenants without Defender for Office 365 licensing gracefully. Aligned with CIS Microsoft 365 Foundations Benchmark v6.0.1.

**Required Permissions:** Active Exchange Online connection (`Connect-ExchangeOnline`). Some checks require Defender for Office 365 Plan 1 or Plan 2 licensing.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `OutputPath` | string | No | Path to export results as CSV. If not specified, results are returned to the pipeline. |

**Output:** Array of security setting objects with Category, Setting, CurrentValue, RecommendedValue, Status, CheckId, and Remediation properties.

**Examples:**

```powershell
# Display Defender security settings
Get-M365DefenderSecurityConfig

# Export to CSV
Get-M365DefenderSecurityConfig -OutputPath '.\defender-security-config.csv'
```

---

### Get-M365ComplianceSecurityConfig

Collects Microsoft Purview/Compliance security configuration settings for M365 assessment.

**Description:**
Queries Security & Compliance PowerShell for compliance-related security settings including unified audit log, DLP policies, and sensitivity labels. Returns a structured inventory of settings with current values and CIS benchmark recommendations. Aligned with CIS Microsoft 365 Foundations Benchmark v6.0.1.

**Required Permissions:** Active Security & Compliance (Purview) connection via `Connect-IPPSSession`.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `OutputPath` | string | No | Path to export results as CSV. If not specified, results are returned to the pipeline. |

**Output:** Array of security setting objects with Category, Setting, CurrentValue, RecommendedValue, Status, CheckId, and Remediation properties.

**Examples:**

```powershell
# Display Purview/Compliance security settings
Get-M365ComplianceSecurityConfig

# Export to CSV
Get-M365ComplianceSecurityConfig -OutputPath '.\compliance-security-config.csv'
```

---

### Get-M365IntuneSecurityConfig

Evaluates Intune/Endpoint Manager security settings against CIS requirements.

**Description:**
Checks device compliance and enrollment configurations for proper security posture. Produces pass/fail verdicts for each control. Aligned with CIS Microsoft 365 Foundations Benchmark v6.0.1.

**Required Permissions:** Microsoft Graph -- `DeviceManagementConfiguration.Read.All` (via `Microsoft.Graph.DeviceManagement` module).

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `OutputPath` | string | No | Path to export results as CSV. If not specified, results are returned to the pipeline. |

**Output:** Array of security setting objects with Category, Setting, CurrentValue, RecommendedValue, Status, CheckId, and Remediation properties.

**Examples:**

```powershell
# Display Intune security evaluation
Get-M365IntuneSecurityConfig

# Export to CSV
Get-M365IntuneSecurityConfig -OutputPath '.\intune-security-config.csv'
```

---

## Collaboration

### Get-M365SharePointSecurityConfig

Collects SharePoint Online and OneDrive security configuration settings for M365 assessment.

**Description:**
Queries Microsoft Graph and SharePoint admin settings for security-relevant configuration including external sharing levels, default link types, re-sharing controls, sync client restrictions, and legacy authentication. Aligned with CIS Microsoft 365 Foundations Benchmark v6.0.1.

**Required Permissions:** Microsoft Graph -- `SharePointTenantSettings.Read.All`.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `OutputPath` | string | No | Path to export results as CSV. If not specified, results are returned to the pipeline. |

**Output:** Array of security setting objects with Category, Setting, CurrentValue, RecommendedValue, Status, CheckId, and Remediation properties.

**Examples:**

```powershell
# Display SharePoint and OneDrive security settings
Get-M365SharePointSecurityConfig

# Export to CSV
Get-M365SharePointSecurityConfig -OutputPath '.\spo-security-config.csv'
```

---

### Get-M365TeamsSecurityConfig

Collects Microsoft Teams security and meeting configuration settings.

**Description:**
Queries Microsoft Graph for Teams security-relevant settings including meeting policies, external access, messaging policies, and third-party app restrictions. Does not support app-only (certificate) authentication -- requires delegated (interactive) auth. Automatically detects tenants without Teams licensing and skips gracefully. Aligned with CIS Microsoft 365 Foundations Benchmark v6.0.1.

**Required Permissions:** Microsoft Graph -- `TeamSettings.Read.All`, `TeamworkAppSettings.Read.All`. Delegated auth only (app-only not supported by Teams Graph APIs).

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `OutputPath` | string | No | Path to export results as CSV. If not specified, results are returned to the pipeline. |

**Output:** Array of security setting objects with Category, Setting, CurrentValue, RecommendedValue, Status, CheckId, and Remediation properties.

**Examples:**

```powershell
# Display Teams security settings (delegated auth required)
Get-M365TeamsSecurityConfig
```

---

### Get-M365FormsSecurityConfig

Collects Microsoft Forms tenant security and configuration settings.

**Description:**
Queries Microsoft Graph for Microsoft Forms admin settings including external sharing controls, phishing protection, and respondent identity recording. Aligned with CIS Microsoft 365 Foundations Benchmark v6.0.1.

**Required Permissions:** Microsoft Graph -- `OrgSettings-Forms.Read.All`.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `OutputPath` | string | No | Path to export results as CSV. If not specified, results are returned to the pipeline. |

**Output:** Array of security setting objects with Category, Setting, CurrentValue, RecommendedValue, Status, CheckId, and Remediation properties.

**Examples:**

```powershell
# Display Forms security settings
Get-M365FormsSecurityConfig

# Export to CSV
Get-M365FormsSecurityConfig -OutputPath '.\forms-security-config.csv'
```

---

## Power BI

### Get-M365PowerBISecurityConfig

Collects Power BI security and tenant configuration settings.

**Description:**
Queries Power BI tenant settings for security-relevant configuration including guest access, external sharing, publish to web, sensitivity labels, and service principal restrictions. Uses `Invoke-PowerBIRestMethod` to query the admin API. Aligned with CIS Microsoft 365 Foundations Benchmark v6.0.1.

**Required Permissions:** Requires the `MicrosoftPowerBIMgmt` PowerShell module and an active Power BI connection via `Connect-PowerBIServiceAccount`.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `OutputPath` | string | No | Path to export results as CSV. If not specified, results are returned to the pipeline. |

**Output:** Array of security setting objects with Category, Setting, CurrentValue, RecommendedValue, Status, CheckId, and Remediation properties.

**Examples:**

```powershell
# Display Power BI security settings
Get-M365PowerBISecurityConfig

# Export to CSV
Get-M365PowerBISecurityConfig -OutputPath '.\powerbi-security-config.csv'
```

---

## Purview

### Get-M365PurviewRetentionConfig

Collects Microsoft Purview data lifecycle retention compliance policy configuration.

**Description:**
Queries the Security & Compliance Center for retention compliance policies and their associated rules. Reports on policy existence, workload coverage (Exchange, Teams, SharePoint/OneDrive), and enforcement mode -- essential for verifying that data lifecycle management requirements are met per regulatory and organizational standards. Aligned with CIS Microsoft 365 Foundations Benchmark v6.0.1 and NIST SP 800-53 AU-11 (Audit Record Retention).

**Required Permissions:** Active Security & Compliance (Purview) connection via `Connect-IPPSSession` or `Connect-Service -Service Purview`.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `OutputPath` | string | No | Path to export results as CSV. If not specified, results are returned to the pipeline. |

**Output:** Array of security setting objects with Category, Setting, CurrentValue, RecommendedValue, Status, CheckId, and Remediation properties.

**Examples:**

```powershell
# Display Purview retention policy configuration
Get-M365PurviewRetentionConfig

# Export to CSV
Get-M365PurviewRetentionConfig -OutputPath '.\purview-retention-config.csv'
```

---

## Setup

### Grant-M365AssessConsent

Creates and configures an Entra ID app registration with all permissions required by M365-Assess.

**Description:**
Provisions a read-only service principal for `Invoke-M365Assessment` with:

- 22 Microsoft Graph API application permissions (all `.Read.All`)
- 3 Entra ID directory roles (Security Reader, Compliance Admin, Global Reader)
- 2 Exchange Online RBAC role groups (View-Only Org Management, Compliance Management)

Supports creating a new app registration from scratch (`-CreateNew`) or configuring an existing one. Saves credentials to `.m365assess.json` for automatic detection by the assessment. Requires Global Administrator or Application Administrator rights.

**Required Permissions:** Global Administrator or Application Administrator in Entra ID. Exchange Administrator for RBAC role group assignment.

**Required Modules:**

- `Microsoft.Graph.Authentication`
- `Microsoft.Graph.Applications`
- `Microsoft.Graph.Identity.Governance`
- `ExchangeOnlineManagement`

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `TenantId` | string | Yes | Tenant ID or domain (e.g., `contoso.onmicrosoft.com`). |
| `CreateNew` | switch | No | Creates a new app registration and self-signed certificate from scratch. Uses delegated auth for the bootstrap. Requires `-AdminUpn`. |
| `ClientId` | string | Yes (Existing) | Application (Client) ID of an existing app registration to configure. Required when not using `-CreateNew`. |
| `AppDisplayName` | string | No | Display name for the app registration. Default: `M365-Assess-Reader`. With `-CreateNew`, names the new app. Without, looks up an existing app by name. |
| `CertificateThumbprint` | string | No | Thumbprint of a certificate in `Cert:\CurrentUser\My` for app-only Graph auth. Must be uploaded to the app registration. Not required with `-CreateNew`. |
| `CertificateExpiryYears` | int | No | Years before the generated certificate expires. Default: 2. Only used with `-CreateNew`. Range: 1-10. |
| `AdminUpn` | string | No | UPN of an Exchange/Global Administrator for delegated sessions (app creation, compliance roles, EXO RBAC). Required with `-CreateNew` and for EXO/compliance steps. |
| `SkipGraph` | switch | No | Skip Microsoft Graph API permission assignment. |
| `SkipExchangeRbac` | switch | No | Skip Exchange Online role group assignment. |
| `SkipComplianceRoles` | switch | No | Skip Purview/Compliance Entra directory role assignment. |

**Output:** PSCustomObject with ClientId, CertificateThumbprint, and TenantId for use with `Invoke-M365Assessment`.

**Examples:**

```powershell
# Create a new app registration with all permissions
Grant-M365AssessConsent -TenantId 'contoso.onmicrosoft.com' `
    -AdminUpn 'admin@contoso.onmicrosoft.com' -CreateNew

# Configure an existing app registration
Grant-M365AssessConsent -TenantId 'contoso.onmicrosoft.com' `
    -ClientId '00000000-0000-0000-0000-000000000000' `
    -CertificateThumbprint 'ABC123DEF456' `
    -AdminUpn 'admin@contoso.onmicrosoft.com'

# Graph permissions only (no AdminUpn required)
Grant-M365AssessConsent -TenantId 'contoso.onmicrosoft.com' `
    -ClientId '00000000-0000-0000-0000-000000000000' `
    -CertificateThumbprint 'ABC123DEF456' `
    -SkipExchangeRbac -SkipComplianceRoles
```
