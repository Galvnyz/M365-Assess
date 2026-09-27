// ======================== Filter bar ========================
function FilterBar({ filters, setFilters, counts, total, search, setSearch, inFindings }) {
  const [domainOpen, setDomainOpen] = useState(false);
  const [fwOpen, setFwOpen] = useState(false);
  const domainRef = useRef(null);
  const fwRef = useRef(null);

  useEffect(() => {
    if (!domainOpen) return;
    const onKey     = e => { if (e.key === 'Escape') setDomainOpen(false); };
    const onOutside = e => { if (domainRef.current && !domainRef.current.contains(e.target)) setDomainOpen(false); };
    document.addEventListener('keydown',   onKey);
    document.addEventListener('mousedown', onOutside);
    return () => {
      document.removeEventListener('keydown',   onKey);
      document.removeEventListener('mousedown', onOutside);
    };
  }, [domainOpen]);

  useEffect(() => {
    if (!fwOpen) return;
    const onKey     = e => { if (e.key === 'Escape') setFwOpen(false); };
    const onOutside = e => { if (fwRef.current && !fwRef.current.contains(e.target)) setFwOpen(false); };
    document.addEventListener('keydown',   onKey);
    document.addEventListener('mousedown', onOutside);
    return () => {
      document.removeEventListener('keydown',   onKey);
      document.removeEventListener('mousedown', onOutside);
    };
  }, [fwOpen]);

  const update = (k, v) => {
    setFilters(f => {
      const cur = new Set(f[k]);
      if (cur.has(v)) cur.delete(v); else cur.add(v);
      return { ...f, [k]: [...cur] };
    });
  };
  const active = filters.status.length + (filters.sequence||[]).length + filters.severity.length + filters.framework.length + filters.domain.length + (filters.profile||[]).length;
  const hasActiveFilters = search.length > 0 || active > 0;
  const isActive = hasActiveFilters && inFindings;

  // [data-value, css-class, optional-display-label]
  const statusChips = [
    ['Fail','fail'], ['Warning','warn'], ['Review','review'], ['Pass','pass'], ['Info','info'],
    ['Skipped','skipped'], ['Unknown','unknown'],
    ['NotApplicable','notapplicable','Not Applicable'],
    ['NotLicensed','notlicensed','Not Licensed'],
  ];
  const sevChips = [ ['critical','crit','Critical'],['high','high','High'],['medium','med','Medium'],['low','low','Low'] ];
  // #898: sequence chips. Multi-select; matches the table column + state-strip
  // pill semantics. Lane (now/soon/later) for active remediation; "done" for
  // Pass status; the "—" / no-sequence case is filtered via "none".
  const seqChips = [
    ['now','now','Now'],
    ['soon','next','Next'],
    ['later','later','Later'],
    ['done','done','Done'],
  ];

  const DOM_ORDER = ['Entra ID','Conditional Access','Enterprise Apps','Exchange Online','Intune','Defender','Purview / Compliance','SharePoint & OneDrive','Teams','Forms','Power BI','Active Directory','SOC 2','Value Opportunity'];
  const domainList = DOM_ORDER.filter(d => counts.domain[d]).concat(
    Object.keys(counts.domain).filter(d => !DOM_ORDER.includes(d)).sort()
  );

  // Issue #847: level chip group renders inline alongside other groups (no
  // longer a dedicated row). Compute it eagerly so JSX stays flat.
  const levelGroup = (() => {
    const singleFw = filters.framework.length === 1 ? filters.framework[0] : null;
    if (!singleFw) return null;
    const isCmmc = singleFw.startsWith('cmmc');
    const isCis  = singleFw.startsWith('cis-');
    if (!isCmmc && !isCis) return null;
    const c = { L1: 0, L2: 0, L3: 0, E3: 0, E5only: 0 };
    FINDINGS.forEach(f => {
      const profs = [].concat(f.fwMeta?.[singleFw]?.profiles || []);
      if (profs.length === 0) return;
      // Issue #844: chip counts reflect the registry's exact tags. No
      // synthetic inheritance. See docs/LEVELS.md.
      if (matchProfileToken(profs, 'L1')) c.L1++;
      if (matchProfileToken(profs, 'L2')) c.L2++;
      if (matchProfileToken(profs, 'L3')) c.L3++;
      const hasE3 = profs.some(p => p.startsWith('E3'));
      if (hasE3) c.E3++; else c.E5only++;
    });
    const tokenList = isCmmc
      ? ['L1','L2','L3'].filter(t => c[t] > 0)
      : ['L1','L2','E3','E5only'].filter(t => c[t] > 0);
    if (!tokenList.length) return null;
    const lvlCss = { L1: 'level', L2: 'level2', L3: 'level3', E3: 'lic', E5only: 'lic5' };
    const lvlLabel = { L1: 'L1', L2: 'L2', L3: 'L3', E3: 'E3', E5only: 'E5 only' };
    return (
      <div className="filter-group">
        <span className="filter-group-label">Level</span>
        {tokenList.map(tok => (
          <button key={tok} className={'chip ' + (lvlCss[tok]||'level') + ((filters.profile||[]).includes(tok) ? ' selected' : '')} onClick={() => update('profile', tok)}>
            {lvlLabel[tok]}<span className="ct">{c[tok]||0}</span>
          </button>
        ))}
      </div>
    );
  })();

  return (
    <div className={'filter-bar' + (isActive ? ' filter-bar-active' : '')}>
      {/* Issue #847: search row stays as a dedicated full-width row. */}
      <div className="fb-row fb-row-search">
        <div className="fb-search">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="5"/><path d="M11 11l3 3"/></svg>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search findings, check IDs, categories…"/>
          {search && <button className="fb-clear-x" onClick={()=>setSearch('')} aria-label="Clear">×</button>}
        </div>
      </div>
      {/* Issue #847: single flowing row for STATUS / SEVERITY / FRAMEWORK / DOMAIN /
          LEVEL groups separated by vertical dividers. Groups break as units when
          the viewport is narrower than the combined width; chips within a group
          still wrap internally as a fallback. Clear-all sits inline at the end
          when filters are active (was a dedicated trailing row). */}
      <div className="fb-row fb-row-flow">
        <div className="filter-group">
          <span className="filter-group-label">Status</span>
          {statusChips
            .filter(([v]) => (counts.status[v] || 0) > 0 || filters.status.includes(v))
            .map(([v,cls,label])=>(
              <button key={v} className={'chip '+cls+(filters.status.includes(v)?' selected':'')} onClick={()=>update('status',v)} title={STATUS_TIP[v]}>
                <span className="dot"/>{label || v}<span className="ct">{counts.status[v]||0}</span>
              </button>
            ))}
        </div>
        <div className="filter-divider"/>
        {/* #898: SEQUENCE filter group. Same semantic as the table column +
            state strip pill. Multi-select. */}
        <div className="filter-group">
          <span className="filter-group-label">Sequence</span>
          {seqChips
            .filter(([v]) => (counts.sequence?.[v] || 0) > 0 || (filters.sequence||[]).includes(v))
            .map(([v,cls,label]) => (
              <button key={v} className={'chip ' + cls + ((filters.sequence||[]).includes(v) ? ' selected' : '')} onClick={() => update('sequence', v)}>
                {label}<span className="ct">{counts.sequence?.[v]||0}</span>
              </button>
            ))}
        </div>
        <div className="filter-divider"/>
        <div className="filter-group">
          <span className="filter-group-label">Severity</span>
          {sevChips.map(([v,cls,label])=>(
            <button key={v} className={'chip '+cls+(filters.severity.includes(v)?' selected':'')} onClick={()=>update('severity',v)}>
              <span className="dot"/>{label}<span className="ct">{counts.severity[v]||0}</span>
            </button>
          ))}
        </div>
        <div className="filter-divider"/>
        <div className="filter-group" ref={fwRef}>
          <span className="filter-group-label">Framework</span>
          <button className={'chip chip-more'+(filters.framework.length?' selected':'')} onClick={()=>setFwOpen(o=>!o)}>
            {filters.framework.length ? `${filters.framework.length} selected` : 'All frameworks'}
            <svg width="10" height="10" viewBox="0 0 10 10" style={{marginLeft:4,opacity:.6}}><path d="M2 3l3 3 3-3" stroke="currentColor" strokeWidth="1.4" fill="none"/></svg>
          </button>
          {fwOpen && (
            <div className="domain-menu">
              {FRAMEWORKS.map(f=>(
                <label key={f.id} className={'domain-opt'+(filters.framework.includes(f.id)?' sel':'')}>
                  <input type="checkbox" checked={filters.framework.includes(f.id)} onChange={()=>update('framework',f.id)}/>
                  <span style={{fontFamily:'var(--font-mono)',fontSize:12}}>{f.id}</span>
                  <span className="ct">{counts.framework[f.id]||0}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="filter-divider"/>
        <div className="filter-group" ref={domainRef}>
          <span className="filter-group-label">Domain</span>
          <button className={'chip chip-more'+(filters.domain.length?' selected':'')} onClick={()=>setDomainOpen(o=>!o)}>
            {filters.domain.length ? `${filters.domain.length} selected` : 'All domains'}
            <svg width="10" height="10" viewBox="0 0 10 10" style={{marginLeft:4,opacity:.6}}><path d="M2 3l3 3 3-3" stroke="currentColor" strokeWidth="1.4" fill="none"/></svg>
          </button>
          {domainOpen && (
            <div className="domain-menu">
              {domainList.map(d => (
                <label key={d} className={'domain-opt'+(filters.domain.includes(d)?' sel':'')}>
                  <input type="checkbox" checked={filters.domain.includes(d)} onChange={()=>update('domain',d)}/>
                  <span>{d}</span>
                  <span className="ct">{counts.domain[d]||0}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        {levelGroup && <div className="filter-divider"/>}
        {levelGroup}
        {active > 0 && (
          <button className="filter-clear filter-clear-inline"
            onClick={()=>setFilters({status:[],sequence:[],severity:[],framework:[],domain:[],profile:[]})}>
            Clear {active} filter{active===1?'':'s'}
          </button>
        )}
      </div>
    </div>
  );
}

// ======================== Search highlight helper ========================
function Highlight({ text, query }) {
  if (!query || !text) return text || null;
  const str = String(text);
  const q = query.toLowerCase();
  const parts = [];
  let lower = str.toLowerCase();
  let last = 0, idx;
  while ((idx = lower.indexOf(q, last)) !== -1) {
    if (idx > last) parts.push(str.slice(last, idx));
    parts.push(<mark key={idx} className="search-hl">{str.slice(idx, idx + q.length)}</mark>);
    last = idx + q.length;
  }
  if (last < str.length) parts.push(str.slice(last));
  return parts.length ? parts : text;
}

// ======================== Findings table ========================
// #917: Column widths use minmax(min, preferred) so the table can shrink
// gracefully on narrow viewports instead of overflowing horizontally. The
// 'finding' column carries the 1fr term so leftover space flows there on
// wide displays. User-resized widths (colWidths[id]) snap to a px value
// and override the minmax form for that column.
// --------------------- Status legend (#962) ---------------------
// Plain-language key for the table's full nine-status vocabulary. The note
// line explains how summary charts group the last four as "Not assessed" so
// the two layers never read as contradictory. beforeprint forces it open so
// printed/PDF copies always include the key.
function StatusLegend() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const expand = () => setOpen(true);
    window.addEventListener('beforeprint', expand);
    return () => window.removeEventListener('beforeprint', expand);
  }, []);
  const statusOrder = ['Pass','Fail','Warning','Review','Info','Skipped','Unknown','NotApplicable','NotLicensed'];
  const sevOrder = ['critical','high','medium','low'];
  return (
    <details className="status-legend" open={open} onToggle={e => setOpen(e.target.open)}>
      <summary>How to read this table</summary>
      <div className="status-legend-grid">
        {statusOrder.map(s => (
          <React.Fragment key={s}>
            <span><span className={'status-badge ' + STATUS_COLORS[s]}><span className="dot"/>{statusLabel(s)}</span></span>
            <span className="status-legend-desc">{STATUS_TIP[s]}</span>
          </React.Fragment>
        ))}
      </div>
      <div className="status-legend-note">
        Only Pass, Fail, and Warning count toward scores. The last four statuses appear in full here and are grouped as a single muted "{NOT_ASSESSED_LABEL}" entry in the summary charts above.
      </div>
      <div className="status-legend-grid">
        {sevOrder.map(s => (
          <React.Fragment key={s}>
            <span><span className={'sev-badge ' + s}><span className="bar"><i/><i/><i/><i/></span><span>{SEV_LABEL[s]}</span></span></span>
            <span className="status-legend-desc">{SEV_TIP[s]}</span>
          </React.Fragment>
        ))}
      </div>
    </details>
  );
}

const ALL_COLS = [
  { id: 'status',    label: 'Status',    width: 'minmax(60px, 80px)'      },
  { id: 'finding',   label: 'Finding',   width: 'minmax(180px, 1.5fr)'    },
  { id: 'domain',    label: 'Domain',    width: 'minmax(90px, 140px)'     },
  { id: 'controlId', label: 'Control #', width: 'minmax(70px, 100px)'     },
  { id: 'checkId',   label: 'CheckID',   width: 'minmax(100px, 160px)'    },
  { id: 'sequence',  label: 'Sequence',  width: 'minmax(70px, 90px)'      },
  { id: 'severity',  label: 'Severity',  width: 'minmax(70px, 100px)'     },
  { id: 'frameworks',label: 'Frameworks',width: 'minmax(80px, 120px)'     },
];
// #898 + #917: include sequence in default visible columns. Sequence sits
// immediately to the left of severity per #917 so the workflow signal
// (Now/Next/Later) reads adjacent to the priority signal (Severity).
// #962: checkId ships hidden — internal identifiers overwhelm non-technical
// readers. Still listed in ALL_COLS, so the Columns picker can re-enable it
// (per-session; visibility is deliberately not persisted).
const DEFAULT_COLS = ['status', 'finding', 'domain', 'controlId', 'sequence', 'severity'];

// Issue #846: enum orderings for sort. Status uses the "worst first" order
// that matches the row-color severity ramp; severity uses the standard
// critical-down ordering.
const FT_STATUS_ORDER = ['Fail','Warning','Review','Pass','Info','Skipped','Unknown','NotApplicable','NotLicensed'];
const FT_SEV_ORDER = ['critical','high','medium','low','info'];
// #898: sequence sort = workflow priority order. Now/Next/Later for active
// remediation, then Done (Pass), then "—" (everything else).
const FT_SEQ_ORDER = ['now','soon','later','done','none'];
const FT_SORTABLE = new Set(['status','sequence','finding','domain','checkId','severity']);

function FindingsTable({ filters, search, focusFinding, onFocusClear, onMatchesChange, editMode, hiddenFindings, onHide, onHideBulk, onRestoreAll }) {
  const { open: sectionOpen, headProps } = useCollapsibleSection();
  const [open, setOpen] = useState(new Set());
  const [visibleCols, setVisibleCols] = useState(DEFAULT_COLS);
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const colPickerRef = useRef(null);

  // Issue #846: sort + resize. Both persist per-tenant in localStorage so
  // user preferences survive a refresh.
  const [sort, setSort] = useState(() => {
    try {
      const raw = localStorage.getItem(LS('m365-findings-sort'));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });
  const [colWidths, setColWidths] = useState(() => {
    try {
      const raw = localStorage.getItem(LS('m365-col-widths'));
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  // #917: per-user column order. Initialised from DEFAULT_COLS with any
  // missing IDs (e.g. ones added in a later release) appended in their
  // ALL_COLS order, and any stale IDs (removed columns) dropped.
  const [colOrder, setColOrder] = useState(() => {
    try {
      const raw = localStorage.getItem(LS('m365-col-order'));
      const stored = raw ? JSON.parse(raw) : null;
      if (Array.isArray(stored) && stored.length) {
        const known = new Set(ALL_COLS.map(c => c.id));
        const filtered = stored.filter(id => known.has(id));
        const missing = ALL_COLS.map(c => c.id).filter(id => !filtered.includes(id));
        return [...filtered, ...missing];
      }
    } catch {}
    return ALL_COLS.map(c => c.id);
  });
  // #917: drag-and-drop reorder state. dragColId is the column currently
  // being dragged; dropTargetId is the column the cursor is over.
  const [dragColId, setDragColId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  useEffect(() => {
    try { localStorage.setItem(LS('m365-findings-sort'), JSON.stringify(sort)); } catch {}
  }, [sort]);
  useEffect(() => {
    try { localStorage.setItem(LS('m365-col-widths'), JSON.stringify(colWidths)); } catch {}
  }, [colWidths]);
  useEffect(() => {
    try { localStorage.setItem(LS('m365-col-order'), JSON.stringify(colOrder)); } catch {}
  }, [colOrder]);

  const onColDragStart = (colId, ev) => {
    setDragColId(colId);
    try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', colId); } catch {}
  };
  const onColDragOver = (colId, ev) => {
    if (!dragColId || dragColId === colId) return;
    ev.preventDefault();
    if (dropTargetId !== colId) setDropTargetId(colId);
  };
  const onColDrop = (colId, ev) => {
    ev.preventDefault();
    if (!dragColId || dragColId === colId) { setDragColId(null); setDropTargetId(null); return; }
    setColOrder(o => {
      const next = o.filter(id => id !== dragColId);
      const idx = next.indexOf(colId);
      if (idx < 0) return o;
      next.splice(idx, 0, dragColId);
      return next;
    });
    setDragColId(null);
    setDropTargetId(null);
  };
  const onColDragEnd = () => { setDragColId(null); setDropTargetId(null); };

  // Cycle sort: none → asc → desc → none.
  const cycleSort = (key) => setSort(s => {
    if (!s || s.key !== key) return { key, dir: 'asc' };
    if (s.dir === 'asc') return { key, dir: 'desc' };
    return null;
  });

  // Drag handle on the right edge of a header cell. captures the current
  // rendered offsetWidth of the header at mousedown so 'fr'-based columns
  // snap to a px width on first drag.
  const startResize = (colId, ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const headerCell = ev.currentTarget.parentElement;
    const startX = ev.clientX;
    const startWidth = headerCell.offsetWidth;
    const onMove = (e) => {
      const next = Math.max(60, Math.round(startWidth + (e.clientX - startX)));
      setColWidths(w => ({ ...w, [colId]: next }));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    if (!colPickerOpen) return;
    const onKey = e => { if (e.key === 'Escape') setColPickerOpen(false); };
    const onOut = e => { if (colPickerRef.current && !colPickerRef.current.contains(e.target)) setColPickerOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onOut);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onOut);
    };
  }, [colPickerOpen]);

  // Issue #697: track the previously focused finding so smart-search cycling
  // can collapse the prior expanded row. Plain ref — does not trigger renders.
  const prevFocusRef = useRef(null);

  useEffect(() => {
    if (!focusFinding) return;
    // Expand the new match and collapse the previously cycled-to one. Indices
    // in the `open` Set track positions in `filtered`, so this only works if
    // the row actually appears in the current filtered view.
    setOpen(o => {
      const n = new Set(o);
      const prev = prevFocusRef.current;
      if (prev && prev !== focusFinding) {
        const prevIdx = sortedFiltered.findIndex(f => f.checkId === prev);
        if (prevIdx >= 0) n.delete(prevIdx);
      }
      const idx = sortedFiltered.findIndex(f => f.checkId === focusFinding);
      if (idx >= 0) n.add(idx);
      return n;
    });
    prevFocusRef.current = focusFinding;
    const timer = setTimeout(() => {
      const rowId = 'finding-row-' + focusFinding.replace(/\./g, '-');
      const el = document.getElementById(rowId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlight-focus');
        setTimeout(() => { el.classList.remove('highlight-focus'); onFocusClear?.(); }, 2500);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [focusFinding]);

  const toggleCol = id => setVisibleCols(v =>
    v.includes(id) ? (v.length > 1 ? v.filter(c => c !== id) : v) : [...v, id]
  );

  // #917: render columns in user-specified colOrder (filtered by visible).
  const colMap = new Map(ALL_COLS.map(c => [c.id, c]));
  const cols = colOrder.filter(id => visibleCols.includes(id)).map(id => colMap.get(id)).filter(Boolean);
  // Issue #846: per-column custom widths override the default. fr columns
  // stay fr until the user drags, then they snap to px.
  const gridTpl = cols.map(c => (colWidths[c.id] ? colWidths[c.id] + 'px' : c.width)).join(' ') + ' 28px';

  // Issue #697: publish the current filtered set up to App so the smart-search
  // counter and Enter-cycling can operate over the same in-view findings.
  // Empty array when no search query — counter hides and cycling no-ops.

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return FINDINGS.filter(f => {
      if (!editMode && hiddenFindings?.has(f.checkId)) return false;
      if (filters.status.length && !filters.status.includes(f.status)) return false;
      if ((filters.sequence||[]).length) {
        // #898: sequence filter — match the same logic as the column pill
        const seq = (f.lane && LANE_LABELS[f.lane]) ? f.lane
                  : (f.status === 'Pass') ? 'done'
                  : null;
        if (!seq || !filters.sequence.includes(seq)) return false;
      }
      if (filters.severity.length && !filters.severity.includes(f.severity)) return false;
      if (filters.framework.length && !f.frameworks.some(fw => filters.framework.includes(fw))) return false;
      if (filters.domain.length && !filters.domain.includes(f.domain)) return false;
      if ((filters.profile||[]).length) {
        const activeFw = filters.framework.length === 1 ? filters.framework[0] : null;
        const fProfiles = activeFw ? [].concat(f.fwMeta?.[activeFw]?.profiles || []) : [];
        if (!filters.profile.some(token => matchProfileToken(fProfiles, token))) return false;
      }
      if (s) {
        const hay = (f.setting+' '+f.checkId+' '+f.current+' '+f.recommended+' '+f.remediation+' '+f.domain+' '+f.section).toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [filters, search, editMode, hiddenFindings]);

  // Issue #846: sorted view layered on top of the filter pipeline. When sort
  // is null (default), original order is preserved. Status and severity sort
  // by enum index so 'Fail' beats 'Pass' regardless of dir; other columns use
  // locale string compare.
  const sortedFiltered = useMemo(() => {
    if (!sort) return filtered;
    const arr = [...filtered];
    const cmp = (a, b) => {
      let av, bv;
      const seqRank = (f) => {
        if (f.lane && FT_SEQ_ORDER.includes(f.lane)) return FT_SEQ_ORDER.indexOf(f.lane);
        if (f.status === 'Pass') return FT_SEQ_ORDER.indexOf('done');
        return FT_SEQ_ORDER.indexOf('none');
      };
      if (sort.key === 'status') { av = FT_STATUS_ORDER.indexOf(a.status); bv = FT_STATUS_ORDER.indexOf(b.status); }
      else if (sort.key === 'sequence') { av = seqRank(a); bv = seqRank(b); }
      else if (sort.key === 'severity') { av = FT_SEV_ORDER.indexOf(a.severity); bv = FT_SEV_ORDER.indexOf(b.severity); }
      else if (sort.key === 'finding') { av = (a.setting || '').toLowerCase(); bv = (b.setting || '').toLowerCase(); }
      else if (sort.key === 'domain') { av = (a.domain || '').toLowerCase(); bv = (b.domain || '').toLowerCase(); }
      else if (sort.key === 'checkId') { av = (a.checkId || '').toLowerCase(); bv = (b.checkId || '').toLowerCase(); }
      else { av = 0; bv = 0; }
      if (av < bv) return sort.dir === 'asc' ? -1 : 1;
      if (av > bv) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    };
    arr.sort(cmp);
    return arr;
  }, [filtered, sort]);

  // Issue #697: publish matches up to App. Only emit when there is a query;
  // empty list when search is cleared so the counter hides and cycling no-ops.
  useEffect(() => {
    if (!onMatchesChange) return;
    onMatchesChange(search ? sortedFiltered.map(f => f.checkId) : []);
  }, [sortedFiltered, search, onMatchesChange]);

  const isFiltered = search.length > 0
    || filters.status.length > 0
    || filters.severity.length > 0
    || filters.framework.length > 0
    || filters.domain.length > 0
    || (filters.profile || []).length > 0;

  const toggle = i => setOpen(o => {
    const n = new Set(o);
    if (n.has(i)) n.delete(i); else n.add(i);
    return n;
  });

  const hl = (text, q) => {
    if (!q || !text) return text;
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i === -1) return text;
    return [
      text.slice(0, i),
      <span style={{background:'var(--accent-soft)',color:'var(--accent-text)',borderRadius:2,padding:'0 1px'}}>{text.slice(i, i + q.length)}</span>,
      text.slice(i + q.length)
    ];
  };

  const renderCell = (colId, f) => {
    switch (colId) {
      case 'status': return (
        <div key="status" style={{display:'flex',flexDirection:'column',gap:3}}>
          <span className={'status-badge ' + STATUS_COLORS[f.status]} title={STATUS_TIP[f.status]}>
            <span className="dot"/>{statusLabel(f.status)}
          </span>
          {f.intentDesign && <span className="badge-intent">By Design</span>}
        </div>
      );
      case 'sequence': {
        // #898: same pill UX as the state strip in #896. Pass→Done, lane→
        // coloured pill, otherwise muted dash.
        const isPass = f.status === 'Pass';
        if (f.lane && LANE_LABELS[f.lane]) {
          return <div key="sequence"><span className={'fdc-pill ' + LANE_CSS[f.lane]}>{LANE_LABELS[f.lane]}</span></div>;
        }
        if (isPass) {
          return <div key="sequence"><span className="fdc-pill done">Done</span></div>;
        }
        return <div key="sequence"><span style={{color:'var(--muted)'}}>—</span></div>;
      }
      case 'finding': return (
        <div key="finding" className="finding-title">
          <div className="t"><Highlight text={f.setting} query={search}/></div>
          <div className="sub"><Highlight text={f.section} query={search}/></div>
        </div>
      );
      case 'domain':    return <div key="domain" className="finding-dom"><Highlight text={f.domain} query={search}/></div>;
      case 'controlId': {
        const activeFw = filters.framework.length === 1 ? filters.framework[0] : null;
        const meta = activeFw ? f.fwMeta?.[activeFw] : null;
        const FW_PREF = ['cis-m365-v6','nist-800-53','cmmc','nist-csf','iso-27001'];
        const cid = meta?.controlId || (() => {
          if (!f.fwMeta) return null;
          for (const fw of FW_PREF) { if (f.fwMeta[fw]?.controlId) return f.fwMeta[fw].controlId; }
          const first = Object.values(f.fwMeta).find(v => v?.controlId);
          return first?.controlId || null;
        })();
        const profiles = activeFw ? [].concat(meta?.profiles || []) : [];
        // Handles both "E3-L1" (CIS) and bare "L1" (CMMC) profile formats
        const rawLevels = [...new Set(profiles.flatMap(p => { const m = p.match(/(L\d+)/); return m ? [m[1]] : []; }))].sort();
        // For CMMC (cumulative model) show only the highest level; for others show full set
        const isCmmcFw = activeFw?.startsWith('cmmc');
        const lvl = isCmmcFw && rawLevels.length > 1 ? rawLevels[rawLevels.length - 1] : rawLevels.join('+');
        const lvlCls = lvl === 'L3' ? 'level3' : lvl.includes('L2') && !lvl.includes('L1') ? 'level2' : 'level';
        const lic  = profiles.some(p => p.startsWith('E3')) && profiles.some(p => p.startsWith('E5')) ? 'E3+E5'
                   : profiles.some(p => p.startsWith('E5')) ? 'E5'
                   : profiles.some(p => p.startsWith('E3')) ? 'E3' : '';
        return (
          <div key="controlId" style={{display:'flex', flexDirection:'column', gap:2, minWidth:0}}>
            {/* #900: long controlId strings (MITRE T-codes are 200+ chars
                semicolon-joined) blow out the row. Truncate via CSS, full
                value visible via native title tooltip. */}
            <span className="check-id check-id-truncate"
                  style={cid ? undefined : {color:'var(--muted)', fontStyle:'italic'}}
                  title={cid || ''}>{cid || '—'}</span>
            {(lvl || lic) && (
              <span style={{display:'inline-flex', gap:3}}>
                {lvl && <span className={'fw-profile-chip ' + lvlCls}>{lvl}</span>}
                {lic && <span className={'fw-profile-chip ' + (lic === 'E5' ? 'lic5' : 'lic')}>{lic}</span>}
              </span>
            )}
          </div>
        );
      }
      case 'checkId': return (
        <div key="checkId" className="check-id"><Highlight text={f.checkId} query={search}/></div>
      );
      case 'severity':  return (
        <div key="severity">
          <span className={'sev-badge ' + f.severity}>
            <span className="bar"><i/><i/><i/><i/></span>
            <span>{SEV_LABEL[f.severity]}</span>
          </span>
        </div>
      );
      case 'frameworks': return (
        <div key="frameworks" className="fw-list">
          {f.frameworks.map(fw => <span key={fw} className="fw-pill">{fw}</span>)}
        </div>
      );
      default: return null;
    }
  };

  return (
    <section className="block" id="findings">
      <div {...headProps}>
        <span className="eyebrow">03 · Detail</span>
        <h2>All findings{isFiltered
          ? <span style={{marginLeft:8,fontSize:12,fontWeight:500,background:'var(--accent-soft)',border:'1px solid var(--accent-border)',color:'var(--accent-text)',borderRadius:20,padding:'2px 10px',verticalAlign:'middle'}}>Showing {sortedFiltered.length} of {FINDINGS.length}</span>
          : <span style={{fontWeight:400,color:'var(--muted)',fontSize:13}}> · {FINDINGS.length} total</span>
        }</h2>
        {editMode && (hiddenFindings?.size > 0) && (
          <button className="restore-all-btn" onClick={e => {e.stopPropagation(); onRestoreAll();}}>
            ↩ Restore {hiddenFindings.size} hidden
          </button>
        )}
        <button className="chip chip-more" style={{marginLeft:12,flexShrink:0}}
                onClick={e => {e.stopPropagation(); setOpen(open.size === sortedFiltered.length && sortedFiltered.length > 0 ? new Set() : new Set(sortedFiltered.map((_,i) => i)));}}
                title={open.size === sortedFiltered.length && sortedFiltered.length > 0 ? 'Collapse all findings' : 'Expand all findings'}>
          {open.size === sortedFiltered.length && sortedFiltered.length > 0 ? '− Collapse all' : '+ Expand all'}
        </button>
        <div ref={colPickerRef} style={{position:'relative', marginLeft:8, flexShrink:0}} onClick={e => e.stopPropagation()}>
          <button className={'chip chip-more' + (visibleCols.length !== DEFAULT_COLS.length ? ' selected' : '')}
                  onClick={() => setColPickerOpen(o => !o)} title="Choose columns">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" style={{marginRight:4}}><path d="M3 5h10M3 11h10"/><circle cx="6" cy="5" r="1.5" fill="currentColor" stroke="none"/><circle cx="10" cy="11" r="1.5" fill="currentColor" stroke="none"/></svg>
            Columns
          </button>
          {colPickerOpen && (
            <div className="domain-menu" style={{right:0, left:'auto', minWidth:180}}>
              {ALL_COLS.map(c => (
                <label key={c.id} className={'domain-opt' + (visibleCols.includes(c.id) ? ' sel' : '')}>
                  <input type="checkbox" checked={visibleCols.includes(c.id)} onChange={() => toggleCol(c.id)}/>
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <span className="section-chevron" aria-hidden="true">{sectionOpen ? '▾' : '▸'}</span>
        <div className="hr"/>
      </div>

      {sectionOpen && <div className="findings">
        <StatusLegend/>
        <div className="findings-head" style={{gridTemplateColumns: gridTpl}}>
          {cols.map(c => {
            const sortable = FT_SORTABLE.has(c.id);
            const isActive = sort?.key === c.id;
            const isDragging = dragColId === c.id;
            const isDropTarget = dropTargetId === c.id && dragColId && dragColId !== c.id;
            return (
              <div key={c.id}
                   className={'findings-col-head'
                     + (isDragging ? ' col-dragging' : '')
                     + (isDropTarget ? ' col-drop-target' : '')}
                   onDragOver={(ev) => onColDragOver(c.id, ev)}
                   onDrop={(ev) => onColDrop(c.id, ev)}>
                {/* #917: drag-grip handle. Only this element is draggable so
                    sort-button clicks and resize drags continue to work. */}
                <span className="findings-col-drag"
                      draggable
                      onDragStart={(ev) => onColDragStart(c.id, ev)}
                      onDragEnd={onColDragEnd}
                      title="Drag to reorder column"
                      aria-label={`Reorder ${c.label} column`}>⋮⋮</span>
                {sortable
                  ? <button type="button" className={'findings-col-sort' + (isActive ? ' active' : '')}
                      onClick={() => cycleSort(c.id)} title={`Sort by ${c.label}`}>
                      <span>{c.label}</span>
                      <span className="findings-col-sort-arrow">
                        {isActive ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                      </span>
                    </button>
                  : <span>{c.label}</span>}
                <div className="findings-col-resize"
                  onMouseDown={(ev) => startResize(c.id, ev)}
                  onClick={e => e.stopPropagation()}
                  title="Drag to resize"/>
              </div>
            );
          })}
          <div/>
        </div>
        {sortedFiltered.length === 0 && <div className="empty">No findings match your filters.</div>}
        {sortedFiltered.map((f,i) => {
          const isOpen = open.has(i);
          const isHidden = hiddenFindings?.has(f.checkId);
          return (
            <React.Fragment key={i}>
              <div id={'finding-row-'+(f.checkId||'').replace(/\./g,'-')}
                   className={'finding-row' + (isOpen?' open':'') + (isHidden?' finding-hidden':'')} onClick={() => toggle(i)}
                   style={{gridTemplateColumns: gridTpl}}>
                {cols.map(c => renderCell(c.id, f))}
                {editMode
                  ? <button className={'hide-finding-btn'+(isHidden?' restore':'')}
                      title={isHidden?'Restore finding':'Hide from report'}
                      onClick={e => { e.stopPropagation(); onHide?.(f.checkId); }}>
                      {isHidden ? '↩' : '✕'}
                    </button>
                  : <div className="caret"><Icon.chevron/></div>
                }
              </div>
              {isOpen && (
                <div className="finding-detail fdd">
                  {/* #901: Copy-to-clipboard button — top-right floating
                      action that emits a markdown summary of the finding. */}
                  <FindingCopyButton f={f}/>
                  {f.intentDesign && (
                    <div className="intent-callout">
                      <strong>Intentional by design.</strong>
                      {f.intentRationale && <span> {f.intentRationale}</span>}
                    </div>
                  )}
                  {/* #863 Phase 2 — Direction D state strip + risk narrative */}
                  <FindingStateStrip f={f}/>
                  <FindingRiskNarrative f={f}/>
                  {/* Existing Phase-3-pending content rows. Will be replaced
                      by typed observed/expected + tabbed actions in Phase 3. */}
                  <div className="fdd-legacy-block">
                    <div className="block-title">Current value</div>
                    <div className={'value-box current finding-current-' + statusTier(f.status)}>{f.current || '—'}</div>
                  </div>
                  <div className="fdd-legacy-block">
                    <div className="block-title">Recommended value</div>
                    <div className="value-box recommended">{f.recommended || '—'}</div>
                  </div>
                  {f.remediation && (
                    <div className="finding-remediation fdd-legacy-block">
                      <div className="block-title">Remediation</div>
                      <div className="remediation-text">{f.remediation}</div>
                    </div>
                  )}
                  {f.references && f.references.length > 0 && (
                    <div className="finding-learn-more fdd-legacy-block">
                      <div className="block-title">Learn more</div>
                      {f.references.map((r, i) => (
                        <a key={i} href={r.url} target="_blank" rel="noreferrer noopener">📖 {r.title} ↗</a>
                      ))}
                    </div>
                  )}
                  {/* #863 Phase 2 — collapsible provenance footer */}
                  <FindingProvenanceFooter evidence={f.evidence}/>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>}
    </section>
  );
}
