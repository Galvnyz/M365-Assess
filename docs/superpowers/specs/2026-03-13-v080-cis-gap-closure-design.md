# Design: v0.8.0 CIS Automated Gap Closure

**Date**: 2026-03-13
**Version**: 0.8.0
**Status**: Draft
**Author**: Daren9m + Claude

## Problem

CIS Benchmark v6.0.1 marks 129 of 140 controls as "Automated" (checkable via API). M365-Assess v0.7.0 has 82 automated check entries in registry.json, but these map to only 68 unique CIS controlIds (some CIS controls are covered by multiple CheckIds, e.g., ENTRA-AUTHMETHOD-001 covers both SMS and Voice for CIS 5.2.3.5). This leaves 61 CIS-Automated controls with no check.

## Goal

Close 51 of the 61 gaps (the remaining 10 are Power BI, deferred to v0.9.0). Bring CIS-Automated coverage from 68/129 unique CIS controls (53%) to 108/129 (84%) with 40 new automated checks and 11 Review-status checks covering controls where no reliable API exists.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Power BI (12 checks) | Deferred to v0.9.0 | Requires new service connection (`MicrosoftPowerBIMgmt` module), new collector from scratch |
| CA policy evaluation | New dedicated collector | Keeps Get-EntraSecurityConfig.ps1 focused; CA evaluator has distinct single purpose |
| PIM checks (E5/P2) | Build with license gating | Emit `Review` with explanation on non-P2 tenants; `dzmlab` has E5 for testing |
| Section 1 org settings | Split by data source | Checks live where their data lives: Entra for Graph, EXO for mailbox, Review for admin-center-only |
| DNS checks | New collector extracted from orchestrator | Promotes DNS evaluation to proper Add-Setting/CheckId pattern |
| Attachment filter + anti-spam | Defender collector | Cmdlets already fetched there; CIS section number doesn't dictate collector layout |
| Implementation approach | Phased PRs by collector | Same pattern as v0.7.0; independently testable per-phase |

## Architecture

### New Collectors (3)

#### 1. `Entra/Get-CASecurityConfig.ps1` (Collector: `CAEvaluator`)

**Purpose**: Evaluate Conditional Access policies against CIS 5.2.2.x requirements.

**Data source**: `Invoke-MgGraphRequest -Uri '/v1.0/identity/conditionalAccess/policies'`

**Evaluation pattern**: Each check filters enabled CA policies for specific condition + grant control combinations. Pass if >= 1 matching policy found.

```
Filter chain per check:
  enabled policies -> condition match (users, apps, client types) -> grant/session control match
  Pass: >= 1 match (report policy names in CurrentValue)
  Fail: 0 matches
```

**Orchestrator wiring**: Identity section, after `07b-Entra-Security-Config`, as `07c-CA-Security-Config`.

**Migration**: ENTRA-CA-001 (legacy auth block) moves here as CA-LEGACYAUTH-001. ENTRA-CA-002/003 (info counts) stay in Entra collector.

**Show-CheckProgress**: `'CAEvaluator'` maps to section `'Identity'`, label `'CA Policy Evaluation'`, ordered after `'Entra'`.

#### 2. `Exchange-Online/Get-DnsSecurityConfig.ps1` (Collector: `DNS`)

**Purpose**: Evaluate DNS authentication records (SPF/DKIM/DMARC) against CIS requirements.

**Data sources**: `Get-AcceptedDomain`, `Resolve-DnsName`, `Get-DkimSigningConfig`

**Design note**: The orchestrator's existing DNS section continues producing the detailed `12-DNS-Authentication.csv` inventory. This collector produces pass/fail verdicts via Add-Setting. Per-domain results: "3/4 domains compliant -- missing: contoso.com" with Fail if any domain is non-compliant.

