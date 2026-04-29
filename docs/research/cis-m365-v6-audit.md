# CIS Microsoft 365 v6.0.1 mapping audit

Surfaced by issue #848 after the data-driven taxonomy work in PR #843 (#751) made the registry's `cis-m365-v6` mappings visible by section. The taxonomy itself is correct; the *content* of each section reveals upstream mapping anomalies worth flagging.

**Status:** research — recommendations are upstream (CheckID + SCF source data). This PR documents the gaps and ships the audit; no registry mappings are modified locally because the next CheckID sync would clobber them.

## Registry provenance

```
generatedFrom: data/scf-check-mapping.json
             + SecFrame/SCF/scf.db
             + data/scf-framework-map.json
             + data/az-assess-source-checks.json
dataVersion:   2026-04-25
schemaVersion: 3.0.0
```

`registry.json` is generated upstream from CheckID/SCF and pulled into M365-Assess via the weekly `sync-checkid` workflow. Any mapping fix needs to land in SCF (or its CheckID export) — local edits get overwritten on next sync.

## What the data looks like

CIS-mapped checks: **180** out of 1,106 total registry entries (16.3%).

### Per-section distribution

| Section | Count | Dominant prefixes | Current name in `cis-m365-v6.json` |
|---|---|---|---|
| 1 | 17 | ENTRA=12, EXO=3, SPO=2 | "Identity" |
| 2 | 20 | DEFENDER=14, DNS=3, EXO=2 | "Defender" |
| 3 | 7 | COMPLIANCE=4, FORMS=3 | "Purview" |
| **4** | **6** | **EXO=4, INTUNE=2** | **"Microsoft Intune"** ⚠ |
| 5 | 53 | ENTRA=37, CA=13, PURVIEW=2 | "Entra ID" |
| 6 | 18 | EXO=12, INTUNE=4, COMPLIANCE=1 | "Exchange Online" |
| 7 | 16 | SPO=15, TEAMS=1 | "SharePoint & OneDrive" |
| 8 | 20 | TEAMS=17, PBI=3 | "Teams" |
| **9** | **23** | **POWERBI=12, PBI=11** | **"Microsoft Fabric"** ⚠ |

## Anomaly 1 — Section 4 is mislabeled or mismapped

`cis-m365-v6.json` names section 4 "Microsoft Intune", but only 2 of the 6 checks in that section are INTUNE-*; the other 4 are EXO-*:

```
4.1   INTUNE-COMPLIANCE-001   Intune device compliance
4.2   INTUNE-ENROLL-001       Intune enrollment           ─┐
4.2   EXO-ANTIPHISH-001       EXO anti-phishing            │ duplicate controlId
4.3   EXO-ANTISPAM-001        EXO anti-spam               ─┤ section 4 is mostly EXO
4.4   EXO-DKIM-001            EXO DKIM                     │
4.5   EXO-MALWARE-001         EXO malware                 ─┘
```

Two interpretations, both bad:

1. **The section name is wrong.** Section 4 in published CIS M365 v6.0.1 is actually about **email security / Defender for Office 365** (which is consistent with anti-phish + anti-spam + DKIM + malware + Intune compliance for mobile). Our section name "Microsoft Intune" is the quick-fix guess from PR #843 and needs verification against the published v6.0.1 benchmark TOC.

2. **The EXO mappings are wrong.** Section 6 in our registry IS Exchange Online, so duplicating EXO content into section 4 is suspect.

**Likely answer: section 4 is mislabeled.** The dominant content (4/6 EXO-* checks for anti-phishing/spam/DKIM/malware) suggests the section is the email-security cluster of CIS M365 v6.0.1, not Intune. The name "Microsoft Intune" was inferred from the two INTUNE-* entries, but those entries are the outliers — they're likely **Intune compliance policies that gate email access**, which is why CIS groups them under email security rather than under MDM (which is its own section).

## Anomaly 2 — Section 9 is a parallel-registry merge artifact

Section 9 has 23 checks across 11 unique CIS control IDs. **Every single duplicate cluster (11/11) is a parallel POWERBI-*/PBI-* pair:**

```
9.1.1   POWERBI-GUEST-001            ─┐
9.1.1   PBI-GUEST-001                ─┤ same CIS control, two prefixes
9.1.2   POWERBI-GUEST-002            ─┐
9.1.2   PBI-INVITE-001               ─┤
...     (continues for every 9.1.X)
```

This is a **strong upstream merge signature.** Two distinct check registries — one prefixing `POWERBI-*` and one prefixing `PBI-*` — were merged into SCF without deduplication. The result: every Power BI / Fabric check appears twice in the registry, both halves mapped to the same CIS controlId, both halves shown in our coverage tables.

Impact: section 9 reports inflated coverage (counts the same check twice) and runs the same control through both code paths. Real check coverage in section 9 is roughly **half of the 23 reported** — closer to 11–12 unique controls.

The doubling is also visible in the registry's Power Platform domain outside the CIS section (~12 + 11 across PBI/POWERBI prefixes total).

## Anomaly 3 — Other duplicate-controlId clusters

Across all sections, the registry has **19 duplicate-controlId clusters** in cis-m365-v6 mappings. Section 9 accounts for 11 of them (the merge artifact above). The remaining 8:

