# Owner / Ticket interaction spec — finding-detail Phase 5

Resolves the open design questions raised in issue #903. Phase 5 of #863 (finding-detail Direction D redesign) implements the Owner and Ticket cells in the state strip; this spec locks down the v1 / v2 split for each open question so implementation has clear targets.

## Schema additions to `REPORT_OVERRIDES`

```jsonc
window.REPORT_OVERRIDES = {
  // ... existing keys: hiddenFindings, hiddenElements, roadmapOverrides

  // #903 (NEW in v2.11.x or v2.12.x — Phase 5 of #863):
  schemaVersion: 2,
  findingOwners: {
    "ENTRA-MFA-001":   "Daren Maranya",
    "EXO-FORWARD-001": "Alice Chen"
  },
  findingTickets: {
    "ENTRA-MFA-001": { system: "Jira", id: "PROJ-1234", status: "In progress" }
  }
};
```

`schemaVersion: 2` flags the new shape so future migrations are explicit. Existing `REPORT_OVERRIDES` blobs without a `schemaVersion` are treated as `1` and the new keys default to `{}`.

## Resolved decisions (the 7 from #903)

### Q1 — Owner: free-form string vs autocomplete from a known list?

**v1: free-form string only.** Renders as the typed value with avatar initials computed from the first 2 chars of the first word.

**v2 deferred:** Autocomplete from a curated per-tenant list of known consultants. Source TBD — could be a `REPORT_OVERRIDES.knownOwners[]` array the user populates, or a pull from the tenant's user directory (privacy concern; Owner is M365-Assess-side metadata, not tenant data).

**Rationale:** Free-form is the simplest defensible v1. Autocomplete adds a configurability surface that's not worth the complexity until there's friction.

### Q2 — Multiple owners per finding allowed?

**v1: no.** One owner per finding, stored as a string.

**v2 deferred:** Could move to `findingOwners[checkId]: string[]` if real multi-owner workflows emerge. Mostly rare in practice — one consultant typically owns a finding through to remediation.

### Q3 — Ticket status — track or not?

**v1: yes, but as a free-form dropdown selection.** Status options: Open / In progress / Done / Blocked. Stored alongside system + id. Used purely for visual display — no logic depends on it.

**Rationale:** Tracking status takes zero additional cognitive load (one dropdown) and gives the consultant useful at-a-glance "did the ticket close?" awareness. Better to ship with it than retrofit later.

**Out of scope:** Polling actual ticket systems for live status. The status field is what the consultant manually sets — it'll drift from the real ticket. The drift is a feature, not a bug — it's the consultant's working memory of the ticket state, not a sync target.

### Q4 — Inline overlay vs modal vs sidebar for the edit flow?

**v1: inline overlay.**

For Owner: text input pops over the cell on click of `Assign`, replacing the cell content for the input duration. ESC cancels; Enter / blur saves.

For Ticket: a small 3-field overlay (system / id / status) renders inline, dropping below the cell. Save button confirms; Cancel discards.

**Rationale:** Matches the lightweight pattern from `<HideableBlock>` (#712). A modal would be more discoverable but heavier; the in-place edit signals "this is editable workflow metadata" without breaking flow.

### Q5 — Pass-status findings — should they show Owner / Ticket cells at all?

**v1: hide the Owner / Ticket cells when status === 'Pass'.**

The state strip becomes a 3-cell layout (Sequence · Effort · Affected) for Pass findings, dropping the trailing two cells.

**Rationale:** Pass findings don't need remediation, so assignment doesn't apply. Showing greyed-out cells adds visual noise without value. If a customer wants an "audit trail" of "this Pass finding was verified by X on date Y" — that's a separate evidence/attestation concern (#875), not the Owner/Ticket flow.

### Q6 — Hidden findings — does owner/ticket survive?

**v1: yes.** When a finding is hidden via HideableBlock (#712), its owner/ticket data stays in `REPORT_OVERRIDES`. Un-hiding restores the full state.

**Rationale:** Hidden ≠ removed. The user may un-hide later, and losing assignment metadata on hide-then-restore is a frustrating bug. The cost (the override blob carries some unused entries when findings are hidden) is negligible.

### Q7 — `REPORT_OVERRIDES` schema versioning

**v1: add `schemaVersion: 2` field.**

Migration: when reading a finalized HTML, if `schemaVersion` is missing, treat it as 1 and initialize the new keys (`findingOwners`, `findingTickets`) to `{}`. Future schema bumps follow the same pattern.

**Rationale:** v1 of `REPORT_OVERRIDES` was versionless. Adding a `schemaVersion` field now makes future migrations explicit — when v3 lands (perhaps for a new metadata key) the loader knows what to default vs. what to expect.

## Out-of-scope decisions (deliberately not specified)

- **URL-aware ticket links.** v1 stores `system + id + status` as text; rendering the ticket as a clickable link to the actual ticket system requires a base-URL configuration per system per tenant. Possible v2: `REPORT_OVERRIDES.ticketSystemUrls[system] = "https://..."` with `{id}` substitution. Not blocking v1 — the consultant can copy the ID and paste into their ticketing tool.
- **Owner avatar source.** v1 uses the first 2 chars of the first word as the avatar text (`"Daren Maranya"` → `"DA"`). Real avatar images, gravatar lookups, etc. are v2.
- **Bulk-assign UI** (assign 10 findings to one owner at once). Not in v1; the per-finding click-to-assign flow scales fine for a single consultant working through a list.
- **Notification on owner change.** No emails / webhooks / Slack pings. v1 is purely client-side metadata.

## Implementation pointers

When Phase 5 is scheduled:

- `src/M365-Assess/assets/report-app.jsx` — `<FindingStateStrip>` component. Replace the placeholder Owner / Ticket cells with edit-mode-aware components:
  - `<OwnerCell f={f}/>` — renders owner from `REPORT_OVERRIDES.findingOwners[f.checkId]`; click `Assign` in edit mode → inline text input
  - `<TicketCell f={f}/>` — renders ticket from `REPORT_OVERRIDES.findingTickets[f.checkId]`; click `+ Create ticket` in edit mode → 3-field overlay
- `EditModeContext` (already exists from #712) — extend to expose `setOwner(checkId, name)` and `setTicket(checkId, ticket)` actions
- `finalizeReport` (existing) — already reads / writes `REPORT_OVERRIDES`; add `findingOwners` and `findingTickets` to the persisted shape, plus the `schemaVersion: 2` field
- Pass-status hide rule: in `<FindingStateStrip>`, gate the Owner / Ticket cells on `f.status !== 'Pass'`
- `docs/user/REPORT-USER-GUIDE.md` — add an Owner / Ticket assignment subsection under "Edit mode walkthrough"

## See also

- Issue #903 (this spec resolves)
- Issue #863 (parent: finding-detail redesign Direction D — Phase 5 implementation)
- `docs/design/finding-detail/direction-d.jsx` — the canonical design reference for the visual treatment