**Orchestrator wiring**: Email section, after `12-DNS-Authentication`, as `12b-DNS-Security-Config`. CollectorMap entry must include `RequiredServices = @('ExchangeOnline')` since `Get-DkimSigningConfig` requires an active EXO connection.

**Show-CheckProgress**: `'DNS'` maps to section `'Email'`, label `'DNS Security Config'`, ordered after `'ExchangeOnline'`.

#### 3. `Intune/Get-IntuneSecurityConfig.ps1` (Collector: `Intune`)

**Purpose**: Evaluate Intune device compliance policy configuration against CIS Section 4.

**Data sources**: Graph Device Management endpoints for compliance policy settings and enrollment configurations.

**Orchestrator wiring**: Intune section, after existing compliance/config collectors, as `14b-Intune-Security-Config`. Requires `Graph` service.

**Show-CheckProgress**: `'Intune'` maps to section `'Intune'`, label `'Intune Security Config'`, ordered after `'Compliance'` and before `'SharePoint'`.

### Existing Collector Extensions

#### `Entra/Get-EntraSecurityConfig.ps1` (+14 checks)

**New sections to add:**
- Section 15: Per-user MFA disabled (new Graph call to check legacy MFA states)
- Section 16: Third-party app restrictions (from existing `authorizationPolicy`)
- Section 17: Guest invitation domain restrictions (from existing `authorizationPolicy`)
- Section 18: Dynamic guest group exists (new Graph groups query)
- Section 19: Device registration extensions -- LAPS, BitLocker recovery, local admin (extends existing device registration section)
- Section 20: Auth method extensions -- Authenticator fatigue protection, system-preferred MFA (extends existing auth methods section)
- Section 21: Password protection for on-prem AD (from existing settings or new call)
- Section 22: PIM role management (new beta Graph call, license-gated)
- Section 23: Access reviews (new beta Graph call, license-gated)
- Section 24: PIM approval requirements (new beta Graph call, license-gated)
- Section 25: Org settings -- admin cloud-only, admin license footprint, public groups, user owned apps (mix of new Graph queries)
- Section 26: Review-only org settings -- Forms phishing, third-party M365 web storage, Bookings

#### `Exchange-Online/Get-ExoSecurityConfig.ps1` (+2 checks)

- EXO-SHAREDMBX-001: Shared mailbox sign-in blocked (new `Get-Mailbox -RecipientTypeDetails SharedMailbox` + Graph user check)
- EXO-DIRECTSEND-001: Direct Send submissions rejected (new `Get-InboundConnector` or transport rule check)

#### `Security/Get-DefenderSecurityConfig.ps1` (+5 checks)

- DEFENDER-MALWARE-002: Comprehensive attachment filtering (from existing `$malwareFilterPolicy`)
- DEFENDER-ANTISPAM-002: No allowed domains in anti-spam (from existing `$contentFilterPolicy`)
- DEFENDER-PRIORITY-001: Priority account protection enabled (new `Get-EOPProtectionPolicyRule` or Graph, license-gated)
- DEFENDER-PRIORITY-002: Strict protection on priority accounts (same data source)
- DEFENDER-ZAP-001: ZAP for Teams enabled (new cmdlet or ATP policy, license-gated)

#### `Collaboration/Get-SharePointSecurityConfig.ps1` (+3 checks)

- SPO-B2B-001: B2B integration enabled (from existing `$spoSettings`)
- SPO-OD-001: OneDrive sharing restricted (from existing `$spoSettings`)
- SPO-MALWARE-002: Infected file download blocked (from existing `$spoSettings`)

#### `Collaboration/Get-TeamsSecurityConfig.ps1` (+2 checks)

- TEAMS-APPS-001: App permission policies configured (new Graph call or Review)
- TEAMS-REPORTING-001: User security reporting enabled (new Graph call or Review)

### Review-Status Checks (11 total)

Controls where no reliable Graph API exists. Each emits `Review` status with:
- **CurrentValue**: "Cannot be checked via API -- verify in [exact admin portal path]"
- **Remediation**: Step-by-step manual verification instructions with portal navigation

