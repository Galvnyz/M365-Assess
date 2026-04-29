# Changelog

All notable changes to M365 Assess are documented here. This project uses [Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

## [2.10.0] - 2026-04-29

The **Polish & Audits** milestone — 10 of 10 issues closed. Three audit-flavored research artifacts (ISO 27001/27002, CIS M365 v6.0.1, per-control narrative content) plus the long-standing SharePoint prefix-bug in the report's "Why It Matters" renderer. No breaking API changes.

### Added
- **Per-prefix narrative content for the finding-detail "Why It Matters" callout (#854)** — expanded coverage from ~22 to ~70 prefix families across SPO / EXO / DNS / DEFENDER / ENTRA / CA / INTUNE / COMPLIANCE / TEAMS / POWERBI / PBI / FORMS. Order preserves more-specific-first (e.g., `EXO-FORWARD` before generic `EXO-`). New `docs/research/narrative-content-sources.md` captures source-authority by family (Microsoft Learn, CIS M365 v6.0.1, NIST 800-63B / 800-53 r5, CISA, M3AAWG, FBI IC3, MITRE ATT&CK). Per-checkId refinement + architectural move to `controls/narrative-overlay.json` deferred to follow-up
- **ISO 27001 vs 27002 mapping audit (#858)** — new `docs/research/iso-27001-vs-27002-audit.md` documents the upstream SCF conflation (1020 / 1020 identical mappings) and recommends the upstream-fix path. New `iso-27002.json` framework definition (was missing — registry tagged checks with `iso-27002` but no framework JSON existed). New `tests/Behavior/Iso-27001-27002-Mapping-Audit.Tests.ps1` with skip-until-upstream divergence assertion + always-runs informational stats. Follow-up tracker #871 monitors when upstream lands
- **CIS M365 v6.0.1 mapping audit (#848)** — new `docs/research/cis-m365-v6-audit.md` catalogs section-9 POWERBI-/PBI- merge-artifact duplicates (11/11 clusters all parallel pairs — every Power BI / Fabric check ships twice and inflates coverage counts) + section-4 EXO-* labeling anomaly (4/6 checks are EXO despite section being named "Microsoft Intune"). New `tests/Behavior/Cis-M365-v6-Mapping-Audit.Tests.ps1` with skip-until-upstream regressions on both anomalies + informational stats

### Fixed
- **SPO- / SHAREPOINT- prefix matching bug in `whyItMatters()` (#854)** — the chain checked `startsWith('SHAREPOINT-')` but the registry uses `SPO-`. **Every SharePoint finding was hitting the generic fallback** since SPO content was added. Now matches correctly with sub-prefix specificity (SHARING/B2B, SITE/ACCESS, SCRIPT/SWAY, SYNC/OD, MALWARE/VERSIONING/LOOP/AUTH/SESSION) plus legacy SHAREPOINT-/20B- catches retained for compatibility

## [2.9.3] - 2026-04-28

Big patch release covering the v2.7.0 — Deep UX milestone closeout plus the v2.10.0 — Polish & Audits UX work to date. Despite "patch" in the version label, this release ships a substantial new framework-coverage UX (per a Claude Design handoff) and several new capabilities — but no breaking API changes. The 3 remaining audit-flavored items (CIS mapping integrity, ISO 27001/27002, per-control narrative content) ship in v2.10.0 proper.

### Added
- **Artifact provenance + chain-of-custody (#867)** — every audience-facing output now carries the M365-Assess version + generated-at timestamp. New `_Assessment-Provenance.json` at the assessment root captures toolName / toolVersion / registryDataVersion / tenant info / sectionsRun + a `outputArtifacts` array with **SHA-256 hashes** of every other file in the folder. The XLSX Compliance Matrix sheet's Title row, the `_Assessment-Summary_*.csv` comment header, and the `_PermissionDeficits.json` payload all gained a version field too. Per-section CSVs intentionally unchanged
- **FrameworkQuilt redesign — adaptive single/multi layout (#751, #855)** — One unified component branches on framework count: 0 → empty state, 1 → single-framework focus surface (donut score + family chart + primary CTA), 2+ → sortable comparison table + coverage chart + drill-down. Implements the Direction-Merged design from `docs/design/framework-redesign/`. New components: `ScoreDonut` (animated SVG ring), `FwManageButton` (real form-control dropdown replacing the chip-shaped picker), `CompareTableM` (sortable), `CoverageChart` (sorted bar with position markers), `FamilyChartM` (clickable family rows), `FilterBanner` (action feedback with single Clear-all), `ProfileChipsM` (level chips promoted out of the buried expanded panel), `GapsCTA` (real primary action button)
- **HideableBlock for any card or section (#712)** — extends edit-mode finding-row hide to ANY card/section. New generic `<HideableBlock hideKey>` wrapper with hover ✕ overlay and ↩ Restore. Persists into REPORT_OVERRIDES on Finalize. v1 wraps 15 elements (Score card, 4 KPIs, 3 roadmap lanes, 7 appendix sub-cards)
- **Native taxonomy for 4 more frameworks (#845 partial)** — HIPAA (6 safeguards via 164.X), SOC 2 TSC (5 criteria), Essential Eight (8 strategies), CISA SCUBA (6 services). Brings native-taxonomy coverage to 12 of 14 supported frameworks. MITRE ATT&CK + STIG documented as deliberate domain fallback
- **Findings table columns resizable + sortable (#846)** — drag handle on the right edge of every header (8px hot zone, 60px min-width, fr columns snap to px on first drag). Click sortable headers (Status / Finding / Domain / CheckID / Severity) to cycle none → asc → desc → none. Status sorts by enum order so Fail comes first. Both persist per-tenant in localStorage
- **`-BaselineLabel` parameter** — already present from v2.9.2, no change here
- **Design handoff package (#856)** — `docs/design/framework-redesign/` committed as the source of truth for the redesign spec
- **`docs/LEVELS.md` (#844)** — semantic reference for level/profile chips. Locks down the per-check trust-the-registry model and rejects synthetic inheritance in code

### Changed
- **FilterBar consolidation (#847)** — collapsed from 5 stacked rows to a single flowing row with vertical dividers between groups (STATUS / SEVERITY / FRAMEWORK / DOMAIN / LEVEL). Groups break as units when the viewport is narrower; chips inside a group never break across a separator. Density-aware compact mode (existing `[data-density="compact"]` selector) halves vertical padding. FilterBar height drops from ~250px to ≤120px on a 1440px viewport
- **CIS M365 v6 sections complete** — added the missing `4: Microsoft Intune` and `9: Microsoft Fabric` to the framework JSON so the family breakdown no longer shows `(unmapped)` rows for those sections
- **Topbar text-size control split into A− / A+ (#852)** — replaced the single A/A+/A++ cycling button with two adjacent buttons that step one position each direction and disable at the boundaries. Tooltips show direction + current size. Persistence (`m365-text-scale` localStorage key) unchanged

### Fixed
- **Appendix Email-authentication card SPF/DKIM predicates (#860)** — the appendix used `r.SPF === 'Pass'` and `r.DKIMStatus === 'Pass'` to count passing domains, but the data fields contain raw SPF records and `OK`/`Not configured` for DKIMStatus. The card always reported `0/N passing` even when the top-of-report DNS panel showed correct counts. Aligned predicates with `DnsAuthPanel`
- **Finding-detail Current value outline now reflects status (refs #674)** — was always red regardless of status, so a Pass finding's Current value visually read as failing. Now color-coded per tier: Pass green / Fail red / Warning amber / Review accent / Info muted. Recommended outline unchanged (always green — it's the target state)
- **Level chip text "L2 ⊇ L3" was backwards (#844)** — already removed in #855's framework redesign; audit confirms no remaining text states it. `docs/LEVELS.md` enshrines the corrected semantic

## [2.9.2] - 2026-04-27

Polish release: HTML report layout cleanup, XLSX matrix readability, and a `-SaveBaseline` UX papercut. One **breaking change** to a parameter type (see Changed).

### Added
- **ScoringViews section header (#835)** — the scoring-tabs panel now has a proper `01c · Scoring` eyebrow + `Posture views by audience` h2 above it (was a "naked" tab strip with no section context). Big % number is color-coded by tier: ≥80 green, 60–79 amber, <60 red, using the theme-safe `--success-text` / `--warn-text` / `--danger-text` palette across all 4 themes. New `<section id="scoring">` anchor enables sidebar deep-linking
- **`-BaselineLabel` parameter on `Invoke-M365Assessment` (#809)** — optional custom label paired with the new switch-form `-SaveBaseline`. Pre-existing `auto-<timestamp>` naming via `-AutoBaseline` is unchanged

### Changed
- **`-SaveBaseline` is now a `[switch]` (BREAKING, #809)** — `-SaveBaseline 'mylabel'` no longer works; migrate to `-SaveBaseline -BaselineLabel 'mylabel'`. The bare `-SaveBaseline` form now auto-labels as `manual-<timestamp>`. Why the breaking shape: PowerShell parameter binding does not allow a single non-switch parameter to accept BOTH the bare flag form AND a string-value form; the two-parameter shape is the only PowerShell-legal way to honor the bare-`-SaveBaseline` request
- **Compliance Matrix XLSX `Horizon` column renamed to `Sequence` (#840)** — Pass-status rows now show `Done` (was empty) with green color-coding matching the Pass status cell. Source data unchanged so the Remediation Roadmap sheet still excludes Pass rows correctly
- **Permissions panel moved from top-of-report to Appendix (#834)** — was wedged between the Domain rollup and findings table; now renders as a card alongside Tenant / MFA / CA in `Appendix · tenant`. The `id="permissions"` deep-link anchor is preserved
- **Sidebar Domains demoted from top-level group to collapsible sub-tree under Findings & Action (#836)** — the per-domain entries are filter shortcuts into the findings table, not separate destinations, so they read more truthfully nested under FINDINGS & ACTION. `Domain posture` link under EXECUTIVE (separate destination) is preserved

### Fixed
- **FilterBar sticky pin no longer follows the user past the findings section (#838)** — `.filter-bar-active`'s `position: sticky` was scoped to the App's main scroll container and stayed pinned through Roadmap, the Permissions card, and Tenant Appendix. Now gates the sticky class on the App's existing scrollspy signal (`active === 'findings'`) so the bar releases when the user scrolls past the table. Reuses the IntersectionObserver already driving sidebar highlighting; no new event listeners

## [2.9.1] - 2026-04-26

Hotfix to v2.9.0. Caught by live-tenant validation post-tag — the underlying lesson is also addressed by a new `.claude/rules/releases.md` rule requiring live verification before any future tag/publish.

### Fixed
- **HTML report rendered as a blank black screen** when `window.REPORT_DATA.permissions.sections.<X>.required` came back empty. `ConvertTo-Json` round-trips empty arrays as `null` and single-element arrays as bare scalars; the new `PermissionsPanel` React component (#812 / v2.9.0) called `.join()` on the field directly. Empty `required: []` for sections like `Email` (which uses EXO, not Graph) became `null`, the call threw, and React unmounted the entire app tree. Fixed by routing all three array fields (`required`, `missing`, top-level `missing`) through an `asArray` coercion helper inside the component
- **HTML report generation silently failed when `-AutoBaseline` was supplied.** PowerShell's parser interpreted `New-Object -TypeName System.Collections.Generic.Dictionary[string, System.IO.DirectoryInfo]` (introduced in C1 #780 / v2.9.0) as an array literal — the comma between the two type parameters became the array operator, producing `Cannot convert 'System.Object[]' to the type 'System.String' required by parameter 'TypeName'` at runtime. Switched to `::new()` which parses the type literal unambiguously. Added the previously-missing `tests/Common/Get-BaselineTrend.Tests.ps1` regression suite — the bug slipped through because the function had zero Pester coverage and the runtime parse only fails inside the `Build-ReportData` -> `Build-SectionHtml` -> `Get-BaselineTrend` call stack
- **Report-generation failures no longer get swallowed silently.** The `catch` block in `Invoke-M365Assessment.ps1` now also calls `Write-Warning` and points at the log file path, instead of writing only to the assessment log. A consultant running a 5-minute assessment shouldn't have to grep the log to discover the report didn't generate

## [2.9.0] - 2026-04-26

The **Trust Hardening** release. Surfaced by an external review on 2026-04-25; closed all 30+ child issues + the parent epic (#766) over Sprints 1-9.

### Added
- **Standardized evidence schema (D1 #785)** -- 8 optional fields on `Add-SecuritySetting` (`ObservedValue`, `ExpectedValue`, `EvidenceSource`, `EvidenceTimestamp`, `CollectionMethod`, `PermissionRequired`, `Confidence`, `Limitations`). Promotes the report appendix from a raw-JSON blob to a structured `EvidenceTable` React component. New "Evidence Details" sheet in the XLSX matrix. 5-collector proof-of-pattern migration. New `docs/EVIDENCE-MODEL.md` field reference + migration cookbook
- **Sanitized evidence package (D4 #788)** -- new `-EvidencePackage` and `-Redact` switches on `Invoke-M365Assessment`. Bundles HTML + XLSX + structured findings + permissions summary + run metadata + SHA-256 manifest as a ZIP suitable for auditor handoff. Deterministic SHA-256-truncated hash tokens replace UPNs (`<user-a3f81b29>`), IPs, GUIDs, tenant display name -- same input always produces the same token across the package, preserving join keys for cross-finding correlation. New `docs/EVIDENCE-PACKAGE.md`
- **License-adjusted scoring views (D2 #786)** -- 6-tab toggle on the executive-summary panel. Headline strict-rule Pass% in the score card stays invariant; tabs are exploration tools for different audiences (CISO / audit lead / account exec / MSP technician / sales engineer / auditor). New `docs/SCORING.md` documents per-view denominators
- **Remediation export formats (D3 #787)** -- new public `Export-M365Remediation` cmdlet writes GitHub Issues markdown (one .md per finding + bulk `create-issues.sh` helper), executive-summary markdown, Jira CSV, and a technical-backlog markdown table. Reads existing assessment artifacts; does NOT re-run the assessment. Sample outputs in `docs/samples/remediation-exports/`
- **Behavioral test suite (C5 #784)** -- 29 Pester tests in `tests/Behavior/` covering permission-map consistency, status normalization, check-ID uniqueness, report-math denominator, baseline drift, QuickScan filter, cloud env mapping, module compatibility downgrade, evidence schema regression guard, wrapper-deprecation guard
- **Linux/macOS cross-platform smoke lane (B6 #777)** -- new advisory CI job. Catches platform-shaped bugs (path separators, Linux case-sensitivity, line endings) without paying the heavy install cost of the full Microsoft.Graph SDK on each runner
- **Mocked Graph/EXO fixture infrastructure (D5 partial #789, #822)** -- `tests/Fixtures/{Graph,Exchange,Intune,Reports}/` with JSON snapshots; per-collector fixture-driven test pattern. Infrastructure-only ship; per-collector migration deferred to future minor releases
- **HTML Permissions panel (#812 B2 followup)** -- `Test-GraphPermissions` writes `_PermissionDeficits.json`; `Build-ReportData` surfaces it; new React `PermissionsPanel` component renders a per-section deficit table. Also populates the previously-stub `permissions-summary.json` in evidence packages
- **Release-candidate workflow (#722)** -- pushes to a `release-candidate` branch auto-tag `vX.Y.Z-rc.N` (auto-incrementing). Existing `release.yml` machinery handles them as GH pre-releases (PSGallery publish skipped for `-` tags)
- **Sovereign cloud support matrix (C2 #781)** -- new `docs/SOVEREIGN-CLOUDS.md`
- **React provenance + license attribution (C4 #783)** -- new `docs/REPORT-FRONTEND.md`; `npm audit --audit-level=high` advisory CI step; committed `THIRD-PARTY-LICENSES.md`
- **Data Handling deep dive (A4 #770, F2 #792)** -- new `docs/DATA-HANDLING.md`; pointers from README and `SECURITY.md`
- **REPORT_DATA schema reference (F5 #794)** -- new `docs/REPORT-SCHEMA.md`
- **Contributor guides (F6 #795, F7 #796)** -- new `docs/TESTING.md` + new `docs/RELEASE-PROCESS.md`
- **Baseline storage normalized to tenant GUID (C1 #780)** -- baseline folders keyed by tenant GUID rather than mixed display name / domain prefix. Read-fallback preserves legacy folders during migration
- **Trust-hardening label set** in the GH issue vocabulary

### Changed
- **Wrapper API surface (C3 #782)** -- 13 legacy `Get-M365*SecurityConfig` / `*RetentionConfig` wrappers now emit a once-per-session `Write-Warning` deprecation notice naming v3.0.0 as the removal target and pointing to the `Invoke-M365Assessment -Section <name>` replacement. Wrappers stay exported in v2.9.x; full removal ships in v3.0.0
- **CI quality gates (B5 #776)** trigger on doc edits that gate version consistency (`README.md`, `CHANGELOG.md`, `docs/**`, etc.) via a lighter docs-gates job
- **Connection profile path (B1 #772)** -- moved out of module root to a per-user app-data path with read-fallback for legacy locations
- **First-class data-state rendering (B8 #779)** -- `NotApplicable`, `NotLicensed`, `Skipped`, `Unknown` get explicit treatment + counts in HTML report, XLSX matrix, executive summary, framework totals, remediation roadmap, drift comparison
- **App-only Graph permission validation (B2 #773)** -- queries the running SP's app-role assignments against required roles per selected `-Section`; emits per-section deficits in console + structured `_PermissionDeficits.json`
- **Status taxonomy (B3 #774)** -- `Add-SecuritySetting` ValidateSet now includes `NotApplicable` and `NotLicensed`
- **Generated permissions matrix (B7 #778)** -- `docs/PERMISSIONS.md` is now generated from `AssessmentMaps.ps1` + `PermissionDefinitions.ps1`. CI step fails any PR that modifies the source maps without regenerating the doc

### Fixed
- README "What's New" header was stale (A1 #767)
- Stale `.m365assess.json` validation note: confirmed already in `.gitignore` (A3 #769; closed-on-arrival)

### Notes
- **PowerShell `[ValidateRange]` rejects `$null` even on `[Nullable[double]]` params**, so the `Confidence` field's range check is implemented inside the helper body rather than via decorator
- **Redaction-order subtlety**: email/UPN redaction runs before tenant-name redaction. Reversing the order would partially-redact `admin@contoso.com` to `admin@<tenant>.com` and leave the address undetectable by later regexes
- **Pester 5 substitutes `<token>` in `It` titles**, so test names use plain ASCII to avoid the implicit data-placeholder syntax
- **Two-stage wrapper deprecation** (v2.9 warns + still exports, v3.0 removes) chosen over the locked plan's single-stage approach because removing a function and adding a warning to it are mutually exclusive

## [2.6.0] - 2026-04-25

Combined release covering the v2.5.0 (closed 2026-04-24) and v2.6.0 -- Finding Interaction (closed 2026-04-25) milestones.

### Added
- Smart search in the findings table: pressing Enter cycles through matches (Shift+Enter reverses), an inline `N/M` counter shows position, Esc clears. Active match auto-expands and scrolls into view; previously cycled-to row auto-collapses to keep the table tidy. Reuses the existing `focusFinding` + `highlight-focus` infrastructure (#697)
- Every top-level section header in the report is now collapsible. New `useCollapsibleSection` hook applied to Posture trend, Framework coverage, Findings table, Roadmap, Stryker, and Appendix. `beforeprint` listener auto-expands so PDF/print exports never lose collapsed content. Plain `useState` per the existing no-localStorage policy (#737)
- New `Get-RemediationLane` PowerShell helper in `Common/` is the single source of truth for Now/Next/Later lane bucketing. Build-ReportData precomputes `lane` onto each finding; HTML report and XLSX export both read it instead of duplicating bucketing rules (#715)
- XLSX export gains a **Horizon** column on the Compliance Matrix sheet (color-coded Now=red, Next=amber, Later=blue; empty for Pass) and a new dedicated **Remediation Roadmap** sheet -- one row per actionable finding, grouped by Now/Next/Later, sorted within each group by severity then CheckId. Closes the parity gap with the HTML report's roadmap (#715)
- New `Effort` column on the Compliance Matrix sheet surfacing the registry-derived effort estimate (#715)
- Framework coverage panel CTA shows the filtered count when one or more level chips are active: `View N of TOTAL findings matching L1 + E3 ->`. Reuses the existing `matchProfileToken` helper (#748)
- Inline `L2 contains L3` indicator chip on the CMMC chip row with hover tooltip clarifying that every L3 control is also assessed at L2 by design (verified by probe: zero L3-only-by-controlId checks exist in v2.22.1+ registry) (#744)
- Framework cards in the Framework Quilt carry a rotating chevron affordance in their top-right corner plus keyboard accessibility (`role="button"`, `aria-expanded`, Enter/Space to toggle, `:focus-visible` outline) and a more visible hover state (#743)
- FilterBar Level row appears for CIS M365 as well as CMMC, with L1 / L2 / E3 / E5 only chips. Chips write to the same `filters.profile` field used by the Framework Quilt panel chips, so selecting a level in either place lights up the other (#740)
- CMMC complete posture view in the Framework Quilt -- the CMMC detail panel surfaces EZ-CMMC handoff gaps (out-of-scope / partial / coverable / inherent) alongside the existing L1/L2/L3 coverage stats. `REPORT_DATA.cmmcHandoff` and `REPORT_DATA.cmmcCoverage` are part of the report data contract. `sync-checkid.yml` pulls the handoff artifact on every scheduled sync (#594)
- Clickable CMMC and CIS profile chips in the Framework Quilt expanded panel toggle each level's membership in `filters.profile` (multi-select). The findings table filters to checks whose `fwMeta[fw].profiles` matches at least one active token; the panel's Coverage by Domain bars re-compute against the same filter so the chart and findings stay consistent (#730, #731, #736)

### Changed
- Posture trend section is now opt-in via `-IncludeTrend` on `Invoke-M365Assessment` (threaded through Export-AssessmentReport -> Build-ReportData -> `window.REPORT_DATA.trendOptIn`). Baselines still auto-save for drift comparison; only the trend section visibility is gated. Default behaviour: no trend section unless explicitly requested (#750)
- Remediation block in the findings detail panel splits PowerShell commands from portal navigation steps. New `.remediation-ps` (code-style with violet "PowerShell" label) and `.remediation-portal` (prose with accent "Portal" label) blocks; segments preserve original order but never share a line (#687)
- Roadmap card visual polish: lane-level color tint via `:has()` selector (Now=danger, Next=warn, Later=accent), stronger solid divider between guidance and metadata blocks, severity tag adopts chip palette colors, Learn more block gets accent border (#686)
- Remediation roadmap default lane distribution rebalanced: Warnings and Reviews land in Later by default unless their severity is critical; only Fail-status findings earn a spot in Now / Next. Observed effect on reference tenant (147 tasks): Now 18 / Next 52 (was 126) / Later 77 (was 3) (#709)
- Framework coverage panel is expanded by default on report load; first visible framework opens automatically so L1/L2 chips and Coverage by Domain bars are immediately visible (#735)
- FilterBar FRAMEWORK and DOMAIN dropdowns cluster at the left of their row instead of being pushed apart by a flex-grow rule (#741)
- 12px vertical spacing added between the Executive Summary tile row and the critical-findings banner below it (#742)
- `sync-checkid.yml` declares its CheckID release channel explicitly. Subscribes to the **stable** channel only; defense-in-depth verify-channel step fails the workflow if a preview-channel payload is received. Aligns with the cross-repo channel model from CheckID v0.1
- Removed the local `Get-CmmcLevelsFromControlId` override in `Build-ReportData.ps1` now that CheckID v2.22.1 publishes identity-semantic `frameworks.cmmc.profiles` upstream. Downstream code consumes registry values directly with zero behavioural change
- Dropped "EZ-CMMC" project name from the Handoff gaps panel heading and footnote text in the report. Heading reads `Handoff gaps`; footnote ends `tracked separately.` Counts and chip behaviour unchanged (#732)
- CheckID registry synced to v3.0.0 (additive `frameworks.X.source` field on per-framework mappings; no breaking changes for M365-Assess; all 1106 checks preserved including local extensions)

### Fixed
- Posture trend was silently filtering baselines by tenant GUID while `Invoke-M365Assessment` saves baselines with the tenant domain as the folder-name suffix. `Build-SectionHtml.ps1` now prefers the tenant's `DefaultDomain` from the tenant CSV over the log-derived short-form prefix or the GUID (#733)
- CMMC Level 1 and Level 2 coverage counts were identical on every tenant because CheckID's `registry.json` uniformly tagged every CMMC-mapped check with `profiles=[L1,L2]`. Build-ReportData now derives profiles from the `controlId` string. Observed effect on reference tenant: L1 drops from 233 to 118; L2 and L3 unchanged (now also resolved upstream in CheckID v2.22.1)

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
