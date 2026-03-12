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

See [`Setup/`](../Setup/) for App Registration provisioning scripts.

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