| CheckId | CIS | Control | Why Review |
|---------|-----|---------|------------|
| ENTRA-PIM-001 | 5.3.1 | PIM manages roles | License-gated (P2) |
| ENTRA-PIM-002 | 5.3.2 | Guest access reviews | License-gated (P2) |
| ENTRA-PIM-003 | 5.3.3 | Privileged role access reviews | License-gated (P2) |
| ENTRA-PIM-004 | 5.3.4 | GA activation approval | License-gated (P2) |
| ENTRA-PIM-005 | 5.3.5 | PRA activation approval | License-gated (P2) |
| ENTRA-ORGSETTING-002 | 1.3.5 | Forms phishing protection | M365 admin center only |
| ENTRA-ORGSETTING-003 | 1.3.7 | Third-party storage in M365 web | Admin center only |
| ENTRA-ORGSETTING-004 | 1.3.9 | Bookings restricted | Admin center only |
| TEAMS-APPS-001 | 8.4.1 | App permission policies | May need admin center |
| TEAMS-REPORTING-001 | 8.6.1 | User security reporting | May need admin center |
| DEFENDER-ZAP-001 | 2.4.4 | ZAP for Teams | May need Defender P2 |

**Note**: PIM checks will attempt the API call first. If a 403 is returned (no P2 license), they fall back to Review. On tenants with P2, they produce real Pass/Fail results. The 5 PIM checks are listed as Review here as worst-case; they become automated on P2 tenants.

## Check Matrix by PR

### PR 1: CA Policy Evaluator (12 checks)

| CheckId | CIS | Check | Key Filter |
|---------|-----|-------|------------|
| CA-MFA-ADMIN-001 | 5.2.2.1 | MFA for admin roles | `builtInControls` contains `mfa`, targets admin role template IDs |
| CA-MFA-ALL-001 | 5.2.2.2 | MFA for all users | `builtInControls` contains `mfa`, targets `All` users |
| CA-LEGACYAUTH-001 | 5.2.2.3 | Legacy auth blocked | Migrated from ENTRA-CA-001; `clientAppTypes` legacy + `block` |
| CA-SIGNIN-FREQ-001 | 5.2.2.4 | Sign-in frequency for admins | `sessionControls.signInFrequency` set + `persistentBrowser` = never |
| CA-PHISHRES-001 | 5.2.2.5 | Phishing-resistant MFA for admins | `authenticationStrength` references phishing-resistant preset |
| CA-USERRISK-001 | 5.2.2.6 | User risk policy | `userRiskLevels` populated + block/mfa grant |
| CA-SIGNINRISK-001 | 5.2.2.7 | Sign-in risk policy | `signInRiskLevels` populated + block/mfa grant |
| CA-SIGNINRISK-002 | 5.2.2.8 | Sign-in risk blocks medium+high | `signInRiskLevels` contains medium,high + `block` |
| CA-DEVICE-001 | 5.2.2.9 | Managed device required | `builtInControls` contains `compliantDevice` or `domainJoinedDevice` |
| CA-DEVICE-002 | 5.2.2.10 | Managed device for security info | Same + targets `registerSecurityInfo` user action |
| CA-INTUNE-001 | 5.2.2.11 | Sign-in frequency for Intune | `signInFrequency` = every time, targets Intune app ID |
| CA-DEVICECODE-001 | 5.2.2.12 | Device code flow blocked | `authenticationFlows` deviceCodeFlow + block |

### PR 2: Entra + PIM (14 checks)

