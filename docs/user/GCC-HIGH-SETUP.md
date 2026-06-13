# Running M365 Assess against GCC High

This guide covers the GCC High specific setup. For general authentication methods
and the per-section cloud support matrix, see [`AUTHENTICATION.md`](AUTHENTICATION.md)
and [`SOVEREIGN-CLOUDS.md`](../reference/SOVEREIGN-CLOUDS.md).

> **TL;DR**
> 1. Register the app at **`portal.azure.us`** (not `portal.azure.com`).
> 2. Connect with `-M365Environment gcchigh` (or let auto-detection handle it).
> 3. Grant consent once with `Grant-M365AssessConsent` - it routes to `graph.microsoft.us` automatically.
> 4. Most sections work. A few endpoints are genuine sovereign gaps and show as `Skipped`, not errors.

---

## 1. Prerequisites

- A GCC High tenant (`*.onmicrosoft.us`).
- An account that can grant admin consent (Global Administrator, or Privileged Role Administrator + the reader roles).
- PowerShell 7.x and the required modules (see [`QUICKSTART.md`](QUICKSTART.md)).

---

## 2. App registration (portal.azure.us)

GCC High app registrations live in the **US Government Azure portal**:

```
https://portal.azure.us/
```

This is a different portal from commercial (`portal.azure.com`). An app registered in
the commercial portal will not be found by a GCC High tenant.

- **Unattended / app-only runs:** create an app registration plus a **certificate**.
  Client-secret auth is rejected by Exchange Online and Purview on every cloud by
  design, so a certificate is required for those services. See
  [`AUTHENTICATION.md`](AUTHENTICATION.md) for the certificate setup.
- **Interactive runs:** no manual app registration is required. The Microsoft Graph
  PowerShell first-party app handles interactive sign-in against `login.microsoftonline.us`.

---

## 3. Connect to the right cloud

The environment is selected with `-M365Environment`:

```powershell
# Explicit
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.us' -M365Environment gcchigh

# DoD
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.mil' -M365Environment dod
```

If you omit `-M365Environment`, auto-detection (`Resolve-M365Environment`) queries the
tenant's OpenID configuration and returns `gcchigh` for USGov tenants. **DoD operators
must pass `-M365Environment dod` explicitly** - the auto-detector returns `gcchigh` as
the safe USGov default.

This single parameter routes Graph to `graph.microsoft.us`, Exchange Online to the
`O365USGovGCCHigh` endpoint, Purview to `ps.compliance.protection.office365.us`, and
Power BI to the `USGovHigh` environment.

---

## 4. Grant permissions (one time)

Run the consent helper once per tenant:

```powershell
.\src\M365-Assess\Setup\Grant-M365AssessConsent.ps1
```

The script reads the active `Get-MgContext` and routes consent calls to
`graph.microsoft.us` automatically - no manual URL editing is needed in GCC High. The
full permission set (Graph, Exchange Online, Purview, plus the directory reader roles)
is documented in [`PERMISSIONS.md`](../reference/PERMISSIONS.md).

### SharePoint settings consent

The SharePoint and OneDrive collectors require **`SharePointTenantSettings.Read.All`**.
It is included in the consent script, but if you see:

```
Unauthorized (401). The SharePointTenantSettings.Read.All permission may not be consented.
```

re-run the consent helper and confirm that permission was granted in the GCC High app
registration. This is the most common GCC High consent gap.

---

## 5. What works, and what is a known gap

GCC High has been verified against a real tenant. Most sections behave exactly as in
commercial. The items below are the GCC-High-specific outcomes:

| Area | GCC High result |
|---|---|
| Secure Score / improvement actions | **Works** - returns real data |
| PIM (privileged role policies) | **Works** - real Pass/Fail via the v1.0 role-management API |
| Power BI tenant settings | **Works** - routed to the `USGovHigh` environment (see section 6) |
| SharePoint / OneDrive | **Works** once `SharePointTenantSettings.Read.All` is consented |
| Teams app settings + external access enumeration | **Works** (v1.0 endpoints) |
| Teams client configuration + meeting policies | **Skipped** - beta-only endpoints, no v1.0 equivalent, not served in GCC High |
| Microsoft Forms tenant settings | **Skipped** - beta-only endpoint, not served in GCC High |

> **`Skipped` is not a failure.** Where an endpoint genuinely does not exist in the
> sovereign cloud, the affected checks emit `Skipped` with an explanation and appear in
> the report's "not assessed" group rather than erroring out or silently disappearing.
> The Teams client-configuration and meeting-policy controls (CIS 8.x) can be verified
> manually in the Teams admin center if needed.

---

## 6. Power BI in GCC High

Power BI **works in GCC High** once the cloud is routed correctly. The collector passes
`-Environment USGovHigh` to `Connect-PowerBIServiceAccount`, which points it at the
national-cloud authority and `api.high.powerbigov.us`. In a verified GCC High run this
was sufficient on its own - **no Azure portal change was required.**

If interactive Power BI sign-in fails on a locked-down workstation with a WAM broker
error like:

```
Error Acquiring Token: WAM Error  Error Code: 3399614466  IncorrectConfiguration
Invalid redirect uri - ensure you have configured the following url in the application
registration: ms-appx-web://microsoft.aad.brokerplugin/<client-id>
```

use one of these fallbacks (in order of preference):

1. **Certificate auth** (`-ClientId` + `-CertificateThumbprint`) - the most robust path;
   it skips the interactive WAM broker entirely.
2. **Device code** (`-UseDeviceCode`) where the tenant permits it.
3. **Add the WAM broker redirect URI** to the app registration under
   **Authentication > Platform configurations**:
   ```
   ms-appx-web://microsoft.aad.brokerplugin/23d8f6bd-1eb0-4cc2-a08c-7bf525c67bcd
   ```

> Power BI is **not generally available in DoD**; the PowerBI section returns no data
> there. See [`SOVEREIGN-CLOUDS.md`](../reference/SOVEREIGN-CLOUDS.md).

---

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| App not found at sign-in | App registered in `portal.azure.com` instead of `portal.azure.us`. Re-register in the GCC High portal. |
| SharePoint `401 Unauthorized` | `SharePointTenantSettings.Read.All` not consented. Re-run `Grant-M365AssessConsent`. |
| Teams / Forms checks show `Skipped` | Expected - those endpoints are not served in GCC High. Not an error. |
| Power BI WAM error `3399614466` | See section 6 - prefer certificate auth, or add the broker redirect URI. |
| Exchange / Purview reject client secret | By design on every cloud. Use `-CertificateThumbprint`. |

If you hit a section that fails (not `Skipped`) in GCC High, please file an issue with
the cloud, section, and the exact error from `_Assessment-Log_*.txt`.

---

## Related

- [`AUTHENTICATION.md`](AUTHENTICATION.md) - authentication methods and certificate setup
- [`SOVEREIGN-CLOUDS.md`](../reference/SOVEREIGN-CLOUDS.md) - per-section support matrix across all four clouds
- [`PERMISSIONS.md`](../reference/PERMISSIONS.md) - section-to-permissions mapping
- [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) - general troubleshooting
