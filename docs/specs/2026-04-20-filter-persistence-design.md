# Filter State Persistence — Design Spec

**Issue:** #634
**Date:** 2026-04-20
**Status:** Approved

## Problem

Active filters (domain, status, severity, framework, profile) are reset on every page refresh. Users must re-apply filters every time they reload the report, which is disruptive when reviewing large finding sets.

## Decision

Persist the `filters` state object to `localStorage` on every change and restore it on mount. Scope the key to the tenant ID so reports from different tenants do not bleed into each other.

## Key design

```
m365-filters-<TenantId>
```

`TenantId` comes from `TENANT.TenantId` (module-level constant already in scope). Falls back to `'default'` if undefined.

## What is persisted

| State | Persisted | Reason |
|---|---|---|
| `filters` (status, severity, framework, domain, profile) | Yes | Intentional user selections |
| `search` | No | Transient — users expect a blank search box on reload |

## Isolation

Using `m365-filters-${TENANT.TenantId}` ensures:
- Reports for the same tenant across refreshes share state correctly
- Reports for different tenants (different TenantId) never share filter state
- All keys share the same origin (file:// or web server) — scoping by TenantId is the correct isolation boundary

## Implementation

### 1. FILTER_KEY constant

Add at module scope (~line 6, after the TENANT constant):

```jsx
const FILTER_KEY = 'm365-filters-' + (TENANT.TenantId || 'default');
```

### 2. Lazy useState init

Replace the `filters` useState call in `App()`:

```jsx
// Before
const [filters, setFilters] = useState({ status:[], severity:[], framework:[], domain:[], profile:[] });

// After
const [filters, setFilters] = useState(() => {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTER_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      return {
        status:    Array.isArray(saved.status)    ? saved.status    : [],
        severity:  Array.isArray(saved.severity)  ? saved.severity  : [],
        framework: Array.isArray(saved.framework) ? saved.framework : [],
        domain:    Array.isArray(saved.domain)    ? saved.domain    : [],
        profile:   Array.isArray(saved.profile)   ? saved.profile   : [],
      };
    }
  } catch {}
  return { status:[], severity:[], framework:[], domain:[], profile:[] };
});
```

### 3. Persist useEffect

Add after the existing theme/mode/density `useEffect` in `App()`:

```jsx
useEffect(() => {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(filters)); } catch {}
}, [filters]);
```

### Why the Clear button needs no change

The existing clear handler calls `setFilters({status:[],severity:[],framework:[],domain:[],profile:[]})`, which triggers the new `useEffect`, writing empty arrays to localStorage. The clear-from-storage behavior is automatic.

### Stale value handling

If a persisted filter value no longer exists in the current data (e.g., a domain from a previous run), the filter simply returns 0 rows. The user can see the active filter chips and click Clear. This is the correct behavior — no sanitization needed.

## Files

| File | Action |
|---|---|
| `src/M365-Assess/assets/report-app.jsx` | Add `FILTER_KEY` constant; update `filters` useState; add persist `useEffect` |
| `src/M365-Assess/assets/report-app.js` | Regenerated via `npm run build` — do not hand-edit |

## Testing

1. Apply a status filter (e.g., "Fail") — refresh the page — verify filter is restored and table is pre-filtered.
2. Open report for Tenant A — apply filters — open report for Tenant B in same browser — verify no filters are active.
3. Click Clear — refresh — verify table is unfiltered.
4. Open the report with no prior localStorage entry — verify it loads with no active filters.
5. Apply multiple filters across different dimensions — refresh — verify all are restored.