| CheckId | CIS | Check | Data Source |
|---------|-----|-------|-------------|
| ENTRA-PERUSER-001 | 5.1.2.1 | Per-user MFA disabled | New Graph call or MSOnline legacy |
| ENTRA-APPS-001 | 5.1.2.2 | Third-party apps blocked | Existing `authorizationPolicy` |
| ENTRA-GUEST-004 | 5.1.6.1 | Invitation domains restricted | Existing `authorizationPolicy` |
| ENTRA-GROUP-002 | 5.1.3.1 | Dynamic guest group exists | New Graph groups query |
| ENTRA-DEVICE-004 | 5.1.4.4 | Local admin limited on join | Extends existing device registration |
| ENTRA-DEVICE-005 | 5.1.4.5 | LAPS enabled | Extends existing device registration |
| ENTRA-DEVICE-006 | 5.1.4.6 | BitLocker key recovery restricted | New Graph call |
| ENTRA-AUTHMETHOD-003 | 5.2.3.1 | Authenticator fatigue protection | Extends existing auth methods |
| ENTRA-AUTHMETHOD-004 | 5.2.3.6 | System-preferred MFA | Extends existing auth methods |
| ENTRA-PIM-001 | 5.3.1 | PIM manages roles | New beta Graph, license-gated |
| ENTRA-PIM-002 | 5.3.2 | Guest access reviews | New beta Graph, license-gated |
| ENTRA-PIM-003 | 5.3.3 | Privileged role access reviews | New beta Graph, license-gated |
| ENTRA-PIM-004 | 5.3.4 | GA activation approval | New beta Graph, license-gated |
| ENTRA-PIM-005 | 5.3.5 | PRA activation approval | New beta Graph, license-gated |

### PR 3: DNS + Defender + EXO Email (9 checks)

| CheckId | CIS | Check | Data Source |
|---------|-----|-------|-------------|
| DNS-SPF-001 | 2.1.8 | SPF for all domains | `Resolve-DnsName` + `Get-AcceptedDomain` |
| DNS-DKIM-001 | 2.1.9 | DKIM for all domains | `Get-DkimSigningConfig` |
| DNS-DMARC-001 | 2.1.10 | DMARC for all domains | `Resolve-DnsName` |
| DEFENDER-MALWARE-002 | 2.1.11 | Comprehensive attachment filter | Existing `$malwareFilterPolicy` |
| DEFENDER-ANTISPAM-002 | 2.1.14 | No allowed domains in anti-spam | Existing `$contentFilterPolicy` |
| DEFENDER-PRIORITY-001 | 2.4.1 | Priority account protection | New cmdlet, license-gated |
| DEFENDER-PRIORITY-002 | 2.4.2 | Strict protection on priority | Same data source |
| DEFENDER-ZAP-001 | 2.4.4 | ZAP for Teams | New cmdlet, license-gated |
| EXO-DIRECTSEND-001 | 6.5.5 | Direct Send rejected | `Get-InboundConnector` |

### PR 4: Org Settings + Intune + SPO + Teams (16 checks)

| CheckId | CIS | Check | Data Source |
|---------|-----|-------|-------------|
| ENTRA-CLOUDADMIN-001 | 1.1.1 | Cloud-only admin accounts | Graph admin role members |
| ENTRA-CLOUDADMIN-002 | 1.1.4 | Admin license footprint | Graph admin users + licenses |
| ENTRA-GROUP-002 | 1.2.1 | Public groups managed | Graph groups query |
| ENTRA-ORGSETTING-001 | 1.3.4 | User owned apps restricted | `/beta/settings` |
| ENTRA-PASSWORD-005 | 5.2.3.3 | Password protection on-prem | Graph settings or policy |
| EXO-SHAREDMBX-001 | 1.2.2 | Shared mailbox sign-in blocked | `Get-Mailbox` + Graph user |
| ENTRA-ORGSETTING-002 | 1.3.5 | Forms phishing (Review) | No API |
| ENTRA-ORGSETTING-003 | 1.3.7 | Third-party storage M365 web (Review) | No API |
| ENTRA-ORGSETTING-004 | 1.3.9 | Bookings restricted (Review) | No API |
| INTUNE-COMPLIANCE-001 | 4.1 | Devices without policy = non-compliant | Graph Device Management |
| INTUNE-ENROLL-001 | 4.2 | Personal enrollment blocked | Graph Device Management |
| SPO-B2B-001 | 7.2.2 | B2B integration enabled | Existing `$spoSettings` |
| SPO-OD-001 | 7.2.4 | OneDrive sharing restricted | Existing `$spoSettings` |
| SPO-MALWARE-002 | 7.3.1 | Infected file download blocked | Existing `$spoSettings` |
| TEAMS-APPS-001 | 8.4.1 | App permission policies (Review) | Admin center |
| TEAMS-REPORTING-001 | 8.6.1 | User reporting (Review) | Admin center |

