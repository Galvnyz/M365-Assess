# ScubaGear Integration (CISA Baseline Compliance)

[CISA ScubaGear](https://github.com/cisagov/ScubaGear) assesses your M365 tenant against the Secure Cloud Business Applications (SCuBA) security baselines. It is included as an **opt-in** section because it requires Windows PowerShell 5.1, handles its own authentication, and takes several minutes to complete.

## How It Works

The orchestrator transparently shells out to `powershell.exe` (Windows PowerShell 5.1) to run ScubaGear. You stay in PowerShell 7; the version bridging is handled automatically.

## First Run

ScubaGear and all 8 of its dependencies (OPA, Microsoft.Graph.Authentication, ExchangeOnlineManagement, SharePoint PnP, Teams, PowerApps, etc.) are auto-installed via `Initialize-SCuBA`. This may take 5-10 minutes. Subsequent runs are faster.

## Products Scanned

All 7 products by default: Entra ID, Defender, Exchange Online, Power Platform, Power BI, SharePoint, Teams.

Use `-ScubaProductNames` to scan specific products:

```powershell
# Scan only Entra ID and Exchange Online
.\Invoke-M365Assessment.ps1 -Section ScubaGear -TenantId 'contoso.onmicrosoft.com' `
    -ScubaProductNames aad,exo
```

Available product names: `aad`, `defender`, `exo`, `powerplatform`, `powerbi`, `sharepoint`, `teams`

## Examples

```powershell
# Run ScubaGear scan only
.\Invoke-M365Assessment.ps1 -Section ScubaGear -TenantId 'contoso.onmicrosoft.com'

# Combine with other sections
.\Invoke-M365Assessment.ps1 -Section Tenant,Identity,ScubaGear -TenantId 'contoso.onmicrosoft.com'

# Government tenant (GCC)
.\Invoke-M365Assessment.ps1 -Section ScubaGear -TenantId 'contoso.onmicrosoft.us' -M365Environment gcc

# GCC High
.\Invoke-M365Assessment.ps1 -Section ScubaGear -TenantId 'contoso.onmicrosoft.us' -M365Environment gcchigh
```

## Output

ScubaGear produces native HTML and JSON reports in the `ScubaGear-Report/` subfolder alongside the parsed `23-ScubaGear-Baseline.csv`.

```
Assessment_YYYYMMDD_HHMMSS/
  23-ScubaGear-Baseline.csv        # Parsed results
  ScubaGear-Report/                # Native ScubaGear output
    BaselineReports.html
    ProviderSettingsExport.json
    ...
```

## Requirements

| Requirement | Details |
|-------------|---------|
| Windows PowerShell 5.1 | Required (ships with Windows). ScubaGear does not run on PowerShell 7. |
| Windows OS | ScubaGear is Windows-only |
| Internet access | First run downloads OPA binary and PowerShell modules |

ScubaGear is **not available** on macOS or Linux.
