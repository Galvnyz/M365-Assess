# M365-Assess: Azure Function App Conversion Plan

> **Date**: March 2026
> **Scope**: Converting M365-Assess from a local PowerShell tool into an Azure Function App for automated, scheduled, and multi-tenant M365 assessments
> **Architecture**: Azure Functions v4 + PowerShell 7.4 + Durable Functions + Managed Identity

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Project Structure](#3-project-structure)
4. [Authentication & Security](#4-authentication--security)
5. [Function Definitions](#5-function-definitions)
6. [API Design](#6-api-design)
7. [Storage Architecture](#7-storage-architecture)
8. [Durable Functions Orchestration](#8-durable-functions-orchestration)
9. [Multi-Tenant Support](#9-multi-tenant-support)
10. [Infrastructure as Code](#10-infrastructure-as-code)
11. [CI/CD Pipeline](#11-cicd-pipeline)
12. [Migration Strategy](#12-migration-strategy)
13. [Performance & Scaling](#13-performance--scaling)
14. [Cost Analysis](#14-cost-analysis)
15. [Risk & Mitigations](#15-risk--mitigations)
16. [Implementation Roadmap](#16-implementation-roadmap)

---

## 1. Executive Summary

### Why a Function App?

The current M365-Assess tool runs locally on a consultant's workstation, requiring manual execution, local PowerShell module installation, and interactive authentication. Converting to an Azure Function App enables:

| Capability | Current (Local) | Function App |
|-----------|----------------|--------------|
| **Execution** | Manual, on-demand | Automated, scheduled, or on-demand via API |
| **Authentication** | Interactive browser or certificate | Managed Identity (zero secrets) |
| **Multi-tenant** | One tenant at a time | Parallel assessments across multiple tenants |
| **Scheduling** | None | CRON-based recurring assessments |
| **Results** | Local CSV/HTML files | Cloud-stored with API access and SAS sharing |
| **History** | Overwritten each run | Full assessment history with trend tracking |
| **Scalability** | Single-threaded | Fan-out/fan-in parallel collector execution |
| **Access** | Requires admin workstation | API callable from any authorized client |

### Target Audience

1. **MSPs/Partners**: Run assessments across all client tenants on a schedule, receive results via API
2. **Internal IT**: Continuous compliance monitoring with scheduled assessments
3. **Integration**: Feed results into SIEM, ticketing, or reporting platforms via API

### Technology Choices

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Azure Functions v4 | Serverless, pay-per-execution, native PowerShell support |
| Language | PowerShell 7.4 | Reuse existing collector logic without rewrite |
| Orchestration | Durable Functions | Fan-out/fan-in pattern for parallel collectors, handles long-running assessments |
| Auth | System-assigned Managed Identity | Zero secrets, auto-rotated, Graph API native support |
| Storage | Azure Blob + Table Storage | Cost-effective, simple, sufficient for assessment data |
| IaC | Bicep | Native Azure, first-class tooling, declarative |
| CI/CD | GitHub Actions | Already hosted on GitHub, free for public repos |
| Monitoring | Application Insights | Built-in Functions integration, KQL queries |

---

## 2. Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Azure Function App                           │
│                     (PowerShell 7.4 Worker)                         │
│                                                                     │
│  ┌──────────────┐  ┌─────────────────────┐  ┌──────────────────┐   │
│  │ HTTP Triggers │  │ Durable Orchestrator│  │  Timer Trigger   │   │
│  │              │  │                     │  │                  │   │
│  │ POST /assess │──│ OrchestrateAssess   │──│ ScheduledAssess  │   │
│  │ GET /status  │  │   ├─ RunCollector   │  │  (CRON-based)    │   │
│  │ GET /report  │  │   ├─ RunCollector   │  │                  │   │
│  │ GET /health  │  │   ├─ RunCollector   │  └──────────────────┘   │
│  └──────────────┘  │   └─ GenerateReport │                         │
│                     └─────────────────────┘                         │
├─────────────────────────────────────────────────────────────────────┤
│                     System-Assigned Managed Identity                │
│           (Graph API + EXO + Purview permissions)                   │
└────────────┬────────────────────┬───────────────────┬───────────────┘
             │                    │                   │
             ▼                    ▼                   ▼
   ┌─────────────────┐  ┌────────────────┐  ┌────────────────────┐
   │  Microsoft Graph │  │  Exchange      │  │  Azure Storage     │
   │  API             │  │  Online        │  │                    │
   │                  │  │                │  │  Blob: CSV/HTML    │
   │  Entra, Intune,  │  │  Mailbox,      │  │  Table: Metadata   │
   │  Security,       │  │  Mail Flow,    │  │  Queue: Durable    │
   │  Compliance      │  │  ATP           │  │                    │
   └─────────────────┘  └────────────────┘  └────────────────────┘
```

### Data Flow

```
1. Client → POST /api/assessments { tenantId, sections[] }
2. HTTP Trigger → Creates Durable Orchestration instance → Returns { assessmentId, statusUrl }
3. Orchestrator → Fans out RunCollector activities (parallel by section)
4. Each Activity → Connects to M365 services → Runs collector → Stores CSV to Blob → Returns result
5. Orchestrator → Aggregates results → Generates HTML report → Stores to Blob
6. Orchestrator → Writes assessment metadata to Table Storage
7. Client → GET /api/assessments/{id} → Returns status, progress, results
8. Client → GET /api/assessments/{id}/report → Returns SAS URL to HTML report in Blob
```

---

## 3. Project Structure

```
M365-Assess-FunctionApp/
│
├── host.json                              # Azure Functions runtime configuration
├── local.settings.json                    # Local development settings (gitignored)
├── local.settings.json.template           # Template for local settings
├── requirements.psd1                      # PowerShell module dependencies
├── profile.ps1                            # Function app startup script
│
├── Modules/
│   └── M365AssessCollectors/              # Shared PowerShell module
│       ├── M365AssessCollectors.psd1      # Module manifest
│       ├── M365AssessCollectors.psm1      # Root module (dot-sources all functions)
│       ├── Collectors/
│       │   ├── Entra/
│       │   │   ├── Invoke-TenantInfoCollector.ps1
│       │   │   ├── Invoke-UserSummaryCollector.ps1
│       │   │   ├── Invoke-MfaReportCollector.ps1
│       │   │   ├── Invoke-AdminRoleCollector.ps1
│       │   │   ├── Invoke-ConditionalAccessCollector.ps1
│       │   │   ├── Invoke-AppRegistrationCollector.ps1
│       │   │   ├── Invoke-PasswordPolicyCollector.ps1
│       │   │   ├── Invoke-EntraSecurityConfigCollector.ps1
│       │   │   ├── Invoke-IdentityProtectionCollector.ps1
│       │   │   ├── Invoke-GuestAccessCollector.ps1
│       │   │   └── Invoke-SignInAnalyticsCollector.ps1
│       │   ├── Exchange/
│       │   │   ├── Invoke-MailboxSummaryCollector.ps1
│       │   │   ├── Invoke-MailFlowCollector.ps1
│       │   │   ├── Invoke-EmailSecurityCollector.ps1
│       │   │   └── Invoke-ExoSecurityConfigCollector.ps1
│       │   ├── Intune/
│       │   │   ├── Invoke-DeviceSummaryCollector.ps1
│       │   │   ├── Invoke-CompliancePolicyCollector.ps1
│       │   │   ├── Invoke-ConfigProfileCollector.ps1
│       │   │   ├── Invoke-AutopilotCollector.ps1
│       │   │   ├── Invoke-AppProtectionCollector.ps1
│       │   │   └── Invoke-EndpointSecurityCollector.ps1
│       │   ├── Security/
│       │   │   ├── Invoke-SecureScoreCollector.ps1
│       │   │   ├── Invoke-DefenderPolicyCollector.ps1
│       │   │   ├── Invoke-DefenderSecurityConfigCollector.ps1
│       │   │   └── Invoke-DlpPolicyCollector.ps1
│       │   ├── Collaboration/
│       │   │   ├── Invoke-SharePointOneDriveCollector.ps1
│       │   │   ├── Invoke-SharePointSecurityConfigCollector.ps1
│       │   │   ├── Invoke-TeamsAccessCollector.ps1
│       │   │   └── Invoke-TeamsSecurityConfigCollector.ps1
│       │   ├── Governance/
│       │   │   ├── Invoke-PimCollector.ps1
│       │   │   ├── Invoke-AccessReviewCollector.ps1
│       │   │   └── Invoke-EntitlementManagementCollector.ps1
│       │   ├── Purview/
│       │   │   ├── Invoke-SensitivityLabelCollector.ps1
│       │   │   ├── Invoke-RetentionPolicyCollector.ps1
│       │   │   ├── Invoke-AuditConfigCollector.ps1
│       │   │   └── Invoke-InsiderRiskCollector.ps1
│       │   └── PowerPlatform/
│       │       ├── Invoke-PowerPlatformCollector.ps1
│       │       ├── Invoke-PowerAppsCollector.ps1
│       │       └── Invoke-PowerAutomateCollector.ps1
│       ├── Helpers/
│       │   ├── Connect-M365Service.ps1    # Service connection wrapper
│       │   ├── Export-AssessmentCsv.ps1    # CSV export helper
│       │   ├── Export-AssessmentReport.ps1 # HTML report generator
│       │   ├── Get-CollectorDefinitions.ps1 # Collector registry
│       │   └── Write-AssessmentLog.ps1    # Logging helper
│       └── Data/
│           ├── framework-mappings.csv     # Compliance framework mappings
│           └── assets/                    # Report assets (CSS, JS, images)
│
├── StartAssessment/                       # HTTP POST → kick off assessment
│   ├── run.ps1
│   └── function.json
│
├── OrchestrateAssessment/                 # Durable Orchestrator
│   ├── run.ps1
│   └── function.json
│
├── RunCollector/                          # Durable Activity → run single collector
│   ├── run.ps1
│   └── function.json
│
├── GenerateReport/                        # Durable Activity → generate HTML report
│   ├── run.ps1
│   └── function.json
│
├── GetAssessmentStatus/                   # HTTP GET → check assessment status
│   ├── run.ps1
│   └── function.json
│
├── GetAssessmentReport/                   # HTTP GET → download report
│   ├── run.ps1
│   └── function.json
│
├── ListAssessments/                       # HTTP GET → list all assessments
│   ├── run.ps1
│   └── function.json
│
├── ScheduledAssessment/                   # Timer Trigger → recurring assessments
│   ├── run.ps1
│   └── function.json
│
├── HealthCheck/                           # HTTP GET → health endpoint
│   ├── run.ps1
│   └── function.json
│
├── infrastructure/
│   ├── main.bicep                         # All Azure resources
│   ├── modules/
│   │   ├── function-app.bicep             # Function App + App Service Plan
│   │   ├── storage.bicep                  # Storage Account
│   │   ├── keyvault.bicep                 # Key Vault
│   │   └── monitoring.bicep               # App Insights + Log Analytics
│   ├── parameters/
│   │   ├── dev.parameters.json
│   │   ├── staging.parameters.json
│   │   └── prod.parameters.json
│   ├── assign-graph-permissions.ps1       # Post-deploy: assign MI permissions
│   └── deploy.ps1                         # Deployment orchestrator
│
├── .github/
│   └── workflows/
│       ├── ci.yml                         # Lint, test, validate Bicep
│       ├── deploy-staging.yml             # Deploy to staging
│       └── deploy-prod.yml               # Deploy to production
│
├── tests/
│   ├── Unit/
│   │   ├── Collectors.Tests.ps1           # Unit tests for collector functions
│   │   └── Helpers.Tests.ps1              # Unit tests for helper functions
│   └── Integration/
│       └── Api.Tests.ps1                  # API integration tests
│
├── .funcignore                            # Files to exclude from deployment
├── .gitignore
└── README.md
```

---

## 4. Authentication & Security

### 4.1 Managed Identity (Primary Auth Method)

The Function App uses a **system-assigned managed identity** for all M365 API access. This eliminates the need for stored secrets, client IDs, or certificates.

**Setup process:**

1. Enable system-assigned managed identity on the Function App (done via Bicep)
2. Assign Graph API application permissions to the managed identity
3. Assign Exchange Online application permissions (for EXO cmdlets)

**Assigning Graph API permissions** (post-deployment script):

```powershell
# assign-graph-permissions.ps1
param(
    [Parameter(Mandatory)]
    [string]$FunctionAppName,

    [Parameter(Mandatory)]
    [string]$ResourceGroupName
)

# Get the managed identity's service principal
$mi = Get-AzADServicePrincipal -DisplayName $FunctionAppName

# Get Microsoft Graph service principal
$graphSp = Get-AzADServicePrincipal -ApplicationId '00000003-0000-0000-c000-000000000000'

# Define required permissions
$requiredPermissions = @(
    'Organization.Read.All'
    'User.Read.All'
    'Group.Read.All'
    'Domain.Read.All'
    'Policy.Read.All'
    'AuditLog.Read.All'
    'UserAuthenticationMethod.Read.All'
    'RoleManagement.Read.Directory'
    'Application.Read.All'
    'Directory.Read.All'
    'SecurityEvents.Read.All'
    'DeviceManagementManagedDevices.Read.All'
    'DeviceManagementConfiguration.Read.All'
    'DeviceManagementApps.Read.All'
    'SharePointTenantSettings.Read.All'
    'TeamSettings.Read.All'
    'TeamworkAppSettings.Read.All'
    'IdentityRiskyUser.Read.All'
    'IdentityRiskEvent.Read.All'
    'AccessReview.Read.All'
    'EntitlementManagement.Read.All'
    'RoleEligibilitySchedule.Read.Directory'
    'RoleAssignmentSchedule.Read.Directory'
    'ServiceHealth.Read.All'
    'ServiceMessage.Read.All'
    'InformationProtectionPolicy.Read'
    'Reports.Read.All'
    'Sites.Read.All'
    'Team.ReadBasic.All'
    'TeamMember.Read.All'
    'Channel.ReadBasic.All'
    'CrossTenantInformation.ReadBasic.All'
)

foreach ($permName in $requiredPermissions) {
    $appRole = $graphSp.AppRole | Where-Object { $_.Value -eq $permName }
    if ($appRole) {
        try {
            New-MgServicePrincipalAppRoleAssignment `
                -ServicePrincipalId $mi.Id `
                -PrincipalId $mi.Id `
                -ResourceId $graphSp.Id `
                -AppRoleId $appRole.Id
            Write-Host "Assigned: $permName" -ForegroundColor Green
        }
        catch {
            if ($_.Exception.Message -match 'already exists') {
                Write-Host "Already assigned: $permName" -ForegroundColor Yellow
            }
            else { throw }
        }
    }
    else {
        Write-Warning "Permission not found: $permName"
    }
}
```

### 4.2 Exchange Online via Managed Identity

```powershell
# In profile.ps1 or at collector execution time:
Connect-ExchangeOnline -ManagedIdentity -Organization "contoso.onmicrosoft.com"
```

**Prerequisites:**
- The managed identity must be granted the `Exchange.ManageAsApp` application permission
- The managed identity must be assigned the `Exchange Administrator` role in Entra ID (or a custom role with read-only permissions)

### 4.3 Multi-Tenant Authentication (Partner Scenario)

For MSP/partner scenarios where the Function App assesses multiple client tenants:

**Option A: Azure Lighthouse (Recommended)**
- Clients delegate access to the partner's tenant via Lighthouse
- Managed identity gets delegated permissions across client tenants
- Single identity, multiple tenants

**Option B: Per-Tenant App Registration**
- Register an app in each client tenant
- Store client certificates in Key Vault
- Function App retrieves cert from Key Vault per tenant
- More setup but more granular control

**Option C: GDAP (Granular Delegated Admin Privileges)**
- For CSP partners
- Uses partner-customer relationship
- Scoped permissions per tenant

### 4.4 API Security

| Layer | Mechanism | Details |
|-------|-----------|---------|
| **Transport** | HTTPS only | Enforced by Azure Functions |
| **Authentication** | Function keys (default) | Each endpoint gets a function-level key |
| **Authentication** | Azure AD (optional) | EasyAuth for AAD-authenticated access |
| **Authorization** | Custom middleware | Validate tenant access per caller |
| **Rate limiting** | Azure API Management (optional) | For production deployments |
| **Network** | Private endpoints (optional) | VNet integration for enterprise |
| **Secrets** | Key Vault references | App settings reference Key Vault secrets |

---

## 5. Function Definitions

### 5.1 StartAssessment (HTTP POST Trigger)

**Purpose**: Receives assessment request, validates input, starts durable orchestration.

**`StartAssessment/function.json`**:
```json
{
  "bindings": [
    {
      "authLevel": "function",
      "type": "httpTrigger",
      "direction": "in",
      "name": "Request",
      "methods": ["post"],
      "route": "assessments"
    },
    {
      "type": "http",
      "direction": "out",
      "name": "Response"
    },
    {
      "name": "starter",
      "type": "durableClient",
      "direction": "in"
    }
  ]
}
```

**`StartAssessment/run.ps1`**:
```powershell
using namespace System.Net

param($Request, $TriggerMetadata)

# Parse request body
$body = $Request.Body
if (-not $body.tenantId) {
    Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{
        StatusCode = [HttpStatusCode]::BadRequest
        Body = @{ error = "tenantId is required" } | ConvertTo-Json
    })
    return
}

# Default sections if not specified
$sections = if ($body.sections) { $body.sections } else {
    @('Tenant', 'Identity', 'Licensing', 'Email', 'Intune', 'Security', 'Collaboration', 'Hybrid')
}

# Build orchestration input
$orchestrationInput = @{
    TenantId     = $body.tenantId
    Sections     = $sections
    CallbackUrl  = $body.callbackUrl
    RequestedBy  = $body.requestedBy
    Timestamp    = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')
} | ConvertTo-Json

# Start durable orchestration
$instanceId = Start-DurableOrchestration -FunctionName 'OrchestrateAssessment' -Input $orchestrationInput
Write-Host "Started orchestration: $instanceId"

# Return management URLs
$response = New-DurableOrchestrationCheckStatusResponse -Request $Request -InstanceId $instanceId

Push-OutputBinding -Name Response -Value $response
```

### 5.2 OrchestrateAssessment (Durable Orchestrator)

**Purpose**: Orchestrates the entire assessment flow — connects services, runs collectors in parallel by section, aggregates results, generates report.

**`OrchestrateAssessment/function.json`**:
```json
{
  "bindings": [
    {
      "name": "Context",
      "type": "orchestrationTrigger",
      "direction": "in"
    }
  ]
}
```

**`OrchestrateAssessment/run.ps1`**:
```powershell
param($Context)

$input = $Context.Input | ConvertFrom-Json
$tenantId = $input.TenantId
$sections = $input.Sections
$timestamp = $input.Timestamp

# Assessment metadata
$assessmentId = $Context.InstanceId
$results = [System.Collections.Generic.List[object]]::new()
$errors = [System.Collections.Generic.List[object]]::new()

# Get collector definitions for requested sections
$collectorDefs = Get-CollectorDefinitions -Sections $sections

# Fan out: Run all collectors in parallel (grouped by section for service dependency)
$parallelTasks = @()
foreach ($collector in $collectorDefs) {
    $activityInput = @{
        AssessmentId = $assessmentId
        TenantId     = $tenantId
        Collector    = $collector
        Timestamp    = $timestamp
    } | ConvertTo-Json

    $parallelTasks += Invoke-DurableActivity -FunctionName 'RunCollector' -Input $activityInput -NoWait
}

# Wait for all collectors to complete
$collectorResults = Wait-DurableTask -Task $parallelTasks

foreach ($result in $collectorResults) {
    $parsed = $result | ConvertFrom-Json
    if ($parsed.Status -eq 'Complete') {
        $results.Add($parsed)
    }
    else {
        $errors.Add($parsed)
    }
}

# Generate HTML report
$reportInput = @{
    AssessmentId = $assessmentId
    TenantId     = $tenantId
    Results      = $results
    Errors       = $errors
    Timestamp    = $timestamp
} | ConvertTo-Json

$reportResult = Invoke-DurableActivity -FunctionName 'GenerateReport' -Input $reportInput

# Store assessment metadata to Table Storage
$metadata = @{
    AssessmentId  = $assessmentId
    TenantId      = $tenantId
    Status        = 'Complete'
    Sections      = ($sections -join ',')
    TotalCollectors = $collectorDefs.Count
    Completed     = $results.Count
    Failed        = $errors.Count
    ReportUrl     = ($reportResult | ConvertFrom-Json).ReportUrl
    StartTime     = $timestamp
    EndTime       = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')
}

# Callback if requested
if ($input.CallbackUrl) {
    Invoke-RestMethod -Uri $input.CallbackUrl -Method Post -Body ($metadata | ConvertTo-Json) -ContentType 'application/json'
}

return $metadata | ConvertTo-Json
```

### 5.3 RunCollector (Durable Activity)

**Purpose**: Executes a single collector, stores CSV output to blob storage, returns result.

**`RunCollector/function.json`**:
```json
{
  "bindings": [
    {
      "name": "input",
      "type": "activityTrigger",
      "direction": "in"
    }
  ]
}
```

**`RunCollector/run.ps1`**:
```powershell
param($input)

$params = $input | ConvertFrom-Json
$collector = $params.Collector
$assessmentId = $params.AssessmentId
$tenantId = $params.TenantId
$timestamp = $params.Timestamp

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

try {
    # Import collector module
    Import-Module M365AssessCollectors -Force

    # Execute collector function
    $functionName = "Invoke-$($collector.FunctionName)"
    $results = & $functionName -TenantId $tenantId

    $stopwatch.Stop()

    # Store CSV to blob
    if ($results -and $results.Count -gt 0) {
        $csvContent = $results | ConvertTo-Csv -NoTypeInformation
        $blobPath = "assessments/$tenantId/$timestamp/$($collector.Name).csv"

        # Upload to blob storage
        $storageContext = New-AzStorageContext -StorageAccountName $env:STORAGE_ACCOUNT_NAME -StorageAccountKey $env:STORAGE_ACCOUNT_KEY
        $csvBytes = [System.Text.Encoding]::UTF8.GetBytes($csvContent -join "`n")
        $stream = [System.IO.MemoryStream]::new($csvBytes)
        Set-AzStorageBlobContent -Container 'assessments' -Blob $blobPath -Stream $stream -Context $storageContext -Force
    }

    return @{
        CollectorName = $collector.Name
        Label         = $collector.Label
        Section       = $collector.Section
        Status        = 'Complete'
        ItemCount     = if ($results) { $results.Count } else { 0 }
        Duration      = $stopwatch.Elapsed.TotalSeconds
        BlobPath      = $blobPath
    } | ConvertTo-Json
}
catch {
    $stopwatch.Stop()

    return @{
        CollectorName = $collector.Name
        Label         = $collector.Label
        Section       = $collector.Section
        Status        = 'Failed'
        ErrorMessage  = $_.Exception.Message
        Duration      = $stopwatch.Elapsed.TotalSeconds
    } | ConvertTo-Json
}
```

### 5.4 GenerateReport (Durable Activity)

**Purpose**: Takes aggregated collector results and generates the HTML report, storing it to blob storage.

**`GenerateReport/run.ps1`**:
```powershell
param($input)

$params = $input | ConvertFrom-Json

Import-Module M365AssessCollectors -Force

# Download all CSV files from blob storage for this assessment
$csvData = @{}
foreach ($result in $params.Results) {
    if ($result.BlobPath) {
        $storageContext = New-AzStorageContext -StorageAccountName $env:STORAGE_ACCOUNT_NAME
        $blob = Get-AzStorageBlobContent -Container 'assessments' -Blob $result.BlobPath -Context $storageContext -Destination ([System.IO.Path]::GetTempFileName())
        $csvData[$result.CollectorName] = Import-Csv -Path $blob.Name
    }
}

# Generate HTML report using existing report generator
$reportHtml = Export-AssessmentReport -CollectorData $csvData -TenantId $params.TenantId -AssessmentId $params.AssessmentId

# Upload report to blob
$reportBlobPath = "assessments/$($params.TenantId)/$($params.Timestamp)/_Assessment-Report.html"
$reportBytes = [System.Text.Encoding]::UTF8.GetBytes($reportHtml)
$stream = [System.IO.MemoryStream]::new($reportBytes)
$storageContext = New-AzStorageContext -StorageAccountName $env:STORAGE_ACCOUNT_NAME
Set-AzStorageBlobContent -Container 'assessments' -Blob $reportBlobPath -Stream $stream -Context $storageContext -Force

# Generate SAS URL (valid for 7 days)
$sasToken = New-AzStorageBlobSASToken -Container 'assessments' -Blob $reportBlobPath -Context $storageContext -Permission r -ExpiryTime (Get-Date).AddDays(7)
$reportUrl = "https://$($env:STORAGE_ACCOUNT_NAME).blob.core.windows.net/assessments/$reportBlobPath$sasToken"

return @{ ReportUrl = $reportUrl } | ConvertTo-Json
```

### 5.5 GetAssessmentStatus (HTTP GET)

**`GetAssessmentStatus/function.json`**:
```json
{
  "bindings": [
    {
      "authLevel": "function",
      "type": "httpTrigger",
      "direction": "in",
      "name": "Request",
      "methods": ["get"],
      "route": "assessments/{assessmentId}"
    },
    {
      "type": "http",
      "direction": "out",
      "name": "Response"
    },
    {
      "name": "starter",
      "type": "durableClient",
      "direction": "in"
    }
  ]
}
```

**`GetAssessmentStatus/run.ps1`**:
```powershell
param($Request, $TriggerMetadata)

$assessmentId = $Request.Params.assessmentId
$status = Get-DurableStatus -InstanceId $assessmentId

if (-not $status) {
    Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{
        StatusCode = 404
        Body = @{ error = "Assessment not found" } | ConvertTo-Json
    })
    return
}

$response = @{
    assessmentId = $assessmentId
    status       = $status.RuntimeStatus
    createdTime  = $status.CreatedTime
    lastUpdated  = $status.LastUpdatedTime
    output       = if ($status.RuntimeStatus -eq 'Completed') { $status.Output | ConvertFrom-Json } else { $null }
}

Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{
    StatusCode = 200
    Body = $response | ConvertTo-Json -Depth 10
    Headers = @{ 'Content-Type' = 'application/json' }
})
```

### 5.6 ScheduledAssessment (Timer Trigger)

**`ScheduledAssessment/function.json`**:
```json
{
  "bindings": [
    {
      "name": "Timer",
      "type": "timerTrigger",
      "direction": "in",
      "schedule": "0 0 2 * * 1"
    },
    {
      "name": "starter",
      "type": "durableClient",
      "direction": "in"
    }
  ]
}
```

**`ScheduledAssessment/run.ps1`**:
```powershell
param($Timer, $TriggerMetadata)

# Read tenant configurations from Table Storage
$storageContext = New-AzStorageContext -StorageAccountName $env:STORAGE_ACCOUNT_NAME
$tenantConfigs = Get-AzTableRow -Table (Get-AzStorageTable -Name 'TenantConfig' -Context $storageContext).CloudTable

foreach ($config in $tenantConfigs) {
    if ($config.Enabled -eq 'true') {
        $orchestrationInput = @{
            TenantId     = $config.PartitionKey
            Sections     = ($config.Sections -split ',')
            CallbackUrl  = $config.CallbackUrl
            RequestedBy  = 'Scheduled'
            Timestamp    = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')
        } | ConvertTo-Json

        $instanceId = Start-DurableOrchestration -FunctionName 'OrchestrateAssessment' -Input $orchestrationInput
        Write-Host "Scheduled assessment for tenant $($config.PartitionKey): $instanceId"
    }
}
```

### 5.7 HealthCheck (HTTP GET)

**`HealthCheck/run.ps1`**:
```powershell
param($Request, $TriggerMetadata)

$health = @{
    status      = 'healthy'
    version     = '0.5.0'
    timestamp   = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')
    runtime     = "PowerShell $($PSVersionTable.PSVersion)"
    environment = $env:AZURE_FUNCTIONS_ENVIRONMENT
    dependencies = @{
        storage = try { $null = New-AzStorageContext -StorageAccountName $env:STORAGE_ACCOUNT_NAME; 'connected' } catch { 'error' }
        graph   = try { $null = Get-MgContext; 'connected' } catch { 'not connected' }
    }
}

Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{
    StatusCode = 200
    Body = $health | ConvertTo-Json
    Headers = @{ 'Content-Type' = 'application/json' }
})
```

---

## 6. API Design

### Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/assessments` | Function key | Start a new assessment |
| `GET` | `/api/assessments/{id}` | Function key | Get assessment status and results |
| `GET` | `/api/assessments/{id}/report` | Function key | Get HTML report (SAS URL) |
| `GET` | `/api/assessments` | Function key | List assessments (with filters) |
| `POST` | `/api/assessments/schedule` | Function key | Create/update scheduled assessment |
| `GET` | `/api/health` | Anonymous | Health check endpoint |

### Request/Response Examples

**Start Assessment:**
```http
POST /api/assessments?code={function-key}
Content-Type: application/json

{
    "tenantId": "contoso.onmicrosoft.com",
    "sections": ["Tenant", "Identity", "Email", "Security"],
    "callbackUrl": "https://my-app.com/webhook/assessment-complete",
    "requestedBy": "admin@msp.com"
}
```

**Response (202 Accepted):**
```json
{
    "id": "abc123-def456",
    "statusQueryGetUri": "https://func-m365assess.azurewebsites.net/api/assessments/abc123-def456?code=...",
    "sendEventPostUri": "...",
    "terminatePostUri": "...",
    "rewindPostUri": "...",
    "purgeHistoryDeleteUri": "..."
}
```

**Get Status:**
```json
{
    "assessmentId": "abc123-def456",
    "status": "Completed",
    "createdTime": "2026-03-10T14:30:00Z",
    "lastUpdated": "2026-03-10T14:35:22Z",
    "output": {
        "assessmentId": "abc123-def456",
        "tenantId": "contoso.onmicrosoft.com",
        "status": "Complete",
        "sections": "Tenant,Identity,Email,Security",
        "totalCollectors": 15,
        "completed": 14,
        "failed": 1,
        "reportUrl": "https://storage.blob.core.windows.net/assessments/contoso/...?sv=...",
        "startTime": "2026-03-10T14:30:00Z",
        "endTime": "2026-03-10T14:35:22Z"
    }
}
```

---

## 7. Storage Architecture

### Blob Storage Layout

```
assessments/                              # Container
├── contoso.onmicrosoft.com/              # Tenant folder
│   ├── 2026-03-10T143000Z/              # Assessment run folder
│   │   ├── 01-Tenant-Info.csv
│   │   ├── 02-User-Summary.csv
│   │   ├── 03-MFA-Report.csv
│   │   ├── ...
│   │   ├── _Assessment-Report.html       # HTML report
│   │   └── _Assessment-Log.txt           # Assessment log
│   └── 2026-03-17T020000Z/              # Next scheduled run
│       ├── ...
├── fabrikam.onmicrosoft.com/
│   └── ...
```

### Table Storage Schema

**AssessmentRuns Table:**

| Column | Type | Description |
|--------|------|-------------|
| `PartitionKey` | string | TenantId |
| `RowKey` | string | AssessmentId |
| `Status` | string | Running/Complete/Failed |
| `Sections` | string | Comma-separated section list |
| `TotalCollectors` | int | Number of collectors run |
| `Completed` | int | Successful collectors |
| `Failed` | int | Failed collectors |
| `ReportUrl` | string | SAS URL to HTML report |
| `RequestedBy` | string | Who triggered the assessment |
| `StartTime` | datetime | Assessment start time |
| `EndTime` | datetime | Assessment end time |

**TenantConfig Table:**

| Column | Type | Description |
|--------|------|-------------|
| `PartitionKey` | string | TenantId |
| `RowKey` | string | "config" |
| `Sections` | string | Comma-separated default sections |
| `Enabled` | string | "true"/"false" for scheduled runs |
| `Schedule` | string | CRON expression |
| `CallbackUrl` | string | Webhook URL for completion |
| `DisplayName` | string | Friendly tenant name |

---

## 8. Durable Functions Orchestration

### Orchestration Pattern: Fan-Out/Fan-In

```
Start Assessment
    │
    ▼
┌─── OrchestrateAssessment ───────────────────────────────────┐
│                                                              │
│   Step 1: Validate input & resolve tenant                   │
│       │                                                      │
│   Step 2: Fan-out collectors (parallel)                      │
│       ├── RunCollector: Tenant Info          ─┐              │
│       ├── RunCollector: User Summary          │              │
│       ├── RunCollector: MFA Report            │  Wait for    │
│       ├── RunCollector: Admin Roles           │  all to      │
│       ├── RunCollector: Conditional Access    │  complete    │
│       ├── RunCollector: Mailbox Summary       │              │
│       ├── RunCollector: Mail Flow             │              │
│       ├── RunCollector: Secure Score          │              │
│       └── RunCollector: ... (N collectors)  ─┘              │
│       │                                                      │
│   Step 3: Aggregate results                                  │
│       │                                                      │
│   Step 4: GenerateReport activity                            │
│       │                                                      │
│   Step 5: Store metadata to Table Storage                    │
│       │                                                      │
│   Step 6: Send callback webhook (if configured)              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Service Connection Strategy

Unlike the local tool which maintains persistent connections, the Function App must handle connections within each activity execution:

**Option A: Connect per activity** (Simple, recommended for start)
- Each `RunCollector` activity calls `Connect-MgGraph -Identity` at the start
- Adds ~2-5 seconds per activity for Graph connection
- EXO connection adds ~5-10 seconds
- Total overhead acceptable given parallel execution

**Option B: Shared connection via orchestrator** (Optimized)
- Orchestrator establishes connections and passes tokens to activities
- Activities use token-based auth (avoids repeated connection overhead)
- More complex but faster for large assessments

**Recommendation**: Start with Option A, optimize to Option B if performance requires it.

---

## 9. Multi-Tenant Support

### Architecture for MSP/Partner Scenario

```
┌────────────────────────────────────┐
│        M365-Assess Function App     │
│         (Partner's Azure)           │
│                                     │
│   Managed Identity ─────────────┐  │
│                                 │  │
└─────────────────────────────────┼──┘
                                  │
           ┌──────────────────────┼──────────────────────┐
           │                      │                      │
           ▼                      ▼                      ▼
  ┌────────────────┐   ┌────────────────┐   ┌────────────────┐
  │  Client Tenant  │   │  Client Tenant  │   │  Client Tenant  │
  │  (Contoso)      │   │  (Fabrikam)     │   │  (Northwind)    │
  │                 │   │                 │   │                 │
  │  Lighthouse     │   │  Lighthouse     │   │  Lighthouse     │
  │  delegation     │   │  delegation     │   │  delegation     │
  └────────────────┘   └────────────────┘   └────────────────┘
```

### Tenant Onboarding Flow

1. Client tenant deploys Lighthouse ARM template (grants read-only access to partner's MI)
2. MSP registers tenant in TenantConfig table via API
3. MSP configures sections and schedule for the tenant
4. Function App runs assessments using delegated Lighthouse permissions

### Lighthouse ARM Template

```json
{
    "properties": {
        "registrationDefinitionName": "M365-Assess Read-Only Access",
        "description": "Read-only access for automated M365 security assessments",
        "managedByTenantId": "{partner-tenant-id}",
        "authorizations": [
            {
                "principalId": "{managed-identity-object-id}",
                "roleDefinitionId": "acdd72a7-3385-48ef-bd42-f606fba81ae7",
                "principalIdDisplayName": "M365-Assess Function App"
            }
        ]
    }
}
```

---

## 10. Infrastructure as Code

### Bicep Template (`infrastructure/main.bicep`)

```bicep
// main.bicep - M365-Assess Function App Infrastructure

@description('The Azure region for all resources')
param location string = resourceGroup().location

@description('Environment name (dev, staging, prod)')
@allowed(['dev', 'staging', 'prod'])
param environment string = 'prod'

@description('Base name for resources')
param baseName string = 'm365assess'

// Variables
var uniqueSuffix = uniqueString(resourceGroup().id)
var functionAppName = '${baseName}-${environment}-${uniqueSuffix}'
var storageAccountName = '${baseName}${environment}${take(uniqueSuffix, 6)}'
var appInsightsName = '${baseName}-insights-${environment}'
var keyVaultName = '${baseName}-kv-${environment}'
var logAnalyticsName = '${baseName}-logs-${environment}'
var hostingPlanName = '${baseName}-plan-${environment}'

// Log Analytics Workspace
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// Application Insights
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

// Storage Account
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

// Blob container for assessments
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

resource assessmentsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'assessments'
  properties: {
    publicAccess: 'None'
  }
}

// Table service for metadata
resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

resource assessmentRunsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'AssessmentRuns'
}

resource tenantConfigTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'TenantConfig'
}

// Key Vault
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
  }
}

// App Service Plan (Consumption)
resource hostingPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: hostingPlanName
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: false
  }
}

// Function App
resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: hostingPlan.id
    httpsOnly: true
    siteConfig: {
      powerShellVersion: '7.4'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        { name: 'AzureWebJobsStorage', value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value}' }
        { name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING', value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value}' }
        { name: 'WEBSITE_CONTENTSHARE', value: toLower(functionAppName) }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'powershell' }
        { name: 'FUNCTIONS_WORKER_RUNTIME_VERSION', value: '7.4' }
        { name: 'APPINSIGHTS_INSTRUMENTATIONKEY', value: appInsights.properties.InstrumentationKey }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'STORAGE_ACCOUNT_NAME', value: storageAccount.name }
        { name: 'KEY_VAULT_NAME', value: keyVault.name }
      ]
    }
  }
}

