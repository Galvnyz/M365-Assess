# Authentication

M365 Assess supports multiple authentication methods for connecting to Microsoft 365 services.

## Interactive (Default)

A browser window opens for each service (Graph, Exchange Online, etc.). Best for one-time or ad-hoc assessments.

```powershell
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com'
```

## Interactive with UPN

Specifying `-UserPrincipalName` avoids WAM (Web Account Manager) broker errors that can occur on some Windows systems, particularly when multiple accounts are signed in.

```powershell
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' `
    -UserPrincipalName 'admin@contoso.onmicrosoft.com'
```

## Device Code Flow

For environments where a browser cannot open (headless servers, remote SSH sessions), use device code flow. You'll be given a URL and code to enter on any device with a browser.

```powershell
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' -UseDeviceCode
```

## Certificate-Based (App-Only)

For unattended or scheduled runs using an Entra ID App Registration with certificate credentials. Requires pre-configured API permissions.

### Quick Start (Auto-Create)

If you don't have an App Registration yet, the setup script creates everything from scratch -- app registration, self-signed certificate, and all permissions in one command:

```powershell
.\Setup\Add-M365AssessmentPermissions.txt `
    -TenantId 'contoso.onmicrosoft.com' `
    -AdminUpn 'admin@contoso.onmicrosoft.com' `
    -CreateNew
```

This creates an app named "M365-Assess-Reader" with a 2-year certificate and assigns all required Graph permissions, compliance directory roles, and Exchange RBAC role groups. The script prints the `ClientId` and `CertificateThumbprint` to use with the assessment.

### Running the Assessment

```powershell
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' `
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

## Client Secret Authentication

Client secret authentication is supported for **Microsoft Graph** and **Power BI** only. Exchange Online and Purview require certificate-based authentication for app-only access.

```powershell
# Create a SecureString from your client secret
$secret = ConvertTo-SecureString 'your-client-secret' -AsPlainText -Force

# Or prompt interactively (recommended - secret never visible in terminal)
$secret = Read-Host -AsSecureString -Prompt 'Client Secret'

Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' `
    -ClientId '00000000-0000-0000-0000-000000000000' `
    -ClientSecret $secret `
    -Section Tenant,Identity,Licensing
```

> **Note:** Client secret authentication only covers Graph-based sections (Tenant, Identity, Licensing, Intune, Security, Collaboration, Hybrid, Inventory, SOC2). Email and Purview sections require certificate-based auth. Power BI supports client secret via service principal.

## Managed Identity

For workloads running on Azure (VMs, App Service, Azure Functions, Azure Automation), use managed identity to authenticate without credentials. The Azure resource must have a system- or user-assigned managed identity with appropriate permissions.

```powershell
Invoke-M365Assessment -ManagedIdentity
```

Managed identity is supported for Graph and Exchange Online. Purview and Power BI do not support managed identity and will fall back to browser-based login with a warning.

## Non-Interactive / Headless Mode

For CI/CD pipelines, scheduled tasks, or any environment without an interactive console, add `-NonInteractive` to suppress module installation prompts and script-unblock dialogs. This is independent of the authentication method — combine it with certificate auth, managed identity, or device code flow.

```powershell
# Scheduled task with certificate auth — no prompts
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' `
    -ClientId '00000000-0000-0000-0000-000000000000' `
    -CertificateThumbprint 'ABC123DEF456' `
    -NonInteractive

# Azure VM with managed identity — no prompts
Invoke-M365Assessment -ManagedIdentity -NonInteractive
```

If required modules are missing, the script logs the exact install commands and exits with an error instead of hanging on a prompt. Optional module issues (e.g., MicrosoftPowerBIMgmt) cause the affected section to be skipped with a warning.

> **Tip:** `-NonInteractive` is also activated automatically when `[Environment]::UserInteractive` is `$false`, such as in non-interactive service accounts or container environments.

## Pre-Existing Connections

If you have already connected to the required services (e.g., via `Connect-MgGraph` and `Connect-ExchangeOnline`), skip the connection step entirely:

```powershell
Invoke-M365Assessment -SkipConnection
```

This is useful when:
- You need custom scopes or connection parameters
- You are running multiple assessments in the same session
- Your environment requires a specific authentication flow not covered above

## Cloud Environments

Use `-M365Environment` for government or sovereign cloud tenants:

```powershell
# GCC High
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.us' -M365Environment gcchigh

# DoD
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.mil' -M365Environment dod
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

| Section | Interactive | Device Code | App-Only (Cert) | Client Secret | Managed Identity | Notes |
|---------|:-----------:|:-----------:|:----------------:|:-------------:|:----------------:|-------|
| Tenant | Yes | Yes | Yes | Yes | Yes | |
| Identity | Yes | Yes | Yes | Yes | Yes | |
| Licensing | Yes | Yes | Yes | Yes | Yes | |
| Email | Yes | Yes | Yes | No | Yes | EXO requires Exchange Admin or Global Reader role for app-only. Client secret not supported for EXO. |
| Intune | Yes | Yes | Yes | Yes | Yes | Falls back to Review on 403 |
| Security | Yes | Yes | Yes | Partial | Yes | DLP/Purview: no device code, managed identity, or client secret (falls back to browser) |
| Collaboration | Yes | Yes | **Partial** | Yes | Yes | **Teams checks skip under app-only** -- Graph Teams APIs require delegated auth |
| PowerBI | Yes | No | Yes | Yes | No | Opt-in. Requires MicrosoftPowerBIMgmt module |
| Hybrid | Yes | Yes | Yes | Yes | Yes | |
| Inventory | Yes | Yes | Yes | Yes | Yes | |
| ActiveDirectory | Yes | Yes | N/A | N/A | N/A | Runs locally via RSAT -- no cloud auth needed |
| SOC2 | Yes | Yes | Yes | Partial | Yes | Purview collectors: no device code, managed identity, or client secret |

### License Requirements

| Section/Collector | Minimum License | Behavior Without License |
|-------------------|----------------|------------------------|
| All default sections | E3 | Full functionality |
| Teams Security Config | E3 + Teams | Skips with warning if no Teams licenses detected |
| Defender Security Config | E3 + Defender P1 | Gracefully skips checks when Defender cmdlets unavailable |
| PIM checks (Entra) | E5 or Entra P2 | Falls back to Review status with manual verification steps |
| Intune Security Config | E3 + Intune | Falls back to Review on permission errors |
| DLP Policies | E3 + Purview | Skippable with `-SkipDLP` to avoid Purview connection |

### Platform Requirements

| Requirement | Sections Affected |
|-------------|-------------------|
| **RSAT or domain controller** | ActiveDirectory only |
| **PowerShell 7.x** | All sections (Windows, macOS, Linux) |

### Service Connections

Each section connects to one or more M365 services. If a service connection fails, only its dependent collectors are skipped -- not the entire assessment.

| Service | Sections | Auth Methods |
|---------|----------|-------------|
| Microsoft Graph | Tenant, Identity, Licensing, Intune, Security, Collaboration, Hybrid, Inventory, SOC2 | Interactive, device code, certificate, client secret (SecureString), managed identity |
| Exchange Online | Email, Security, Inventory | Interactive, device code, certificate, managed identity. **Client secret not supported.** |
| Purview | Security (DLP only), SOC2 | Interactive, certificate. **No device code, managed identity, or client secret.** |
| Power BI | PowerBI | Interactive, certificate, client secret (SecureString). **No device code or managed identity.** |
