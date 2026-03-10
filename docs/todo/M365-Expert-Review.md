# M365-Assess: Microsoft 365 Expert Review

> **Reviewer**: Microsoft 365 Security Architecture Review
> **Date**: March 2026
> **Solution Version**: 0.4.0
> **Scope**: Comprehensive gap analysis, new collector recommendations, and improvement plan

---

## Executive Summary

M365-Assess is a well-structured PowerShell-based read-only assessment tool targeting IT consultants and MSPs who evaluate SMB Microsoft 365 environments (10–500 users). The solution currently covers **8 standard sections** with **30+ collectors** across Entra ID, Exchange Online, Intune, Security (Defender/DLP), Collaboration (SharePoint/Teams), and Hybrid. It also includes 3 opt-in sections (Inventory, Active Directory, ScubaGear).

**What's done well:**
- Clean, consistent collector pattern (each script is self-contained with params, help, error handling)
- CIS benchmark alignment with multi-framework compliance mapping (12 frameworks)
- Self-contained HTML report with dark mode, charts, and dashboards
- Multi-cloud support (Commercial, GCC, GCC High, DoD)
- Multiple auth methods (interactive, device code, certificate, pre-existing)
- Interactive wizard for non-technical operators
- Comprehensive DNS authentication checking (SPF/DKIM/DMARC per domain)

**Critical gaps identified:**
- **No Entra ID Governance coverage** (PIM, Access Reviews, Entitlement Management) — the #1 Zero Trust gap
- **No Entra ID Protection coverage** (risky users, risk detections, risk policies) — essential for threat posture
- **No Power Platform governance** — a massive shadow IT blind spot in every SMB
- **No Purview data protection depth** — only DLP policies are checked; sensitivity labels, retention, insider risk, and audit configuration are missing
- **No Defender for Cloud Apps** — OAuth app governance is unchecked
- **No guest/external user governance** — B2B access is a common attack vector
- **No sign-in analytics** — legacy auth detection, geographic anomalies, MFA failure patterns
- **Intune coverage is shallow** — missing Autopilot, MAM, endpoint security, encryption, LAPS, update rings
- **No Copilot readiness assessment** — increasingly requested by SMB clients

**Risk Impact Summary:**

| Gap | Risk Level | Effort | Priority |
|-----|-----------|--------|----------|
| Entra ID Governance (PIM/Access Reviews) | CRITICAL | Medium | P1 |
| Entra ID Protection (Risky Users/Sign-ins) | CRITICAL | Low | P1 |
| Power Platform Governance | HIGH | Medium | P1 |
| Purview Data Protection (Labels/Retention) | HIGH | Medium | P1 |
| Guest/External User Governance | HIGH | Low | P2 |
| Sign-in Analytics | HIGH | Medium | P2 |
| Intune Depth (Autopilot/MAM/ASR/LAPS) | HIGH | Medium | P2 |
| Defender for Cloud Apps | MEDIUM | Medium | P2 |
| Service Health & Advisories | MEDIUM | Low | P2 |
| Copilot Readiness | MEDIUM | Low | P3 |
| Defender for Identity | LOW | Low | P3 |
| eDiscovery Overview | LOW | Low | P3 |

---

## Part A: Improvements to Existing Collectors

### A1. Entra Security Config (`Entra/Get-EntraSecurityConfig.ps1`)

**Current state**: Checks ~20 CIS benchmark controls covering security defaults, password protection, admin consent workflow, legacy per-user MFA, and SSPR settings.

**Missing checks to add:**

| Check | CIS Reference | Graph API Endpoint | Why It Matters |
|-------|--------------|-------------------|----------------|
| Authentication Methods Policy | CIS 1.1.x | `GET /policies/authenticationMethodsPolicy` | Determines which modern auth methods (FIDO2, passkeys, TAP, Authenticator, SMS, email) are enabled/disabled tenant-wide. Critical for phishing-resistant MFA assessment. |
| Cross-Tenant Access Policy | CIS 1.x | `GET /policies/crossTenantAccessPolicy` | Default inbound/outbound trust settings. Misconfigured defaults allow external tenants to bypass MFA or device compliance. |
| External Collaboration Settings | CIS 1.x | `GET /policies/authorizationPolicy` → `allowInvitesFrom` | Controls who can invite guests. SMBs often leave this as "Everyone" allowing any user to invite external guests. |
| Self-Service Group Management | — | `GET /groupSettings` | Whether users can create M365 Groups/Teams without approval. Uncontrolled group creation causes sprawl and data leakage. |
| Device Registration Settings | — | `GET /policies/deviceRegistrationPolicy` | Who can join/register devices to Entra ID. Open registration allows personal devices to access corporate resources. |
| Named Locations Inventory | — | `GET /identity/conditionalAccess/namedLocations` | Foundation for CA policy analysis. Without this, CA coverage gaps can't be identified. |
| MFA Enforcement Gap Detection | — | Composite check | Detect the dangerous state where Security Defaults are OFF AND no CA policy enforces MFA. This is the #1 finding in SMB assessments. |
| Custom Banned Password List | CIS 1.4.x | `GET /settings` → `bannedPasswordCheck` | Whether custom banned passwords are configured in addition to the global list. |
| Tenant Restrictions v2 | — | `GET /policies/crossTenantAccessPolicy/default` | Whether users can access other tenants' resources from managed devices. Data exfiltration vector. |

**Implementation detail**: The `Get-EntraSecurityConfig.ps1` already follows a pattern of returning `[PSCustomObject]` with `CisControl`, `Setting`, `CurrentValue`, `ExpectedValue`, `Status`, `Severity`. New checks should follow this exact pattern.

**New Graph scopes required**: `CrossTenantInformation.ReadBasic.All`, `Policy.Read.All` (already requested), `AuthenticationMethod.Read.All`

---

