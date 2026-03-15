# Authentication

M365 Assess supports multiple authentication methods for connecting to Microsoft 365 services.

## Interactive (Default)

A browser window opens for each service (Graph, Exchange Online, etc.). Best for one-time or ad-hoc assessments.

```powershell
.\Invoke-M365Assessment.ps1 -TenantId 'contoso.onmicrosoft.com'
```

## Interactive with UPN

Specifying `-UserPrincipalName` avoids WAM (Web Account Manager) broker errors that can occur on some Windows systems, particularly when multiple accounts are signed in.

```powershell
.\Invoke-M365Assessment.ps1 -TenantId 'contoso.onmicrosoft.com' `
    -UserPrincipalName 'admin@contoso.onmicrosoft.com'
```

## Device Code Flow

For environments where a browser cannot open (headless servers, remote SSH sessions), use device code flow. You'll be given a URL and code to enter on any device with a browser.

```powershell
.\Invoke-M365Assessment.ps1 -TenantId 'contoso.onmicrosoft.com' -UseDeviceCode
```

## Certificate-Based (App-Only)

For unattended or scheduled runs using an Entra ID App Registration with certificate credentials. Requires pre-configured API permissions.

```powershell
.\Invoke-M365Assessment.ps1 -TenantId 'contoso.onmicrosoft.com' `
    -ClientId '00000000-0000-0000-0000-000000000000' `
    -CertificateThumbprint 'ABC123DEF456'
```

### Required API Permissions

The App Registration needs these Microsoft Graph **application** permissions:

| Permission | Used By |
|-----------|---------|
| `User.Read.All` | User summary, MFA report |
| `UserAuthenticationMethod.Read.All` | MFA method details |
| `Directory.Read.All` | Admin roles, groups, org settings |
| `Policy.Read.All` | Conditional Access, auth methods |
| `Application.Read.All` | App registrations |
| `SecurityEvents.Read.All` | Secure Score |
| `DeviceManagementConfiguration.Read.All` | Intune policies |
| `DeviceManagementManagedDevices.Read.All` | Device inventory |
| `Sites.Read.All` | SharePoint/OneDrive |
| `TeamSettings.Read.All` | Teams configuration |

For Exchange Online, add the **Exchange.ManageAsApp** application role and assign the **Exchange Administrator** or **Global Reader** directory role to the service principal.

See [`Setup/`](Setup/) for App Registration provisioning scripts.

## Managed Identity

For workloads running on Azure (VMs, App Service, Azure Functions, Azure Automation), use managed identity to authenticate without credentials. The Azure resource must have a system- or user-assigned managed identity with appropriate permissions.

```powershell
.\Invoke-M365Assessment.ps1 -ManagedIdentity
```

Managed identity is supported for Graph and Exchange Online. Purview and Power BI do not support managed identity and will fall back to browser-based login with a warning.

## Pre-Existing Connections

If you have already connected to the required services (e.g., via `Connect-MgGraph` and `Connect-ExchangeOnline`), skip the connection step entirely:

```powershell
.\Invoke-M365Assessment.ps1 -SkipConnection
```

This is useful when:
- You need custom scopes or connection parameters
- You are running multiple assessments in the same session
- Your environment requires a specific authentication flow not covered above

## Cloud Environments

Use `-M365Environment` for government or sovereign cloud tenants:

```powershell
# GCC High
.\Invoke-M365Assessment.ps1 -TenantId 'contoso.onmicrosoft.us' -M365Environment gcchigh

# DoD
.\Invoke-M365Assessment.ps1 -TenantId 'contoso.onmicrosoft.mil' -M365Environment dod
```

| Value | Environment |
|-------|------------|
| `commercial` | Microsoft 365 Commercial (default) |
| `gcc` | Government Community Cloud |
| `gcchigh` | GCC High |
| `dod` | Department of Defense |

## Capability Matrix

Not all sections work with all authentication methods. This matrix shows what works where.

### Auth Method Support

| Section | Interactive | Device Code | App-Only (Cert) | Managed Identity | Notes |
|---------|:-----------:|:-----------:|:----------------:|:----------------:|-------|
| Tenant | Yes | Yes | Yes | Yes | |
| Identity | Yes | Yes | Yes | Yes | |
| Licensing | Yes | Yes | Yes | Yes | |
| Email | Yes | Yes | Yes | Yes | EXO requires Exchange Admin or Global Reader role for app-only |
| Intune | Yes | Yes | Yes | Yes | Falls back to Review on 403 |
| Security | Yes | Yes | Yes | Yes | DLP/Purview: no device code or managed identity (falls back to browser) |
| Collaboration | Yes | Yes | **Partial** | Yes | **Teams checks skip under app-only** -- Graph Teams APIs require delegated auth |
| PowerBI | Yes | No | Yes | No | Opt-in. Requires MicrosoftPowerBIMgmt module |
| Hybrid | Yes | Yes | Yes | Yes | |
| Inventory | Yes | Yes | Yes | Yes | |
| ActiveDirectory | Yes | Yes | N/A | N/A | Runs locally via RSAT -- no cloud auth needed |
| SOC2 | Yes | Yes | Yes | Yes | Purview collectors: no device code or managed identity |
| ScubaGear | Yes | N/A | Yes | N/A | **Windows only** -- requires PowerShell 5.1 |

### License Requirements

| Section/Collector | Minimum License | Behavior Without License |
|-------------------|----------------|------------------------|
| All default sections | E3 | Full functionality |
| Teams Security Config | E3 + Teams | Skips with warning if no Teams licenses detected |
| Defender Security Config | E3 + Defender P1 | Gracefully skips checks when Defender cmdlets unavailable |
| PIM checks (Entra) | E5 or Entra P2 | Falls back to Review status with manual verification steps |
| Intune Security Config | E3 + Intune | Falls back to Review on permission errors |
| DLP Policies | E3 + Purview | Skippable with `-SkipDLP` to avoid Purview connection |
| ScubaGear | Varies by product | Reports N/A for unlicensed products |

### Platform Requirements

| Requirement | Sections Affected |
|-------------|-------------------|
| **Windows + PowerShell 5.1** | ScubaGear only |
| **RSAT or domain controller** | ActiveDirectory only |
| **PowerShell 7.x** | All other sections (Windows, macOS, Linux) |

### Service Connections

Each section connects to one or more M365 services. If a service connection fails, only its dependent collectors are skipped -- not the entire assessment.

| Service | Sections | Auth Methods |
|---------|----------|-------------|
| Microsoft Graph | Tenant, Identity, Licensing, Intune, Security, Collaboration, Hybrid, Inventory, SOC2 | Interactive, device code, certificate, client secret, managed identity |
| Exchange Online | Email, Security, Inventory | Interactive, device code, certificate, managed identity |
| Purview | Security (DLP only), SOC2 | Interactive, certificate. **No device code or managed identity** |
| Power BI | PowerBI | Interactive, certificate. **No device code or managed identity** |
