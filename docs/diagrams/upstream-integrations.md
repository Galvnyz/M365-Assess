# Upstream Integrations

All external systems that feed data into M365-Assess and the outputs the tool produces. Data flows left-to-right: external sources enter the orchestrator, which produces assessment artifacts.

```mermaid
graph LR
    subgraph External["External Data Sources"]
        direction TB
        CheckID["CheckID Repo<br/>(Galvnyz/CheckID)"]
        GraphAPI["Microsoft Graph API"]
        EXOService["Exchange Online<br/>Management"]
        PurviewService["Purview / Security<br/>& Compliance"]
        DNS["Public DNS"]
        PSGallery["PSGallery<br/>(NuGet)"]
        MITRE["MITRE ATT&CK<br/>(static JSON)"]
        AD["Active Directory<br/>(on-prem, optional)"]
    end

    subgraph CICD["GitHub Actions CI/CD"]
        direction TB
        CIWorkflow["ci.yml<br/>(quality gates + 2,000+ Pester tests)"]
        SyncWorkflow["sync-checkid.yml<br/>(cross-repo sync)"]
        ReleaseWorkflow["release.yml<br/>(v* tag → GH release)"]
    end

    subgraph Controls["controls/"]
        direction TB
        Registry["registry.json<br/>(292 checks)"]
        Frameworks["frameworks/*.json<br/>(15 frameworks)"]
        LocalExt["local-extensions.json<br/>(M365-Assess-specific checks,<br/>preserved across sync)"]
        RiskSev["risk-severity.json"]
        MITREMap["mitre-technique-map.json"]
        RoleTiers["role-tiers.json"]
    end

    subgraph Core["M365-Assess Core"]
        direction TB
        Orchestrator["Invoke-M365Assessment.ps1"]
        ConnService["Connect-Service.ps1"]
        ImportReg["Import-ControlRegistry.ps1"]
        ImportFw["Import-FrameworkDefinitions.ps1"]

        subgraph Collectors["Security Config Collectors"]
            direction TB
            EntraColl["Entra Security<br/>(ENTRA-*)"]
            CAColl["Conditional Access<br/>(CA-*)"]
            EntAppColl["Enterprise Apps<br/>(ENTAPP-*)"]
            EXOColl["Exchange Online<br/>(EXO-*)"]
            DNSColl["DNS Security<br/>(DNS-*)"]
            IntuneColl["Intune<br/>(INTUNE-*)"]
            DefenderColl["Defender<br/>(DEFENDER-*)"]
            ComplianceColl["Compliance<br/>(COMPLIANCE-*)"]
            SPColl["SharePoint<br/>(SPO-*)"]
            TeamsColl["Teams<br/>(TEAMS-*)"]
        end

        subgraph Reporting["Report Generation"]
            direction TB
            ExportReport["Export-AssessmentReport"]
            ExportOverview["Export-ComplianceOverview"]
            ExportCatalog["Export-FrameworkCatalog"]
            ExportMatrix["Export-ComplianceMatrix"]
        end
    end

    subgraph Outputs["Assessment Outputs"]
        direction TB
        HTML["HTML Report<br/>(self-contained, branded)"]
        XLSXOut["XLSX Compliance Matrix<br/>(2 sheets)"]
        CatalogHTML["Framework Catalog HTMLs<br/>(per-framework standalone)"]
        CSVs["Section CSVs<br/>(raw findings)"]
        SummaryCSV["Summary CSV +<br/>Issues Log"]
    end

    %% CheckID sync flow
    CheckID -->|"weekly sync +<br/>on-demand dispatch"| SyncWorkflow
    SyncWorkflow -->|"curl raw content<br/>by release tag"| Registry
    SyncWorkflow -->|"curl raw content<br/>by release tag"| Frameworks
    LocalExt -->|"preserved + merged<br/>at sync time"| Registry

    %% Static data
    MITRE --> MITREMap

    %% CI/CD connections
    CIWorkflow -.->|"PSScriptAnalyzer +<br/>Pester matrix (PS 7.4 + 7.6)"| Core
    ReleaseWorkflow -.->|"v* tag push"| Core

    %% Service connections
    GraphAPI -->|"Connect-MgGraph<br/>(5 auth methods)"| ConnService
    EXOService -->|"Connect-ExchangeOnline"| ConnService
    PurviewService -->|"Connect-IPPSSession"| ConnService
    DNS -->|"Resolve-DnsName<br/>(ThreadJobs)"| DNSColl
    AD -->|"Get-AD* cmdlets<br/>(optional)"| Orchestrator

    %% Internal data flow
    ConnService --> Collectors
    Registry --> ImportReg
    Frameworks --> ImportFw
    RiskSev --> ImportReg
    ImportReg --> Reporting
    ImportFw --> Reporting
    Collectors -->|"Add-Setting() →<br/>CSV export"| Reporting

    %% Output flow
    ExportReport --> HTML
    ExportOverview --> HTML
    ExportCatalog --> CatalogHTML
    ExportMatrix --> XLSXOut
    Orchestrator --> CSVs
    Orchestrator --> SummaryCSV

    %% Auth methods annotation
    AuthNote["Auth Methods:<br/>Interactive | Device Code |<br/>Certificate | Client Secret |<br/>Managed Identity"]
    CloudNote["Cloud Environments:<br/>Commercial | GCC |<br/>GCC High | DoD"]

    GraphAPI ~~~ AuthNote
    GraphAPI ~~~ CloudNote

    %% Styles
    classDef external fill:#dbeafe,stroke:#3b82f6,color:#000
    classDef cicd fill:#fef3c7,stroke:#f59e0b,color:#000
    classDef controls fill:#e0e7ff,stroke:#6366f1,color:#000
    classDef core fill:#d1fae5,stroke:#10b981,color:#000
    classDef output fill:#fce7f3,stroke:#ec4899,color:#000
    classDef note fill:#f1f5f9,stroke:#94a3b8,color:#64748b,stroke-dasharray:5 5

    class CheckID,GraphAPI,EXOService,PurviewService,DNS,PSGallery,MITRE,AD external
    class CIWorkflow,SyncWorkflow,ReleaseWorkflow cicd
    class Registry,Frameworks,LocalExt,RiskSev,MITREMap,RoleTiers controls
    class Orchestrator,ConnService,ImportReg,ImportFw,EntraColl,CAColl,EntAppColl,EXOColl,DNSColl,IntuneColl,DefenderColl,ComplianceColl,SPColl,TeamsColl,ExportReport,ExportOverview,ExportCatalog,ExportMatrix core
    class HTML,XLSXOut,CatalogHTML,CSVs,SummaryCSV output
    class AuthNote,CloudNote note
```
