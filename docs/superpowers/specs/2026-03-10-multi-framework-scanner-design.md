# Multi-Framework Security Scanner — Design Spec

> **Date**: 2026-03-10
> **Status**: Approved
> **Authors**: Daren Maranya, Claude (AI architect)
> **Stakeholders**: Craig (requested SOC 2 support)

## Problem Statement

M365-Assess is currently a CIS-first scanner. All 45 checks are identified by CIS
control IDs hardcoded in collectors. The report groups by CIS sections, scores against
CIS profiles (E3-L1/E3-L2/E5-L1/E5-L2), and treats other frameworks as cross-reference
columns. This architecture cannot natively support SOC 2, NIST 800-53, or any other
framework as a first-class citizen.

SOC 2 is the immediate business driver — Craig's team needs SOC 2 audit support. But the
solution should be general enough that adding any framework is a data task, not a code
change.

## Goals

1. **Framework-agnostic checks** — Each M365 configuration check exists independently of
   any framework. Frameworks claim ownership of checks through a data registry.
2. **Native SOC 2 support** — SOC 2 Trust Services Criteria (CC1-CC9) as a first-class
   framework with its own report view, scoring, and licensing profiles.
3. **Extensible by data** — Adding a new framework requires only a JSON profile file and
   mapping data. No collector or report code changes.
4. **Backward compatible** — CIS view remains the default. Existing users see no
   regressions.
5. **Evidence generation** — For audit-driven frameworks like SOC 2, the scanner can
   generate evidence artifacts that map to auditor requests (e.g., A-Lign).

## Non-Goals

- Full SOC 2 compliance automation (SOC 2 is ~66% procedural/policy — we cover the ~34%
  that is M365-automatable and are transparent about what requires manual evidence)
- Rewriting collectors as a declarative policy engine (too much risk, not enough payoff)
- Real-time continuous monitoring (this remains a point-in-time assessment)

## Architecture

### Approach: Data-Driven Inversion (Approach A)

Keep the existing collector architecture. Externalize all control metadata into a unified
control registry (JSON). The registry is the single source of truth — each check is
defined once with all its framework memberships, evaluation criteria, licensing
requirements, and remediation.

### Directory Structure

```
controls/
  registry.json              <- Master: every check with all framework IDs + licensing
  frameworks/
    cis-m365-v6.json         <- Framework profile: grouping, scoring, profiles
    soc2-tsc.json            <- SOC 2 profile: CC criteria, evidence types
    nist-800-53-mod.json     <- NIST profile
    iso-27001.json           <- ISO profile
    ...
```

Licensing lives in `registry.json` per check (not in a separate `licensing/` directory)
to avoid dual-maintenance. Framework profiles reference check IDs; the registry holds
the licensing tier for each check.

### Control Registry (registry.json)

Each check is a framework-agnostic entry:

```json
{
  "checkId": "ENTRA-ADMIN-001",
  "name": "Global Administrator Count",
  "category": "Admin Accounts",
  "collector": "Entra",
  "licensing": { "minimum": "E3" },
  "frameworks": {
    "cis-m365-v6": { "controlId": "1.1.3", "profiles": ["E3-L1","E5-L1"] },
    "soc2": { "controlId": "CC6.3", "evidenceType": "screenshot" },
    "nist-800-53": { "controlId": "AC-6(5)" },
    "iso-27001": { "controlId": "A.5.15;A.8.2" },
    "cmmc": { "controlId": "3.1.5;3.1.6" }
  }
}
```

### Check ID Convention

```
{COLLECTOR}-{AREA}-{NNN}

Examples:
  ENTRA-MFA-001        ENTRA-ADMIN-002       ENTRA-ACCESSREVIEW-001
  EXO-ANTIPHISH-001    EXO-FORWARD-001       EXO-TRANSPORT-001
  DEFENDER-MALWARE-001 DEFENDER-SAFELINK-001
  SPO-SHARING-001      SPO-GUEST-001
  TEAMS-MEETING-001    TEAMS-EXTERNAL-001
  PURVIEW-AUDITLOG-001 PURVIEW-ALERTPOL-001  PURVIEW-DLP-001
```

### Framework Profile (e.g., soc2-tsc.json)

Each framework defines how its checks are grouped, scored, and rendered:

```json
{
  "frameworkId": "soc2-tsc",
  "label": "SOC 2 Trust Services Criteria",
  "version": "2022",
  "css": "fw-soc2",
  "scoring": {
    "method": "criteria-coverage",
    "criteria": {
      "CC6.1": {
        "label": "Logical & Physical Access Controls",
        "checks": ["ENTRA-MFA-001", "ENTRA-LOCKOUT-001", "ENTRA-LEGACYAUTH-001", ...]
      },
      "CC6.3": {
        "label": "Role-Based Access",
        "checks": ["ENTRA-ADMIN-001", "ENTRA-PIM-001", ...]
      }
    }
  },
  "licensingProfiles": {
    "E3": { "excludeChecks": ["ENTRA-PIM-001", "ENTRA-IDRISK-001"] },
    "E5": { "excludeChecks": [] }
  }
}
```

## Collector Changes

### Scope of refactoring

Each of the 5 collectors defines its own local `Add-Setting` function (there is no
shared helper in `Common/`). The parameter rename (`-CisControl` to `-CheckId`) must be
applied to each collector's function definition and all its call sites (~150+ total
across 5 files). This is a mechanical find-and-replace operation but must be done
atomically per collector.

**Before:**
```powershell
Add-Setting -CisControl '1.1.3' ...
```

**After:**
```powershell
Add-Setting -CheckId 'ENTRA-ADMIN-001' ...
```

Output CSV column changes from `CisControl` to `CheckId`. All API calls, evaluation
logic, and remediation text remain unchanged.

### Migration strategy: all-at-once cutover

All 5 collectors are migrated in a single pass (not incrementally). This avoids the
complexity of the report layer handling mixed column names from different collectors.

The cutover sequence within Phase 1:
1. Build `registry.json` with a `cisControlId` reverse-lookup field per entry
2. Update all 5 collectors: rename `Add-Setting` parameter + update all call sites
3. Update `Export-AssessmentReport.ps1` to load registry and key on `CheckId` instead of
   `CisControl`. The registry's `cisControlId` field preserves the CIS identity for the
   CIS report view.
4. Retire `framework-mappings.csv` (replaced by registry.json)

This is a single coordinated change — no partial migration state exists.

### Report-layer data pipeline (post-migration)

At report load time, `Export-AssessmentReport.ps1`:
1. Loads `registry.json` into a hashtable keyed by `CheckId`
2. Loads each framework profile JSON from `controls/frameworks/`
3. For each assessment CSV row, looks up `CheckId` in the registry to get all framework
   memberships
4. Framework profiles define grouping (e.g., SOC 2 groups by CC criteria, CIS groups by
   section prefix from the CIS controlId)
5. Scoring is calculated per the framework profile's `scoring.method`

Two distinct data structures (clarified):
- **Framework display metadata** (label, CSS class) — from framework profile JSON header
- **Per-check framework membership** (which controls this check satisfies) — from
  registry.json `frameworks` field per check

### New SOC 2-Specific Checks

Checks that SOC 2 auditors request but CIS does not cover:

| CheckId | Check | SOC 2 Criteria | CIS Equivalent |
|---------|-------|----------------|----------------|
| ENTRA-ACCESSREVIEW-001 | Access Reviews configured for privileged roles | CC6.1, CC6.2 | None |
| ENTRA-SECURESCOR-001 | Microsoft Secure Score retrieved | CC3.1, CC4.1 | None |
| PURVIEW-AUDITRET-001 | Audit log retention period | CC7.1 | None |
| PURVIEW-ALERTPOL-001 | Security alert policies configured | CC7.1, CC7.2 | None |

Note: `PURVIEW-*` checks require creating a new Purview security-config collector
(`Purview/Get-PurviewSecurityConfig.ps1`). The existing Purview scripts are standalone
inventory tools that do not feed into the assessment CSV pipeline. This new collector
is a Phase 2 deliverable with its own Graph/Purview permissions requirements.
| ENTRA-STALEACCT-001 | Stale/inactive accounts detected | CC6.2, CC6.5 | None |
| ENTRA-GUESTLIFE-001 | Guest user lifecycle/expiration | CC6.3 | None |

## Report Changes

### Framework-native views

The report becomes multi-perspective. Selecting a framework re-groups findings by that
framework's control structure:

- **CIS view** (default): Grouped by CIS sections, scored by profile compliance — same
  as today
- **SOC 2 view**: Grouped by CC criteria, scored by criteria coverage, includes
  automatable vs manual distinction
- **NIST 800-53 view**: Grouped by control families (AC, AU, IA, SC, SI)
- **ISO 27001 view**: Grouped by Annex A themes (Organizational, Technological)

### Dynamic framework loading

The current hardcoded `$frameworkLookup` (12 entries) becomes dynamic — loaded from
whatever `.json` files exist in `controls/frameworks/`. Adding a framework to the report
requires only adding its profile JSON.