### A2. Conditional Access (`Entra/Get-ConditionalAccessReport.ps1`)

**Current state**: Exports all CA policies with state, conditions, grant controls, and session controls. Good for documentation but lacks analytical depth.

**Missing analysis to add:**

| Enhancement | How to Implement | Impact |
|-------------|-----------------|--------|
| **Coverage gap analysis** | Cross-reference all users against CA policy assignments. Identify users/groups not covered by ANY MFA-enforcing CA policy. | CRITICAL — the single most important CA finding |
| **Report-only vs enabled breakdown** | Count and flag policies stuck in report-only mode. Many SMBs create policies but never switch them to "On". | HIGH — false sense of security |
| **Named location resolution** | For each policy referencing named locations, resolve to actual IP ranges/countries. Currently shows only location IDs. | MEDIUM — makes the report actionable |
| **Legacy auth blocking check** | Verify at least one CA policy blocks legacy authentication protocols (IMAP, POP3, SMTP, ActiveSync with basic auth). | CRITICAL — legacy auth bypasses MFA |
| **Break-glass account exclusion audit** | Identify emergency access accounts and verify they're properly excluded from appropriate policies. | HIGH — lockout prevention |
| **App coverage analysis** | Which cloud apps have explicit CA policies vs. relying on "All cloud apps" blanket policies. | MEDIUM — targeted assessment |
| **Compliant device requirement check** | Whether any policy requires compliant/hybrid-joined device. Critical for Zero Trust device trust. | HIGH |

**Implementation**: Add a `Get-ConditionalAccessAnalysis.ps1` companion collector or extend the existing report with an analysis summary section that the HTML report can render.

---

### A3. App Registrations (`Entra/Get-AppRegistrationReport.ps1`)

**Current state**: Lists app registrations with name, appId, sign-in audience, creation date, credential status, and API permission summary.

**Missing checks to add:**

| Check | Graph API | Why |
|-------|----------|-----|
| **Expiring credentials (30/60/90 day)** | `GET /applications` → `passwordCredentials`, `keyCredentials` with expiry math | Prevents service outages from expired secrets/certs. The #1 operational finding. |
| **High-privilege permissions audit** | `GET /applications` → `requiredResourceAccess` filtered for dangerous permissions | Identifies apps with `Mail.ReadWrite`, `Files.ReadWrite.All`, `Directory.ReadWrite.All`, `RoleManagement.ReadWrite.Directory` — these are crown jewel permissions. |
| **Admin-consented enterprise apps** | `GET /servicePrincipals` → `appRoleAssignments` | Shows all enterprise apps with admin consent. Many are third-party SaaS apps with excessive permissions. |
| **OAuth2 permission grants** | `GET /oauth2PermissionGrants` | Shows delegated permission grants. Identifies overly broad user consent grants. |
| **Multi-tenant apps** | `GET /applications` → `signInAudience` = `AzureADMultipleOrgs` or `AzureADandPersonalMicrosoftAccount` | Multi-tenant app registrations can be exploited for consent phishing attacks. |
| **Apps with no owner** | `GET /applications/{id}/owners` | Orphaned apps with no owner can't be maintained and become security liabilities. |
| **Unused apps (no sign-ins)** | `GET /servicePrincipals` → `signInActivity` | Apps with credentials but no recent sign-in activity may be dormant attack surface. |

**New Graph scope**: `Application.Read.All` (already requested)

---

### A4. Intune Collectors (All)

**Current state**: Three collectors covering device summary, compliance policies, and config profiles. Provides a basic inventory but misses most Intune security features.

**New checks to add to existing collectors or as new sub-collectors:**

| Area | Collector Location | Graph API Endpoint | Details |
|------|-------------------|-------------------|---------|
| **Autopilot profiles** | New: `Intune/Get-AutopilotReport.ps1` | `GET /deviceManagement/windowsAutopilotDeploymentProfiles` | Profile count, assignment status, deployment mode (user-driven vs self-deploying), OOBE settings. Missing Autopilot = manual device setup = inconsistent security baseline. |
| **Windows Update rings** | New: `Intune/Get-UpdatePolicyReport.ps1` | `GET /deviceManagement/deviceConfigurations` (type `#microsoft.graph.windowsUpdateForBusinessConfiguration`) | Update ring settings: deferral periods, quality/feature update policies, delivery optimization. Misconfigured updates = unpatched devices. |
| **App Protection Policies (MAM)** | New: `Intune/Get-AppProtectionReport.ps1` | `GET /deviceAppManagement/managedAppPolicies` | iOS/Android app protection policies. Critical for BYOD — without MAM, corporate data on personal devices has no protection. |
| **Endpoint Security policies** | New: `Intune/Get-EndpointSecurityReport.ps1` | `GET /deviceManagement/intents` | Attack Surface Reduction rules, firewall rules, antivirus configuration, disk encryption (BitLocker/FileVault). The core of device security posture. |
| **BitLocker/FileVault status** | Extend: `Intune/Get-DeviceSummary.ps1` | `GET /deviceManagement/managedDevices` → `isEncrypted` | Per-device encryption status. Unencrypted devices = data breach risk on lost/stolen devices. |
| **LAPS configuration** | New: check within `Intune/Get-EndpointSecurityReport.ps1` | `GET /deviceManagement/deviceConfigurations` (LAPS type) | Local Administrator Password Solution. Without LAPS, all devices share the same local admin password = lateral movement. |
| **Windows feature update profiles** | Extend: `Intune/Get-UpdatePolicyReport.ps1` | `GET /deviceManagement/windowsFeatureUpdateProfiles` | Which Windows version devices are targeted to. Important for Windows 11 migration tracking. |
| **Remediation scripts** | New: `Intune/Get-RemediationReport.ps1` | `GET /deviceManagement/deviceHealthScripts` | Proactive remediation scripts deployed. Shows maturity of device management. |

