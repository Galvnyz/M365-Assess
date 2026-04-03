# PnP.PowerShell Evaluation for SharePoint/OneDrive Collectors

**Issue:** [#255](https://github.com/Galvnyz/M365-Assess/issues/255)
**Date:** 2026-04-01 (validated 2026-04-02)
**Status:** Research Complete -- DEFER (no-go)

## Background

M365-Assess currently uses Microsoft Graph API (`/v1.0/admin/sharepoint/settings` and
`/beta/admin/sharepoint/settings`) to collect SharePoint Online and OneDrive security
configuration. Several CIS Benchmark checks cannot be fully automated because the Graph
API does not expose the required tenant-level properties. This document evaluates whether
adopting PnP.PowerShell would close those gaps.

---

## 1. Current Coverage Gaps

The collector (`Collaboration/Get-SharePointSecurityConfig.ps1`) currently reports
**"Requires SPO PowerShell verification"** or **"Not available via Graph API"** for the
following checks:

| CheckId | Setting | Gap Reason |
|---------|---------|------------|
| SPO-SHARING-008 | External Sharing Restricted by Security Group | Graph does not expose `OnlyAllowMembersOfSpecificSecurityGroupsToShareExternally` |
| SPO-SCRIPT-001 | Custom Script on Personal Sites (CIS 7.3.3) | `DenyAddAndCustomizePages` per-site property, no Graph equivalent |
| SPO-SCRIPT-002 | Custom Script on Self-Service Sites (CIS 7.3.4) | `DenyAddAndCustomizePagesForSitesCreatedByUser` tenant property, no Graph equivalent |
| SPO-B2B-001 | SharePoint B2B Integration (CIS 7.2.2) | `isB2BIntegrationEnabled` only in beta, unreliable |
| SPO-OD-001 | OneDrive External Sharing (CIS 7.2.4) | `oneDriveSharingCapability` only in beta |
| SPO-MALWARE-002 | Infected File Download Blocked (CIS 7.3.1) | `disallowInfectedFileDownload` only in beta |

Several additional Graph v1.0 properties (default sharing link type, guest expiration,
email attestation, default link permission) are available but occasionally return null
depending on tenant configuration, making fallback desirable.

### Graph v1.0 sharepointSettings: Full Property List

The Graph v1.0 endpoint exposes approximately 28 properties. Notable properties that
**are** available: `sharingCapability`, `sharingDomainRestrictionMode`,
`isResharingByExternalUsersEnabled`, `isLegacyAuthProtocolsEnabled`,
`isUnmanagedSyncAppForTenantRestricted`, `idleSessionSignOut`.

Notable properties that are **missing** from Graph entirely (even beta):

- IP-based access restriction settings
- Conditional access controls for SharePoint
- Claims-based controls
- Link expiration policies
- `DenyAddAndCustomizePages` (per-site and tenant-level)
- Security group restriction for external sharing
- Several advanced compliance and DLP-related tenant settings

The Set-SPOTenant / Get-SPOTenant cmdlet surface exposes **100+ properties**, compared
to Graph's ~28. PnP's `Get-PnPTenant` wraps the same CSOM/REST surface and returns a
comparable (though slightly smaller) subset.

---

## 2. PnP.PowerShell vs Microsoft.Graph.Sites

### What PnP Can Access That Graph Cannot

PnP.PowerShell uses the SharePoint Client Side Object Model (CSOM) and SharePoint REST
APIs under the hood, giving it access to the full SPO tenant administration surface.
Specific advantages relevant to M365-Assess:

| Capability | PnP Cmdlet | Graph Equivalent |
|-----------|-----------|-----------------|
| Custom script per site | `Get-PnPSite -Includes DenyAddAndCustomizePages` | None |
| Custom script tenant default | `Get-PnPTenant` property | None |
| Security group sharing restriction | `Get-PnPTenant` property | None |
| Infected file download block | `Get-PnPTenant` property | Beta only (unreliable) |
| OneDrive sharing capability | `Get-PnPTenant` property | Beta only |
| B2B integration enabled | `Get-PnPTenant` property | Beta only |
| IP-based access restrictions | `Get-PnPTenant` property | None |
| Link expiration policies | `Get-PnPTenant` property | None |
| Conditional access policy for SPO | `Get-PnPTenant` property | None |
| Site enumeration with properties | `Get-PnPTenantSite` | `Sites.Read.All` (limited properties) |

PnP provides **650+ cmdlets** spanning SharePoint, Teams, Planner, Flow, and Entra ID.
For this evaluation, only the tenant administration cmdlets matter.

### What Graph Does Better

- **Standardized authentication:** Graph connections via `Connect-MgGraph` are already
  established by M365-Assess. No separate connection step needed.
- **Consistent API surface:** REST-based, versioned, predictable.
- **No CSOM dependency:** Graph does not pull in the SharePoint CSOM assemblies.

---

## 3. Authentication Compatibility

### Supported Auth Methods

PnP.PowerShell supports:

- **Certificate-based app-only auth** (fully supported via `Connect-PnPOnline -ClientId -Tenant -CertificatePath`)
- **Managed Identity** (Azure Functions, Azure Automation via `-ManagedIdentity` flag)
- **Interactive/delegated** (browser-based OAuth)
- **Device code flow**
- **Client secret** (deprecated, scheduled for removal after April 2026)

### Integration with Existing Graph Connections

PnP.PowerShell **cannot share** an existing `Connect-MgGraph` session. It maintains its
own authentication context via `Connect-PnPOnline`. This means:

- A **separate connection call** is required (`Connect-PnPOnline -Url https://<tenant>-admin.sharepoint.com`)
- The same Azure AD app registration **can** be reused if it has both Graph and
  SharePoint API permissions configured, but PnP establishes its own token.
- Users would need to provide the SharePoint admin URL or tenant name, which M365-Assess
  can derive from the existing Graph connection context.

### Permission Requirements

PnP tenant administration cmdlets require **SharePoint Administrator** role or an app
registration with the `Sites.FullControl.All` application permission on SharePoint. This
is a broader permission scope than the current `SharePointTenantSettings.Read.All` Graph
scope used by M365-Assess.

---

## 4. Module Size and Dependency Impact

### Package Metrics

| Metric | Value |
|--------|-------|
| Current version | 3.1.0 (released April 18, 2025; still latest stable as of April 2026) |
| Total PSGallery downloads | 50.7 million |
| Declared PSGallery dependencies | None (self-contained) |
| Minimum PowerShell version | 7.4.0 |
| Runtime | .NET 8.0 |
| Cmdlet count | 750+ |
| Estimated install size | ~80-120 MB (assemblies + CSOM binaries) |
| Nightly builds | 3.1.345-nightly (March 2026) |

### Dependency Concerns

While the PSGallery listing declares no module dependencies, PnP.PowerShell bundles
significant internal dependencies:

- **MSAL.NET** for authentication (potential version conflict with Microsoft.Graph SDK
  which also bundles MSAL.NET)
- **SharePoint CSOM assemblies** (~30 MB of SharePoint client libraries)
- **Azure Identity libraries**
- **Newtonsoft.Json** (potential version conflict)

The MSAL version conflict is a **known risk**. M365-Assess already has a documented MSAL
ceiling constraint with Exchange Online (EXO 3.8.0+ conflicts with Graph SDK 2.x). Adding
PnP.PowerShell introduces a third MSAL consumer, increasing the surface area for assembly
binding conflicts.

### Impact on Install Time

Adding PnP.PowerShell to `RequiredModules` would:

- Increase `Install-Module M365-Assess` time by 30-60 seconds (network-dependent)
- Add ~80-120 MB to the installed footprint
- Require PowerShell 7.4.0 minimum (M365-Assess currently requires 7.0)

---

## 5. Maintenance and License Health

### Project Health

| Metric | Value |
|--------|-------|
| License | MIT |
| GitHub stars | ~860 |
| Open issues | ~80 |
| Total releases | 20+ |
| Repository | [github.com/pnp/powershell](https://github.com/pnp/powershell) |
| Maintainer | Microsoft Patterns and Practices (community) |
| Microsoft official? | **No** -- community-maintained, no SLA |

### Release Cadence

PnP.PowerShell releases roughly **monthly to quarterly**. The v3.x line (current) is
based on .NET 8 and PowerShell 7.4. The project has been continuously maintained since
2020 (as the successor to the older SharePoint PnP PowerShell Commands module).

### Risk Assessment

- **Positive:** Active community, MIT license, regular releases, broad adoption (50M+
  downloads), Microsoft employees contribute.
- **Negative:** No Microsoft SLA or official support, no guaranteed compatibility with
  Graph SDK versions, MSAL version drift is a recurring issue in GitHub discussions,
  breaking changes between major versions (v2 to v3 required PowerShell 7.4+).

---

## 6. Alternative: Microsoft.Online.SharePoint.PowerShell (SPO Module)

The official Microsoft SPO PowerShell module (`Microsoft.Online.SharePoint.PowerShell`)
is another option worth considering:

| Aspect | SPO Module | PnP.PowerShell |
|--------|-----------|----------------|
| Maintainer | Microsoft (official) | Community (PnP) |
| Cmdlet count | ~250 | ~750 |
| Tenant settings coverage | Full (Get/Set-SPOTenant) | Near-full (Get/Set-PnPTenant) |
| Auth: certificate-based | Yes (as of Nov 2025) | Yes |
| Auth: managed identity | Limited | Yes |
| PowerShell Core support | Yes (7.x) | Yes (7.4+) |
| MSAL conflict risk | Lower (Microsoft-aligned) | Higher (bundles own MSAL) |
| SLA/support | Microsoft support | Community only |

The SPO module provides the same tenant property coverage needed to close the identified
gaps without the MSAL conflict risk. However, it introduces its own connection model
(`Connect-SPOService`) separate from Graph, similar to PnP.

---

## 7. Cost-Benefit Summary

### Benefits of Adopting PnP.PowerShell

1. **Closes 3-6 CIS check gaps** that are currently "Review" status
2. **750+ cmdlets** for future expansion (site-level audits, permission reports)
3. **Active community** with broad adoption
4. **MIT license** with no usage restrictions

### Costs and Risks

1. **MSAL version conflict risk** -- the single biggest technical concern, given existing
   EXO/Graph MSAL conflicts already documented in M365-Assess
2. **Separate auth flow** -- users must provide SharePoint admin URL and authenticate
   separately, complicating the wizard flow
3. **Broader permissions** -- `Sites.FullControl.All` vs current read-only Graph scopes
4. **80-120 MB additional footprint** and PowerShell 7.4+ minimum
5. **No Microsoft SLA** -- community module with no guaranteed compatibility
6. **Third connection to manage** -- Graph, EXO, and now PnP (or SPO) in a single
   assessment run

---

## Recommendation: DEFER

**Do not adopt PnP.PowerShell at this time.** Revisit when one of the following occurs:

### Rationale

1. **MSAL conflict risk is too high.** M365-Assess already has a documented MSAL ceiling
   constraint with EXO 3.8.0. Adding PnP.PowerShell (which bundles its own MSAL.NET)
   creates a three-way MSAL conflict surface. Until Microsoft resolves the underlying
   MSAL binding issues across its module ecosystem, adding another MSAL consumer is
   inadvisable.

2. **The gap is manageable.** The 3-6 checks that fall back to "Review" status represent
   a small fraction of the 149 total automated checks. Users can verify these manually via
   the SharePoint admin center. The remediation text in each check already provides the
   exact PowerShell command and admin center path.

3. **Graph beta is closing the gap.** Several missing properties (`disallowInfectedFileDownload`,
   `oneDriveSharingCapability`, `isB2BIntegrationEnabled`) are already available in the
   Graph beta endpoint. As these graduate to v1.0, the gap narrows without any new dependency.

4. **If a SPO dependency is needed later, prefer the official SPO module.** The
   `Microsoft.Online.SharePoint.PowerShell` module carries lower MSAL conflict risk
   (Microsoft-aligned versioning) and provides the same tenant property coverage. It
   should be the first choice if a SharePoint-specific module becomes necessary.

### Revisit Triggers

- **Microsoft resolves MSAL cross-module conflicts** (e.g., unified MSAL in .NET 9+)
- **Graph API stops improving** -- if the beta properties stall and do not graduate to v1.0 within 12 months
- **User demand** -- if customers frequently report that "Review" status checks are insufficient
- **Site-level auditing requirements** -- if M365-Assess adds per-site permission audits or site classification checks, PnP becomes significantly more compelling

### Interim Mitigation

For the checks currently stuck at "Review" status, consider adding a **documentation
note** in the report output explaining that these checks require manual verification in
the SharePoint admin center or via `Get-SPOTenant` in the SharePoint Online Management
Shell. This is already partially implemented via the `Remediation` field.

---

## 8. Existing Legacy SPO Usage in SOC2 Collector

The SOC2 confidentiality collector (`SOC2/Get-SOC2ConfidentialityControls.ps1`, lines
81-93) already uses the legacy `Microsoft.Online.SharePoint.PowerShell` module via
`Get-SPOTenant`. This is the only place in M365-Assess that depends on a SharePoint
PowerShell module rather than Graph API.

The SOC2 collector handles the dependency gracefully:

- Checks for `Get-SPOTenant` availability via `Get-Command` (line 81)
- Falls back to a status message if the module is not installed (line 93)
- Requires manual `Connect-SPOService` before running the assessment (line 88)

**PnP as a replacement for the legacy SPO module in SOC2?** Technically possible --
`Get-PnPTenant` exposes the same properties. However, replacing one optional module
dependency with another does not justify the MSAL conflict risk. If the legacy SPO module
were to be deprecated by Microsoft, PnP would become a natural replacement candidate, but
as of April 2026 Microsoft continues to maintain the SPO module with certificate-based
auth support (added November 2025).

---

## 9. Validation (April 2026)

This section documents the freshness check performed on the original research.

| Data Point | Original Value | Current Value (April 2026) | Changed? |
|------------|---------------|---------------------------|----------|
| PnP.PowerShell stable version | 3.1.0 (April 2025) | 3.1.0 (still latest stable) | No |
| Graph v1.0 sharepointSettings properties | ~28 properties | ~28 properties (no new additions) | No |
| Beta properties graduated to v1.0 | None of the gap properties | Still in beta or missing | No |
| MSAL cross-module conflict | Active (EXO 3.8.0+ vs Graph SDK) | Still active; PS 7.4 Azure Automation partial fix only | No |
| EXO ceiling constraint (#231) | Blocked | Still blocked | No |
| PnP nightly builds | Not checked | 3.1.345-nightly (March 2026) | N/A |

**Conclusion:** All original data points remain accurate. The DEFER recommendation stands
with no change in the underlying conditions.

---

## Sources

- [PnP PowerShell Overview - Microsoft Learn](https://learn.microsoft.com/en-us/powershell/sharepoint/sharepoint-pnp/sharepoint-pnp-cmdlets)
- [PnP PowerShell Authentication](https://pnp.github.io/powershell/articles/authentication.html)
- [PnP PowerShell GitHub Repository](https://github.com/pnp/powershell)
- [PnP.PowerShell 3.1.0 - PowerShell Gallery](https://www.powershellgallery.com/packages/pnp.powershell/3.1.0)
- [Graph sharepointSettings Resource Type](https://learn.microsoft.com/en-us/graph/api/resources/sharepointsettings?view=graph-rest-1.0)
- [Managing SharePoint Online Tenant Settings via Graph API](https://michev.info/blog/post/3923/managing-sharepoint-online-tenant-settings-via-the-graph-api)
- [Does Microsoft Care About SharePoint Online PowerShell?](https://office365itpros.com/2024/03/19/sharepoint-online-powershell/)
- [App-Only Authentication for SharePoint Online PowerShell](https://office365itpros.com/2025/12/02/app-only-authentication-spo/)
- [Connect-PnPOnline Documentation](https://pnp.github.io/powershell/cmdlets/Connect-PnPOnline.html)
- [Get-PnPTenant Documentation](https://pnp.github.io/powershell/cmdlets/Get-PnPTenant.html)