// RBAC: Function App MI → Storage Blob Data Contributor
resource storageBlobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, functionApp.id, 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// RBAC: Function App MI → Key Vault Secrets User
resource keyVaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, functionApp.id, '4633458b-17de-408a-b874-0445c86b69e6')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Outputs
output functionAppName string = functionApp.name
output functionAppUrl string = 'https://${functionApp.properties.defaultHostName}'
output storageAccountName string = storageAccount.name
output keyVaultName string = keyVault.name
output managedIdentityPrincipalId string = functionApp.identity.principalId
output managedIdentityTenantId string = functionApp.identity.tenantId
```

### Key Configuration Files

**`host.json`**:
```json
{
    "version": "2.0",
    "managedDependency": {
        "enabled": false
    },
    "extensions": {
        "durableTask": {
            "storageProvider": {
                "type": "AzureStorage"
            },
            "maxConcurrentActivityFunctions": 10,
            "maxConcurrentOrchestratorFunctions": 5
        }
    },
    "functionTimeout": "00:10:00",
    "logging": {
        "applicationInsights": {
            "samplingSettings": {
                "isEnabled": true,
                "excludedTypes": "Request"
            }
        }
    }
}
```

**`requirements.psd1`**:
```powershell
@{
    # Do NOT use managed dependencies for production (slow cold starts)
    # Instead, bundle modules in the Modules/ folder

    # If using managed dependencies for dev:
    # 'Az.Accounts'        = '3.*'
    # 'Az.Storage'         = '7.*'
    # 'Microsoft.Graph.Authentication' = '2.*'
}
```

**`profile.ps1`**:
```powershell
# Azure Functions profile (runs on each worker start)

