# Service Connection Architecture

Visualizes the lazy connection pattern, process isolation boundaries, EXO/Purview mutual exclusion, and background DNS prefetch. Each subgraph represents an OS-level process boundary.

```mermaid
graph TD
    Entry([Invoke-M365Assessment.ps1]) --> ConnSvc

    subgraph MainProcess["Main Process (pwsh 7.x)"]
        ConnSvc["Connect-RequiredService<br/>(lazy, per-section)"]

        subgraph GraphBlock["Microsoft Graph (connected once, reused)"]
            GraphConn["Connect-MgGraph"]
            Scopes["Aggregated Scopes<br/>(User.Read.All, Application.Read.All,<br/>RoleManagement.Read.All, ...)"]
            GraphAuth["Auth Methods:<br/>Interactive | Device Code |<br/>Certificate | Client Secret |<br/>Managed Identity"]
            CloudEnv["Cloud Environment:<br/>Commercial | GCC |<br/>GCC High | DoD"]

            GraphConn --- Scopes
            GraphConn --- GraphAuth
            GraphConn --- CloudEnv
        end

        subgraph EXOBlock["Exchange Online"]
            EXOConn["Connect-ExchangeOnline"]
            EXOCollectors["Collectors:<br/>EXO Security Config<br/>Defender Security Config<br/>Mail Flow / Permissions"]
            EXOConn --> EXOCollectors
        end

        subgraph PurviewBlock["Purview / Security & Compliance"]
            PurviewConn["Connect-IPPSSession"]
            PurviewCollectors["Collectors:<br/>Compliance Security Config<br/>DLP Policies<br/>Audit Retention"]
            PurviewNote["Limitations:<br/>No device code auth<br/>No managed identity"]
            PurviewConn --> PurviewCollectors
            PurviewConn --- PurviewNote
        end

        subgraph GraphCollectors["Graph-Dependent Collectors"]
            EntraCol["Entra Security Config<br/>(ENTRA-*)"]
            CACol["Conditional Access<br/>(CA-*)"]
            EntAppCol["Enterprise Apps<br/>(ENTAPP-*)"]
            IntuneCol["Intune Security Config<br/>(INTUNE-*)"]
            SPCol["SharePoint Security Config<br/>(SPO-*)"]
            TeamsCol["Teams Security Config<br/>(TEAMS-*)"]
        end

        ConnSvc --> GraphConn
        ConnSvc --> EXOConn
        ConnSvc --> PurviewConn
        GraphConn --> GraphCollectors

        %% Mutual exclusion
        EXOConn <-..->|"CONFLICT: shared<br/>ExchangeOnlineManagement module.<br/>Only one connected at a time.<br/>Auto-disconnect before switching."| PurviewConn

        %% Section execution order
        ExecOrder["Section Execution Order<br/>(minimizes reconnects):<br/>Tenant → Identity → Licensing →<br/>Email → Intune → Inventory →<br/>Security → Collaboration →<br/>PowerBI → Hybrid"]
    end

    subgraph ChildProcess["Child Process (isolated pwsh 7.x)"]
        PBIConn["Connect-PowerBIServiceAccount"]
        PBICollector["PowerBI Security Config"]
        PBIReason["Reason: MSAL assembly conflict<br/>between MicrosoftPowerBIMgmt and<br/>Microsoft.Graph SDK 2.x"]

        PBIConn --> PBICollector
        PBIConn --- PBIReason
    end

    subgraph BackgroundJobs["Background ThreadJobs"]
        DnsPrefetch["DNS Prefetch<br/>(started after Graph connect)"]
        DnsJobs["Start-ThreadJob per<br/>verified domain"]
        DnsRecords["Resolve: SPF, DKIM,<br/>DMARC, MTA-STS,<br/>TLS-RPT, BIMI"]
        DnsWait["Results collected in<br/>Phase 4 (Deferred DNS)"]

        DnsPrefetch --> DnsJobs --> DnsRecords --> DnsWait
    end

    ConnSvc -.->|"IsChildProcess"| PBIConn
    GraphConn -.->|"after first connect:<br/>resolve domain +<br/>start prefetch"| DnsPrefetch

    %% Styles
    classDef main fill:#dbeafe,stroke:#3b82f6,color:#000
    classDef exo fill:#fef3c7,stroke:#f59e0b,color:#000
    classDef purview fill:#e0e7ff,stroke:#6366f1,color:#000
    classDef graph fill:#d1fae5,stroke:#10b981,color:#000
    classDef child fill:#fed7aa,stroke:#ea580c,color:#000
    classDef background fill:#e2e8f0,stroke:#64748b,color:#000,stroke-dasharray:5 5
    classDef conflict fill:#fee2e2,stroke:#ef4444,color:#b91c1c
    classDef info fill:#f1f5f9,stroke:#94a3b8,color:#64748b

    class ConnSvc,ExecOrder main
    class GraphConn,Scopes,GraphAuth,CloudEnv graph
    class EXOConn,EXOCollectors exo
    class PurviewConn,PurviewCollectors,PurviewNote purview
    class EntraCol,CACol,EntAppCol,IntuneCol,SPCol,TeamsCol graph
    class PBIConn,PBICollector,PBIReason child
    class DnsPrefetch,DnsJobs,DnsRecords,DnsWait background
```