### SOC 2 scoring display

```
SOC 2 Coverage — E3 License
  CC6.1  Logical Access        8/10 checks passing
  CC6.3  Access Authorization  3/4  checks passing
  CC7.1  Monitoring            4/5  checks passing
  ...
  Automatable Coverage: 18/24 passing (75%)
  Manual/Procedural:    9 criteria require manual evidence
```

### Evidence package (future phase)

For SOC 2, generate audit-ready evidence mapped to auditor request IDs (e.g., A-Lign
R-1159: "Password or authentication settings for Office 365 — include screenshots of
MFA"). This maps the scanner output directly to audit evidence requests.

## Data Pipeline — Populating the Registry

### Sources for framework mappings

| Source | What it provides | Cost |
|--------|-----------------|------|
| Existing framework-mappings.csv | 140 CIS controls -> 8 frameworks | Already have |
| SCF Excel Spreadsheet | CIS Controls v8 -> 261 frameworks incl. SOC 2 | Free |
| CISA ScubaGear CSV | M365 setting -> NIST 800-53 (cross-validation) | Free |
| CIS M365 Benchmark PDF | Each CIS rec -> CIS Controls v8 Safeguard | Free |
| A-Lign SOC 2 Requirements.xlsx | Real auditor evidence requests -> CC criteria | Have it |
| Microsoft Compliance Manager | M365 improvement actions -> framework controls | Tenant |

### SOC 2 mapping chain

```
CIS M365 Benchmark rec (e.g., 1.1.3)
  -> CIS Controls v8 Safeguard (e.g., 6.5)    [from benchmark PDF]
  -> SOC 2 CC criteria (e.g., CC6.3)           [from SCF spreadsheet]
  -> Validated against A-Lign audit requests   [from Craig's file]
```

## Licensing Matrix (SOC 2)

| SOC 2 Feature | E3 | E5 | Impact on SOC 2 |
|---------------|----|----|-----------------|
| Conditional Access / MFA | Yes (P1) | Yes (P2) | Core CC6.1 |
| PIM (privileged access) | No | Yes (P2) | CC6.3, CC8.1 |
| Identity Protection (risk) | No | Yes (P2) | CC7.1 |
| Unified Audit Log | 180 days | 1 year | CC7.1 |
| Defender for O365 | No | Plan 2 | CC5, CC6.8 |
| DLP (basic) | Yes | Full | CC6.7 |
| Sensitivity Labels (auto) | No | Yes | CC6.7 |
| eDiscovery Premium | No | Yes | CC7.4 |
| Insider Risk Management | No | Yes | CC7.2 |

## Phasing

| Phase | Scope | Dependencies |
|-------|-------|-------------|
| Phase 1 | Control registry JSON + SOC 2 mappings + collector CheckId migration + report framework selector redesign | None |
| Phase 2 | New SOC 2-specific checks (access reviews, audit retention, Secure Score, alert policies, stale accounts, guest lifecycle) + SOC 2 licensing profiles | Phase 1 |
| Phase 3 | Evidence package generation for SOC 2 auditors | Phase 2 |
| Phase 4 | Additional framework native views (CMMC, NIST 800-53, ISO 27001) — one profile JSON per framework | Phase 1 |

## Research References

- CISA ScubaGear: https://github.com/cisagov/ScubaGear
- Secure Controls Framework: https://securecontrolsframework.com/scf-download/
- CISO Assistant: https://github.com/intuitem/ciso-assistant-community
- Microsoft Compliance Manager SOC 2 template (tenant-based)
- NIST OLIR crosswalks: https://csrc.nist.gov/projects/olir
- A-Lign SOC 2 audit evidence request (Craig's file, 130 requirements, 33 CC criteria)
- Microsoft licensing guidance: https://learn.microsoft.com/en-us/office365/servicedescriptions/microsoft-365-service-descriptions/microsoft-365-tenantlevel-services-licensing-guidance/microsoft-365-security-compliance-licensing-guidance

## Key Decisions

1. **JSON for registry** — Supports nested framework metadata cleanly
2. **Check-centric model** — Checks are framework-agnostic; frameworks claim ownership
3. **Approach A (Data-Driven Inversion)** — Minimal collector changes, maximum metadata
   externalization. Rejected: Policy Engine (Approach B, too much rewrite risk) and
   Report-Only Abstraction (Approach C, can't add framework-specific checks)
4. **CIS remains default view** — Backward compatible; SOC 2 and others are additive
5. **Honest about automation limits** — SOC 2 is ~34% automatable for M365; report
   distinguishes automatable vs manual criteria