# Authenticate managed identity to Azure (for Storage, Key Vault)
if ($env:MSI_SECRET) {
    Disable-AzContextAutosave -Scope Process | Out-Null
    Connect-AzAccount -Identity | Out-Null
}

# Import shared collector module
$modulePath = Join-Path $PSScriptRoot 'Modules' 'M365AssessCollectors'
if (Test-Path $modulePath) {
    Import-Module $modulePath -Force
}
```

---

## 11. CI/CD Pipeline

### GitHub Actions Workflow

**`.github/workflows/deploy.yml`**:
```yaml
name: Deploy M365-Assess Function App

on:
  push:
    branches: [main]
    paths:
      - 'M365-Assess-FunctionApp/**'
  workflow_dispatch:
    inputs:
      environment:
        description: 'Target environment'
        required: true
        default: 'staging'
        type: choice
        options:
          - staging
          - prod

permissions:
  id-token: write
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Validate Bicep
        run: az bicep build --file infrastructure/main.bicep

      - name: Run PSScriptAnalyzer
        shell: pwsh
        run: |
          Install-Module PSScriptAnalyzer -Force -Scope CurrentUser
          $results = Invoke-ScriptAnalyzer -Path ./M365-Assess-FunctionApp -Recurse -ExcludeRule PSAvoidUsingWriteHost
          if ($results) {
            $results | Format-Table -AutoSize
            exit 1
          }

      - name: Run Pester Tests
        shell: pwsh
        run: |
          Install-Module Pester -Force -Scope CurrentUser
          Invoke-Pester -Path ./tests -OutputFormat NUnitXml -OutputFile TestResults.xml

  deploy:
    needs: validate
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment || 'staging' }}
    steps:
      - uses: actions/checkout@v4

      - name: Azure Login (OIDC)
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Deploy Infrastructure
        run: |
          az deployment group create \
            --resource-group ${{ secrets.RESOURCE_GROUP }} \
            --template-file infrastructure/main.bicep \
            --parameters environment=${{ inputs.environment || 'staging' }}

      - name: Deploy Function App
        uses: Azure/functions-action@v1
        with:
          app-name: ${{ secrets.FUNCTION_APP_NAME }}
          package: ./M365-Assess-FunctionApp

      - name: Assign Graph Permissions
        shell: pwsh
        run: |
          ./infrastructure/assign-graph-permissions.ps1 `
            -FunctionAppName ${{ secrets.FUNCTION_APP_NAME }} `
            -ResourceGroupName ${{ secrets.RESOURCE_GROUP }}