**New Graph scopes**: `DeviceManagementConfiguration.Read.All` (already requested), `DeviceManagementApps.Read.All`, `DeviceManagementManagedDevices.Read.All` (already requested)

---

### A5. Security Section

**Current state**: Secure Score, Defender for O365 policies (anti-phish, anti-spam, anti-malware, safe links, safe attachments), DLP policies, and CIS benchmark checks for Defender settings.

**Missing checks:**

| Check | Endpoint/Cmdlet | Why |
|-------|----------------|-----|
| **Defender for Endpoint onboarding status** | `GET /security/alerts_v2` + check for MDE-sourced alerts; `GET /deviceManagement/managedDevices` → check `managedDeviceName` vs MDE | Determines how many devices are onboarded to MDE. Common gap: Intune-enrolled but MDE not onboarded. |
| **Attack Surface Reduction (ASR) rules** | `GET /deviceManagement/intents` (security baseline type) | Which ASR rules are enabled/audit/block. Many tenants have ASR rules in audit-only mode permanently. |
| **Threat & Vulnerability Management (TVM)** | `GET /security/alerts_v2?$filter=serviceSource eq 'microsoftDefenderForEndpoint'` | Summary of vulnerability severity distribution. Gives a quick risk snapshot. |
| **Alert summary by severity** | `GET /security/alerts_v2` → aggregate by severity | Current active alerts across all Defender services. Shows whether the SOC is keeping up. |
| **Quarantine policies** | `Get-QuarantinePolicy` (EXO) | Who can release quarantined messages. Misconfigured policies let end users release malware. |
| **Tenant Allow/Block List** | `Get-TenantAllowBlockListItems` (EXO) | Custom allow/block entries. Allow-listed domains/senders bypass filtering — a common misconfiguration. |

---

### A6. Exchange Online

**Current state**: Mailbox summary, mail flow (transport rules, connectors), email security (SPF/DKIM/DMARC, ATP settings), EXO CIS benchmarks, DNS auth.

**Missing checks:**

| Check | Cmdlet/Graph | Why |
|-------|-------------|-----|
| **Unified Audit Log status** | `Get-AdminAuditLogConfig` → `UnifiedAuditLogIngestionEnabled` | If UAL is disabled, there is ZERO visibility into tenant activity. This is the #1 Exchange finding. |
| **Mailbox auditing configuration** | `Get-OrganizationConfig` → `AuditDisabled`, per-mailbox `Get-Mailbox` → `AuditEnabled`, `AuditOwner`, `AuditDelegate`, `AuditAdmin` | E3 has limited default audit actions vs E5. Verifies adequate audit coverage. |
| **External forwarding rules** | `Get-InboxRule` (all mailboxes) → filter `ForwardTo`, `ForwardAsAttachmentTo`, `RedirectTo` where target is external | Attackers commonly create forwarding rules during BEC. Also catches employee data exfiltration. |
| **OAuth apps with mailbox access** | `Get-MailboxPermission` + `Get-RecipientPermission` + Graph `oauth2PermissionGrants` filtering Mail.* | Identifies apps that can read/send email. Critical for BEC detection. |
| **Shared mailbox sign-in blocked** | `Get-MsolUser` or Graph → filter for shared mailboxes → check `accountEnabled` | CIS 1.2.2: Shared mailboxes should have sign-in disabled. If enabled, anyone with the password can sign in directly. |
| **Remote domains settings** | `Get-RemoteDomain` → `AutoForwardEnabled` | Whether auto-forwarding is allowed to external domains. Should be blocked to prevent data exfiltration. |
| **Journal rules** | `Get-JournalRule` | Active journal rules may be sending copies of all email to external addresses. Legacy compliance or active exfiltration. |
| **Mobile device access policies** | `Get-MobileDeviceMailboxPolicy` or `Get-ActiveSyncDeviceAccessRule` | Controls which devices can connect to Exchange via ActiveSync/EAS. |

---

### A7. Collaboration (SharePoint & Teams)

**Current state**: SharePoint/OneDrive tenant settings, SharePoint CIS checks, Teams access policies, Teams CIS checks.

**Missing checks:**

| Check | Cmdlet/Graph | Why |
|-------|-------------|-----|
| **SharePoint site-level sharing overrides** | `Get-SPOSite -Limit All` → `SharingCapability` per site | Tenant-level sharing may be restricted but individual sites can override to "Anyone". This is a common data leakage vector. |
| **OneDrive sync client restrictions** | `Get-SPOTenantSyncClientRestriction` | Whether sync is limited to domain-joined PCs. Without this, any personal device can sync corporate files. |
| **Teams external access (federation)** | `Get-CsExternalAccessPolicy` + `Get-CsTenantFederationConfiguration` | Which external domains can chat/call/meet with internal users. Open federation = phishing vector. |
| **Teams meeting policies** | `Get-CsTeamsMeetingPolicy` | Lobby bypass settings, who can present, recording/transcription defaults, external participant access. |
| **Teams messaging policies** | `Get-CsTeamsMessagingPolicy` | URL preview, edit/delete message windows, Giphy content rating, third-party file storage. |
| **Teams app permission policies** | `Get-CsTeamsAppPermissionPolicy` | Which third-party Teams apps are allowed. Uncontrolled app installation = data access risk. |
| **Idle session timeout** | `Get-SPOTenant` → `ConditionalAccessPolicy` or via CA policies | CIS 1.3.2: Idle session timeout for unmanaged devices. |
| **SharePoint legacy auth** | `Get-SPOTenant` → `LegacyAuthProtocolsEnabled` | Legacy authentication protocols should be disabled for SharePoint. |

---

### A8. Report Generation (`Common/Export-AssessmentReport.ps1`)

**Current state**: Comprehensive HTML report with dark mode, charts (donut, bar), tabbed navigation, data tables, compliance mapping, and search. Very well done.

