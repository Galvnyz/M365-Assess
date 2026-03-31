# Changelog

All notable changes to M365 Assess are documented here. This project uses [Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

## [1.0.1] - 2026-03-30

### Fixed
- **Defender preset security policies** -- tenants with Standard or Strict preset security policies enabled no longer show false failures for anti-phishing, anti-spam, anti-malware, Safe Links, and Safe Attachments checks. Preset-managed policies are detected via `Get-EOPProtectionPolicyRule` and `Get-ATPProtectionPolicyRule` and reported as "Managed by [Standard/Strict] preset security policy" with Pass status. (#245)

## [1.0.0] - 2026-03-30

### Added
- **First public release** -- M365 Assess is now a proper PowerShell module ready for PSGallery publishing
- 8 Graph sub-modules declared in manifest RequiredModules (was 3) -- `Install-Module M365-Assess` now pulls in all dependencies
- 37 new Pester tests across 6 files: Connect-Service, Resolve-DnsRecord, Test-BlockedScripts, SecureScoreReport, StrykerIncidentReadiness, HybridSyncReport
- Interactive optional module install prompt -- users are offered to install ImportExcel and MicrosoftPowerBIMgmt when missing (default N)
- ImportExcel pre-flight detection with XLSX export skip warning
- Module version table displayed after successful repair
- Coverage summary in CI workflow job summary
- Skip-nav link, `.sr-only` utility, ARIA attributes, and table captions for HTML report accessibility
- `docs/QUICKSTART.md` for first-run setup on fresh Windows machines

### Changed
- **Dark mode CSS variables** -- cloud badges, DKIM badges, and status badges now use CSS variables instead of hardcoded hex; 11 redundant `body.dark-theme` overrides removed
- **Error handling standardized** -- `Assert-GraphConnection` helper replaces 56 duplicated connection checks across 28 collectors (-252 lines)
- All `ErrorActionPreference = 'Continue'` files now have explanatory comments
- README updated for `src/M365-Assess/` module structure -- all examples use `Import-Module` pattern
- "Azure AD Connect" renamed to "Microsoft Entra Connect" throughout
- Null comparisons updated to PowerShell best-practice `$null -ne $_` form
- Magic `Start-Sleep` values replaced with named `$errorDisplayDelay` constant
- Empty check progress now shows feedback message instead of silent return

### Fixed
- DKIM badges had no dark mode support -- appeared as light-theme colors on dark backgrounds
- Hardcoded badge text colors broke dark mode contrast in some themes

## [0.9.9] - 2026-03-29

### Changed
- **Repo restructure** — all module files moved to `src/M365-Assess/` for clean PSGallery publishing (`Publish-Module -Path ./src/M365-Assess`)
- **Orchestrator decomposition** — `Invoke-M365Assessment.ps1` reduced from 2,761 to 971 lines; 8 focused modules extracted to `Orchestrator/` directory
- **`.psm1` module structure** — proper `M365-Assess.psm1` wrapper with `FunctionsToExport`, `Import-Module` and `Get-Command` now work correctly
- **Assets consolidated** — two `assets/` folders merged into single `src/M365-Assess/assets/` (branding + SKU data)

### Removed
- **ScubaGear integration** — removed wrapper, permissions script, docs, and all tool-specific code paths. CISA SCuBA compliance framework data retained

### Added
- **PSGallery publish workflow** — `release.yml` validates, creates GitHub Release, and publishes to PSGallery on version tags
- **21 PSGallery readiness tests** — manifest validation, FileList integrity, module loading, package hygiene
- **Expanded PSGallery tags** — Compliance, Audit, NIST, SOC2, HIPAA, ZeroTrust, SecurityBaseline
- PSGallery install instructions in README and release process in CONTRIBUTING.md
- Interactive Module Repair with `-NonInteractive` support
- Blocked script detection (NTFS Zone.Identifier)
- Section-aware module detection
- EXO version pinning to 3.7.1
- msalruntime.dll auto-fix
- 24 Pester tests for module repair, headless mode, and blocked script detection

## [0.9.8] - 2026-03-20

### Added
- **Stryker Incident Readiness** — 9 new security checks ported from StrykerScan, covering attack vectors from the Stryker Corporation cyberattack (March 2026):
  - ENTRA-STALEADMIN-001: Admin accounts inactive >90 days
  - ENTRA-SYNCADMIN-001: On-prem synced admin accounts (compromise path)
  - CA-EXCLUSION-001: Privileged admins excluded from CA policies
  - ENTRA-ROLEGROUP-001: Unprotected groups in privileged role assignments
  - ENTRA-APPS-002: App registrations with dangerous Intune write permissions
  - INTUNE-MAA-001: Multi-Admin Approval not enabled
  - INTUNE-RBAC-001: RBAC role assignments without scope tags
  - ENTRA-BREAKGLASS-001: Break-glass emergency access account detection
  - INTUNE-WIPEAUDIT-001: Mass device wipe activity (attack indicator)
- New collector: `Security/Get-StrykerIncidentReadiness.ps1` with full control registry mappings (NIST 800-53, CISA SCuBA, CIS M365 v6, ISO 27001, MITRE ATT&CK)
- Automated security check count increased from 160 to 169

## [0.9.7] - 2026-03-19

### Added
- XLSX export auto-discovers framework columns from JSON definitions (#138)
- `-CisBenchmarkVersion` parameter for future CIS v7.0 upgrade path (#156)
- CheckID PSGallery module as primary registry source with local fallback (#139)
- Profile-based frameworks render as inline tags in XLSX (e.g., `1.1.1 [E3-L1] [E5-L1]`)
- 3 new Pester tests for Import-ControlRegistry (severity overlay, CisFrameworkId, fallback)

### Changed
- DLP collector removes redundant session checks, saving ~15-30s per run (#164)
- XLSX export uses 14 dynamic framework columns (was 13 hardcoded)
- Import-ControlRegistry accepts `-CisFrameworkId` parameter for reverse lookup
- CI sync-checkid job renamed to reflect fallback cache role

### Removed
- 17 legacy flat framework properties from finding object (CisE3L1, Nist80053Low, etc.)
- Redundant `Get-Command` and `Get-Label` session checks from DLP collector

## [0.9.6] - 2026-03-19

### Added
- JSON-driven framework rendering: auto-discover frameworks from `controls/frameworks/*.json` via `Import-FrameworkDefinitions.ps1` (#67)
- `Export-ComplianceOverview.ps1`: extracted compliance overview into standalone function (~230 lines)
- `Frameworks` hashtable on each finding object for dynamic framework access
- Wizard Report Options step: toggle Compliance Overview, Cover Page, Executive Summary, Remove Branding, and Limit Frameworks interactively
- Numbered framework sub-selector with all 13 families and Select All/None shortcuts
- `-AcceptedDomains` parameter on `Get-DnsSecurityConfig.ps1` for cached domain passthrough
- CSS classes for new framework tags: `.fw-fedramp`, `.fw-essential8`, `.fw-mitre`, `.fw-cisv8`, `.fw-default`, `.fw-profile-tag` (light + dark theme)
- 13 Pester tests for `Import-FrameworkDefinitions`
- `FedRAMP`, `Essential8`, `MITRE`, `CISv8` added to `-FrameworkFilter` ValidateSet

### Changed
- Compliance overview now renders 14 framework-level columns (down from 16 profile-level columns) with inline profile tags
- CI consolidated from 5 jobs to 3: single "Quality Gates" job (lint + smoke + version), full Pester, and push-only CheckID sync
- Branch protection enabled on `main` requiring Quality Gates to pass before merge
- Public group owner check uses client-side visibility filter (avoids `Directory.Read.All` requirement)
- Orchestrator passes cached accepted domains to deferred DNS collector (avoids EXO session timeout)
- Framework JSON fixes: `displayOrder`/`description` added to cis-m365-v6 and nist-800-53, `soc2-tsc` frameworkId corrected to `soc2`, Unicode corruption fixed in hipaa/stig/cmmc

### Removed
- 12 catalog CSV files in `assets/frameworks/` (replaced by `totalControls` in framework JSONs, -2,833 lines)
- Hardcoded `$frameworkLookup`, `$allFrameworkKeys`, `$cisProfileKeys`, `$nistProfileKeys` from report script

## [0.9.5] - 2026-03-17

### Changed
- Remove all backtick line continuations from 10 security collectors (1,216 total), replacing with splatting (@params) pattern (#130, #131, #132)
- Document ErrorActionPreference strategy with inline comments across all 12 collectors (#135)

### Added
- Write-Warning when progress display helpers (Show-CheckProgress.ps1, Import-ControlRegistry.ps1) are missing (#133)
- `-CheckOnly` staleness detection switch for Build-Registry.ps1 (#134)
- Pester regression test scanning collectors for backtick line continuations (#136)
- CONTRIBUTING.md with error handling convention documentation (#135)

## [0.9.4] - 2026-03-15

### Added
- Cross-platform CI: lint + smoke tests on ubuntu-latest and macos-latest (#103)
- PSGallery feasibility report (`docs/superpowers/specs/2026-03-15-psgallery-feasibility.md`)

### Changed
- CI lint job now runs on all 3 platforms (Windows, Linux, macOS)
- New `smoke-tests` job runs platform-agnostic Pester tests cross-platform
- Full Pester suite and version check remain Windows-only
- PSGallery packaging (#120) deferred to v1.0.0 (requires .psm1 wrapper restructuring)

## [0.9.3] - 2026-03-15

### Added
- Copy-to-clipboard button for PowerShell remediation commands in HTML report (#121)
- Pester consistency tests for metadata drift prevention (#104)
  - Manifest FileList coverage, framework count, section names, registry integrity, version consistency

### Fixed
- Dynamic zebra striping now applies to td cells for dark mode visibility (#125)

## [0.9.1] - 2026-03-15

### Changed
- **Breaking:** `-ClientSecret` parameter now requires `[SecureString]` instead of plain text (#111)
- EXO/Purview explicitly reject ClientSecret auth instead of silent fallthrough (#112)
- Framework count in exec summary uses dynamic `$allFrameworkKeys.Count` instead of hardcoded 12 (#100)

### Fixed
- PowerBI 404/403 error parsing with actionable messages (#106)
- SharePoint 401/403 guides users to consent `SharePointTenantSettings.Read.All` (#116)
- Teams beta endpoint errors use try/catch + Write-Warning instead of SilentlyContinue (#115)
- Null-safe `['value']` array access across 5 collector files (47 insertions) (#114)
- PIM license vs config detection distinguishes "not configured" from "missing P2 license" (#117)
- SOC2 SharePoint dependency probe with module-missing vs not-connected messaging (#110)
- DeviceCodeCredential stray errors no longer crash Entra and Teams collectors
- PowerBI child process no longer prompts for Service parameter

### Added
- 5 new Pester tests for PowerBI disconnected, 403, and 404 scenarios (#113)
- COMPLIANCE.md updated to 149 automated checks, 233 registry entries (#99)
- CONTRIBUTING.md with Pester testing guidance and PR template checklist (#101)
- Registry README documenting CSV-to-JSON build pipeline (#102)

## [0.9.0] - 2026-03-14

### Added
- Power BI security config collector with 11 CIS 9.1.x checks (`PowerBI/Get-PowerBISecurityConfig.ps1`)
- 14 Pester tests for Power BI collector (pass/fail/review scenarios)
- `-ManagedIdentity` switch for Azure managed identity authentication (Graph + EXO)
- `-ClientSecret` parameter exposed on orchestrator for app-only Graph auth
- Power BI section wired into orchestrator (opt-in), Connect-Service, wizard, and collector maps
- PowerBI and ActiveDirectory added to report `sectionDisplayOrder`
- SECURITY.md and COMPATIBILITY.md added to README documentation index

### Changed
- Registry updated: 11 Power BI checks now automated (149 total automated, 233 entries)
- Section execution reordered to minimize EXO/Purview reconnection thrashing
- ScubaProductNames help text corrected to "seven products" (includes `powerbi`)
- `.PARAMETER Section` help now lists all 13 valid values
- Manifest FileList updated with 7 previously missing scripts (Common helpers + SOC2)

### Fixed
- 6 validated issues from external code review addressed on this branch

## [0.8.5] - 2026-03-14

### Changed
- Version management centralized to `M365-Assess.psd1` module manifest (single source of truth)
- Runtime scripts (`Invoke-M365Assessment.ps1`, `Export-AssessmentReport.ps1`) now read version from manifest via `Import-PowerShellDataFile`
- Removed `.NOTES Version:` lines from 23 scripts (no longer needed)
- CI version consistency check simplified from 25-file scan to 3-location verification

## [0.8.4] - 2026-03-14

### Added
- Pester unit tests for all 9 security config collectors (CA, EXO, DNS, Defender, Compliance, Intune, SharePoint, Teams + existing Entra), bringing total test count from 137 to 236
- Edge case test for missing Global Administrator directory role

### Changed
- Org attribution updated to Galvnyz across repository
- CLAUDE.md testing policy updated: Pester tests are now part of standard workflow (previously "on demand only")

### Fixed
- Unsafe array access in Get-EntraSecurityConfig.ps1 when Global Admin role is not activated (#88)
- Unsafe array access in Export-AssessmentReport.ps1 when tenantData is empty (#89)

## [0.8.3] - 2026-03-14

### Added
- Dark mode toggle with CSS variable theming and accessibility improvements
- Email report section redesigned with improved flow and categorization

### Fixed
- Print/PDF layout broken for client delivery (#78)
- MFA adoption metric using proxy data instead of registration status (#76)

## [0.8.2] - 2026-03-14

### Added
- GitHub Actions CI pipeline: PSScriptAnalyzer, Pester tests, version consistency checks
- 137 Pester tests across smoke, Entra, registry, and control integrity suites
- Dependency pinning with compatibility matrix

### Fixed
- Global admin count now excludes breakglass accounts (#72)

## [0.8.1] - 2026-03-14

### Added
- 6 CIS quick-win checks: admin center restriction (5.1.2.4), emergency access accounts (1.1.2), password hash sync (5.1.8.1), external sharing by security group (7.2.8), custom script on personal sites (7.3.3), custom script on site collections (7.3.4)
- Authentication capability matrix with auth method support, license requirements, and platform requirements

### Changed
- Registry expanded to 233 entries with 138 automated checks
- Synced version numbers across all 23 scripts to 0.8.1
- CheckId Guide rewritten with current counts, sub-numbering docs, supersededBy pattern, and new-check checklist
- Added Show-CheckProgress and Export-ComplianceMatrix to version tracking list

### Fixed
- Dashboard card coloring inconsistency in Collaboration section (switch statement semicolons)
- Added ActiveDirectory and SOC2 sections to README Available Sections table

## [0.8.0] - 2026-03-14

### Added
- Conditional Access policy evaluator collector with 12 CIS 5.2.2.x checks
- 14 Entra/PIM automated CIS checks (identity settings + PIM license-gated)
- DNS security collector with SPF/DKIM/DMARC validation
- Intune security collector (compliance policy + enrollment restrictions)
- 6 Defender and EXO email security checks
- 8 org settings checks (user consent, Forms phishing, third-party storage, Bookings)
- 3 SharePoint/OneDrive checks (B2B integration, external sharing, malware blocking)
- 2 Teams review checks (third-party apps, reporting)
- Report screenshots in README (cover page, executive summary, security dashboard, compliance overview)
- Updated sample report to v0.8.0 with PII-scrubbed Contoso data

### Changed
- Registry expanded to 227 entries with 132 automated checks across 13 frameworks
- Progress display updated to include Intune collector
- 11 manual checks superseded by new automated equivalents

## [0.7.0] - 2026-03-12

### Added
- 8 automated Teams CIS checks (zero new API calls)
- 8 automated Entra/SharePoint CIS checks (2 new API calls)
- Compliance collector with 4 automated Purview CIS checks
- 5 automated EXO/Defender CIS checks
- Expanded automated CIS controls to 82 (55% coverage)

### Fixed
- Handle null `Get-AdminAuditLogConfig` response in Compliance collector

## [0.6.0] - 2026-03-11

### Added
- Multi-framework security scanner with SOC 2 support (13 frameworks total)
- XLSX compliance matrix export (requires ImportExcel module)
- Standardized collector output with CheckId sub-numbering and Info status
- `-SkipDLP` parameter to skip Purview connection

### Changed
- Report UX overhaul: NoBranding switch, donut chart fixes, Teams license skip
- App Registration provisioning scripts moved to `Setup/`
- README restructured into focused documentation files

### Fixed
- Detect missing modules based on selected sections
- Validate wizard output folder to reject UPN and invalid paths

## [0.5.0] - 2026-03-10

### Added
- Security dashboard with Secure Score visualization and Defender controls
- SVG donut charts, horizontal bar charts, and toggle visibility
- Compact chip grid replacing collector status tables

### Changed
- Report UI overhaul with dashboards, hero summary, Inter font
- Restyled Security dashboard to match report layout pattern

### Fixed
- Hybrid sync health shows OFF when sync is disabled
- Dark mode link color readability
- Null-safe compliance policy lookup and ScubaGear error hints

## [0.4.0] - 2026-03-09

### Added
- Light/dark mode with floating toggle, auto-detection, and localStorage persistence
- Connection transparency showing service connection status
- Cloud environment auto-detection (commercial, GCC, GCC High, DoD)
- Device code authentication flow for headless environments
- Tenant-aware output folder naming

### Fixed
- ScubaGear wrong-tenant auth
- Logo visibility in dark mode

## [0.3.0] - 2026-03-08

### Added
- Initial release of M365 Assess
- 8 assessment sections: Tenant, Identity, Licensing, Email, Intune, Security, Collaboration, Hybrid
- Self-contained HTML report with cover page and branding
- CSV export for all collectors
- Interactive wizard for section selection and authentication
- ScubaGear integration for CISA baseline scanning
- Inventory section (opt-in) for M&A due diligence