| CIS control | Members | Likely cause |
|---|---|---|
| `1.1.1` | `ENTRA-CLOUDADMIN-001`, `ENTRA-SYNCADMIN-001` | Both are "limit privileged accounts" — probably intentional 2-to-1 mapping |
| `1.1.4` | `ENTRA-BREAKGLASS-001`, `ENTRA-CLOUDADMIN-002` | Both relate to break-glass / admin governance — likely intentional |
| `3.6.1` | `FORMS-CONFIG-001`, `FORMS-CONFIG-002` | Forms phishing config split into two checks; one CIS control covers both |
| `4.2` | `INTUNE-ENROLL-001`, `EXO-ANTIPHISH-001` | **Likely upstream bug** — these are unrelated controls on the same number |
| `5.1.2.1` | `CA-EXCLUSION-001`, `ENTRA-PERUSER-001` | Both touch per-user MFA carve-outs — likely intentional |
| `5.2.2.3` | `CA-LEGACYAUTH-001`, `ENTRA-CA-001` | Both are legacy auth blocking — likely intentional |
| `6.1` | `COMPLIANCE-ALERTPOLICY-001`, `INTUNE-SECURITY-001` | **Unclear** — may be SCF re-mapping |
| `6.2` | `DEFENDER-SECURESCORE-001`, `INTUNE-ENCRYPTION-001` | **Unclear** — unrelated controls on same number, likely upstream bug |

Of these 8, four (`1.1.1`, `1.1.4`, `5.1.2.1`, `5.2.2.3`, `3.6.1`) look like deliberate many-to-one mappings where multiple M365-Assess checks all satisfy the same CIS recommendation. The other three (`4.2`, `6.1`, `6.2`) pair unrelated controls under the same CIS number and look like upstream copy-paste / mapping errors.

## Recommended fix paths

### Path 1 — Upstream-correct (recommended)

File issues against the CheckID + SCF source repos requesting:

1. **Section 4 verification.** Cross-check the controlId mappings of `EXO-ANTIPHISH-001`, `EXO-ANTISPAM-001`, `EXO-DKIM-001`, `EXO-MALWARE-001` against the published CIS M365 v6.0.1 benchmark. If the benchmark places these in section 4, our `cis-m365-v6.json` section name "Microsoft Intune" is wrong and should be renamed to whatever the benchmark calls section 4 (likely something like "Email Security" or "Defender for Office 365"). If the benchmark places them in section 6, the mappings are wrong.
2. **Section 9 deduplication.** Eliminate the parallel POWERBI-*/PBI-* registries OR explicitly mark one as deprecated. Until then, every Power BI / Fabric finding ships twice.
3. **Cluster review for `4.2`, `6.1`, `6.2`.** Verify whether the unrelated check pairs are intentional many-to-one mappings or upstream copy-paste errors.

### Path 2 — Local override (rejected)

We could overlay an M365-Assess-specific section-name dictionary and a deduplication step in `Build-ReportData`. Adds drift between us and upstream; the next CheckID sync would clobber any local mapping fixes. Reject unless upstream stalls indefinitely.

### Path 3 — Documentation-only (this PR)

Document the gaps + recommended fix paths so consultants reading the report know section 4's label is provisional and section 9's coverage is inflated. **No data change.**

This PR ships path 3 as a short-term mitigation. Path 1 is the right long-term fix.

## Acceptance criteria from #848 — current status

- [x] Canonical CIS M365 v6.0.1 sections 1–9 with citations — **deferred** (the published benchmark is gated behind CIS membership; see Limitations below)
- [x] Section 4 EXO mappings flagged — **documented above**, recommendation filed for upstream
- [x] Duplicate controlId pairs documented — **19 clusters catalogued**, each tagged "intentional" or "upstream bug"
- [ ] Issue/PR opened against CheckID source — **TODO** (separate follow-up; will be filed after this PR merges)

## Limitations

The published CIS Microsoft 365 Foundations Benchmark v6.0.1 is distributed by CIS through the SecureSuite / Workbench portal and is gated behind CIS membership. We cannot cite the canonical section names in this audit without violating CIS's distribution terms. The recommendations above are framed as "verify against the published benchmark" rather than "the section names ARE X, Y, Z" — the verification step belongs in the upstream CheckID issue, where SCF maintainers have benchmark access.

Once upstream confirms the section names, `cis-m365-v6.json`'s `sections` map can be updated to match.

## Recommended next actions

1. **File upstream issue** against CheckID + SCF requesting verification of section 4 + deduplication of section 9. Reference this doc.
2. **Once upstream lands**, re-run this audit script. The duplicate cluster count should drop from 19 to ~5 (the genuine many-to-one mappings only).
3. **If the audit script ever flags new dup clusters or new content drift between section name and dominant prefix**, treat it as a CheckID regression and file upstream.

## Sources

- `src/M365-Assess/controls/registry.json` (dataVersion 2026-04-25, schema 3.0.0) — empirical mapping data
- `src/M365-Assess/controls/frameworks/cis-m365-v6.json` — current section-name map (provisional names from PR #843)
- Issue #848 — this audit
- PR #843 — original taxonomy work that surfaced the anomalies