**Recommended enhancements:**

| Enhancement | Description | Priority |
|-------------|-------------|----------|
| **Executive Risk Dashboard** | Add a top-level "Risk Overview" section with a heatmap/traffic-light grid: rows = assessment domains (Identity, Email, Devices, Data, Collaboration), columns = risk level (Critical/High/Medium/Low). Calculated from collector findings. | HIGH |
| **MFA Gap Visualization** | Dedicated chart showing: users with MFA registered vs not, broken down by admin vs regular user. This is the #1 thing executives ask about. | HIGH |
| **Copilot Readiness Section** | If Copilot licenses detected or section selected: sensitivity label coverage, oversharing risk indicators, prerequisite checklist. | MEDIUM |
| **Power Platform Governance** | Dedicated report tab for Power Platform findings when that section is assessed. | MEDIUM |
| **Data Protection Maturity** | Visual maturity model: None → Basic → Intermediate → Advanced, based on: labels deployed, auto-labeling, DLP active, retention configured, insider risk configured. | MEDIUM |
| **Compliance Readiness Matrix** | Quick-view table: rows = compliance frameworks, columns = % of controls assessed as passing. | LOW |
| **Trend Comparison** | If previous assessment results exist in the output folder, show delta/trend arrows (improved/declined/unchanged). | LOW |

---

## Part B: New Collectors to Add

### Priority 1 — Critical Gaps (HIGH IMPACT)

---

### B1. Entra ID Governance — NEW Section

**Why critical**: Entra ID Governance (PIM, Access Reviews, Entitlement Management) is the cornerstone of Zero Trust. Without it, standing admin privileges persist indefinitely, group memberships are never reviewed, and access lifecycle is unmanaged. This is the single biggest gap in the current solution.

**Note**: Requires Entra ID P2 or Entra ID Governance license. Collectors should gracefully handle unlicensed tenants with an informational finding ("ID Governance not licensed — consider for Zero Trust maturity").

#### B1a. `Governance/Get-PimReport.ps1` — Privileged Identity Management

**What to assess:**
- PIM-eligible vs permanently active role assignments for all directory roles
- PIM policy settings per role (activation max duration, MFA requirement, approval requirement, justification requirement)
- Recent PIM activations (last 30 days) — who activated what, how often
- Roles with zero eligible assignments (no PIM coverage)
- Roles with permanent active assignments that should be eligible

**Graph API endpoints:**
```
GET /roleManagement/directory/roleAssignmentScheduleInstances          # Active assignments
GET /roleManagement/directory/roleEligibilityScheduleInstances         # Eligible assignments
GET /roleManagement/directory/roleAssignmentScheduleRequests           # Activation history
GET /policies/roleManagementPolicies                                    # PIM policies per role
```

**Graph scopes**: `RoleManagement.Read.Directory`, `RoleEligibilitySchedule.Read.Directory`, `RoleAssignmentSchedule.Read.Directory`

**Output CSV columns**: `RoleName`, `RoleId`, `PrincipalName`, `PrincipalType`, `AssignmentType` (Eligible/Active), `AssignmentState` (Active/Provisioned), `StartDateTime`, `EndDateTime`, `MemberType` (Direct/Group)

**CIS/Framework mapping**: CIS 1.1.x (Admin accounts), NIST AC-6(5), ISO A.5.15, CMMC 3.1.5

---

#### B1b. `Governance/Get-AccessReviewReport.ps1` — Access Reviews

**What to assess:**
- Active access review definitions (schedules, scope, reviewers)
- Access review completion status (% completed, overdue reviews)
- Review decisions summary (approved, denied, not reviewed)
- Whether access reviews exist for: admin roles, guest users, group memberships, application access

**Graph API endpoints:**
```
GET /identityGovernance/accessReviews/definitions                       # All review definitions
GET /identityGovernance/accessReviews/definitions/{id}/instances        # Review instances
GET /identityGovernance/accessReviews/definitions/{id}/instances/{id}/decisions  # Decisions
```

**Graph scopes**: `AccessReview.Read.All`

**Output CSV columns**: `ReviewName`, `ReviewScope`, `ReviewerType`, `Status`, `StartDate`, `EndDate`, `TotalDecisions`, `ApprovedCount`, `DeniedCount`, `NotReviewedCount`

---

#### B1c. `Governance/Get-EntitlementManagementReport.ps1` — Entitlement Management

**What to assess:**
- Access packages defined, their catalog, policies
- Access package assignment status
- Connected organizations (for B2B access)

**Graph API endpoints:**
```
GET /identityGovernance/entitlementManagement/accessPackages            # Access packages
GET /identityGovernance/entitlementManagement/catalogs                  # Catalogs
GET /identityGovernance/entitlementManagement/connectedOrganizations    # Connected orgs
```

**Graph scopes**: `EntitlementManagement.Read.All`

---

### B2. Entra ID Protection — NEW Collector

#### `Entra/Get-IdentityProtectionReport.ps1`

**Why critical**: Without Identity Protection data, you have no visibility into active threats against the tenant. Risky users may be actively compromised with no remediation. Risk-based CA policies may not be configured.

**What to assess:**
- Risky users count and risk levels (high/medium/low)
- Risky users with no remediation action
- Risk detections in last 30 days (type, count, risk level)
- Risky service principals
- Risk-based CA policies configured (sign-in risk, user risk)
- MFA registration campaign status

**Graph API endpoints:**
```
GET /identityProtection/riskyUsers                                      # Risky users
GET /identityProtection/riskyUsers?$filter=riskLevel eq 'high'         # High-risk users
GET /identityProtection/riskDetections                                  # Risk detections
GET /identityProtection/riskyServicePrincipals                         # Risky service principals
GET /identity/conditionalAccess/policies?$filter=conditions/signInRiskLevels/any(x:x ne null)  # Risk-based CA
```

