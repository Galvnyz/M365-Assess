# v0.9.2 Compliance UX Design Spec

> **Milestone:** v0.9.2 - Compliance UX
> **Issues:** #108 (card metrics), #109 (section filter), #122 (expand/collapse), #123 (NIST baselines)
> **Scope:** `Common/Export-AssessmentReport.ps1` (HTML report generator)
> **Prerequisite:** CheckID NIST 800-53 baseline profiles (plan at `C:\git\CheckID\.claude\nist-800-53-baselines-plan.md`)

## Summary

Four changes to the compliance overview section of the HTML report:

1. **Dual-metric cards** -- all framework cards show pass rate as the primary number with a coverage progress bar underneath
2. **Section filter** -- pill-style toggle bar to scope findings by assessment domain (Identity, Email, Security, etc.) with full recalculation of cards, status bar, and table
3. **Expand/collapse all** -- two buttons at the top of the compliance matrix accordion
4. **NIST 800-53 baseline profiles** -- replace the single NIST 800-53 column with 4 profile columns (Low, Moderate, High, Privacy)

---

## 1. Dual-Metric Cards (#108)

### Problem

CIS cards show **pass rate** (passed / assessed) while non-CIS cards show **coverage** (mapped / catalog total). Same visual design, different metrics -- confusing.

### Solution

All cards show two metrics:
- **Primary:** Pass rate percentage (big number, color-coded)
- **Secondary:** Coverage progress bar with label underneath

### Card HTML Structure

```html
<div class='stat-card fw-card [success|warning|danger]' data-fw='CisE3L1'>
    <div class='stat-value'>87.3%</div>
    <div class='stat-label'>CIS E3 L1</div>
    <div class='stat-sublabel'>123 of 140 assessed</div>
    <div class='coverage-bar'>
        <div class='coverage-fill' style='width: 88%'></div>
    </div>
    <div class='coverage-label'>88% coverage</div>
</div>
```

### Metric Calculations