## Registry Update Pattern

Same as v0.7.0:
1. Add new automated entry with `hasAutomatedCheck: true`, `collector`, `category`, full framework mappings
2. Add `"supersededBy": "<new-checkId>"` to corresponding `MANUAL-CIS-*` entry
3. Special case: ENTRA-CA-001 migration -- add `"supersededBy": "CA-LEGACYAUTH-001"` and mark old entry `hasAutomatedCheck: false`

## Version Bump

Update all 11 locations per `.claude/rules/versions.md` from 0.7.0 to 0.8.0.

## Files to Modify

| File | Changes |
|------|---------|
| `Entra/Get-CASecurityConfig.ps1` | **NEW** -- 12 CA evaluation checks |
| `Exchange-Online/Get-DnsSecurityConfig.ps1` | **NEW** -- 3 DNS checks |
| `Intune/Get-IntuneSecurityConfig.ps1` | **NEW** -- 2 Intune checks |
| `Entra/Get-EntraSecurityConfig.ps1` | +14 checks (identity, auth methods, PIM, org settings) |
| `Exchange-Online/Get-ExoSecurityConfig.ps1` | +2 checks (shared mailbox, direct send) |
| `Security/Get-DefenderSecurityConfig.ps1` | +5 checks (malware filter, anti-spam, priority, ZAP) |
| `Collaboration/Get-SharePointSecurityConfig.ps1` | +3 checks (B2B, OneDrive sharing, malware) |
| `Collaboration/Get-TeamsSecurityConfig.ps1` | +2 checks (app policies, reporting) |
| `Invoke-M365Assessment.ps1` | Version bump, 3 new collector entries in collectorMap |
| `M365-Assess.psd1` | Version bump, 3 new files in FileList |
| `Common/Show-CheckProgress.ps1` | Add 3 new collectors to maps and order |
| `controls/registry.json` | ~51 new entries + ~51 MANUAL supersededBy |
| `README.md` | Version badge, automated count update |
| `.claude/rules/versions.md` | Update current version + add 3 new collector rows (CA, DNS, Intune) to version bump checklist |
| All modified collector `.NOTES` blocks | Version bump to 0.8.0 |

## Verification

Per PR:
1. Parse check: `[scriptblock]::Create()`
2. JSON validation: `ConvertFrom-Json` on registry.json
3. PSScriptAnalyzer lint
4. Pester registry integrity tests

After all PRs:
5. Live tenant test against `dzmlab.onmicrosoft.com`
6. Verify console streaming shows new collectors with correct check counts
7. Verify HTML report includes new checks in CIS compliance matrix
8. Verify XLSX export includes new framework mappings

## Post v0.8.0 Coverage

| Metric | Before | After |
|--------|--------|-------|
| CIS-Automated covered | 68/129 (53%) | 108/129 (84%) |
| Review-status checks | 0 | 11 |
| Total awareness | 68/129 | 119/129 (92%) |
| Remaining (Power BI) | -- | 10/129 (v0.9.0) |
| Registry entries | 176 | ~227 |
| New collectors | 6 | 9 |
| New API calls | -- | ~10-12 |