**Graph scopes**: `IdentityRiskyUser.Read.All`, `IdentityRiskEvent.Read.All`, `IdentityRiskyServicePrincipal.Read.All`

**Output**: Summary CSV with risk counts + detailed risky users list

**CIS/Framework mapping**: CIS 1.x, NIST SI-4, ISO A.8.16

---

### B3. Power Platform Governance — NEW Section

**Why critical**: Power Platform (Power Apps, Power Automate, Power BI) is deployed in nearly every M365 tenant and is the #1 shadow IT vector. Users can build apps and flows that connect to external services, exfiltrate data, or create unmonitored automations — all with their M365 credentials. Most MSPs don't assess this at all.

#### B3a. `PowerPlatform/Get-PowerPlatformReport.ps1` — Environments & DLP

**What to assess:**
- All Power Platform environments (Default, Sandbox, Production)
- Environment DLP policies (which connectors are Business vs Non-Business vs Blocked)
- Whether a tenant-level DLP policy exists (critical — without one, ANY connector can be used)
- Connector classification (premium vs standard, custom connectors)
- Maker count per environment

**PowerShell module**: `Microsoft.PowerApps.Administration.PowerShell`

**Cmdlets:**
```powershell
Get-AdminPowerAppEnvironment                                # All environments
Get-DlpPolicy                                              # DLP policies
Get-AdminPowerAppConnector                                  # Available connectors
```

**Connection**: Power Platform admin requires separate authentication. Add `PowerPlatform` as a new service type in `Connect-Service.ps1`. Use `Add-PowerAppsAccount` cmdlet.

---

#### B3b. `PowerPlatform/Get-PowerAppsReport.ps1` — App Inventory

**What to assess:**
- All Power Apps in the tenant (name, owner, created date, last modified, environment)
- Apps shared with "Everyone" (oversharing)
- Apps using premium connectors
- Apps connecting to external data sources (SQL, HTTP, custom APIs)
- Orphaned apps (owner left the organization)

**Cmdlets:**
```powershell
Get-AdminPowerApp                                           # All apps
Get-AdminPowerAppRoleAssignment -AppName $appId             # App sharing
```

---

#### B3c. `PowerPlatform/Get-PowerAutomateReport.ps1` — Flow Inventory

**What to assess:**
- All cloud flows (name, owner, state, trigger type, connections used)
- Flows running as the creator vs service account
- Flows connecting to external services
- High-risk connectors in use (HTTP, SQL, custom connectors, Azure Blob)
- Suspended/failed flows
- Desktop flows (RPA) inventory if Power Automate Desktop is used

**Cmdlets:**
```powershell
Get-AdminFlow                                               # All flows
Get-AdminFlowUserDetails -UserId $userId                    # Flow ownership
```

---

### B4. Purview Data Protection — Expanded Section

**Why critical**: The current solution only checks DLP policies via Purview. Sensitivity labels, retention, insider risk, and audit configuration are the other four pillars of data protection. Without them, the assessment misses whether the organization can classify, retain, protect, and monitor its data.

#### B4a. `Purview/Get-SensitivityLabelReport.ps1` — Information Protection

**What to assess:**
- Published sensitivity labels (name, priority, tooltip, content marking, encryption, auto-labeling)
- Label policies (which users/groups, mandatory labeling, default label)
- Auto-labeling policies (sensitive info types used, workloads covered)
- Label usage statistics (if available via Graph)
- Whether ANY labels exist (many SMBs have zero labels — this is the finding)

**Connection**: Security & Compliance PowerShell (already supported via `Connect-IPPSSession`)

**Cmdlets:**
```powershell
Get-Label                                                   # All labels
Get-LabelPolicy                                             # Label policies
Get-AutoSensitivityLabelPolicy                             # Auto-labeling policies
Get-AutoSensitivityLabelRule                               # Auto-labeling rules
```

**Graph alternative** (if Purview connection is unavailable):
```
GET /security/informationProtection/sensitivityLabels       # Requires InformationProtectionPolicy.Read
```

---

#### B4b. `Purview/Get-RetentionPolicyReport.ps1` — Records & Retention

**What to assess:**
- Retention policies (name, workloads covered, retention duration, action after retention)
- Retention labels (name, retention duration, regulatory record, disposition review)
- Workload coverage: which workloads have retention policies (Exchange, SharePoint, OneDrive, Teams, Viva Engage)
- Whether ANY retention exists (many SMBs have zero retention — data loss risk AND compliance risk)

**Cmdlets:**
```powershell
Get-RetentionCompliancePolicy                              # Retention policies
Get-RetentionComplianceRule                                # Retention rules
Get-ComplianceTag                                          # Retention labels
```

---

#### B4c. `Purview/Get-AuditConfigReport.ps1` — Audit Configuration

**What to assess:**
- Unified Audit Log status (enabled/disabled) — cross-check with EXO `Get-AdminAuditLogConfig`
- Audit log retention period (E3 default = 180 days, E5 = 365 days, can extend to 10 years)
- Advanced Audit availability (E5 feature: crucial events like MailItemsAccessed)
- Mailbox audit configuration (org-level and per-mailbox)
- Audit log search policy

**Cmdlets:**
```powershell
Get-AdminAuditLogConfig                                    # EXO audit config
Get-UnifiedAuditLogRetentionPolicy                         # Retention policies for audit logs
Get-OrganizationConfig | Select AuditDisabled              # Org-level mailbox audit
```

---

#### B4d. `Purview/Get-InsiderRiskReport.ps1` — Insider Risk Management

**What to assess:**
- Whether Insider Risk policies are configured (policy count, types, status)
- Policy templates in use (departing employee, data theft, security policy violations)
- Whether Insider Risk is licensed (E5 or IRM add-on)
- HR connector status (if configured for departure triggers)
- Priority user groups defined