```

---

## 12. Migration Strategy

### Phase 1: Extract Collector Module (Week 1-2)

**Goal**: Refactor existing collector scripts into a reusable PowerShell module that works both locally AND in the Function App.

**Tasks:**
- [ ] Create `Modules/M365AssessCollectors/` module structure
- [ ] Refactor each collector `.ps1` from standalone script to exported function
  - Remove `[CmdletBinding()] param(...)` script-level parameters
  - Convert to `function Invoke-<CollectorName>Collector { [CmdletBinding()] param($TenantId) ... }`
  - Remove connection checks from individual collectors (connection handled by caller)
  - Return results as objects (no direct CSV export inside collector)
- [ ] Create module manifest (`M365AssessCollectors.psd1`) with all exported functions
- [ ] Create `Get-CollectorDefinitions` function that returns the collector registry
- [ ] Update local `Invoke-M365Assessment.ps1` to optionally use the module
- [ ] Write Pester unit tests for each collector function (mocked Graph calls)

**Key refactoring pattern:**

```powershell
# BEFORE (standalone script): Entra/Get-TenantInfo.ps1
[CmdletBinding()]
param([string]$OutputPath)
$ErrorActionPreference = 'Stop'
try { $context = Get-MgContext; if (-not $context) { Write-Error "..."; return } }
catch { Write-Error "..."; return }
# ... collector logic ...
if ($OutputPath) { $results | Export-Csv ... }
Write-Output $results

