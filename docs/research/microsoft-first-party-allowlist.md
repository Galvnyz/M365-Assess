# Microsoft first-party app + owner-tenant allowlist

Surfaced by issue #887 after two false-positive incidents in the v2.10.x sprint where ENTRA-ENTAPP-020 ("Foreign Apps Impersonating Microsoft Names") flagged legitimate Microsoft-published service principals as impersonators (#880, #885 — extended to 4 owner tenants).

The owner-tenant-only allowlist approach was fragile by design — Microsoft adds new publisher tenants for new product lines, and each missed tenant produces a false positive in customer reports until empirical observation surfaces it.

## What this PR ships

`src/M365-Assess/controls/microsoft-first-party-appids.json` — a data file with two parallel allowlists:

1. **`appIds[]`** — ~280 known Microsoft first-party AppIds. v1.1 mirrors the canonical Microsoft-published list at [Power Platform admin · Commonly used Microsoft first-party services and portal apps](https://learn.microsoft.com/en-us/power-platform/admin/apps-to-allow) plus a handful of empirically-discovered additions (Connect-MgGraph SP, EXO REST API PowerShell, Graph PowerShell SDK alt — these are SDK-tooling apps not on the Power Platform admin list).
2. **`ownerTenantIds[]`** — 4 known Microsoft publisher tenant GUIDs (Microsoft Services, Microsoft Corp, the narrower Defender-flavored one, Microsoft Graph Command Line Tools).

ENTRA-ENTAPP-020 now matches **AppId first, owner-tenant second**. Any SP whose AppId is on the list passes through immediately; remaining SPs fall through to the owner-tenant check; only those failing both are candidates for the "impersonator" check (which then applies the displayName-pattern match against `microsoft *`).

## Why AppId-first

- **Owner tenants change.** Microsoft has reorganized internal tenant ownership for some app lines historically. AppId is a permanent identifier tied to the app registration; it doesn't change when the publisher tenant changes.
- **AppId list is data, not code.** A new false-positive surfaces → add the AppId to the JSON → ship a patch. No collector code changes needed.
- **Cross-customer parity.** The AppId list is the same in every tenant. The owner-tenant of an app is also the same in every tenant — but only IF Microsoft hasn't migrated the app since we last observed it.

## Source provenance

| Source | Confidence | Coverage |
|---|---|---|
| **Microsoft Learn — Power Platform admin docs (`apps-to-allow`)** | High — Microsoft-published, Microsoft-maintained | Bulk of the list (~250 entries) |
| Empirical observation in lab tenants (M365-Assess 2026-04-29) | High — confirmed live | Discovered the dedicated Microsoft Graph CLI Tools owner tenant + Connect-MgGraph SP |
| Microsoft Graph PowerShell SDK source (well-known constants for SPs and resources) | High — Microsoft-published constants | Connect-MgGraph SP, EXO REST API PowerShell SP, Graph resource AppId |

The JSON's `calibrationStatus: "v1.1 — extended from Microsoft canonical list"` flag is honest: this mirrors Microsoft's own published list as of 2026-04-30. Microsoft updates that page periodically — quarterly re-sync recommended.

## What this PR does NOT do

- **Doesn't catalogue every Microsoft first-party app.** Microsoft has hundreds. The list is "most-likely-to-show-up-as-foreign-with-Microsoft-in-the-name", not exhaustive.
- **Doesn't push the data upstream to CheckID.** This is consumer-side hardening; the catalogue is M365-Assess-local data. If other consumers want the same list, the data file can be promoted to CheckID in a future iteration. No SCF / CheckID semantic depends on it.
- **Doesn't add a CI step that diff-checks the list against a Microsoft-maintained source.** Future hardening tracked separately if the manual-curation cadence becomes a problem.

## How to expand the list

When a customer report shows a Microsoft first-party app under "Foreign Apps Impersonating Microsoft Names":

1. Run `Get-MgServicePrincipal -Filter "displayName eq '<flagged name>'" | Select displayName, appId, appOwnerOrganizationId` to confirm the AppId.
2. Verify it's actually Microsoft-published (search the AppId on Microsoft Learn / Roadtools / community lists).
3. Add a new entry to `appIds[]` in `microsoft-first-party-appids.json` with `name`, `purpose`, `ownerTenantHint`.
4. Ship a patch release.

If the SP is from an owner tenant we haven't seen before, also add the new owner-tenant GUID to `ownerTenantIds[]`.

## Related upstream work

The owner-tenant data is M365-Assess-local — does NOT need an upstream CheckID issue. Registry semantic is unaffected.

If a future ENTRA-ENTAPP-020-equivalent check were ever to land in CheckID with shared cross-consumer data, the AppId list might migrate upstream. Out of scope for v2.11.0.