**Cmdlets:**
```powershell
Get-InsiderRiskPolicy                                      # IRM policies (if accessible)
```

**Note**: IRM has limited PowerShell/API access. This collector may be primarily a license/availability check with a recommendation to configure if licensed but unused.

---

### Priority 2 — Important Gaps (MEDIUM IMPACT)

---

### B5. Defender for Cloud Apps — NEW Collector

#### `Security/Get-CloudAppSecurityReport.ps1`

**Why important**: MDCA provides OAuth app governance, shadow IT discovery, and app-level threat detection. Many SMBs have MDCA licensed through E5 but it's unconfigured.

**What to assess:**
- Whether MDCA is activated/configured
- OAuth app governance policies
- Connected apps (sanctioned/unsanctioned)
- File policies and session policies
- Discovered apps catalog (shadow IT)
- App governance alerts

**API**: MDCA REST API (`https://<portal-url>.portal.cloudappsecurity.com/api/v1/`)
- Authentication: API token from MDCA portal or via Graph Security API

**Graph alternative:**
```
GET /security/alerts_v2?$filter=serviceSource eq 'microsoftCloudAppSecurity'
```

---

### B6. Guest & External User Governance — NEW Collector

#### `Entra/Get-GuestAccessReport.ps1`

**Why important**: Guest users are a common attack vector. Stale guest accounts, over-permissioned guests, and unreviewed B2B access are consistent findings.

**What to assess:**
- Guest user count and trend
- Stale guests (last sign-in > 90 days)
- Guests with directory role assignments (should be zero)
- Guest access restrictions (what can guests see in the directory)
- Cross-tenant access policy (default settings, per-organization overrides)
- B2B collaboration settings (who can invite, allowed/blocked domains)
- External user lifecycle (automatic redemption, guest expiry)

**Graph API endpoints:**
```
GET /users?$filter=userType eq 'Guest'&$select=displayName,mail,createdDateTime,signInActivity
GET /policies/crossTenantAccessPolicy/partners                          # Per-org overrides
GET /policies/crossTenantAccessPolicy/default                           # Default settings
GET /policies/authorizationPolicy                                       # Guest restrictions
```

**Graph scopes**: `User.Read.All`, `Policy.Read.All`, `CrossTenantInformation.ReadBasic.All`

---

### B7. Sign-in Analytics — NEW Collector

#### `Entra/Get-SignInAnalyticsReport.ps1`

**Why important**: Sign-in logs reveal active threats and misconfiguration that static configuration checks cannot detect: legacy auth still in use, geographic anomalies, MFA failure patterns, and interactive sign-ins from unexpected locations.

**What to assess:**
- Legacy authentication protocol usage (last 7 days) — which users, which protocols (IMAP, POP3, SMTP, EWS with basic auth)
- Geographic distribution of sign-ins (detect sign-ins from unexpected countries)
- MFA success/failure rate
- CA policy evaluation summary (which policies are blocking, which are granting)
- Risky sign-in patterns (multiple failed MFA, impossible travel detected by risk engine)
- Service principal sign-in activity

**Graph API endpoints:**
```
GET /auditLogs/signIns?$filter=createdDateTime ge {7daysAgo}&$top=500  # Recent sign-ins (sampled)
GET /auditLogs/signIns?$filter=clientAppUsed ne 'Browser' and clientAppUsed ne 'Mobile Apps and Desktop clients'  # Legacy auth
```

**Graph scopes**: `AuditLog.Read.All`, `Directory.Read.All`

**Note**: Sign-in logs can be very large. Sample the last 7 days with a reasonable page limit. Focus on aggregate patterns, not individual events.

---

### B8. Service Health & Advisories — NEW Collector

#### `Tenant/Get-ServiceHealthReport.ps1`

**Why important**: Service health issues and upcoming message center changes can impact the assessment findings and provide context for the consultant.

**What to assess:**
- Current service health status (all M365 services)
- Active advisories and incidents
- Message center items (last 30 days) — upcoming changes, required actions
- Service health trend (issues in last 30 days)

**Graph API endpoints:**
```
GET /admin/serviceAnnouncement/healthOverviews                         # Service health
GET /admin/serviceAnnouncement/issues?$filter=isResolved eq false      # Active issues
GET /admin/serviceAnnouncement/messages?$top=50&$orderby=startDateTime desc  # Message center
```

**Graph scopes**: `ServiceHealth.Read.All`, `ServiceMessage.Read.All`

---

### Priority 3 — Nice-to-Have (LOWER IMPACT for SMB)

---

### B9. Copilot Readiness — NEW Collector

#### `Tenant/Get-CopilotReadinessReport.ps1`

**What to assess:**
- Copilot for M365 license availability and assignment
- Sensitivity label coverage (% of SharePoint sites and OneDrive accounts with labels)
- Oversharing indicators (sites shared with "Everyone except external users", broadly shared files)
- Search and content discoverability review
- Prerequisites checklist: M365 Apps deployment, Teams compliance, OneDrive sync

**Graph API:**
```
GET /subscribedSkus → filter for Copilot SKU IDs
GET /reports/getSharePointSiteUsageDetail
```

---

### B10. Defender for Identity — NEW Collector

#### `Security/Get-DefenderIdentityReport.ps1`

**What to assess:**
- Whether MDI is licensed and configured
- Sensor deployment status (which DCs have sensors)
- Health alerts from MDI
- Recent identity-based alerts

**Graph:**
```
GET /security/alerts_v2?$filter=serviceSource eq 'microsoftDefenderForIdentity'
```

---

### B11. eDiscovery Overview — NEW Collector

#### `Purview/Get-eDiscoveryReport.ps1`

**What to assess:**
- Active eDiscovery cases (Standard and Premium)
- Content searches
- Holds in place
- eDiscovery licensing availability