# AFTER (module function): Collectors/Entra/Invoke-TenantInfoCollector.ps1
function Invoke-TenantInfoCollector {
    [CmdletBinding()]
    param([string]$TenantId)

    # Collector logic only — no connection management, no file I/O
    $org = Get-MgOrganization
    # ... process data ...

    return $results
}
```

### Phase 2: Function App Scaffold (Week 2-3)

**Goal**: Deploy a working but minimal Function App with managed identity.

**Tasks:**
- [ ] Create Function App project structure (all `function.json` and `run.ps1` stubs)
- [ ] Write Bicep templates for all infrastructure
- [ ] Deploy to Azure (staging environment)
- [ ] Enable system-assigned managed identity
- [ ] Run `assign-graph-permissions.ps1` to grant Graph permissions
- [ ] Verify managed identity can call `Connect-MgGraph -Identity`
- [ ] Verify managed identity can call `Connect-ExchangeOnline -ManagedIdentity`
- [ ] Implement `HealthCheck` function and verify connectivity

### Phase 3: Core Functionality (Week 3-5)

**Goal**: Implement the full assessment flow via API.

**Tasks:**
- [ ] Implement `StartAssessment` HTTP trigger with input validation
- [ ] Implement `OrchestrateAssessment` durable orchestrator with fan-out/fan-in
- [ ] Implement `RunCollector` activity with blob storage output
- [ ] Implement `GenerateReport` activity with HTML report generation
- [ ] Implement `GetAssessmentStatus` HTTP trigger
- [ ] Implement `GetAssessmentReport` HTTP trigger with SAS URL generation
- [ ] Bundle M365AssessCollectors module in the Function App
- [ ] End-to-end testing: trigger assessment → collectors run → report generated → report downloadable

### Phase 4: Storage & History (Week 5-6)

**Goal**: Add Table Storage metadata tracking and assessment history.

**Tasks:**
- [ ] Implement Table Storage writes in orchestrator (AssessmentRuns table)
- [ ] Implement `ListAssessments` HTTP trigger with filtering
- [ ] Add assessment history retrieval (previous runs for same tenant)
- [ ] Implement blob lifecycle management (auto-delete assessments older than N days)
- [ ] Add report comparison capability (diff between two assessment runs)

### Phase 5: Scheduling & Multi-Tenant (Week 6-8)

**Goal**: Add timer triggers and multi-tenant support.

**Tasks:**
- [ ] Implement `ScheduledAssessment` timer trigger
- [ ] Implement tenant registration API (CRUD for TenantConfig table)
- [ ] Test with multiple tenants (at least 2)
- [ ] Document Lighthouse setup for multi-tenant delegation
- [ ] Add per-tenant section configuration
- [ ] Add webhook callback on completion

### Phase 6: CI/CD & Hardening (Week 8-10)

**Goal**: Production-ready deployment pipeline and security hardening.

**Tasks:**
- [ ] Create GitHub Actions CI workflow (lint, test, validate Bicep)
- [ ] Create GitHub Actions CD workflows (staging, production)
- [ ] Add OIDC-based Azure authentication for GitHub Actions
- [ ] Implement Application Insights custom metrics and alerts
- [ ] Add rate limiting (via APIM or custom middleware)
- [ ] Optional: VNet integration and private endpoints
- [ ] Optional: Azure AD EasyAuth on HTTP endpoints
- [ ] Documentation: API reference, deployment guide, troubleshooting
- [ ] Create Azure Developer CLI (`azd`) configuration for one-command deployment

---

## 13. Performance & Scaling

### Cold Start Mitigation

PowerShell Azure Functions have notorious cold start times (10-30 seconds). Strategies:

| Strategy | Impact | Effort |
|----------|--------|--------|
| **Bundle modules** (don't use managed dependencies) | -10-20s cold start | Low |
| **Premium plan** with always-ready instances | Eliminates cold start | Higher cost |
| **Warm-up trigger** (periodic ping) | Keeps instances warm | Low |
| **Reduce module size** (only import needed submodules) | -5-10s | Medium |

**Recommendation**: Bundle modules + warm-up trigger for Consumption plan. Switch to Premium only if cold start is unacceptable.

### Execution Timeouts

| Plan | Max Timeout | Strategy |
|------|-------------|----------|
| Consumption | 10 minutes | Durable Functions split work into <10min activities |
| Premium | 60 minutes | Single-shot possible, but Durable is still better |

Each collector activity should complete in under 5 minutes. If a collector is slow (e.g., enumerating all mailbox forwarding rules across 500 mailboxes), split into paginated sub-activities.

### Parallel Execution

Durable Functions `maxConcurrentActivityFunctions = 10` means up to 10 collectors run simultaneously. For a typical assessment with 30 collectors, this means 3 "waves" of parallel execution.

**Estimated total assessment time:**
- Cold start: ~15 seconds (first invocation only)
- 30 collectors × avg 30 seconds each ÷ 10 parallel = ~90 seconds of execution
- Report generation: ~10 seconds
- **Total: ~2 minutes** (vs ~5-10 minutes sequential on local workstation)

---

## 14. Cost Analysis

### Consumption Plan Pricing (US East)

| Component | Unit Cost | Monthly Estimate (20 tenants, weekly assessments) |
|-----------|-----------|---------------------------------------------------|
| **Function executions** | First 1M free, then $0.20/M | Free (well under 1M) |
| **Function compute** | 400,000 GB-s free, then $0.000016/GB-s | ~$0.50 |
| **Blob Storage** | $0.0184/GB/month | ~$0.10 (small CSV/HTML files) |
| **Table Storage** | $0.045/GB/month | ~$0.01 |
| **Storage transactions** | $0.0036/10K | ~$0.05 |
| **Application Insights** | $2.30/GB ingested | ~$2-5 |
| **Key Vault** | $0.03/10K operations | ~$0.01 |
| **Total** | | **~$3-6/month** |

### Premium Plan (if needed)

| Component | Monthly Cost |
|-----------|-------------|
| EP1 (1 instance, always-ready) | ~$145/month |
| Burst instances (on-demand) | ~$0.173/vCPU-hour |
| Same storage costs as above | ~$3-6 |
| **Total** | **~$150/month** |

**Recommendation**: Start with Consumption Plan. Only move to Premium if cold starts or timeouts become problematic.

---

## 15. Risk & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **EXO module doesn't work in Functions** | Medium | High | Test early in Phase 2. Fallback: use Graph API for EXO data (less coverage but functional). Alternative: use REST API calls directly. |
| **Managed identity permission limits** | Low | Medium | Document exact permission requirements. Test with minimal scopes. Some Purview cmdlets may require different auth — test early. |
| **Cold start >30 seconds** | High | Medium | Bundle modules, use warm-up trigger. Premium plan as fallback. |
| **Durable Functions state storage costs** | Low | Low | Purge completed orchestrations after 30 days. Set `durableTask.storageProvider.partitionCount` appropriately. |
| **Multi-tenant auth complexity** | Medium | High | Start with single-tenant. Add Lighthouse support in Phase 5. Document the setup clearly. |
| **PowerShell module version conflicts** | Medium | Medium | Pin module versions in `requirements.psd1`. Bundle specific versions. Test extensively. Known issue: Graph SDK + EXO module MSAL conflicts. |
| **Function timeout (10 min)** | Low | Medium | Durable Functions split work into small activities. Each collector should complete in <5 min. |
| **Graph API throttling** | Medium | Low | Implement retry with exponential backoff. Use `$top` and pagination. Spread requests across activities. |
| **PnP PowerShell not available** | Low | Medium | Use native Graph cmdlets instead of PnP. All current SharePoint data is accessible via Graph. |

---

## 16. Implementation Roadmap

```
Week 1-2:   ████████████████  Phase 1: Extract Collector Module
Week 2-3:   ████████████████  Phase 2: Function App Scaffold + Infra
Week 3-5:   ████████████████████████████████  Phase 3: Core Functionality
Week 5-6:   ████████████████  Phase 4: Storage & History
Week 6-8:   ████████████████████████████████  Phase 5: Scheduling & Multi-Tenant
Week 8-10:  ████████████████████████████████  Phase 6: CI/CD & Hardening
```

### Key Milestones

| Week | Milestone | Deliverable |
|------|-----------|-------------|
| 2 | Module extracted | `M365AssessCollectors` module works locally |
| 3 | Function App deployed | Health endpoint responds, MI authenticated |
| 5 | E2E assessment works | API triggers assessment, report downloadable |
| 6 | History tracking | Assessment history queryable via API |
| 8 | Multi-tenant ready | 2+ tenants assessed on schedule |
| 10 | Production ready | CI/CD, monitoring, documentation complete |

### Prerequisites

Before starting implementation:

1. **Azure subscription** with contributor access
2. **M365 test tenant** (dev tenant or test environment) for non-destructive testing
3. **GitHub repository** with Actions enabled
4. **Azure AD app registration** for GitHub Actions OIDC auth
5. **PowerShell 7.4** and **Azure Functions Core Tools** installed locally for development
6. **Decision**: Consumption vs Premium plan (start with Consumption)
7. **Decision**: Single-tenant first vs multi-tenant from start (recommend single-tenant first)

---

## Appendix A: Module Dependency Matrix

| Module | Version | Used By | Size | Bundle? |
|--------|---------|---------|------|---------|
| `Microsoft.Graph.Authentication` | 2.x | All Graph collectors | ~5MB | Yes |
| `Microsoft.Graph.Users` | 2.x | Identity collectors | ~3MB | Yes |
| `Microsoft.Graph.Identity.DirectoryManagement` | 2.x | Entra, Licensing | ~5MB | Yes |
| `Microsoft.Graph.Identity.SignIns` | 2.x | CA, MFA, Auth Methods | ~4MB | Yes |
| `Microsoft.Graph.Applications` | 2.x | App Registrations | ~3MB | Yes |
| `Microsoft.Graph.Reports` | 2.x | Sign-in Analytics | ~2MB | Yes |
| `Microsoft.Graph.Security` | 2.x | Secure Score, Alerts | ~3MB | Yes |
| `Microsoft.Graph.DeviceManagement` | 2.x | Intune collectors | ~5MB | Yes |
| `ExchangeOnlineManagement` | 3.7.1 | EXO collectors | ~15MB | Yes (pin version!) |
| `Az.Accounts` | 3.x | Storage, Identity | ~10MB | Yes |
| `Az.Storage` | 7.x | Blob/Table operations | ~8MB | Yes |
| **Total bundled size** | | | **~63MB** | |

**Note**: Azure Functions has a 500MB deployment package limit. 63MB is well within limits.

---

## Appendix B: Environment Variables / App Settings

| Setting | Description | Example |
|---------|-------------|---------|
| `STORAGE_ACCOUNT_NAME` | Storage account for blobs/tables | `m365assessprod1a2b3c` |
| `KEY_VAULT_NAME` | Key Vault for secrets | `m365assess-kv-prod` |
| `ASSESSMENT_VERSION` | Version string | `0.5.0` |
| `DEFAULT_SECTIONS` | Default sections if not specified | `Tenant,Identity,Email,Security` |
| `REPORT_RETENTION_DAYS` | Auto-delete reports after N days | `90` |
| `MAX_CONCURRENT_ASSESSMENTS` | Limit concurrent orchestrations | `5` |
| `CALLBACK_TIMEOUT_SECONDS` | Webhook callback timeout | `30` |

---

## Appendix C: Comparison with Alternatives

| Feature | M365-Assess Function App | Maester | CISA ScubaGear | Commercial Tools |
|---------|--------------------------|---------|----------------|------------------|
| **Hosting** | Azure Functions (serverless) | Local PowerShell | Local PowerShell | SaaS |
| **Scheduling** | Built-in timer triggers | External scheduler | Manual | Built-in |
| **Multi-tenant** | Yes (Lighthouse/GDAP) | Manual per-tenant | Manual per-tenant | Yes |
| **API access** | REST API | None | None | Varies |
| **Custom collectors** | Yes (modular) | Yes (Pester-based) | No (fixed) | Limited |
| **HTML report** | Yes (self-contained) | Yes | Yes | Yes |
| **Cost** | ~$3-6/month | Free | Free | $50-500+/month |
| **Compliance mapping** | 12 frameworks | Limited | CISA only | Varies |
| **Copilot readiness** | Planned | No | No | Some |
| **Power Platform** | Planned | No | No | Some |
