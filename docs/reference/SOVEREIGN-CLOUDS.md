# Sovereign cloud support

> **Maintenance note:** this document is **hand-maintained** today. Per-section support varies based on Microsoft service availability in each sovereign environment. Updates welcome via PR; eventual full automation tracked alongside `controls/` data files.

M365 Assess connects to four cloud environments via the `-M365Environment` parameter on `Invoke-M365Assessment`:

| Value | Description | Authentication endpoint |
|---|---|---|
| `commercial` | Worldwide commercial M365 | `login.microsoftonline.com` |
| `gcc` | Government Cloud (formerly GCC Moderate) — same endpoints as commercial | `login.microsoftonline.com` |
| `gcchigh` | Government Cloud High (FedRAMP High; routes to USGov endpoints) | `login.microsoftonline.us` |
| `dod` | DoD Impact Level 5 (routes to USGov DoD endpoints) | `login.microsoftonline.us` |

The Graph SDK environment, EXO endpoint, and Purview connection URI are set in `Common/Connect-Service.ps1` (`$envConfig` hashtable, ~line 120).

---

## Status legend

| Status | Meaning |
|---|---|
| **Tested** | Verified working against a real tenant in this environment |
| **Expected** | Should work — same APIs are documented as available, but not personally verified |
| **Partial** | Some features in this section are available; others are missing or behave differently |
| **Unsupported** | The underlying service or required APIs are not available in this environment |

Most sections are marked **Expected** outside Commercial — the underlying APIs are documented for sovereign clouds, but exhaustive testing on every cloud is impractical. If you run M365 Assess against a sovereign tenant and find issues, please file an issue with the cloud + section + symptom.

---

## Per-section support matrix

| Section | Commercial | GCC | GCC High | DoD |
|---|---|---|---|---|
| **Tenant** (org info, domains, basic identity) | Tested | Expected | Expected | Expected |
| **Identity** (users, MFA, admin roles, CA, app registrations) | Tested | Expected | Expected | Expected |
| **Licensing** (SKU summary, per-user assignments) | Tested | Expected | Expected | Expected |
| **Email** (mailbox summary, mail flow, EXO security config, DNS auth) | Tested | Expected | Expected | Expected |
| **Intune** (device summary, compliance, config profiles, Defender for Endpoint policies) | Tested | Expected | Partial — some Defender features delayed in DoD | Partial |
| **Security** (Secure Score, Defender for Office 365 policies, DLP, Purview, Stryker readiness) | Tested | Expected | Partial — Defender feature parity varies | Partial — some MDO P2 features unavailable |
| **Collaboration** (SharePoint, OneDrive, Teams, Forms tenant settings) | Tested | Expected | Expected | Expected |
| **PowerBI** (Power BI tenant settings, capacities) | Tested | Expected | Expected | Unsupported — Power BI service not generally available in DoD |
| **Hybrid** (on-prem sync, password hash sync, agent versions) | Tested | Expected | Expected | Expected |
| **Inventory** (mailbox/group/Teams/SharePoint enumeration) | Tested | Expected | Expected | Expected |
| **ActiveDirectory** (DC health, replication, AD security — runs on a domain-joined machine) | Tested | Tested | Tested | Tested |
| **SOC2** (controls evidence pulled from Graph + Purview) | Tested | Expected | Expected | Expected |
| **ValueOpportunity** (license utilization, feature adoption) | Tested | Expected | Partial | Partial |

---

## Section caveats

### Security (Defender suite)

Defender for Office 365 P2 features (Safe Links advanced hunting, Safe Attachments dynamic delivery, automated investigation and response) historically lag in GCC High and DoD by 1-2 quarters. The collector emits `NotLicensed` (per `docs/CHECK-STATUS-MODEL.md`) when a feature isn't reachable, so check results stay honest in those clouds. Concrete gaps surfaced today:

- `DEFENDER-SAFELINKS-001` and `DEFENDER-SAFEATTACH-001` emit `NotLicensed` when the underlying cmdlets / APIs aren't present (handled in `Security/DefenderSafeAttLinksChecks.ps1`)
- `DEFENDER-ZAP-001` (ZAP for Teams) requires Defender for Office 365 P2; emits `NotLicensed` on shorter-license tenants regardless of cloud

### Intune (Endpoint Manager)

Intune service availability matches Defender — most features land in commercial first, then GCC, then GCC High, with DoD trailing slightly. Specific endpoint-related features may be marked unavailable on DoD tenants; collectors handle this gracefully.

### Power BI

Power BI service is **not generally available in DoD** as of this document's date. The PowerBI section in M365 Assess will likely return early with no data on DoD tenants. Don't pass `-Section PowerBI` against DoD; the orchestrator skips gracefully but it's a wasted Connect attempt.

### Purview / Compliance

Purview Compliance Manager assessments and DLP policies have full parity across Commercial, GCC, GCC High, and DoD. The Connect-IPPSSession URIs route to per-cloud endpoints via `Connect-Service.ps1`'s `PurviewParams`.

### Active Directory

AD collectors (Hybrid Sync, ADDomainReport, ADReplicationReport, ADSecurityReport) run **on a domain-joined Windows machine** and don't traverse the M365 cloud at all — same behavior across all four environments. The `-M365Environment` parameter doesn't affect these collectors.

---

## Tested-vs-Expected rationale

Marking everything as "Tested" would be misleading without a verified rotation across all four environments. Marking everything as "Expected" would be unhelpfully cautious for the commercial baseline most consultants use.

The matrix above commits to:

- **Commercial: Tested** — the project's reference platform
- **GCC: Expected** — same endpoints as commercial; if commercial works, GCC works (modulo tenant-specific licensing)
- **GCC High: Expected** unless a known feature gap exists (then Partial)
- **DoD: Expected/Partial/Unsupported** based on documented Microsoft service availability

When a real-world bug is reported against a sovereign cloud, that section moves to **Tested** in this matrix once the fix lands. We don't move sections to Tested speculatively.

---

## Authentication notes per cloud

All sovereign clouds support **certificate-based app-only authentication** (the recommended unattended path). Specific notes:

| Cloud | Cert auth | Client secret | Device code | Managed identity |
|---|---|---|---|---|
| Commercial | ✅ | ✅ Graph + Power BI only (per `E1 #790` warn) | ✅ | ✅ |
| GCC | ✅ | ✅ Graph + Power BI | ✅ | ✅ |
| GCC High | ✅ | ✅ Graph + Power BI | ✅ | ✅ |
| DoD | ✅ | ✅ Graph + Power BI | ✅ Limited; some DoD tenants disable device code | Verify per tenant |

Exchange Online and Purview reject client-secret auth on every cloud by design (verified in `Connect-Service.ps1:195, 225`). Use `-CertificateThumbprint` for unattended runs against EXO/Purview regardless of environment.

---

## How to add coverage for a new cloud

If a new sovereign cloud is added (e.g., a future regional GCC variant):

1. Add a new key to `$envConfig` in `Common/Connect-Service.ps1` with the appropriate `GraphEnvironment`, `ExoEnvironment`, and `PurviewParams`
2. Add the value to the `[ValidateSet]` on the `-M365Environment` parameter (in `Connect-Service.ps1` and `Invoke-M365Assessment.ps1`)
3. Add a column to the matrix in this doc with conservative `Expected` markings
4. Add tests that mock `Get-MgContext` returning the new environment string and verify routing

---

## Related

- `Common/Connect-Service.ps1` — `$envConfig` hashtable (per-cloud endpoints)
- `Invoke-M365Assessment.ps1` — `-M365Environment` parameter validation
- [`AUTHENTICATION.md`](../user/AUTHENTICATION.md) — auth methods per cloud
- [`PERMISSIONS.md`](PERMISSIONS.md) — section-to-permissions matrix (cloud-agnostic)
- [`CHECK-STATUS-MODEL.md`](CHECK-STATUS-MODEL.md) — `NotLicensed` semantics for cloud-specific feature gaps