**Cmdlets:**
```powershell
Get-ComplianceCase                                         # eDiscovery cases
Get-ComplianceSearch                                       # Content searches
Get-CaseHoldPolicy                                        # Hold policies
```

---

## Part C: Infrastructure & Quality Improvements

### C1. Orchestrator Updates (`Invoke-M365Assessment.ps1`)

Add new sections to the orchestrator:

```powershell
# New section definitions to add to $sections ordered dictionary
'12' = @{ Name = 'Governance';       Label = 'Entra ID Governance (PIM, Access Reviews)'; Selected = $false }
'13' = @{ Name = 'DataProtection';   Label = 'Data Protection (Labels, Retention, Audit)'; Selected = $false }
'14' = @{ Name = 'PowerPlatform';    Label = 'Power Platform Governance';                  Selected = $false }

# Update $sectionServiceMap
'Governance'      = @('Graph')
'DataProtection'  = @('Graph', 'Purview')
'PowerPlatform'   = @('PowerPlatform')

# Update $sectionScopeMap
'Governance'      = @('RoleManagement.Read.Directory', 'RoleEligibilitySchedule.Read.Directory',
                      'AccessReview.Read.All', 'EntitlementManagement.Read.All')
'DataProtection'  = @('InformationProtectionPolicy.Read')
'PowerPlatform'   = @()  # Uses separate PowerApps module auth

# Update $collectorMap
'Governance' = @(
    @{ Name = '33-PIM-Report';           Script = 'Governance\Get-PimReport.ps1';                    Label = 'PIM Roles' }
    @{ Name = '34-Access-Reviews';       Script = 'Governance\Get-AccessReviewReport.ps1';           Label = 'Access Reviews' }
    @{ Name = '35-Entitlement-Mgmt';     Script = 'Governance\Get-EntitlementManagementReport.ps1';  Label = 'Entitlement Management' }
)
'DataProtection' = @(
    @{ Name = '36-Sensitivity-Labels';   Script = 'Purview\Get-SensitivityLabelReport.ps1';    Label = 'Sensitivity Labels'; RequiredServices = @('Purview') }
    @{ Name = '37-Retention-Policies';   Script = 'Purview\Get-RetentionPolicyReport.ps1';     Label = 'Retention Policies'; RequiredServices = @('Purview') }
    @{ Name = '38-Audit-Config';         Script = 'Purview\Get-AuditConfigReport.ps1';         Label = 'Audit Configuration'; RequiredServices = @('Purview') }
    @{ Name = '39-Insider-Risk';         Script = 'Purview\Get-InsiderRiskReport.ps1';         Label = 'Insider Risk'; RequiredServices = @('Purview') }
    @{ Name = '39b-eDiscovery';          Script = 'Purview\Get-eDiscoveryReport.ps1';          Label = 'eDiscovery Overview'; RequiredServices = @('Purview') }
)
'PowerPlatform' = @(
    @{ Name = '40-Power-Platform';       Script = 'PowerPlatform\Get-PowerPlatformReport.ps1';  Label = 'Environments & DLP'; RequiredServices = @('PowerPlatform') }
    @{ Name = '41-Power-Apps';           Script = 'PowerPlatform\Get-PowerAppsReport.ps1';      Label = 'Power Apps'; RequiredServices = @('PowerPlatform') }
    @{ Name = '42-Power-Automate';       Script = 'PowerPlatform\Get-PowerAutomateReport.ps1';  Label = 'Power Automate'; RequiredServices = @('PowerPlatform') }
)

# New collectors in existing sections (add to Identity)
# Add to 'Identity' array:
@{ Name = '07c-Identity-Protection';     Script = 'Entra\Get-IdentityProtectionReport.ps1';  Label = 'Identity Protection' }
@{ Name = '07d-Guest-Access';            Script = 'Entra\Get-GuestAccessReport.ps1';          Label = 'Guest Access' }
@{ Name = '07e-Sign-in-Analytics';       Script = 'Entra\Get-SignInAnalyticsReport.ps1';      Label = 'Sign-in Analytics' }

# Add to 'Tenant' array:
@{ Name = '01b-Service-Health';          Script = 'Tenant\Get-ServiceHealthReport.ps1';        Label = 'Service Health' }
@{ Name = '01c-Copilot-Readiness';       Script = 'Tenant\Get-CopilotReadinessReport.ps1';    Label = 'Copilot Readiness' }

# Add to 'Intune' array:
@{ Name = '15b-Autopilot';              Script = 'Intune\Get-AutopilotReport.ps1';              Label = 'Autopilot' }
@{ Name = '15c-Update-Policies';        Script = 'Intune\Get-UpdatePolicyReport.ps1';            Label = 'Update Policies' }
@{ Name = '15d-App-Protection';         Script = 'Intune\Get-AppProtectionReport.ps1';           Label = 'App Protection (MAM)' }
@{ Name = '15e-Endpoint-Security';      Script = 'Intune\Get-EndpointSecurityReport.ps1';       Label = 'Endpoint Security' }

# Add to 'Security' array:
@{ Name = '18c-Cloud-App-Security';     Script = 'Security\Get-CloudAppSecurityReport.ps1';      Label = 'Cloud App Security' }
@{ Name = '18d-Defender-Identity';      Script = 'Security\Get-DefenderIdentityReport.ps1';      Label = 'Defender for Identity' }
```

### C2. Connect-Service.ps1 Updates

Add new service type for Power Platform:

```powershell
# Add to ValidateSet: 'Graph', 'ExchangeOnline', 'Purview', 'PowerPlatform'

# Add connection block:
'PowerPlatform' {
    if (-not (Get-Module -Name Microsoft.PowerApps.Administration.PowerShell -ListAvailable)) {
        Write-Error "Microsoft.PowerApps.Administration.PowerShell module not installed."
        return
    }
    Add-PowerAppsAccount
}
```

