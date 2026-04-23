# Changelog

All notable changes to M365 Assess are documented here. This project uses [Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

## [2.4.0] - 2026-04-22

### Added
- User-controlled text scale cycle in the topbar (A / A+ / A++) — scales finding-title and detail body text without touching chrome; preference persisted in localStorage (#689, #704)
- Expand-all / collapse-all button on the findings table header (#688)
- Explicit "skipped" grey segment on domain-card and framework-quilt bars, with matching muted label and hover tooltip explaining the color legend (#703)
- Print preview auto-expands the first visible framework in the Framework Coverage section via `beforeprint` listener, ensuring framework details always render in the PDF output (#694)

### Changed
- EDIT MODE banner now renders above the topbar (was below) by reordering the Topbar fragment — the existing `position: sticky; top: 0` CSS then pins it to the top of the main column (#693)
- Left sidebar: `DOMAINS` section collapsed by default with a `+` toggle; `DETAILS` renamed to `Findings & action` with an accent top-border for visual emphasis; all `+` expand indicators right-aligned consistently (#695, #702)
- Filter bar restructured into three rows (search / status+severity / framework+domain) and adds `.filter-bar-active` sticky treatment when search or any filter is active (#696)
- Topbar icon-btn-group now right-aligns even when wrapping to a second row in narrow viewports (#700)
- Email authentication posture bars now render as discrete per-domain segments (green for pass, red for fail) instead of a single partial bar — 3 green + 1 red is more legible than a 75% filled bar (#699)
- Domain-card meta counts colored to match their bar segments (pass = success, warn = amber, fail = danger, review = accent, skipped = muted) — the row now doubles as a legend (#703)

### Fixed
- Duplicate subsection headings removed from Domain Posture (Intune / SharePoint / AD-Hybrid / Email Auth panels each render their title exactly once; outer wrapper divs were repeating the internal panel label) (#701)
- Microsoft-managed / Customer-earned Secure Score split tiles hidden when `microsoftScore === 0` — the computation uses an invalid `actionType = 'ProviderGenerated'` discriminator so the split was always broken; tiles will return once the classification logic is corrected (#698)

### Documentation / Branding
- Remaining "Azure AD" literals in PS remediation strings and Setting labels replaced with "Microsoft Entra" across SharePoint B2B, CA device compliance, Entra join/joined devices, PIM role paths, and P1/P2 premium warnings (#667)

## [2.3.1] - 2026-04-21

### Fixed
- Power BI collector now skips gracefully on non-Windows platforms (Linux/macOS) when no service principal is configured; emits an actionable warning instead of hanging on device-code auth (#664)
- Password Hash Sync status corrected to amber "Verify" (instead of red "Disabled") when `OnPremisesLastPasswordSyncDateTime` is absent on an active hybrid tenant — this is normal for Entra Cloud Sync or PHS enabled before any password changes (#665)
- Secure Score panel no longer shows 0 earned points when the tenant has a non-zero score; mapping from `currentScore` now applied correctly (#663)
- Assessment CSV output files now use the correct base filename (was incorrectly including the full script path in some environments) (#666)

### Changed
- "Microsoft Entra Connect" replaces "Azure AD Connect" in all remediation strings and collector output; "Microsoft Entra Cloud Sync" replaces "Azure AD Connect Cloud Sync" (#667, #662)

## [2.3.0] - 2026-04-21

### Added
- Filter state persistence — active section/severity/status/framework filters saved to `localStorage` (scoped per tenant) and restored on report reload (#634)
- `-ReportDensity` parameter (`Compact` | `Comfort`) added to `Export-AssessmentReport` and threaded through to `Get-ReportTemplate`; default `Compact` (no behaviour change) (#646)
- Vibe theme (`-ReportTheme Light`) — repurposed from the prior flat-light palette to a warm rose-gold dark aesthetic; Neon theme hue and contrast boosted (#649, #650)
- Anti-FOUC theme allowlist now derived from the PowerShell `ValidateSet` via reflection — a single source of truth; adding a new theme to the `ValidateSet` automatically protects it from flash (#645)
- N-of-M findings counter displayed in the All Findings table header (#638)
- Search match text highlighted in yellow in the findings results list (#636)
- `learnMore` URLs surfaced in the finding detail panel with a direct link (#637)
- Evidence block (collapsible `<details>`) added to finding detail panel for findings that carry structured evidence data (#640)
- CMMC L1 / L2 / L3 compliance scoring filters added to the compliance overview (#641)

### Fixed
- Print / PDF output quality improvements — dedicated print CSS media query, page-break rules, and hidden interactive controls (#635)

## [2.2.0] - 2026-04-20

### Added
- Roadmap CSV export — "Download CSV" button in the Remediation Roadmap exports the current roadmap table (reflecting any localStorage lane overrides) with columns: Lane, Setting, CheckID, Severity, Effort, Domain, Section, CurrentValue, RecommendedValue, Remediation, LearnMore, ControlRef (#549)
- Evidence field Phase 1 — 5 collectors (CA-MFA-ADMIN-001, ENTRA-SECDEFAULT-001, DEFENDER-ANTIPHISH-001, EXO-AUTH-001, SPO-SHARING-001) emit structured evidence data wired through `REPORT_DATA.findings[].evidence`; React finding detail panel shows a collapsible `<details>` Evidence block (#546)
- AD/Hybrid dashboard panel — `AdHybridPanel` React component in the report home view surfaces hybrid sync status, last sync time, sync type, password hash sync, and AD security finding counts when ActiveDirectory section is in scope (#562)

### Changed
- ISO/IEC 27001 framework label updated to "ISO/IEC 27001 + 27002:2022"; description clarifies that Pass/Fail reflects ISO 27002 implementation guidance mapped to ISO 27001 Annex A control IDs — not the risk-based certification requirement (#618)
- README footer now discloses Claude Code (Anthropic) co-development

### Changed (infrastructure)
- CheckID registry synced to v2.17.0 — 1096 total control entries; BACKUP-ENABLED-001 marked hasAutomatedCheck=false (no collector implemented) (#619)

## [2.1.0] - 2026-04-20

### Added
- Dashboard panels: DNS authentication summary, Intune device categories, mailbox summary, and SharePoint config panels in the report home view (#601)
- Sidebar sub-navigation for long section lists — collapses into a scrollable sub-menu (#599)
- Roadmap deep-link: clicking a finding in the Findings panel now deep-links to its entry in the Remediation Roadmap (#599)
- `intentDesign` flag on findings — collector sets this to suppress false-positive guidance for intentional configurations (#597)
- User staleness metrics (`NeverSignedIn`, `StaleMember` columns) added to user summary data (#597)
- DMARC staged-rollout detection — policy `none` with active reporting now emits a `Review` instead of `Fail` (#597)
- `tenantAgeYears` computed field added to tenant data (derived from `CreatedDateTime`) (#597)
- Framework description and official homepage URL now sourced from registry JSON and surfaced in the framework detail panel; `FW_BLURB` constants serve as fallback (#606, closes #592)

### Changed
- Secure Score card splits `CurrentScore / MaxScore` into two separate stat values — easier to read at a glance (#599)

### Fixed
- Report theme and mode were not applied on initial load — `data-theme="dark"` and `data-mode="comfort"` were invalid CSS selector values; replaced with correct defaults (`neon`/`dark`) and added anti-flash inline script in `<head>` (#604)
- `localStorage` access wrapped in `try/catch` to prevent `SecurityError` when report is opened from `file://` URLs in strict browser environments (#604)

### Changed (infrastructure)
- CheckID registry synced to v2.14.0 — 14 new upstream checks across EXO, Entra, Intune, and Teams domains (#603)

## [2.0.0] - 2026-04-18

### Added
- React 18 UMD report engine — single self-contained HTML file; all CSS/JS inlined via `Get-ReportTemplate.ps1` StringBuilder pipeline (#538–#541)
- `Build-ReportData.ps1` data bridge — PowerShell → `window.REPORT_DATA` JSON; powers the React app with live tenant data (#539)
- Real Secure Score sparkline — collector now fetches 180-day history; label adapts dynamically (2 WK / 2 MO / 6 MO TREND) (#556)
- Framework blurbs and official site links in the framework detail panel (JSX `FW_BLURB` lookup)
- Tenant · Live and MFA · Coverage status cards pinned to sidebar bottom
- Doom-font neon gradient ASCII banner in `Show-AssessmentHeader` — magenta-to-teal 24-bit ANSI gradient across 18 art rows (#569)
- `OnPremisesSyncEnabled` column added to admin role report (`Get-AdminRoleReport.ps1`) — fetched per-user via targeted Graph call; blank for service principals and groups (#573)
- `effort` field wired from control registry into `REPORT_DATA.findings[].effort` — defaults to `'medium'` until upstream registry populates the field (#573)
- Dark high-contrast mode brand-mark legibility fix (theme-scoped CSS override)

### Changed
- Remediation roadmap changed from 3-column grid to single full-width column list for easier reading
- Findings expand panel no longer shows duplicate Remediation block — remediation guidance lives exclusively in the Actions tab
- `-WhiteLabel` switch hides GitHub/Galvnyz attribution in the React report footer
- `-CompactReport` is the v2 replacement for the removed Skip* flags
- Remediation roadmap "How we prioritized" copy updated to accurately reflect severity-based bucketing; effort-weighted quick-win lane noted as pending upstream registry data (#547)
- Progress display reverted to `Write-Progress` — ANSI gradient bar (#570) removed before release due to fragility across console environments (#579)

### Fixed
- `Test-ModuleCompatibility`: `-SkipPurview` now correctly suppresses false EXO downgrade warning when no ExchangeOnline-dependent sections are selected (#580)
- `Show-AssessmentHeader`: output folder and log file paths now displayed in startup banner (#580)

### Removed
- `-CustomBranding`, `-FindingsNarrative`, `-CustomerProfile` parameters removed (#541)
- `New-M365BrandingConfig` removed from `FunctionsToExport` and module loader (#541)

## [1.16.0] - 2026-04-18

### Added
- `-CompactReport` switch replaces `-SkipCoverPage`, `-SkipComplianceOverview`, and `-SkipExecutiveSummary`; QuickScan auto-sets it unless explicitly overridden (#526)
- Auth parameter sets enforced: `AppOnlyCert`, `AppOnlySecret`, `DeviceCode`, `ManagedIdentity`, `ConnectionProfile`, `SkipConnection`, `Interactive` (#526)
- `-Section All` shorthand expands to all 13 sections (#526)
- `-AutoBaseline` switch auto-saves a dated snapshot after each run and compares to the most recent previous snapshot (#526)
- `-ListBaselines` switch displays saved baselines for a tenant and exits without running an assessment (#526)
- `Compare-M365Baseline` public cmdlet generates a drift HTML report from two saved baselines without re-running an assessment (#526)
- Baseline manifests now store `RegistryVersion` and `CheckCount`; cross-version comparisons restrict to shared CheckIDs and surface schema additions/removals separately (#526)
- PDF export via browser `window.print()` button in report nav — replaces unreliable headless-browser generation (#526)
- XLSX output includes a `Drift` sheet when a drift report is present (#526)
- `WhiteLabel` auto-enabled when `-CustomBranding` is supplied without explicitly passing `-WhiteLabel` (#526)
- `Get-RegistryVersion` helper in `AssessmentHelpers.ps1` reads `dataVersion` from `controls/registry.json` (#526)

### Changed
- Wizard Step 5 simplified from 6 options to 2: `CompactReport` and `QuickScan` (#526)
- `-SkipDLP` renamed to `-SkipPurview` to accurately reflect that it skips all three Purview collectors (#526)

### Removed
- `-NoBranding` — superseded by `-WhiteLabel` (#526)
- `-SkipCoverPage`, `-SkipComplianceOverview`, `-SkipExecutiveSummary` — replaced by `-CompactReport` (#526)
- `-Package` — PDF generation moved to browser print button (#526)
- `-FrameworkFilter`, `-FrameworkFilters`, `-FrameworkExport` — framework filtering is HTML-UI-only; all frameworks always rendered (#526)
- `-CisBenchmarkVersion` — dead parameter; CIS version is determined by `controls/frameworks/cis-m365-v6.json` (#526)

### Fixed
- Admin role separation: per-role 404 (role definition absent from tenant) now silently skipped instead of aborting the entire collector (#527)
- Admin role separation: per-principal 404 on `/licenseDetails` for service principals and deleted users now silently skipped (#527)
- EXO Security Config: `Asc-2X1-*` auto-expanding archive auxiliary segment quota warnings suppressed via `-WarningAction SilentlyContinue` on `Get-OwaMailboxPolicy`, `Get-MailboxAuditBypassAssociation`, and `Get-EXOMailbox` (#526)
- Error catch guards switched from `$_.Exception.Message` to `"$_"` for Graph SDK errors where HTTP body only appears in the full ErrorRecord string (#527)

## [1.15.0] - 2026-04-18

### Added
- XLSX Summary sheet: Combined sub-rows per license tier for CIS M365 (e.g. E3 Combined (L1+L2), E5 Combined (L1+L2)) — counts unique findings across both levels, avoiding double-counting (#508)
- XLSX Grouped by Profile sheet: same Combined rows added for each CIS license tier (#508)

### Fixed
- XLSX Grouped by Profile sheet: all data was zero due to `PSObject.Properties.Name` used on a hashtable — replaced with `ContainsKey()` check (#507)
- XLSX Grouped by Profile sheet: individual CIS control IDs (1.1.1, 1.1.2...) were appearing as profile rows — gap rows now filtered via `IsGap` flag (#507)
- Framework Catalog gap rows were always visible instead of appearing only when Detailed Checks is expanded (#505)
- Appendix chip filters were not highlighted on initial page load — `appendixFilterAll(true)` was defined but never called (#505)
- Framework Catalog group table was missing Total Controls and Not Automated columns (#505)
- Admin role separation: `Ensure the required PowerShell module is installed` error message did not match the catch pattern — broadened pattern to cover Graph SDK auth errors (#505, #506)
- Admin role separation: console permission warning added to match `Test-GraphPermissions` output style (#506)

### Changed
- CheckID registry synced to v2.8.0 (#497)

## [1.14.0] - 2026-04-18

### Added
- CMMC L2 collector: `Get-IntuneRemovableMediaConfig` (MP.L2-3.8.7) — enumerates all `storageBlockRemovableStorage` device restriction profiles, one row per profile with assignment status (#467)
- CMMC L2 collector: `Get-EntraAdminRoleSeparationConfig` (SC.L2-3.13.3) — detects privileged roles used for day-to-day access (permanent Global Admin, dual admin+user accounts) (#468)
- 4 new Intune CMMC L2 collectors wired into assessment: `Get-IntuneVpnSplitTunnelConfig`, `Get-IntuneWifiEapConfig`, `Get-IntuneCaRemoteDeviceConfig`, `Get-IntuneAlwaysOnVpnConfig` (#449)
- Framework Catalog full control list with gap rows (controls not yet in assessment), column picker, and per-catalog CSV export (#454, #455)
- CMMC L2 level sub-filter (L1 / L2 pill buttons) in Compliance Overview, mirroring the existing CIS profile sub-filter (#501)

### Changed
- 6 Intune collectors rewritten to emit one row per profile instead of a single aggregate row: `Get-IntuneMobileEncryptConfig`, `Get-IntunePortStorageConfig`, `Get-IntuneAppControlConfig`, `Get-IntuneFipsConfig`, `Get-IntuneAutoDiscConfig`, `Get-IntuneRemovableMediaConfig` — each collector now emits a Fail/Warning sentinel row when no qualifying profiles exist (#503)
- Registry remediation fallback: `Export-AssessmentReport` now falls back to collector-supplied remediation text when `registry.json` has no entry, eliminating blank remediation cells in the Appendix (#491)
- Dark mode contrast fixed for active filter buttons (`--m365a-dark` replaced with `--m365a-primary` for `.fw-checkbox.active` and `.co-profile-btn.active`) (#501)

### Fixed
- `Get-EntraAdminRoleSeparationConfig` returned 404 when querying role assignments with `$expand=principal` — orphaned (deleted) principals cause Graph to reject the expand; removed expand and use `principalId` directly (#502)

## [1.13.0] - 2026-04-17

### Added
- Compliance Overview filter panel revamped: collapsible `<details>` panel with severity chips (Critical/High/Medium/Low/Info), all filter groups unified, localStorage persistence across page reloads (#465)
- CIS profile/level sub-filters in Compliance Overview framework selector: E3 L1 / E3 L2 / E5 L1 / E5 L2 pill buttons, visible only when CIS M365 v6 filter is active (#452)
- Appendix enriched with impact/risk metadata columns (ImpactRationale, SCFWeighting, SCFDomain, SCFControl, Collector, LicensingMin), column picker to toggle visibility, status/severity/collector chip filters, and per-table CSV export (#456)
- Intune Overview dashboard page with metric cards, category coverage grid, and filterable findings table; auto-skips when Intune not in assessment scope (#470)
- DNS SERVFAIL detection: `Test-DnsZoneAvailable` emits DNS-ZONE-001 (High) and suppresses all downstream DNS checks to prevent false positives on broken zones (#460)
- RFC 7505 null MX and defensive lockdown pattern recognized: null SPF + null MX + DMARC reject/quarantine emits DNS-LOCKDOWN-001 (Pass) instead of cascading failures (#461)

### Changed
- Framework Catalog scoring method labels now display human-readable names (e.g. "Profile Compliance" instead of "profile-compliance") (#457)
- Framework Catalog summary stats enriched with descriptive `title` tooltips and plain-language labels ("Checks Assessed", "Pass Rate", "Coverage") (#458)
- Sections with a single table automatically expand to fill available viewport height; expand button hidden (#459)
- Collaboration Settings dashboard tiles updated with status badges, group headers (SharePoint & OneDrive / Microsoft Teams), and descriptive tooltips (#464)
- CheckID registry synced to v2.6.1 (4 new CMMC L2 Phase 4 checks: INTUNE-VPNCONFIG-001, INTUNE-WIFI-001, CA-REMOTEDEVICE-001, INTUNE-REMOTEVPN-001) (#482)
- Sync workflow now normalizes Windows-1252 bytes to UTF-8 after each CheckID download, preventing recurrence of encoding corruption

### Fixed
- CIS assessed check count now consistent between Compliance Overview card and Framework Catalog — both deduplicate by parent CheckId (strips sub-number suffix) (#453)
- Compliance Overview no longer shows unmapped rows (—) when a framework filter chip is active (#451)
- `cmmc.json`, `hipaa.json`, and `stig.json` corrected from Windows-1252 encoding (0x97 em dash, 0xa7 section sign) to proper UTF-8 (#485)
- Identity collectors 02-07d missing `RequiredServices` annotation — Graph connected too late, causing up to 6 collectors to be silently skipped (#473)

## [1.12.0] - 2026-04-16

### Added
- Policy drift detection: `-SaveBaseline <label>` saves the current assessment as a named JSON snapshot; `-CompareBaseline <label>` compares the next run against it and adds a "Drift Analysis" page to the HTML report with Regressed/Improved/Modified/New/Removed classification (#370)
- `impactRationale` surfaced in Remediation Action Plan — "Why it matters:" sub-line rendered below each remediation cell, drawn from `registry.json` for all 254 checks (#424)

## [1.11.0] - 2026-04-16

### Added
- DNS-MX-001: MX record verification check — Pass when MX resolves to `*.mail.protection.outlook.com`, Warning for third-party relays (Proofpoint, Mimecast, etc.), Fail when no MX record exists (#423)
- Column picker extended to all section tables (previously only security-config tables had it) (#412)
- Per-table CSV export button in control bar — client-side JS, respects active status filters and hidden columns; filename `<Section>_<Tenant>_<Date>.csv` (#418)
- Graphical emphasis on Expand Table button: accent-colored border, icon, and distinct hover state (#417)

### Changed
- Column picker merged into the status filter bar (no longer a separate element above it) (#413)
- Status chips consistently color-coded across all tables: Fail=red, Warning=amber, Review=purple, Pass=green, Info=grey (#414)
- Hybrid section demoted to bottom of left nav when `onPremisesSyncEnabled` is false/null; muted badge indicates cloud-only (#415)
- EXO-AUDIT-001 setting name updated to `Exchange Org Audit Config`; COMPLIANCE-AUDIT-001 updated to `Unified Audit Log (UAL) Ingestion` (#420)
- SPO-SYNC-001 and SPO-ACCESS-002 empty `CurrentValue` now emits `'Not configured'` or `'Could not retrieve via Graph API'` instead of blank (#421)

### Fixed
- ENTRA-ENTAPP-020 excluded Microsoft first-party service principals (`appOwnerOrganizationId == f8cdef31...`) from credential hygiene check, eliminating 47+ false positives on E5 tenants (#419)
- Status filter chips and All/None buttons now apply correctly across all section tables (#416)
- Non-security-config table rows (MFA Report, Admin Roles, Conditional Access list, App Registrations, etc.) were hidden on load because the JS status filter defaulted to `display:none` when no status checkboxes existed (#440)

## [1.10.1] - 2026-04-15

### Fixed
- Entra Security Config and EXO Security Config collectors returned 0 items due to
  `Add-Setting @{ }` hashtable literal in catch blocks binding entire object to `$Category` (#431)
- Authenticator fatigue protection check threw 'Cannot index into a null array' when
  `featureSettings` sub-properties are absent on fresh tenants (#431)
- Password hash sync check swallowed result via throw-to-catch anti-pattern;
  null org data now emits a Review row instead of a silent Write-Warning (#431)

## [1.10.0] - 2026-04-15

### Added
- Remediation Action Plan page in HTML report with severity/section chip filters (#401)
- Per-table column visibility picker (CheckId, Category, RecommendedValue hidden by default)
- Universal compact/expand toggle for all section tables
- Bar chart in Remediation Action Plan header showing checks by section
- Numbered index column in Appendix: Checks Run table
- Purview compliance checks: DLP workload coverage, alert policies, auto-labeling, comms compliance (#409)
- XLSX compliance matrix: 5 new SCF columns (ImpactSeverity, SCFDomain, CSFFunction, etc.) and Verification sheet (#408)
- CheckID v2.0.0 schema compatibility (scf/impactRating objects, E3/E5 licensing minimum) (#405)
- 8 missing registry entries restored: CA-NAMEDLOC-001, CA-REPORTONLY-001, CA-SESSION-001, SPO-ACCESS-001/002, SPO-SITE-001/002, SPO-VERSIONING-001 (#411)
- Project CLAUDE.md with architecture overview and key workflows (#411)

### Changed
- QuickScan auto-applies compact report format (SkipCoverPage, SkipExecutiveSummary, SkipComplianceOverview)
- PSGallery package optimized (~8MB to ~4MB via PNG compression and JSON minification)

### Fixed
- Bar chart section counts were all zero due to ForEach-Object `$_` variable shadowing in nested Where-Object
- Remediation Action Plan chart card visual cohesion (removed double-card background, added left border divider)
- Severity row hover now shows white text on all section, data, and remediation tables (removed opacity fade)
- Null-array exceptions in Entra password checks when directory settings or authenticator feature settings are absent (#426)
- Null-array exceptions in CA sign-in frequency checks when sessionControls is absent from a policy (#426)
- EXO hidden mailboxes OPATH filter boolean type mismatch causing 400 Bad Request errors (#425)
- EXO transient server-side errors now caught and reported as Review status instead of surfacing as warnings (#425)
- Get-Mailbox ResultSize warnings suppressed with -WarningAction SilentlyContinue (#425)
- Issues log now captures technical collector failures, not only permission errors (#425)
- DNS false positives for .onmicrosoft.com domains filtered at source (carried from #397)

## [1.9.0] - 2026-04-07

### Added
- **QuickScan triage report format** -- `-QuickScan` now automatically omits the cover page, executive summary, and compliance overview to produce a compact, action-focused report. Each section can be individually re-enabled with `-SkipCoverPage:$false`, `-SkipExecutiveSummary:$false`, or `-SkipComplianceOverview:$false`. (#372)

### Fixed
- **DNS false-positive failures for .onmicrosoft.com domains** -- SPF, DKIM, and DMARC checks were evaluating Microsoft-managed `.onmicrosoft.com` accepted domains and marking tenants as Fail when those domains had no DNS records (they cannot, by design). These domains are now filtered at the source before any DNS check runs. (#394)

## [1.8.1] - 2026-04-07

### Fixed
- **Connection profile + app reg regression** -- `Test-GraphTokenValid` was running before the first Graph connection, causing all Graph-dependent sections to be skipped with "Graph token expired" on every run. The check now only fires when Graph was already connected in a prior section. (#395)

## [1.8.0] - 2026-04-07

### Added
- **6 new SharePoint security checks** -- site sharing vs tenant policy (SPO-SITE-001), sensitive site external sharing (SPO-SITE-002), site admin visibility (SPO-SITE-003), CA coverage for SharePoint (SPO-ACCESS-001), unmanaged device sync restriction (SPO-ACCESS-002), version history configuration (SPO-VERSIONING-001). Registry: 304 entries (219 automated). (#382)
- **Device code token expiry detection** -- `Test-GraphTokenValid` added to AssessmentHelpers; pre-section token check skips Graph-dependent collectors with a Warning if the token has expired mid-run; startup warning advises using Interactive or Certificate auth for long assessments. (#380)

### Changed
- **SharePoint Review statuses replaced with Warning** -- SPO-SESSION-001, SPO-MALWARE-002, SPO-B2B-001, SPO-SHARING-008 now emit Warning with "Could not verify" when the Graph/beta API is unavailable, instead of silently returning Review. (#383)
- **SharePoint sharing thresholds hardened** -- SPO-SHARING-001 `externalUserAndGuestSharing` escalated to Fail; SPO-SHARING-004 anonymous links escalated to Fail; SPO-SHARING-003/005/006 null/missing values escalated to Warning; SPO-SYNC-002 and SPO-LOOP-001/002 evaluate to Pass/Warning/Review instead of always Info. (#381)
- **Power BI API failures now surface as Warning** -- connection errors no longer silently set `$allSettings = @()` causing all CIS 9.x checks to return Review; a sentinel Warning entry is emitted with "Could not verify -- API unavailable". (#357)
- **CI line coverage gate raised from 50% to 65%** -- reflects improved test baseline after 495-test coverage sweep (PRs #386-#388). (#389)

## [1.7.0] - 2026-04-06

### Added
- **`-DryRun` switch** -- preview sections, services, Graph scopes, and check counts without connecting or collecting data. Useful for first-time setup validation and CI/CD dry runs. (#363)
- **5 new Conditional Access security checks** -- report-only policy detection (CA-REPORTONLY-001), trusted IP named location risk (CA-NAMEDLOC-001), persistent browser without device compliance (CA-SESSION-001), combined risk policy anti-pattern (CA-RISKPOLICY-001), Tier-0 role coverage gaps (CA-ROLECOVERAGE-001). Registry: 298 entries (214 automated). (#368)
- **Enriched sidebar nav badges** -- sections without security findings now show contextual badges: gray "skip" for skipped sections, neutral item count for inventory/data sections. (#374)
- **License-skipped check details in compliance overview** -- callout now lists each skipped check by ID, name, and required service plan instead of just a count. (#360)

### Changed
- **Framework catalog "Findings" renamed to "Automated Checks"** -- clarifies the distinction between our security checks and the framework's control definitions. Coverage column now shows percentages with hover tooltip for fractions. (#369, #374)
- **Framework scoring aligned** -- Info-status findings excluded from pass rate denominators in both ComplianceOverview and FrameworkCatalog. Warning and Review shown as separate columns in catalog group tables instead of lumped "Other". (#369, #373)
- **Section header layout** -- collector chips moved directly under heading for visibility, callouts wrapped in flex container for side-by-side display, duplicate Expand/Collapse buttons removed. (#351, #356)
- **Persistent banners** -- hero banner and QuickScan banner now visible on every page in paginated mode, not just the overview. (#356, #359)
- **All 15 framework tags colored** -- fixed CSS class mismatches for Essential Eight, CIS Controls v8, and Entra STIG. Each framework now has a unique color in both light and dark mode. (#374)
- **Chip error text widened** -- max-width increased from 140px to 280px, expanded state unlimited. Collector chip max-width increased from 340px to 480px. (#356)

### Fixed
- **License gating ran before Graph connection** -- `Resolve-TenantLicenses` called `Get-MgSubscribedSku` before Graph connected, causing a warning on every run and silently disabling license gating. Moved to post-Graph-connect block with isolated error handling. (#353, #355)
- **Services not disconnected after assessment** -- Graph, EXO, and Purview sessions now cleanly disconnect after assessment completes. (#354, #355)
- **Progress summary printed twice** -- silent initialization before connection, authoritative summary with license data printed once after Graph connects. (#355)

## [1.6.0] - 2026-04-03

### Added
- Value Opportunity integration tests validating full collector pipeline (#348)
- Unit tests for Build-ValueOpportunityHtml report rendering (#348)
- MailboxSettings.Read Graph permission in app registration setup
- Purview.ApplicationAccess and EXO API permissions in consent function
- CheckId cross-reference validation in sku-feature-map tests

### Changed
- Replaced STANDARD sentinel in sku-feature-map.json with real Microsoft service plan IDs for accurate license detection (#346)
- Value Opportunity bar chart colors now use CSS variables for dark mode support
- Improved table header hover transitions across report

### Fixed
- Value Opportunity showing 0% adoption due to STANDARD sentinel auto-licensing all features (#346)
- Secure Score M365 Average showing N/A due to Graph SDK AdditionalProperties deserialization (#350)
- Broken CSS variable reference (--m365a-bg) in Value Opportunity stat cards
- Duplicate .section-description CSS rule in report template
- PSScriptAnalyzer failure from unapproved verb Analyze-ValueOpportunity (#350)

## [1.5.0] - 2026-04-03

### Added
- **License-aware check gating** -- automatically skips checks requiring service plans the tenant does not have (e.g., PIM checks skipped on E3-only tenants). Uses `Get-MgSubscribedSku` service plan detection instead of tier-based mapping to handle bundles, add-ons, and standalone licenses correctly. 25 checks mapped to specific plans (AAD_PREMIUM_P2, ATP_ENTERPRISE, LOCKBOX_ENTERPRISE, INTUNE_A, INFORMATION_PROTECTION_COMPLIANCE). Compliance overview shows info callout with skip count. (#268, #333)
- **`-QuickScan` switch** -- runs only Critical and High severity checks for faster CI/CD pipelines and daily monitoring. Collectors with no qualifying checks are skipped entirely. Report shows amber "Quick Scan Mode" banner. Available in wizard as option 6. Composes with license gating for smallest possible check set. (#273, #335)
- **Security Defaults gap analysis** -- new check ENTRA-SECDEFAULT-002 evaluates CA policy coverage across 4 areas (MFA-all, legacy auth block, admin MFA, Azure Management MFA) when Security Defaults is OFF. Pass/Review/Fail based on coverage. Self-contained Graph call, no cross-collector dependency. (#270, #332)
- **App security cluster** -- 21 new enterprise application security checks (ENTRA-ENTAPP-001 through 021) covering Tier 0 permission classification, credential hygiene, attack path analysis, reply URI/consent validation, and verified publisher enforcement. Expanded dangerous permissions from 10 to 49 (41 Tier 0 + 8 Tier 1). (#324, #325, #326, #328)
- **Entra ID STIG V1R1** -- 15th compliance framework with 10 Entra-specific DISA STIG controls and severity-coverage scoring. (#327, #328)
- **Microsoft Fluent UI sidebar icons** -- replaced 16 custom SVGs with official Fluent UI System Icons (Regular 20px, MIT licensed) for consistent Microsoft product aesthetic. (#305, #330)
- **Email tabbed protocol cards** -- replaced accordion with tabbed interface for SPF/DKIM/DMARC/MTA-STS explainers. ARIA accessible, responsive, print-friendly. (#307, #331)

### Changed
- **Registry licensing schema** -- migrated from tier-based `licensing.minimum` (E3/E5) to service plan detection `licensing.requiredServicePlans` (array of ServicePlanName values). OR logic: check runs if tenant has any listed plan. 294 entries migrated. (#268, #333)
- **Initialize-CheckProgress** -- now accepts composable `TenantLicenses` and `SeverityFilter` parameters for license gating and QuickScan respectively. (#268, #273)
- **Registry expanded** -- 295 entries (211 automated), up from 294.

### Fixed
- **Entra STIG scoring** -- corrected scoring method from invalid `pass-rate` to `severity-coverage`. (#329)

## [1.2.0] - 2026-04-02

### Added
- **Admin MFA strength classification** -- MFA Report now includes `MfaStrength` column (Phishing-Resistant/Standard/Weak/None) and new ENTRA-ADMIN-004 security check flags Global Administrators lacking phishing-resistant MFA methods. (#318)
- **Paginated report navigation** -- sidebar nav with section list, status badges, hash routing, browser back/forward, keyboard arrows, "Show All" toggle, and mobile hamburger menu. Report sections are now focused pages instead of one long scroll. (#288, #303)
- **Compact hero banner** -- dark branded banner with cropped logo replaces full-screen cover page on screen. Full cover preserved for print/PDF only. (#306)
- **Service-area breakdown chart** -- SVG stacked bar chart in executive summary showing pass/fail/warning/review per service area. Uses CSS variables for dark mode. (#276, #293)
- **Inline explanation callouts** -- per-section "Read More..." toggle consolidating section descriptions, protocol explainers, and contextual tips under one collapsed control. (#275, #292, #306)
- **Checks-run appendix** -- audit trail at end of report listing every security check executed with CheckId, Setting, Category, Status, and Section. (#278, #294)
- **RiskSeverity column in XLSX** -- compliance matrix now includes color-coded risk severity (Critical/High/Medium/Low) from risk-severity.json. (#278, #294)
- **`-OpenReport` switch** -- auto-opens the HTML report in the default browser after generation. Wired through both Export-AssessmentReport.ps1 and Invoke-M365Assessment.ps1. (#278, #294)
- **Footer repo link** -- "Generated by M365 Assess" is now a clickable link to the GitHub repo. (#306)

### Changed
- **Get-EntraSecurityConfig.ps1 decomposed** -- 1,753-line monolith split into ~110-line orchestrator + 5 focused helpers (PasswordAuth, AdminRole, ConditionalAccess, UserGroup, Helpers). Migrated to SecurityConfigHelper contract. (#256, #290)
- **Get-DefenderSecurityConfig.ps1 decomposed** -- 1,040-line monolith split into ~90-line orchestrator + 6 focused helpers (AntiPhishing, AntiSpam, AntiMalware, SafeAttLinks, PresetZap, Helpers). Migrated to SecurityConfigHelper contract. (#257, #291)
- **All 13 collectors now on SecurityConfigHelper contract** -- `$deferredCollectors` exclusion list eliminated. (#290, #291)
- **Collector tables expanded by default** -- pagination removes the need to collapse content for scroll management. (#306)
- **Combined Overview page** -- Executive Summary and Organization Profile merged into single sidebar entry. (#306)
- **Asset discovery priority** -- cropped logo variants preferred over full-size originals. (#306)

## [1.1.0] - 2026-04-01

### Added
- **SecurityConfigHelper contract** -- shared `Initialize-SecurityConfig`, `Add-SecuritySetting`, and `Export-SecurityConfigReport` functions eliminate duplicated `Add-Setting` boilerplate across collectors. ValidateSet enforcement on Status field rejects invalid values at the source. (#236, #282)
- **74 contract tests** -- unit tests for all 3 SecurityConfigHelper functions plus structural compliance tests verifying all 11 migrated collectors follow the contract pattern. Full suite: 811 passing. (#238, #285)
- **13 public module cmdlets** -- individual security collectors exported as `Get-M365*SecurityConfig` functions. Users can now run `Get-M365ExoSecurityConfig`, `Get-M365EntraSecurityConfig`, etc. standalone after `Import-Module M365-Assess`. (#241, #287)
- **Graph API scope validation** -- pre-flight permission check runs after first Graph connection, warning about missing scopes grouped by affected section. Detects app-only auth and skips gracefully. (#272, #281)
- **Mailbox delegation audit** -- `Get-MailboxPermissionReport.ps1` wired into Email section orchestrator for FullAccess/SendAs/SendOnBehalf reporting. (#269, #280)
- **Hidden mailbox detection** -- `EXO-HIDDEN-001` check flags user mailboxes hidden from GAL as potential compromise indicators, mapped to MITRE T1564. (#277, #280)

### Changed
- **Export-AssessmentReport.ps1 decomposed** -- 4,278-line monolith split into 4 focused files: `ReportHelpers.ps1` (225 lines), `Build-SectionHtml.ps1` (1,355 lines), `Get-ReportTemplate.ps1` (2,411 lines), and a 341-line orchestrator. Zero behavior change. (#235, #286)
- **8 collectors migrated to SecurityConfigHelper** -- replaced ~240 lines of duplicated boilerplate across Forms, Intune, Compliance, PowerBI, Purview Retention, DNS, EntApp, and CA collectors. (#283, #284)
- **Module install prompts improved** -- ImportExcel and MicrosoftPowerBIMgmt promoted from Optional to Recommended tier with `[Y/n]` default-yes prompts and NonInteractive auto-install. (#254, #280)

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
