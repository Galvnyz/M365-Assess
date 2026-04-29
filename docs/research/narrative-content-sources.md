# Narrative content — sources for the "Why It Matters" callout

Surfaced by issue #854 after PR #853 (the Direction-D finding-detail panel) made the generic boilerplate narrative visually prominent.

## What this PR did

Expanded the `whyItMatters(f)` prefix-chain in `src/M365-Assess/assets/report-app.jsx` from ~22 prefixes (with broad `EXO-` and `INTUNE-` catch-alls) to ~70 specific prefix narratives covering:

- All `SPO-*` checks (the previous chain checked `SHAREPOINT-` which **never matched** the registry's `SPO-` prefix — every SharePoint finding fell through to the generic)
- All `DNS-*` checks (SPF, DKIM, DMARC, MX)
- All sub-prefixes of `EXO-*` (FORWARD, AUDIT, OWA, DKIM, AUTH, EXTTAG, MAILTIPS, TRANSPORT, DIRECTSEND, etc.)
- Specific `DEFENDER-*` sub-prefixes (SECURESCORE, SECUREMON, ZAP, CLOUDAPPS, etc.)
- `ENTRA-*` gaps (SECDEFAULT, SSPR, GUEST, PERUSER, ENTAPP, GROUP, SESSION, ORGSETTING, SOD)
- Specific `CA-*` sub-prefixes (LEGACYAUTH, PHISHRES, DEVICE, RISKPOLICY, NAMEDLOC, REPORTONLY, DEVICECODE)
- `INTUNE-*` sub-prefixes (COMPLIANCE, ENCRYPTION, ENROLL, UPDATE)
- `COMPLIANCE-*` sub-prefixes (AUDIT, ALERTPOLICY, DLP, retention/labels)
- `TEAMS-*` sub-prefixes (EXTACCESS, MEETING, APPS)
- All `POWERBI-*` and `PBI-*` Power BI / Fabric prefixes
- `FORMS-*` phishing detection

Order preserved so more-specific prefixes match before generic catch-alls (e.g., `EXO-FORWARD` before `EXO-`).

## Why this scope was carved

Issue #854 originally asked for **per-check** narratives across all ~250 checks × 4 narrative fields (whyItMatters + currentLabel + recommended + remediation). That is multi-week content work. This PR ships per-prefix narratives at the smallest meaningful prefix granularity — one narrative per check family. Long-tail per-check refinement (and the architectural move from JSX prefix-chain to registry-overlay JSON) is tracked as a future content-audit issue.

## Source authority by prefix family

Citations are by family. Each narrative is grounded in the published guidance from at least one of these authorities; specific URLs are intentionally not embedded inline because they evolve and the narrative is a *thesis*, not a quote.

| Prefix family | Primary sources |
|---|---|
| `ENTRA-MFA`, `ENTRA-AUTHMETHOD`, `ENTRA-PERUSER` | Microsoft Learn — *Authentication methods*; CISA *More than a password*; NIST SP 800-63B §5.1 |
| `ENTRA-SECDEFAULT` | Microsoft Learn — *Security Defaults*; CIS M365 v6.0.1 §1 |
| `ENTRA-SSPR` | Microsoft Learn — *Self-Service Password Reset*; CIS M365 v6.0.1 §1 |
| `ENTRA-ADMIN`, `ENTRA-CLOUDADMIN`, `ENTRA-PIM`, `ENTRA-BREAKGLASS`, `ENTRA-STALEADMIN` | Microsoft Learn — *Privileged Identity Management*, *Emergency-access accounts*; CIS M365 §1.1; NIST SP 800-53 r5 AC-2(7), AC-5 |
| `ENTRA-CONSENT`, `ENTRA-APPREG`, `ENTRA-ENTAPP`, `ENTRA-APPS-002` | Microsoft Learn — *Manage user consent*, *Investigate risky OAuth apps*; community: Practical365, AdamFowlerIT consent-phishing posts |
| `ENTRA-GUEST`, `ENTRA-LINKEDIN` | Microsoft Learn — *External collaboration settings*; CIS M365 §1.3 |
| `ENTRA-PASSWORD` | NIST SP 800-63B §5.1.1 (password length + no forced rotation under MFA) |
| `ENTRA-DEVICE`, `ENTRA-HYBRID`, `ENTRA-GROUP`, `ENTRA-ORGSETTING`, `ENTRA-SESSION`, `ENTRA-SOD` | Microsoft Learn — Entra device join, group governance, session controls; CIS M365 §1.5–1.6 |
| `CA-*` (all sub-prefixes) | Microsoft Learn — *Conditional Access* deployment guides; Microsoft *Zero Trust* deployment center; CISA Zero Trust Maturity Model |
| `DEFENDER-ANTIPHISH`, `DEFENDER-SAFELINKS`, `DEFENDER-SAFEATTACH`, `DEFENDER-OUTBOUND`, `DEFENDER-ZAP`, `DEFENDER-ANTIMALWARE`, `DEFENDER-ANTISPAM` | Microsoft Learn — *Defender for Office 365 preset policies*; MS *Recommended secure configurations* |
| `DEFENDER-SECURESCORE`, `DEFENDER-SECUREMON` | Microsoft Learn — *Microsoft Secure Score*; CIS Controls v8 IG1 §17 (incident-response telemetry) |
| `EXO-FORWARD` | Microsoft Learn — *Disable automatic external email forwarding*; FBI IC3 BEC advisories |
| `EXO-AUDIT` | Microsoft Learn — *Manage mailbox auditing*; CIS M365 §6.1.1 |
| `EXO-DKIM`, `DNS-DKIM`, `DNS-SPF`, `DNS-DMARC`, `DNS-MX` | Microsoft Learn — *Email authentication for Microsoft 365*; M3AAWG *Sender Best Common Practices*; dmarc.org |
| `EXO-OWA`, `EXO-MAILTIPS`, `EXO-EXTTAG`, `EXO-AUTH`, `EXO-DIRECTSEND`, `EXO-TRANSPORT`, `EXO-ANTIPHISH`, `EXO-SHAREDMBX`, `EXO-CONNFILTER`, `EXO-LOCKBOX`, `EXO-ADDINS`, `EXO-MALWARE`, `EXO-ANTISPAM`, `EXO-SHARING`, `EXO-HIDDEN` | Microsoft Learn — *Exchange Online* admin guide; community: Practical365, MVP blogs on transport rules + connectors |
| `SPO-*` | Microsoft Learn — *Manage sharing settings*, *Restrict OneDrive sync*; CIS M365 §7 |
| `TEAMS-*` | Microsoft Learn — *Teams external access*, *Meeting policies*, *App permission policies*; CIS M365 §8 |
| `INTUNE-*` | Microsoft Learn — *Intune compliance policies*, *Device-configuration profiles*, *Update rings*; CIS Controls v8 IG1 §4 (secure config) |
| `COMPLIANCE-AUDIT`, `PURVIEW-AUDIT` | Microsoft Learn — *Audit log search*, *Auditing solutions in Microsoft Purview*; FFIEC *IT Examination Handbook* |
| `COMPLIANCE-ALERTPOLICY` | Microsoft Learn — *Alert policies in Microsoft Purview*; MITRE ATT&CK detection guidance |
| `COMPLIANCE-DLP`, `DLP-*`, `PURVIEW-RETENTION`, `COMPLIANCE-LABELS`, `COMPLIANCE-COMMS` | Microsoft Learn — *Data Loss Prevention*, *Retention policies*, *Sensitivity labels*; relevant regulatory texts (HIPAA Privacy Rule, PCI-DSS v4 §3.4, GDPR Art. 32) |
| `FORMS-*` | Microsoft Learn — *Microsoft Forms phishing-detection*; CIS M365 §3.6 |
| `POWERBI-*`, `PBI-*` | Microsoft Learn — *Power BI tenant settings*, *Sensitivity labels in Power BI*; CIS M365 §9 |

## What's still missing (out of scope this PR)

1. **Per-check refinement** — checks within a prefix family share the prefix-level narrative. A v2 audit would write per-checkId narratives (~250 entries) for the highest-value checks.
2. **`currentLabel` improvements** — issue #854 also called out that bare values like `True` in the displayed Current cell aren't semantically clear. Fixing that is a renderer change (not a narrative-content change) and should land in a follow-up.
3. **`recommended` value full-sentence guidance** — same shape as currentLabel, follow-up.
4. **Remediation cmdlet drift** — issue #854 noted some `Update-Mg*` cmdlets have been renamed in recent SDK releases. Cross-checking remediation strings against current cmdlets is its own audit.
5. **Architectural move to registry-overlay JSON** — the issue's preferred long-term architecture (`controls/narrative-overlay.json` with `narrative.whyItMatters` + `narrative.sources[]` per check) is deferred until per-check content actually warrants it.

A follow-up tracker issue should be filed for items 1–4 once this lands.

## Acceptance criteria from #854 — current status

- [x] `Why It Matters` — covered for ~70 prefix groups (was ~22)
- [x] Generic-fallback narrative still exists as the final return — but should rarely fire for any common M365 check
- [ ] `Current value` semantic-clarity refinement — **deferred** to follow-up
- [ ] `Recommended` full-sentence guidance — **deferred** to follow-up
- [ ] Remediation cmdlet cross-check — **deferred** to follow-up
- [ ] Move from JSX prefix-chain to registry-overlay JSON — **deferred** to v2.11+

## Verification

```powershell
Invoke-M365Assessment -ProfileName <your-profile>
```

Open the HTML report → expand any finding → confirm the "Why It Matters" callout is no longer the generic "This control maps to hardening guidance across CIS, NIST, and CMMC..." fallback for the common M365 checks (SPO-SHARING-001, EXO-FORWARD-001, ENTRA-SECDEFAULT-001, DNS-SPF-001, etc.).