### C3. Framework Mappings Update

Add new rows to `Common/framework-mappings.csv` for:
- Governance controls (PIM, access reviews)
- Power Platform controls
- Data protection controls (labels, retention, audit)
- Additional Intune controls (Autopilot, MAM, ASR)
- Guest governance controls

### C4. New Directory Structure

Create new directories:
```
mkdir Governance/           # PIM, Access Reviews, Entitlement Management
mkdir PowerPlatform/        # Power Platform governance collectors
mkdir Tenant/               # Move Get-TenantInfo.ps1 here (currently in Entra/) — OR keep in Entra/ and add new Tenant collectors there
```

**Note**: `Get-TenantInfo.ps1` is currently in `Entra/` but logically belongs to the "Tenant" section. Consider a `Tenant/` directory for Service Health and Copilot Readiness, or simply add them to `Entra/` for consistency.

### C5. Version Sync

Current state:
- `M365-Assess.psd1` → `ModuleVersion = '0.3.0'`
- `Invoke-M365Assessment.ps1` → `$script:AssessmentVersion = '0.4.0'`

These should be synchronized. Bump both to `0.5.0` for the release that includes these new collectors.

### C6. Error Handling Enhancement

Each new collector should follow the established pattern:
```powershell
[CmdletBinding()]
param([string]$OutputPath)
$ErrorActionPreference = 'Stop'
try {
    $context = Get-MgContext
    if (-not $context) { Write-Error "Not connected to Microsoft Graph." ; return }
} catch { Write-Error "Not connected to Microsoft Graph." ; return }
# ... collector logic ...
if ($OutputPath) { $results | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8 }
Write-Output $results
```

### C7. Graph API Permission Summary

**Complete list of new Graph scopes needed** (across all new collectors):

| Scope | Used By |
|-------|---------|
| `RoleManagement.Read.Directory` | PIM Report |
| `RoleEligibilitySchedule.Read.Directory` | PIM Report |
| `RoleAssignmentSchedule.Read.Directory` | PIM Report |
| `AccessReview.Read.All` | Access Reviews |
| `EntitlementManagement.Read.All` | Entitlement Management |
| `IdentityRiskyUser.Read.All` | Identity Protection |
| `IdentityRiskEvent.Read.All` | Identity Protection |
| `IdentityRiskyServicePrincipal.Read.All` | Identity Protection |
| `CrossTenantInformation.ReadBasic.All` | Guest Access, Entra Security Config |
| `ServiceHealth.Read.All` | Service Health |
| `ServiceMessage.Read.All` | Service Health |
| `DeviceManagementApps.Read.All` | App Protection (MAM) |
| `InformationProtectionPolicy.Read` | Sensitivity Labels (Graph fallback) |

---

## Part D: Implementation Roadmap

### Phase 1 — Quick Wins (1-2 weeks)
- [ ] Add Identity Protection collector (`Entra/Get-IdentityProtectionReport.ps1`)
- [ ] Add Guest Access collector (`Entra/Get-GuestAccessReport.ps1`)
- [ ] Add Service Health collector (`Tenant/Get-ServiceHealthReport.ps1`)
- [ ] Enhance Entra Security Config with auth methods policy and MFA gap detection
- [ ] Add Unified Audit Log check to Exchange section
- [ ] Add external forwarding rule detection to Exchange section
- [ ] Update orchestrator with new collectors
- [ ] Bump version to 0.5.0

### Phase 2 — Core Governance (2-3 weeks)
- [ ] Create Governance section with PIM, Access Reviews, Entitlement Management collectors
- [ ] Create Purview expanded section with Sensitivity Labels, Retention, Audit Config collectors
- [ ] Enhance Conditional Access with coverage gap analysis
- [ ] Enhance App Registrations with expiring credentials and high-privilege permissions
- [ ] Add CIS benchmark checks for new areas
- [ ] Update framework mappings CSV

### Phase 3 — Platform Expansion (2-3 weeks)
- [ ] Create Power Platform section with Environments, Apps, Flows collectors
- [ ] Add Connect-Service.ps1 support for Power Platform
- [ ] Add Intune Autopilot, MAM, Endpoint Security, Update Policies collectors
- [ ] Add Sign-in Analytics collector
- [ ] Add Copilot Readiness collector
- [ ] Add Defender for Cloud Apps collector

### Phase 4 — Report & Polish (1-2 weeks)
- [ ] Add Executive Risk Dashboard to HTML report
- [ ] Add Data Protection Maturity section
- [ ] Add MFA gap visualization
- [ ] Update all compliance framework mappings
- [ ] Testing across E3, E5, Business Premium tenants
- [ ] Documentation updates

---

## Appendix: CIS Microsoft 365 Foundations Benchmark v4.0 Coverage Gap Analysis

The current solution covers approximately **65-70%** of CIS M365 v4.0 controls. Key uncovered areas:

| CIS Section | Coverage | Gap |
|-------------|----------|-----|
| 1. Account/Authentication | ~80% | Missing: auth methods policy, named locations, PIM checks |
| 2. Application Permissions | ~60% | Missing: OAuth grant analysis, high-privilege app audit |
| 3. Data Management | ~30% | Missing: sensitivity labels, retention, audit config |
| 4. Email Security | ~85% | Missing: UAL status, external forwarding, journal rules |
| 5. Microsoft Defender | ~70% | Missing: ASR rules, MDE onboarding, MDCA |
| 6. SharePoint/OneDrive | ~75% | Missing: site-level sharing overrides, sync restrictions |
| 7. Teams | ~70% | Missing: meeting policies, messaging policies, app permissions |
| 8. Power Platform | **0%** | Entirely missing section |

**Target**: Achieve **90%+ CIS coverage** after implementing all Phase 1-3 collectors.
