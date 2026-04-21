# Search Match Highlighting — Design Spec

**Issue:** #636
**Date:** 2026-04-20
**Status:** Approved

## Problem

When a user types in the search box the table filters to matching rows, but the matching substring is not visually indicated within each cell. Users must re-read the row to find why it matched.

## Decision

Highlight the **first occurrence** of the search term in each visible text column that participates in the search corpus. Use the existing `--accent-soft` / `--accent-text` CSS variable pair (same tokens as the N-of-M badge) for visual consistency.

## Columns highlighted

| Column (`colId`) | Field(s) highlighted |
|---|---|
| `finding` | `f.setting` (title line), `f.section` (subtitle line) |
| `checkId` | `f.checkId` |
| `domain` | `f.domain` |
| `status` | — (badge, not text) |
| `severity` | — (badge, not text) |
| `frameworks` | — (pills, not text) |
| `controlId` | — (derived/complex, skipped) |

`current`, `recommended`, and `remediation` are part of the search corpus but do not appear as table columns — they live in the expanded detail row. Highlighting them is out of scope.

## Implementation

### Helper function

Add `hl(text, q)` inside `FindingsTable`, just above `renderCell` (~line 1216):

```jsx
const hl = (text, q) => {
  if (!q || !text) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return text;
  return [
    text.slice(0, i),
    <span key="h" style={{background:'var(--accent-soft)',color:'var(--accent-text)',borderRadius:2,padding:'0 1px'}}>{text.slice(i, i + q.length)}</span>,
    text.slice(i + q.length)
  ];
};
```

- Returns plain `text` when `q` is empty or no match — zero cost when search is inactive.
- Case-insensitive match via `.toLowerCase()`.
- Returns an array (valid React child) with the highlight `<span>` wrapping only the matched portion.
- First occurrence only — sufficient since rows are already filtered to contain the match.

### renderCell changes

`case 'finding'` (~line 1227):

```jsx
case 'finding': return (
  <div key="finding" className="finding-title">
    <div className="t">{hl(f.setting, search)}</div>
    <div className="sub">{hl(f.section, search)}</div>
  </div>
);
```

`case 'domain'` (~line 1231):

```jsx
case 'domain': return <div key="domain" className="finding-dom">{hl(f.domain, search)}</div>;
```

`case 'checkId'` (~line 1264):

```jsx
case 'checkId': return (
  <div key="checkId" className="check-id">{hl(f.checkId, search)}</div>
);
```

### Files

| File | Action |
|---|---|
| `src/M365-Assess/assets/report-app.jsx` | Add `hl` helper (~line 1216); update three `renderCell` cases |
| `src/M365-Assess/assets/report-app.js` | Regenerated via `npm run build` — do not hand-edit |

## Testing

1. Type any term in the search box (e.g., "MFA").
2. Verify matched substring is highlighted in purple in the finding title, subtitle, checkId, and domain columns of matching rows.
3. Clear search — verify no highlights remain and table renders normally.
4. Verify with a term that matches only the checkId (e.g., "CA-") — title has no highlight, checkId does.
5. Verify highlight renders correctly in all four themes.
6. Verify that when search is empty, `hl()` returns plain text with no spans (inspect DOM).
