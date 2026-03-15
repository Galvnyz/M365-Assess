# v0.9.2 Compliance UX Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the compliance overview section of the HTML report with unified card metrics, section filtering, expand/collapse controls, and NIST 800-53 baseline profiles.

**Architecture:** All changes are in `Common/Export-AssessmentReport.ps1` (~3975 lines). The file generates a single self-contained HTML report with embedded CSS and JavaScript. PowerShell builds the HTML strings; JS handles client-side interactivity.

**Tech Stack:** PowerShell 7, HTML/CSS/JS (inline in generated report), Pester 5.x for tests.

**Spec:** `docs/superpowers/specs/2026-03-15-v092-compliance-ux-design.md`

---

## Chunk 1: Expand/Collapse All + Dual-Metric Cards

These two features are independent and have no data dependencies.

### Task 1: Expand/Collapse All Buttons (#122)

**Files:**
- Modify: `Common/Export-AssessmentReport.ps1:599-605` (section HTML generation)
- Modify: `Common/Export-AssessmentReport.ps1:3844` (JS section, after status filter)
- Test: `tests/Common/Export-AssessmentReport.Tests.ps1`

- [ ] **Step 1: Write failing test for expand/collapse buttons**

Add a test that verifies the report HTML contains expand/collapse buttons:

```powershell
It 'Should include expand/collapse buttons in section panels' {
    $html | Should -Match 'expand-all-btn'
    $html | Should -Match 'collapse-all-btn'
    $html | Should -Match 'collector-detail'
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pwsh -NoProfile -Command "Invoke-Pester ./tests/Common/Export-AssessmentReport.Tests.ps1 -Filter 'expand' -PassThru"`
Expected: FAIL (buttons don't exist yet)

- [ ] **Step 3: Add expand/collapse buttons to section HTML generation**

In `Export-AssessmentReport.ps1`, after the section description line (~line 604), add buttons
for sections with multiple collector-detail panels. The buttons go after the collector-grid
div and before the first collector-detail.

Find the line that starts rendering collector details (around line 607 where the collector-grid
starts). After the collector-grid closing `</div>`, insert:

```powershell
# Expand/Collapse buttons (only for sections with multiple collectors)
if ($sectionCollectors.Count -gt 1) {
    $null = $sectionHtml.AppendLine("<div class='matrix-controls'><button type='button' class='expand-all-btn fw-action-btn'>Expand All</button><button type='button' class='collapse-all-btn fw-action-btn'>Collapse All</button></div>")
}
```

Note: Use class-based selectors (`expand-all-btn`, `collapse-all-btn`) instead of IDs since
there are multiple sections, each getting their own pair of buttons.

- [ ] **Step 4: Add JavaScript for expand/collapse**

After the status filter JS block (line ~3844), add:

```javascript
// --- Expand/Collapse All buttons ---
document.querySelectorAll('.expand-all-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
        var section = btn.closest('.section');
        if (section) {
            section.querySelectorAll('.collector-detail').forEach(function(d) { d.open = true; });
        }
    });
});
document.querySelectorAll('.collapse-all-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
        var section = btn.closest('.section');
        if (section) {
            section.querySelectorAll('.collector-detail').forEach(function(d) { d.open = false; });
        }
    });
});
```

- [ ] **Step 5: Add CSS for matrix-controls**

After the `.info-status-note` styles (line ~3338), add:

```css
.matrix-controls { display: flex; gap: 6px; margin: 8px 0; }
```

Also add print media hide rule at line ~3565 (alongside `.fw-selector` and `.status-filter`):

```css
.matrix-controls { display: none; }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pwsh -NoProfile -Command "Invoke-Pester ./tests/Common/Export-AssessmentReport.Tests.ps1 -Filter 'expand' -PassThru"`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add Common/Export-AssessmentReport.ps1 tests/Common/Export-AssessmentReport.Tests.ps1
git commit -m "feat: add expand/collapse all buttons to section panels (#122)"
```

---

### Task 2: Dual-Metric Cards (#108)

**Files:**
- Modify: `Common/Export-AssessmentReport.ps1:1812-1840` (card generation)
- Modify: `Common/Export-AssessmentReport.ps1:3313-3322` (CSS)
- Test: `tests/Common/Export-AssessmentReport.Tests.ps1`

- [ ] **Step 1: Write failing test for dual-metric cards**

```powershell
It 'Should include coverage bar in all framework cards' {
    $html | Should -Match 'coverage-bar'
    $html | Should -Match 'coverage-fill'
    $html | Should -Match 'coverage-label'
}

It 'Should show pass rate as primary metric for non-CIS cards' {
    # Non-CIS cards should now show pass rate, not just coverage
    $html | Should -Match "stat-sublabel.*assessed"
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pwsh -NoProfile -Command "Invoke-Pester ./tests/Common/Export-AssessmentReport.Tests.ps1 -Filter 'coverage bar' -PassThru"`
Expected: FAIL (coverage-bar class doesn't exist yet)

- [ ] **Step 3: Add coverage bar CSS**

After the `.fw-action-btn` styles (line ~3320), add:

```css
.coverage-bar { margin-top: 6px; background: var(--m365a-border); border-radius: 4px; height: 6px; overflow: hidden; }
.coverage-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
.fw-card.success .coverage-fill { background: var(--m365a-success); }
.fw-card.warning .coverage-fill { background: var(--m365a-warning); }
.fw-card.danger .coverage-fill { background: var(--m365a-danger); }
.stat-sublabel { font-size: 0.75em; color: var(--m365a-medium-gray); }
.coverage-label { font-size: 0.65em; color: var(--m365a-medium-gray); margin-top: 2px; }
```

- [ ] **Step 4: Refactor CIS card generation to dual-metric format**

Replace lines 1817-1827 (CIS profile card block). The existing code computes `$profileScore`
(pass rate) and `$coverageLabel`. Add coverage bar:

```powershell
if ($fwKey -in $cisProfileKeys) {
    # CIS profile card -- pass rate as primary, coverage bar as secondary
    $profileFindings = @($allCisFindings | Where-Object { $_.$col -and $_.$col -ne '' })
    $profilePass = @($profileFindings | Where-Object { $_.Status -eq 'Pass' }).Count
    $profileScored = $profileFindings.Count
    $profileScore = if ($profileScored -gt 0) { [math]::Round(($profilePass / $profileScored) * 100, 1) } else { 0 }
    $scoreDisplay = if ($profileScored -gt 0) { "$profileScore%" } else { 'N/A' }
    $scoreClass = if ($profileScored -eq 0) { '' } elseif ($profileScore -ge 80) { 'success' } elseif ($profileScore -ge 60) { 'warning' } else { 'danger' }
    $catalogTotal = if ($catalogCounts.ContainsKey($fwKey)) { $catalogCounts[$fwKey] } else { 0 }
    $coveragePct = if ($catalogTotal -gt 0) { [math]::Round(($profileScored / $catalogTotal) * 100, 0) } else { 0 }
    $coverageLabel = if ($catalogTotal -gt 0) { "$profileScored of $catalogTotal assessed" } else { "$profileScored assessed" }
    $null = $complianceHtml.AppendLine("<div class='stat-card fw-card $scoreClass' data-fw='$col' data-catalog-total='$catalogTotal'><div class='stat-value'>$scoreDisplay</div><div class='stat-label'>$($fwInfo.Label)</div><div class='stat-sublabel'>$coverageLabel</div><div class='coverage-bar'><div class='coverage-fill' style='width: $coveragePct%'></div></div><div class='coverage-label'>$coveragePct% coverage</div></div>")
}
```

- [ ] **Step 5: Refactor non-CIS card generation to dual-metric format**

Replace lines 1829-1837 (non-CIS card block). Add pass rate calculation and coverage bar:

```powershell
else {
    # Non-CIS card -- pass rate as primary, coverage bar as secondary
    $mappedFindings = @($allCisFindings | Where-Object { $_.$col -and $_.$col -ne '' })
    $mappedControls = @($mappedFindings | ForEach-Object { $_.$col -split ';' } | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' } | Sort-Object -Unique)
    $mappedCount = $mappedControls.Count
    $mappedPass = @($mappedFindings | Where-Object { $_.Status -eq 'Pass' }).Count
    $mappedTotal = $mappedFindings.Count
    $passRate = if ($mappedTotal -gt 0) { [math]::Round(($mappedPass / $mappedTotal) * 100, 1) } else { 0 }
    $passDisplay = if ($mappedTotal -gt 0) { "$passRate%" } else { 'N/A' }
    $passClass = if ($mappedTotal -eq 0) { '' } elseif ($passRate -ge 80) { 'success' } elseif ($passRate -ge 60) { 'warning' } else { 'danger' }
    $totalCount = if ($catalogCounts.ContainsKey($fwKey)) { $catalogCounts[$fwKey] } else { 0 }
    $coveragePct = if ($totalCount -gt 0) { [math]::Round(($mappedCount / $totalCount) * 100, 0) } else { 0 }
    $coverageLabel = if ($totalCount -gt 0) { "$mappedTotal of $totalCount assessed" } else { "$mappedTotal assessed" }
    $null = $complianceHtml.AppendLine("<div class='stat-card fw-card $passClass' data-fw='$col' data-catalog-total='$totalCount'><div class='stat-value'>$passDisplay</div><div class='stat-label'>$($fwInfo.Label)</div><div class='stat-sublabel'>$coverageLabel</div><div class='coverage-bar'><div class='coverage-fill' style='width: $coveragePct%'></div></div><div class='coverage-label'>$coveragePct% coverage</div></div>")
}
```

Key changes from existing code:
- Primary metric is now **pass rate** (`$mappedPass / $mappedTotal`), not coverage
- Color class based on pass rate thresholds (80/60), not coverage thresholds (70/50)
- Coverage bar added as secondary visual indicator
- `data-catalog-total` attribute added for JS recalculation later (Task 4)

- [ ] **Step 6: Run test to verify it passes**

Run: `pwsh -NoProfile -Command "Invoke-Pester ./tests/Common/Export-AssessmentReport.Tests.ps1 -Filter 'coverage bar' -PassThru"`
Expected: PASS

- [ ] **Step 7: Smoke test report generation**

Run a report generation against a real assessment folder to verify cards render correctly:

```bash
pwsh -NoProfile -Command "& ./Common/Export-AssessmentReport.ps1 -AssessmentFolder '<latest-assessment-folder>'"
```

Open the generated HTML and visually verify:
- CIS cards show pass rate with coverage bar
- Non-CIS cards show pass rate with coverage bar
- Color coding matches pass rate thresholds

- [ ] **Step 8: Commit**

```bash
git add Common/Export-AssessmentReport.ps1 tests/Common/Export-AssessmentReport.Tests.ps1
git commit -m "feat: unified dual-metric cards with pass rate and coverage bar (#108)"
```

---

## Chunk 2: Section Filter + Compliance Data Embedding

### Task 3: Add Section Property + Data Embedding (#109 - Part 1)

**Files:**
- Modify: `Common/Export-AssessmentReport.ps1:1699-1722` (allCisFindings)
- Modify: `Common/Export-AssessmentReport.ps1:1918-1920` (after compliance table)
- Test: `tests/Common/Export-AssessmentReport.Tests.ps1`

- [ ] **Step 1: Write failing test for section property and data embedding**

```powershell
It 'Should include Section property in compliance data' {
    $html | Should -Match 'complianceData'
    $html | Should -Match '"s":"Identity"'  # abbreviated section key
}

It 'Should include data-section attribute on compliance table rows' {
    $html | Should -Match "data-section='"
}
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Add Section property to allCisFindings**

At line 1708, add `Section` property to the PSCustomObject. Insert before `Source`:

```powershell
Section      = $c.Section
Source       = $c.Collector
```

- [ ] **Step 4: Add data-section attribute to compliance table rows**

At line 1895, modify the `<tr>` to include the section:

```powershell
# Before:
$null = $complianceHtml.AppendLine("<tr class='cis-row-$($finding.Status.ToLower())'>")
# After:
$null = $complianceHtml.AppendLine("<tr class='cis-row-$($finding.Status.ToLower())' data-section='$(ConvertTo-HtmlSafe -Text $finding.Section)'>")
```

- [ ] **Step 5: Embed complianceData JSON blob**

After the compliance table closing tags (line ~1919, after `</div>`), add the JSON data
blob for client-side recalculation:

```powershell
# Embed compliance data for client-side filtering/recalculation
$complianceJson = @($allCisFindings | ForEach-Object {
    $fwMap = [ordered]@{}
    foreach ($fwKey in $allFrameworkKeys) {
        $fwCol = $frameworkLookup[$fwKey].Col
        $val = $_.$fwCol
        if ($val -and $val -ne '') { $fwMap[$fwCol] = $val }
    }
    [PSCustomObject]@{
        c  = $_.CheckId
        s  = $_.Section
        st = $_.Status
        fw = $fwMap
    }
}) | ConvertTo-Json -Compress -Depth 3
$null = $complianceHtml.AppendLine("<script>var complianceData = $complianceJson;</script>")
```

- [ ] **Step 6: Run test to verify it passes**

- [ ] **Step 7: Commit**

```bash
git add Common/Export-AssessmentReport.ps1 tests/Common/Export-AssessmentReport.Tests.ps1
git commit -m "feat: add section property and compliance data embedding for filters (#109)"
```

---

### Task 4: Section Filter HTML + CSS (#109 - Part 2)

**Files:**
- Modify: `Common/Export-AssessmentReport.ps1:1842-1860` (after status filter HTML)
- Modify: `Common/Export-AssessmentReport.ps1:3324-3328` (CSS)
- Test: `tests/Common/Export-AssessmentReport.Tests.ps1`

- [ ] **Step 1: Write failing test for section filter HTML**

```powershell
It 'Should include section filter with pills' {
    $html | Should -Match "id='sectionFilter'"
    $html | Should -Match 'section-checkbox'
    $html | Should -Match "id='sectionSelectAll'"
    $html | Should -Match "id='sectionSelectNone'"
}
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Generate section filter HTML**

After the info-status-note block (line ~1865, after the conditional info note `</div>`), add
the section filter. Build the unique sections from the findings data:

```powershell
# Section filter (scopes compliance view by assessment domain)
$uniqueSections = @($allCisFindings | Select-Object -ExpandProperty Section -ErrorAction SilentlyContinue | Where-Object { $_ } | Sort-Object -Unique)
if ($uniqueSections.Count -gt 1) {
    $null = $complianceHtml.AppendLine("<div class='section-filter' id='sectionFilter'>")
    $null = $complianceHtml.AppendLine("<span class='section-filter-label'>Sections:</span>")
    foreach ($sec in $uniqueSections) {
        $secCount = @($allCisFindings | Where-Object { $_.Section -eq $sec }).Count
        $null = $complianceHtml.AppendLine("<label class='section-checkbox'><input type='checkbox' value='$(ConvertTo-HtmlSafe -Text $sec)' checked> $(ConvertTo-HtmlSafe -Text $sec) ($secCount)</label>")
    }
    $null = $complianceHtml.AppendLine("<span class='fw-selector-actions'><button type='button' id='sectionSelectAll' class='fw-action-btn'>All</button><button type='button' id='sectionSelectNone' class='fw-action-btn'>None</button></span>")
    $null = $complianceHtml.AppendLine("</div>")
}
```

- [ ] **Step 4: Add no-results placeholder**

After the compliance table (line ~1919), before the `</details>` closing:

```powershell
$null = $complianceHtml.AppendLine("<div id='complianceNoResults' class='no-results' style='display:none'><p>No findings match the current filter selection.</p></div>")
```

- [ ] **Step 5: Add section filter CSS**

After the `.info-status-note` styles (line ~3338), add:

```css
.section-filter { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 8px 14px; margin: 0 0 12px; background: var(--m365a-light-gray); border: 1px solid var(--m365a-border); border-radius: 6px; }
.section-filter-label { font-weight: 600; font-size: 0.85em; color: var(--m365a-dark); margin-right: 4px; }
.section-checkbox { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border: 1px solid var(--m365a-border); border-radius: 4px; font-size: 0.82em; cursor: pointer; transition: all 0.15s; background: var(--m365a-card-bg); user-select: none; }
.section-checkbox:hover { border-color: var(--m365a-accent); }
.section-checkbox.active { background: var(--m365a-dark); color: #fff; border-color: var(--m365a-dark); }
.section-checkbox input[type="checkbox"] { display: none; }
.no-results { text-align: center; padding: 40px; color: var(--m365a-medium-gray); font-style: italic; }
```

Also add dark mode variant after the existing dark theme overrides (~line 3402):

```css
body.dark-theme .section-checkbox.active { background: #3B82F6; color: #ffffff; border-color: #3B82F6; }
```

And print media hide rule (~line 3565):

```css
.section-filter { display: none; }
```

- [ ] **Step 6: Run test to verify it passes**

- [ ] **Step 7: Commit**

```bash
git add Common/Export-AssessmentReport.ps1 tests/Common/Export-AssessmentReport.Tests.ps1
git commit -m "feat: add section filter HTML and CSS (#109)"
```

---

### Task 5: Unified Filter JavaScript (#109 - Part 3)

**Files:**
- Modify: `Common/Export-AssessmentReport.ps1:3756-3844` (replace existing JS filters)
- Test: `tests/Common/Export-AssessmentReport.Tests.ps1`

- [ ] **Step 1: Write failing test for unified filter JS**

```powershell
It 'Should include unified applyAllFilters function' {
    $html | Should -Match 'applyAllFilters'
    $html | Should -Match 'recalculateCards'
    $html | Should -Match 'recalculateStatusBar'
    $html | Should -Match "getElementById\('sectionFilter'\)"
}
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Replace existing framework + status filter JS with unified function**

Replace lines 3756-3844 (both `applyFrameworkFilter` and `applyStatusFilter` blocks)
with the unified filter system. This is the largest single code change in the plan.

The new JS must:
1. Gather active checkboxes from all three filter bars (framework, status, section)
2. Toggle framework columns and cards (existing behavior, moved into unified function)
3. Filter table rows by status AND section intersection
4. Track visible row count for no-results message
5. Recalculate card metrics from `complianceData` JSON
6. Recalculate status bar from `complianceData` JSON
7. Wire up All/None buttons for all three filter bars
8. Initialize all filters on page load

```javascript
// --- Unified compliance filters ---
var fwSelector = document.getElementById('fwSelector');
var statusFilter = document.getElementById('statusFilter');
var sectionFilter = document.getElementById('sectionFilter');
var compTable = document.getElementById('complianceTable');
var cards = document.querySelectorAll('.fw-card');

if (compTable) {
    var compRows = compTable.querySelectorAll('tbody tr');
    var allFwCols = compTable.querySelectorAll('.fw-col');
    var fwCbs = fwSelector ? fwSelector.querySelectorAll('input[type="checkbox"]') : [];
    var statusCbs = statusFilter ? statusFilter.querySelectorAll('input[type="checkbox"]') : [];
    var sectionCbs = sectionFilter ? sectionFilter.querySelectorAll('input[type="checkbox"]') : [];

    function getActive(cbs, parentClass) {
        var active = [];
        cbs.forEach(function(cb) {
            var lbl = cb.closest(parentClass);
            if (cb.checked) { if (lbl) lbl.classList.add('active'); active.push(cb.value); }
            else { if (lbl) lbl.classList.remove('active'); }
        });
        return active;
    }

    function applyAllFilters() {
        var activeFw = getActive(fwCbs, '.fw-checkbox');
        var activeStatus = getActive(statusCbs, '.status-checkbox');
        var activeSections = getActive(sectionCbs, '.section-checkbox');

        // 1. Toggle framework columns and cards
        allFwCols.forEach(function(el) {
            var fw = el.getAttribute('data-fw');
            el.style.display = activeFw.indexOf(fw) !== -1 ? '' : 'none';
        });
        cards.forEach(function(card) {
            var fw = card.getAttribute('data-fw');
            card.style.display = activeFw.indexOf(fw) !== -1 ? '' : 'none';
        });

        // 2. Filter rows by status + section
        var visibleCount = 0;
        compRows.forEach(function(row) {
            var sec = row.getAttribute('data-section') || '';
            var sectionOk = activeSections.length === 0 || activeSections.indexOf(sec) !== -1;
            var statusOk = false;
            for (var i = 0; i < activeStatus.length; i++) {
                if ((row.className || '').indexOf('cis-row-' + activeStatus[i]) !== -1) { statusOk = true; break; }
            }
            var show = sectionOk && statusOk;
            row.style.display = show ? '' : 'none';
            if (show) visibleCount++;
        });

        // 3. No-results message
        var noResults = document.getElementById('complianceNoResults');
        if (noResults) noResults.style.display = visibleCount === 0 ? '' : 'none';

        // 4. Recalculate cards
        if (typeof complianceData !== 'undefined') {
            recalculateCards(activeFw, activeSections);
            recalculateStatusBar(activeSections);
        }
    }

    function recalculateCards(activeFw, activeSections) {
        cards.forEach(function(card) {
            var fw = card.getAttribute('data-fw');
            if (activeFw.indexOf(fw) === -1) return;
            var catalogTotal = parseInt(card.getAttribute('data-catalog-total')) || 0;

            var findings = complianceData.filter(function(f) {
                return (activeSections.length === 0 || activeSections.indexOf(f.s) !== -1) && f.fw[fw];
            });
            var passCount = findings.filter(function(f) { return f.st === 'Pass'; }).length;
            var total = findings.length;
            var passRate = total > 0 ? (passCount / total * 100) : 0;
            var coveragePct = catalogTotal > 0 ? Math.round(total / catalogTotal * 100) : 0;

            var valEl = card.querySelector('.stat-value');
            if (valEl) valEl.textContent = (total > 0 ? passRate.toFixed(1) : '0') + '%';
            var subEl = card.querySelector('.stat-sublabel');
            if (subEl) subEl.textContent = passCount + ' of ' + total + ' assessed';
            var fill = card.querySelector('.coverage-fill');
            if (fill) fill.style.width = coveragePct + '%';
            var covLabel = card.querySelector('.coverage-label');
            if (covLabel) covLabel.textContent = coveragePct + '% coverage';

            card.classList.remove('success', 'warning', 'danger');
            if (total === 0) { /* no class */ }
            else if (passRate >= 80) card.classList.add('success');
            else if (passRate >= 60) card.classList.add('warning');
            else card.classList.add('danger');
        });
    }

    function recalculateStatusBar(activeSections) {
        var bar = document.querySelector('.compliance-status-bar');
        if (!bar || typeof complianceData === 'undefined') return;
        var findings = activeSections.length === 0 ? complianceData :
            complianceData.filter(function(f) { return activeSections.indexOf(f.s) !== -1; });
        var total = findings.length;

        // Status CSS class suffix -> display label mapping
        var statusMap = [
            { css: 'pass', label: 'Pass' },
            { css: 'fail', label: 'Fail' },
            { css: 'warning', label: 'Warning' },
            { css: 'review', label: 'Review' },
            { css: 'info', label: 'Info' }
        ];
        var counts = {};
        statusMap.forEach(function(s) { counts[s.label] = 0; });
        findings.forEach(function(f) { if (counts.hasOwnProperty(f.st)) counts[f.st]++; });

        // Update total label
        var totalEl = bar.querySelector('.compliance-bar-total');
        if (totalEl) totalEl.textContent = total + ' controls assessed';

        // Update bar segments (div.hbar-segment with class hbar-pass/hbar-fail/etc.)
        statusMap.forEach(function(s) {
            var seg = bar.querySelector('.hbar-segment.hbar-' + s.css);
            if (seg) {
                var count = counts[s.label] || 0;
                var pct = total > 0 ? (count / total * 100) : 0;
                seg.style.width = pct > 0 ? pct + '%' : '0';
                seg.style.display = pct > 0 ? '' : 'none';
                seg.title = s.label + ': ' + count;
                var lbl = seg.querySelector('.hbar-label');
                if (lbl) lbl.textContent = count > 0 ? count : '';
            }
        });

        // Update legend counts
        bar.querySelectorAll('.hbar-legend-item').forEach(function(item) {
            var text = item.textContent;
            var match = text.match(/^(.+?)\s*\(\d+\)$/);
            if (match) {
                var label = match[1].trim();
                var count = counts[label] || 0;
                if (count > 0) {
                    item.textContent = label + ' (' + count + ')';
                    item.style.display = '';
                } else {
                    item.style.display = 'none';
                }
            }
        });
    }

    // Wire up change handlers
    fwCbs.forEach(function(cb) { cb.addEventListener('change', applyAllFilters); });
    statusCbs.forEach(function(cb) { cb.addEventListener('change', applyAllFilters); });
    sectionCbs.forEach(function(cb) { cb.addEventListener('change', applyAllFilters); });

    // All/None buttons -- framework
    var fwAll = document.getElementById('fwSelectAll');
    var fwNone = document.getElementById('fwSelectNone');
    if (fwAll) fwAll.addEventListener('click', function() { fwCbs.forEach(function(cb) { cb.checked = true; }); applyAllFilters(); });
    if (fwNone) fwNone.addEventListener('click', function() { fwCbs.forEach(function(cb) { cb.checked = false; }); applyAllFilters(); });

    // All/None buttons -- status
    var sAll = document.getElementById('statusSelectAll');
    var sNone = document.getElementById('statusSelectNone');
    if (sAll) sAll.addEventListener('click', function() { statusCbs.forEach(function(cb) { cb.checked = true; }); applyAllFilters(); });
    if (sNone) sNone.addEventListener('click', function() { statusCbs.forEach(function(cb) { cb.checked = false; }); applyAllFilters(); });

    // All/None buttons -- section
    var secAll = document.getElementById('sectionSelectAll');
    var secNone = document.getElementById('sectionSelectNone');
    if (secAll) secAll.addEventListener('click', function() { sectionCbs.forEach(function(cb) { cb.checked = true; }); applyAllFilters(); });
    if (secNone) secNone.addEventListener('click', function() { sectionCbs.forEach(function(cb) { cb.checked = false; }); applyAllFilters(); });

    // Initialize
    applyAllFilters();
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Smoke test all three filters in browser**

Generate a report and verify in browser:
- Framework pills toggle columns and cards (existing behavior preserved)
- Status pills toggle rows (existing behavior preserved)
- Section pills toggle rows AND recalculate card metrics
- All three compose correctly
- "No results" message appears when all sections/statuses are deselected
- All/None buttons work for all three filter bars

- [ ] **Step 6: Commit**

```bash
git add Common/Export-AssessmentReport.ps1 tests/Common/Export-AssessmentReport.Tests.ps1
git commit -m "feat: unified filter system with section-scoped recalculation (#109)"
```

---

## Chunk 3: NIST 800-53 Baseline Profiles

> **Prerequisite:** CheckID must have completed the NIST 800-53 baseline work
> (plan at `C:\git\CheckID\.claude\nist-800-53-baselines-plan.md`).
> The `controls/registry.json` must contain `profiles` arrays in NIST 800-53 entries
> and `controls/frameworks/nist-800-53-r5.json` must exist.
>
> If CheckID work is not yet complete, skip this chunk. It can be added later without
> affecting the other three features.

### Task 6: NIST Baseline Framework Lookup + Finding Data (#123 - Part 1)

**Files:**
- Modify: `Common/Export-AssessmentReport.ps1:75-92` (framework lookup)
- Modify: `Common/Export-AssessmentReport.ps1:1697-1722` (finding data)
- Modify: `Common/Export-AssessmentReport.ps1:1731-1744` (catalog counts)
- Test: `tests/Common/Export-AssessmentReport.Tests.ps1`

- [ ] **Step 1: Write failing test for NIST baseline columns**

```powershell
It 'Should include NIST baseline columns in compliance matrix' -Skip:(-not (Test-Path "$projectRoot/controls/frameworks/nist-800-53-r5.json")) {
    $html | Should -Match "data-fw='Nist80053Low'"
    $html | Should -Match "data-fw='Nist80053Moderate'"
    $html | Should -Match "data-fw='Nist80053High'"
    $html | Should -Match "data-fw='Nist80053Privacy'"
}
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Update framework lookup table**

At lines 75-91, replace the single NIST 800-53 entry with 4 baseline entries:

```powershell
# Replace this line:
#   'NIST-800-53'= @{ Col = 'Nist80053';  Label = 'NIST 800-53 Rev 5';  Css = 'fw-nist' }
# With these 4 lines:
'NIST-Low'     = @{ Col = 'Nist80053Low';      Label = 'NIST Low';      Css = 'fw-nist' }
'NIST-Moderate'= @{ Col = 'Nist80053Moderate';  Label = 'NIST Moderate'; Css = 'fw-nist' }
'NIST-High'    = @{ Col = 'Nist80053High';      Label = 'NIST High';     Css = 'fw-nist-high' }
'NIST-Privacy' = @{ Col = 'Nist80053Privacy';   Label = 'NIST Privacy';  Css = 'fw-nist-privacy' }
```

Update `$allFrameworkKeys` at line 91:
```powershell
$allFrameworkKeys = @('CIS-E3-L1','CIS-E3-L2','CIS-E5-L1','CIS-E5-L2','NIST-Low','NIST-Moderate','NIST-High','NIST-Privacy','NIST-CSF','ISO-27001','STIG','PCI-DSS','CMMC','HIPAA','CISA-SCuBA','SOC-2')
```

Add a list of NIST profile keys (like `$cisProfileKeys`):
```powershell
$nistProfileKeys = @('NIST-Low','NIST-Moderate','NIST-High','NIST-Privacy')
```

- [ ] **Step 4: Update finding data population**

At lines 1697-1721, add NIST profile extraction and 4 new columns. After the CIS
profile extraction (line 1697), add:

```powershell
$nistProfiles = if ($fw.'nist-800-53' -and $fw.'nist-800-53'.profiles) { $fw.'nist-800-53'.profiles } else { @() }
$nistControlId = if ($fw.'nist-800-53' -and $fw.'nist-800-53'.controlId) { $fw.'nist-800-53'.controlId } else { '' }
```

In the PSCustomObject (after line 1714 where `Nist80053` is set), replace the single
`Nist80053` line with 4 profile lines:

```powershell
Nist80053        = if ($fw.'nist-800-53')  { $fw.'nist-800-53'.controlId } else { '' }
Nist80053Low     = if ($nistProfiles -contains 'Low')      { $nistControlId } else { '' }
Nist80053Moderate = if ($nistProfiles -contains 'Moderate') { $nistControlId } else { '' }
Nist80053High    = if ($nistProfiles -contains 'High')     { $nistControlId } else { '' }
Nist80053Privacy = if ($nistProfiles -contains 'Privacy')  { $nistControlId } else { '' }
```

Note: Keep the original `Nist80053` for backward compat; it's no longer in `$frameworkLookup`
but may be used elsewhere.

- [ ] **Step 5: Update catalog counts for NIST baselines**

At lines 1731-1744, read baseline control counts from the framework definition JSON:

```powershell
# Load NIST 800-53 baseline counts from framework definition
$nistFwDefPath = Join-Path -Path $projectRoot -ChildPath 'controls/frameworks/nist-800-53-r5.json'
if (Test-Path -Path $nistFwDefPath) {
    $nistFwDef = Get-Content -Path $nistFwDefPath -Raw | ConvertFrom-Json
    if ($nistFwDef.scoring -and $nistFwDef.scoring.profiles) {
        foreach ($profileName in @('Low','Moderate','High','Privacy')) {
            $profile = $nistFwDef.scoring.profiles.$profileName
            if ($profile -and $profile.controlCount) {
                $catalogCounts["NIST-$profileName"] = $profile.controlCount
            }
        }
    }
}
```

Remove the old `'NIST-800-53' = 'nist-800-53-r5.csv'` entry from `$catalogFiles`.

- [ ] **Step 6: Run test to verify it passes**

- [ ] **Step 7: Commit**

```bash
git add Common/Export-AssessmentReport.ps1 tests/Common/Export-AssessmentReport.Tests.ps1
git commit -m "feat: NIST 800-53 baseline profiles in framework lookup and finding data (#123)"
```

---

### Task 7: NIST Baseline Default Visibility + Card Treatment (#123 - Part 2)

**Files:**
- Modify: `Common/Export-AssessmentReport.ps1:1773-1781` (framework selector HTML)
- Modify: `Common/Export-AssessmentReport.ps1:1812-1840` (card generation)
- Test: `tests/Common/Export-AssessmentReport.Tests.ps1`

- [ ] **Step 1: Write failing test for NIST baseline default visibility**

```powershell
It 'Should default NIST baseline columns to unchecked in framework selector' -Skip:(-not (Test-Path "$projectRoot/controls/frameworks/nist-800-53-r5.json")) {
    # NIST baseline checkboxes should NOT have 'checked' attribute
    $html | Should -Match "value='Nist80053Low'"
    $html | Should -Not -Match "value='Nist80053Low' checked"
}
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Update framework selector to default NIST baselines unchecked**

At line 1778, modify the checkbox generation to omit `checked` for NIST profile keys:

```powershell
foreach ($fwKey in $allFrameworkKeys) {
    $fwInfo = $frameworkLookup[$fwKey]
    $checkedAttr = if ($fwKey -in $nistProfileKeys) { '' } else { ' checked' }
    $null = $complianceHtml.AppendLine("<label class='fw-checkbox'><input type='checkbox' value='$($fwInfo.Col)'$checkedAttr> $($fwInfo.Label)</label>")
}
```

- [ ] **Step 4: Ensure NIST baseline cards use dual-metric pattern**

The card generation loop (lines 1812-1840) already handles CIS profiles vs non-CIS.
NIST baselines should be treated like CIS profiles (they have `profile-compliance` scoring).
Add them to the profile card branch:

```powershell
if ($fwKey -in $cisProfileKeys -or $fwKey -in $nistProfileKeys) {
    # Profile/baseline card -- pass rate as primary, coverage bar as secondary
    # (same code as CIS profile cards from Task 2)
}
```

- [ ] **Step 5: Run test to verify it passes**

- [ ] **Step 6: Smoke test report with NIST baselines**

Generate report and verify:
- 4 NIST baseline cards are visible (with pass rate + coverage bar)
- NIST baseline columns are hidden by default in the matrix table
- Clicking NIST checkboxes in the framework selector reveals columns
- Card metrics update correctly when section filter is applied

- [ ] **Step 7: Commit**

```bash
git add Common/Export-AssessmentReport.ps1 tests/Common/Export-AssessmentReport.Tests.ps1
git commit -m "feat: NIST baseline default visibility and dual-metric cards (#123)"
```

---

### Task 8: Final Integration Test + Cleanup

**Files:**
- Modify: `tests/Common/Export-AssessmentReport.Tests.ps1`

- [ ] **Step 1: Run full test suite**

```bash
pwsh -NoProfile -Command "Invoke-Pester ./tests/ -PassThru"
```

All tests must pass.

- [ ] **Step 2: Run smoke test against real assessment**

Generate a report against a real assessment folder and verify all 4 features work together:
- Dual-metric cards (CIS + non-CIS + NIST baselines)
- Section filter with full recalculation
- Expand/collapse all buttons
- All three filters composing correctly
- Dark mode rendering

- [ ] **Step 3: Commit any test fixes**

```bash
git add tests/
git commit -m "test: integration tests for v0.9.2 compliance UX features"
```
