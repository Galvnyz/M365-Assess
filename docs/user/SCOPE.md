# What M365-Assess covers (and what it doesn't)

A one-page answer to "what does this tool actually do?" for procurement reviews, customer briefings, and onboarding.

For the full per-section detail, see [`RUN.md`](RUN.md). For the report features, see [`REPORT-USER-GUIDE.md`](REPORT-USER-GUIDE.md).

---

## In scope (default)

These sections run on every assessment unless explicitly excluded with `-Section`:

| Section | What it covers |
|---|---|
| **Tenant** | Organization profile, verified domains, security defaults |
| **Identity** | Users, MFA, admin roles, Conditional Access, app registrations, password policy, Entra security config |
| **Licensing** | SKU allocation, assigned vs. consumed seats |
| **Email** | Mailbox config, mail flow, anti-spam / anti-phishing, modern auth, DNS authentication (SPF / DKIM / DMARC), audit settings |
| **Intune** | Managed devices, compliance policies, configuration profiles, CMMC L2 controls (encryption, port storage, app control, FIPS, removable media) |
| **Security** | Microsoft Secure Score, Defender for Office 365, DLP policies, incident readiness (stale admins, CA exclusions, break-glass, device wipe audit) |
| **Collaboration** | SharePoint / OneDrive sharing, Teams meeting policies, Forms data sharing, third-party app restrictions |
| **PowerBI** | 11 CIS 9.1.x tenant settings: guest access, external sharing, publish-to-web, sensitivity labels |
| **Hybrid** | Azure AD Connect / Cloud Sync configuration, drift between on-prem and cloud directory state |

---

## Opt-in (run with `-Section`)

These cost extra time, require additional permissions, or only apply in specific environments:

| Section | When to add it | Notes |
|---|---|---|
| **ActiveDirectory** | On-premises AD environment | Requires RSAT or domain-controller access; produces dcdiag, replication, AD Security reports |
| **SOC2** | SOC 2 Trust Services audit prep | Pulls 30 days of audit-log evidence; produces a readiness checklist for non-automatable criteria |
| **Inventory** | Snapshot of mailboxes / groups / Teams / SPO / OneDrive | Counts only — useful for sizing, not posture |
| **ValueOpportunity** | License utilization + feature adoption | Identifies SKUs paid for but not used |
| **Networking** | Port-connectivity tests to M365 endpoints | Useful when troubleshooting connection failures |
| **Windows** | Local installed-software inventory | Endpoint-side; assumes you're running against a managed device |

---

## Out of scope

If you need any of the below, M365-Assess is the wrong tool:

| Not covered | Why | What to use instead |
|---|---|---|
| **Third-party SaaS** (Salesforce, Workday, ServiceNow, etc.) | M365-Assess connects only to Microsoft 365 APIs | A SaaS posture management (SSPM) platform |
| **Network controls** (firewalls, IDS / IPS, NAC) | Network surface lives outside M365 | A network security posture tool |
| **Endpoint detection content** (EDR rules, SIEM detections) | Detection-content tuning is operational, not configuration audit | Microsoft Sentinel / Defender XDR portals |
| **Custom application configuration** (in-tenant LOB apps) | Custom apps' security posture is org-specific and not standardised | App-specific review |
| **M365 service health** (incidents, advisories) | M365-Assess audits *your* configuration, not Microsoft's service state | Microsoft 365 admin center → Service health |
| **Tenant cost optimization** (license audit beyond utilization) | The ValueOpportunity section flags unused features but is not a procurement tool | Microsoft Cost Management |
| **On-prem Exchange / SharePoint** (non-hybrid) | Tool is cloud-first; only the Hybrid section touches on-prem config | Standalone on-prem tooling |
| **GDPR / HIPAA / PCI compliance verdict** | M365-Assess maps controls to frameworks but doesn't certify compliance | An accredited auditor signs off; M365-Assess feeds the evidence |

---

## A note on framework coverage

M365-Assess maps each finding to **15 compliance frameworks** (CIS Controls v8, CIS M365 v6, NIST 800-53, NIST CSF, CMMC, ISO 27001, ISO 27002, SOC 2, PCI-DSS, HIPAA, FedRAMP, MITRE ATT&CK, STIG, CISA SCUBA, Essential Eight). This **mapping is informational** — useful for evidence packages and audit prep, not a substitute for an auditor's judgement.

A tenant scoring 95% on CIS M365 has not been "CIS-certified"; it has 95% of the controls M365-Assess maps to CIS verified as Pass. Real certification still requires an accredited assessor.

---

## See also

- [`RUN.md`](RUN.md) — full per-section detail with the cmdlets each one runs
- [`REPORT-USER-GUIDE.md`](REPORT-USER-GUIDE.md) — what to do with the output
- [`COMPLIANCE.md`](COMPLIANCE.md) — framework mapping detail
- [`INDEX.md`](../INDEX.md) — back to the docs index