**CIS profile cards (unchanged logic, new coverage bar):**
- Pass rate: `passCount / assessedCount * 100` (existing)
- Coverage: `assessedCount / catalogTotal * 100` (new -- how many of the profile's controls we actually assess)

**Non-CIS cards (new pass rate, existing coverage bar):**
- Pass rate: `passCount / mappedCount * 100` (new -- of controls we mapped, how many passed)
- Coverage: `mappedCount / catalogTotal * 100` (existing)

**NIST baseline cards (new):**
- Pass rate: `passCount / mappedCount * 100` (of controls mapped to this baseline, how many passed)
- Coverage: `mappedCount / baselineControlCount * 100` (mapped vs baseline total, not full catalog)

### Color Thresholds

Color is based on **pass rate** (the primary metric), not coverage:
- `>= 80%` -- success (green)
- `>= 60%` -- warning (yellow)
- `< 60%` -- danger (red)

### CSS Additions

```css
.coverage-bar {
    margin-top: 6px;
    background: var(--m365a-border);
    border-radius: 4px;
    height: 6px;
    overflow: hidden;
}
.coverage-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s;
}
/* Color inherits from card's success/warning/danger class */
.fw-card.success .coverage-fill { background: var(--m365a-success); }
.fw-card.warning .coverage-fill { background: var(--m365a-warning); }
.fw-card.danger .coverage-fill  { background: var(--m365a-danger); }

.coverage-label {
    font-size: 0.65em;
    color: var(--m365a-medium-gray);
    margin-top: 2px;
}
```

---

## 2. Section Filter (#109)

### Problem

Consultants review compliance one domain at a time ("How does our email security map to CIS?") but there's no way to scope the compliance view by assessment section.

### Solution

Add a section filter bar (pill-style toggles) alongside the existing framework selector and status filter. When sections are selected, everything recalculates: cards, status bar, and table.

### Data Source

The `$summary` CSV (read at line 118) already has a `Section` column with display-ready
labels: "Identity", "Email", "Security", "Compliance", "Devices", "Collaboration", "PowerBI".
The `$allCisFindings` PSCustomObject currently stores `Source = $c.Collector` (line 1708),
which holds verbose names like "Entra Security Config". Add a `Section` property alongside it:

```powershell
# Line 1708 area -- add Section property to allCisFindings
Section      = $c.Section    # e.g., "Identity", "Email", "Security"
Source       = $c.Collector  # existing, unchanged
```

No mapping table is needed -- `$c.Section` already contains the exact display labels.
Add a `data-section` attribute to each compliance matrix table row.

### HTML Structure

```html
<div class='section-filter' id='sectionFilter'>
    <span class='section-filter-label'>Sections:</span>
    <label class='section-checkbox active'>
        <input type='checkbox' value='Identity' checked> Identity (45)
    </label>
    <label class='section-checkbox active'>
        <input type='checkbox' value='Email' checked> Email (32)
    </label>
    <!-- ... one per section with count ... -->
    <span class='fw-selector-actions'>
        <button type='button' id='sectionSelectAll' class='fw-action-btn'>All</button>
        <button type='button' id='sectionSelectNone' class='fw-action-btn'>None</button>
    </span>
</div>
```

### Table Row Markup

```html
<tr class='cis-row-pass' data-section='Identity'>
    <!-- existing cells -->
</tr>
```

### JS Refactor: Unified Filter Function

The existing report has two **independent** filter functions (lines 3756-3844):
- `applyFrameworkFilter()` -- toggles **column** and **card** visibility; does not touch rows
- `applyStatusFilter()` -- toggles **row** visibility; does not touch columns or cards

These must be merged into a single `applyAllFilters()` function so that all three dimensions
compose correctly. Each filter's change handler calls `applyAllFilters()`:

- **Framework filter** continues to toggle column visibility and card visibility (unchanged behavior)
- **Status filter** affects row visibility (unchanged behavior)
- **Section filter** affects row visibility AND triggers card/status bar recalculation (new)

Row visibility is the intersection of status + section. Framework selection does NOT affect
row visibility (matching current behavior -- framework toggles show/hide columns, not rows).

```javascript
function applyAllFilters() {
    var activeFw = getActiveFrameworks();
    var activeStatus = getActiveStatuses();
    var activeSections = getActiveSections();

    // 1. Toggle framework columns and cards (existing logic, moved here)
    allFwCols.forEach(function(el) {
        var fw = el.getAttribute('data-fw');
        el.style.display = activeFw.indexOf(fw) !== -1 ? '' : 'none';
    });
    cards.forEach(function(card) {
        var fw = card.getAttribute('data-fw');
        card.style.display = activeFw.indexOf(fw) !== -1 ? '' : 'none';
    });

    // 2. Filter table rows (status + section intersection)
    var visibleCount = 0;
    rows.forEach(function(row) {
        var sectionMatch = activeSections.indexOf(row.getAttribute('data-section')) !== -1;
        var statusMatch = matchesStatus(row, activeStatus);
        var show = sectionMatch && statusMatch;
        row.style.display = show ? '' : 'none';
        if (show) visibleCount++;
    });

    // 3. Show/hide "no results" message
    var noResults = document.getElementById('complianceNoResults');
    if (noResults) noResults.style.display = visibleCount === 0 ? '' : 'none';

    // 4. Recalculate cards and status bar for selected sections
    recalculateCards(activeSections);
    recalculateStatusBar(activeSections);
}
```

### Card Recalculation

When sections change, each visible card's pass rate, coverage bar, and color class update:

```javascript
function recalculateCards(activeSections) {
    cards.forEach(function(card) {
        if (card.style.display === 'none') return;  // hidden by framework filter
        var fw = card.getAttribute('data-fw');
        var catalogTotal = parseInt(card.getAttribute('data-catalog-total'));

        // Filter complianceData to selected sections + this framework
        var findings = complianceData.filter(function(f) {
            return activeSections.indexOf(f.section) !== -1 && f.frameworks[fw];
        });
        var passCount = findings.filter(function(f) { return f.status === 'Pass'; }).length;
        var total = findings.length;
        var passRate = total > 0 ? (passCount / total * 100).toFixed(1) : 0;
        var coveragePct = catalogTotal > 0 ? (total / catalogTotal * 100).toFixed(0) : 0;

        // Update pass rate (primary metric)
        card.querySelector('.stat-value').textContent = passRate + '%';
        card.querySelector('.stat-sublabel').textContent =
            passCount + ' of ' + total + ' assessed';

        // Update coverage bar
        var fill = card.querySelector('.coverage-fill');
        if (fill) fill.style.width = coveragePct + '%';
        var covLabel = card.querySelector('.coverage-label');
        if (covLabel) covLabel.textContent = coveragePct + '% coverage';

        // Update color class based on pass rate thresholds
        card.classList.remove('success', 'warning', 'danger');
        if (passRate >= 80) card.classList.add('success');
        else if (passRate >= 60) card.classList.add('warning');
        else card.classList.add('danger');
    });
}
```

### No-Results State

When all rows are hidden (e.g., all sections deselected), show a placeholder message:

```html
<div id='complianceNoResults' class='no-results' style='display:none'>
    <p>No findings match the current filter selection.</p>
</div>
```

Placed inside the compliance section, after the matrix table. Visibility toggled
by `applyAllFilters()` based on `visibleCount === 0`.

### Data Embedding

To enable client-side recalculation, embed finding data as a compressed JSON blob in the HTML:

```html
<script>
var complianceData = [{"c":"ENTRA-SECDEFAULT-001","s":"Identity","st":"Pass","fw":{"CisE3L1":"1.2.1","Nist80053Low":"AC-2"}},...];
</script>
```

Built from `$allCisFindings` during report generation using `ConvertTo-Json -Compress` with
abbreviated keys to minimize size:
- `c` = checkId, `s` = section, `st` = status, `fw` = frameworks (only non-empty mappings)

**Size estimate:** ~233 entries x ~150 bytes each = ~35KB compressed. Acceptable for a
single-file HTML report that is already several hundred KB. The alternative (DOM-based
filtering by reading `data-section` and class attributes from rows) would avoid the extra
data but cannot recalculate card percentages without duplicating the framework mapping logic
in JavaScript.

### CSS Additions

Reuse existing `.fw-selector` styling pattern:

```css
.section-filter {
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    padding: 10px 14px; margin: 6px 0;
    background: var(--m365a-light-gray);
    border: 1px solid var(--m365a-border); border-radius: 6px;
}
.section-checkbox {
    /* Same as .fw-checkbox */
}
.section-checkbox.active {
    /* Same as .fw-checkbox.active */
}
```

---

## 3. Expand/Collapse All (#122)

### Problem

The compliance matrix uses `<details>` accordion panels. Reviewing many controls requires clicking each one individually.

### Solution

Two buttons at the top of the compliance matrix: "Expand All" and "Collapse All".

### HTML Structure

```html
<div class='matrix-controls'>
    <button type='button' id='expandAll' class='fw-action-btn'>Expand All</button>
    <button type='button' id='collapseAll' class='fw-action-btn'>Collapse All</button>
</div>
```

### JavaScript

The `<details>` accordion panels are `<details class='collector-detail'>` elements generated
at line 1522, NOT inside `#complianceTable` (which is a `<table>`). Target them by class:

```javascript
document.getElementById('expandAll').addEventListener('click', function() {
    document.querySelectorAll('.collector-detail').forEach(function(d) {
        d.open = true;
    });
});
document.getElementById('collapseAll').addEventListener('click', function() {
    document.querySelectorAll('.collector-detail').forEach(function(d) {
        d.open = false;
    });
});
```

### Placement

Inside each `<details class='section'>` panel, after the section summary and before the
first `<details class='collector-detail'>`. Uses existing `.fw-action-btn` styling.
Only render the buttons for sections that contain multiple collector-detail panels.

---

## 4. NIST 800-53 Baseline Profiles (#123)

### Prerequisite

CheckID must have NIST baseline profile data in `registry.json` before this work begins.
See `C:\git\CheckID\.claude\nist-800-53-baselines-plan.md`.

### Changes to Export-AssessmentReport.ps1

**4a. Framework lookup table (lines 75-91):**

Replace the single NIST 800-53 entry with 4 baseline entries:

```powershell
# Remove:
# 'NIST-800-53' = @{ Col = 'Nist80053'; Label = 'NIST 800-53 Rev 5'; Css = 'fw-nist' }

# Add:
'NIST-Low'     = @{ Col = 'Nist80053Low';      Label = 'NIST Low';      Css = 'fw-nist' }
'NIST-Moderate'= @{ Col = 'Nist80053Moderate';  Label = 'NIST Moderate'; Css = 'fw-nist' }
'NIST-High'    = @{ Col = 'Nist80053High';      Label = 'NIST High';     Css = 'fw-nist-high' }
'NIST-Privacy' = @{ Col = 'Nist80053Privacy';   Label = 'NIST Privacy';  Css = 'fw-nist-privacy' }
```

**4b. Framework key list (`$allFrameworkKeys`):**

Update to include the 4 NIST profiles instead of the single entry.

**4c. Catalog counts:**

Read baseline control counts from the framework definition JSON at
`controls/frameworks/nist-800-53-r5.json` (or `lib/CheckID/data/frameworks/` after
submodule cutover). The JSON structure is:

```json
{
  "scoring": {
    "profiles": {
      "Low":      { "controlCount": 149 },
      "Moderate": { "controlCount": 287 },
      "High":     { "controlCount": 370 },
      "Privacy":  { "controlCount": 96 }
    }
  }
}
```

Each profile's `controlCount` becomes the denominator for coverage calculations.
If the framework definition file is missing (CheckID work not yet complete), fall back
to the existing `nist-800-53-r5.csv` row count as the single denominator and skip
baseline splitting.

**4d. Finding data population (lines 1699-1722):**

Add 4 NIST profile columns to the `$allCisFindings` PSCustomObject, populated from registry
entries that have `profiles` arrays containing the respective baseline:

```powershell
Nist80053Low      = if ($nistProfiles -contains 'Low')      { $nistControlId } else { '' }
Nist80053Moderate = if ($nistProfiles -contains 'Moderate') { $nistControlId } else { '' }
Nist80053High     = if ($nistProfiles -contains 'High')     { $nistControlId } else { '' }
Nist80053Privacy  = if ($nistProfiles -contains 'Privacy')  { $nistControlId } else { '' }
```

**4e. Card generation:**

NIST baseline cards use the same dual-metric pattern as all other cards (see section 1).
They are `profile-compliance` type, so they show:
- Pass rate: controls in this baseline that passed / total controls in this baseline that we assess
- Coverage: controls in this baseline that we assess / baseline's total control count

**4f. Remove old NIST 800-53 monolithic card and column.**

### Column Count Impact

- Remove: 1 column (NIST-800-53)
- Add: 4 columns (NIST-Low, NIST-Moderate, NIST-High, NIST-Privacy)
- Net: +3 columns (from 13 to 16 total framework columns)

### Default Visibility

The 4 NIST baseline columns should default to **unchecked** in the framework selector
to keep the initial table width manageable. Users toggle them on as needed. The existing
`.matrix-table` is wrapped in a scrollable `table-wrapper` div, so horizontal overflow
is handled, but defaulting to 20+ visible columns would degrade the initial experience.

The NIST baseline **cards** are still visible by default -- only the table columns are
hidden. This matches the pattern where cards provide the summary and users drill into
the matrix for details.

---

## Implementation Order

1. **#122 Expand/Collapse All** -- simplest, no dependencies, can merge first
2. **#108 Dual-Metric Cards** -- card refactor, no data changes needed
3. **#123 NIST Baselines** -- depends on CheckID upstream work being complete
4. **#109 Section Filter** -- most complex (JS recalculation), benefits from #108 and #123 being done first since card recalc logic builds on the dual-metric structure

Items 1 and 2 can be developed in parallel. Item 3 depends on CheckID. Item 4 depends on 2.

---

## Testing

### Smoke Tests

- Report generates without errors with all 4 changes applied
- All framework cards render with pass rate + coverage bar
- Section filter pills appear with correct counts
- Expand/Collapse All buttons toggle all accordion panels
- NIST baseline columns appear in the compliance matrix
- All filters compose correctly (framework + status + section)

### Visual Verification

- Cards show consistent dual-metric layout across CIS and non-CIS frameworks
- Coverage bars scale proportionally
- Section filter recalculates card percentages correctly
- Dark mode renders correctly (if supported)

### Edge Cases

- Section with zero findings (should show 0% or hide card)
- Framework with no mapped controls in selected sections
- All sections deselected (show "no results" state)
- NIST baseline with zero mapped controls (Privacy may have low coverage initially)
