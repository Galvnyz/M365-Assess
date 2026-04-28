// Direction Merged — adaptive layout based on framework count.
// 1 framework  → A's toolbar + focus (one big detail surface, donut score).
// 2+ frameworks → C's comparison table + a coverage chart, with focused detail
//                 panel below using the same donut score.
//
// "Manage frameworks" toggles which frameworks are in scope.
//
// Polishes:
//  - Donut: animated draw-in + count-up percentage on mount/change
//  - Comparison table: sortable column headers
//  - Coverage chart: hover tooltip with breakdown, focus animation
//  - Family chart: clickable rows that drill in (banner feedback)
//  - Profile chips: action feedback banner
//  - Smooth focus transition between frameworks (fade)
//  - Empty state when 0 frameworks visible
//  - Real primary CTA button

const {
  useState: useStateM,
  useRef: useRefM,
  useEffect: useEffectM,
  useMemo: useMemoM,
} = React;

/* ---------- count-up hook ---------- */
function useCountUp(value, duration = 600) {
  const [n, setN] = useStateM(value);
  const startRef = useRefM(null);
  const fromRef = useRefM(value);
  const rafRef = useRefM(0);
  useEffectM(() => {
    fromRef.current = n;
    startRef.current = null;
    cancelAnimationFrame(rafRef.current);
    const tick = (ts) => {
      if (startRef.current == null) startRef.current = ts;
      const t = Math.min(1, (ts - startRef.current) / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      const cur = fromRef.current + (value - fromRef.current) * eased;
      setN(cur);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line
  }, [value]);
  return n;
}

/* ---------- Donut / ring chart for score ---------- */
function ScoreDonut({ counts, size = 168, stroke = 18, animKey = 'donut' }) {
  const segs = [
    { key: 'pass',   v: counts.pass,   color: 'var(--success)' },
    { key: 'warn',   v: counts.warn,   color: 'var(--warn)' },
    { key: 'fail',   v: counts.fail,   color: 'var(--danger)' },
    { key: 'review', v: counts.review, color: 'var(--accent)' },
    { key: 'info',   v: counts.info,   color: 'var(--muted)' },
  ].filter(s => s.v > 0);

  const total = counts.total || 1;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;
  const targetPct = coveragePct(counts);
  const animatedPct = useCountUp(targetPct, 700);
  const tone = readinessLabel(targetPct).tone;

  // Mount/key animation: scale circumference from 0 → full
  const [progress, setProgress] = useStateM(0);
  useEffectM(() => {
    setProgress(0);
    const id = requestAnimationFrame(() => {
      // small delay so transition picks it up
      setTimeout(() => setProgress(1), 40);
    });
    return () => cancelAnimationFrame(id);
  }, [animKey, counts.total, counts.pass, counts.warn, counts.fail]);

  let acc = 0;
  return (
    <div className="fw-donut-wrap" style={{width: size, height: size}}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="fw-donut">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} opacity=".4"/>
        {segs.map((s, i) => {
          const frac = s.v / total;
          const dash = frac * c * progress;
          const offset = -acc * c * progress;
          acc += frac;
          const gap = segs.length > 1 ? 1.5 : 0;
          return (
            <circle key={s.key}
              cx={cx} cy={cy} r={r} fill="none"
              stroke={s.color} strokeWidth={stroke} strokeLinecap="butt"
              strokeDasharray={`${Math.max(0, dash - gap)} ${c}`}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${cx} ${cy})`}
              style={{transition:'stroke-dasharray .7s cubic-bezier(.22,1,.36,1), stroke-dashoffset .7s cubic-bezier(.22,1,.36,1)'}}
            />
          );
        })}
      </svg>
      <div className="fw-donut-center">
        <div className={'fw-donut-pct ' + tone}>{Math.round(animatedPct)}<span>%</span></div>
        <div className="fw-donut-sub">{counts.pass}/{counts.total}</div>
      </div>
    </div>
  );
}

/* ---------- Manage frameworks dropdown ---------- */
function ManageButton({ allFw, visible, onToggle, onSetAll }) {
  const [open, setOpen] = useStateM(false);
  const ref = useRefM(null);
  useEffectM(() => {
    if (!open) return;
    const onOut = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onOut);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onOut);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);
  return (
    <div ref={ref} style={{position:'relative'}}>
      <button className={'chip chip-more' + (open ? ' selected' : '')} onClick={() => setOpen(o => !o)}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" style={{marginRight:4}}>
          <path d="M3 4h10M3 8h10M3 12h10"/>
          <circle cx="6" cy="4" r="1.5" fill="currentColor" stroke="none"/>
          <circle cx="11" cy="8" r="1.5" fill="currentColor" stroke="none"/>
          <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/>
        </svg>
        Manage frameworks
        <svg width="10" height="10" viewBox="0 0 10 10" style={{marginLeft:6, opacity:.6, transition:'transform .15s', transform: open ? 'rotate(180deg)' : 'none'}}>
          <path d="M2 3l3 3 3-3" stroke="currentColor" strokeWidth="1.4" fill="none"/>
        </svg>
      </button>
      {open && (
        <div className="domain-menu fw-manage-menu">
          <div className="fw-manage-head">
            <div className="fw-manage-eyebrow">
              Frameworks in scope · {visible.length} of {allFw.length}
            </div>
            <div className="fw-manage-bulk">
              <button onClick={() => onSetAll(allFw.map(f => f.id))}>Select all</button>
              <span>·</span>
              <button onClick={() => onSetAll([allFw[0].id])} disabled={visible.length === 1}>Reset</button>
            </div>
          </div>
          {allFw.map(f => {
            const sel = visible.includes(f.id);
            const pct = coveragePct(f.counts);
            const r = readinessLabel(pct);
            return (
              <label key={f.id} className={'domain-opt' + (sel ? ' sel' : '')}>
                <input type="checkbox" checked={sel} onChange={() => onToggle(f.id)}/>
                <div style={{minWidth:0, flex:1}}>
                  <div style={{fontSize:12, fontWeight:500}}>{f.full}</div>
                  <div style={{fontSize:11, color:'var(--muted)', fontFamily:'var(--font-mono)'}}>{f.id} · {f.counts.total} controls</div>
                </div>
                <span className={'ct ' + r.tone}>{pct}%</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- Profile chips (shared) ---------- */
function ProfileChipsM({ framework, active, onChange, compact }) {
  if (!framework.profileType) return null;
  const tokens = framework.profileType === 'cmmc'
    ? [
        { tok: 'L1', label: 'L1', count: framework.profiles.L1, cls: 'level' },
        { tok: 'L2', label: 'L2', count: framework.profiles.L2, cls: 'level2' },
        { tok: 'L3', label: 'L3', count: framework.profiles.L3, cls: 'level3' },
      ]
    : framework.profileType === 'cis'
      ? [
          { tok: 'L1', label: 'L1', count: framework.profiles.L1, cls: 'level' },
          { tok: 'L2', label: 'L2', count: framework.profiles.L2, cls: 'level2' },
          { tok: 'E3', label: 'E3', count: framework.profiles.E3, cls: 'lic' },
          { tok: 'E5only', label: 'E5 only', count: framework.profiles.E5only, cls: 'lic5' },
        ]
      : [
          { tok: 'Low', label: 'Low', count: framework.profiles.Low, cls: 'level' },
          { tok: 'Mod', label: 'Moderate', count: framework.profiles.Mod, cls: 'level2' },
          { tok: 'High', label: 'High', count: framework.profiles.High, cls: 'level3' },
        ];
  return (
    <div>
      {!compact && (
        <div style={{fontSize:11, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.08em', fontWeight:600, marginBottom:6}}>
          Filter by {framework.profileType === 'cmmc' ? 'maturity level' : framework.profileType === 'cis' ? 'profile' : 'baseline'}
        </div>
      )}
      <div style={{display:'flex', gap:6, alignItems:'center', flexWrap:'wrap'}}>
        {tokens.map(t => (
          <button key={t.tok}
            className={'fw-profile-chip fw-profile-chip-btn ' + t.cls + (active.includes(t.tok) ? ' selected' : '')}
            onClick={() => {
              const next = active.includes(t.tok) ? active.filter(x => x !== t.tok) : [...active, t.tok];
              onChange(next);
            }}>
            {t.label} <b>{t.count}</b>
          </button>
        ))}
        {active.length > 0 && (
          <button className="fw-tb-clear" onClick={()=>onChange([])}>Clear</button>
        )}
      </div>
    </div>
  );
}

/* ---------- Filter banner (shows feedback when chips/family selected) ---------- */
function FilterBanner({ profiles, family, onClear }) {
  if (profiles.length === 0 && !family) return null;
  const parts = [];
  if (profiles.length) parts.push(`${profiles.length} profile filter${profiles.length>1?'s':''} (${profiles.join(', ')})`);
  if (family) parts.push(`family ${family.code}`);
  return (
    <div className="fw-filter-banner">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M2 3h12l-4.5 6v4l-3 1.5V9L2 3z"/>
      </svg>
      <span>Filtered by {parts.join(' + ')}</span>
      <button onClick={onClear}>Clear</button>
    </div>
  );
}

/* ---------- Family chart (shared) — clickable rows ---------- */
function FamilyChartM({ families, focused, onFocus }) {
  const max = Math.max(...families.map(f => f.total));
  return (
    <div className="fw-fam-chart">
      {families.map(fam => {
        const pct = Math.round(((fam.pass + fam.info * 0.5) / fam.total) * 100);
        const ok = pct >= 80;
        const isFocused = focused && focused.code === fam.code;
        return (
          <button key={fam.code}
            className={'fw-fam-row fw-fam-row-btn' + (isFocused ? ' focused' : '')}
            onClick={() => onFocus && onFocus(isFocused ? null : fam)}
            type="button">
            <div className="fw-fam-code">{fam.code}</div>
            <div className="fw-fam-name">{fam.name}</div>
            <div className="fw-fam-track" style={{flexBasis: `${(fam.total / max) * 100}%`}}>
              <div className="fw-bar fw-fam-bar">
                {fam.pass>0   && <div className="fw-seg pass"   style={{flex:fam.pass}}/>}
                {fam.warn>0   && <div className="fw-seg warn"   style={{flex:fam.warn}}/>}
                {fam.fail>0   && <div className="fw-seg fail"   style={{flex:fam.fail}}/>}
                {fam.review>0 && <div className="fw-seg review" style={{flex:fam.review}}/>}
                {fam.info>0   && <div className="fw-seg info"   style={{flex:fam.info}}/>}
              </div>
            </div>
            <div className={'fw-fam-stat ' + (ok ? 'pass' : fam.fail > 2 ? 'fail' : 'warn')}>
              {fam.fail > 0 ? `${fam.fail} gap${fam.fail!==1?'s':''}` : `${fam.pass} pass`}
            </div>
            <div className="fw-fam-pct">{pct}%</div>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Coverage comparison chart (multi-framework) ---------- */
function CoverageChart({ frameworks, focused, onFocus }) {
  const sorted = useMemoM(
    () => [...frameworks].sort((a, b) => coveragePct(b.counts) - coveragePct(a.counts)),
    [frameworks]
  );
  return (
    <div className="fw-cov-chart">
      <div className="fw-cov-chart-head">
        <div>
          <div style={{fontSize:11, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.1em', fontWeight:700, marginBottom:2}}>Coverage comparison</div>
          <div style={{fontSize:12, color:'var(--text-soft)'}}>{frameworks.length} frameworks · sorted by coverage</div>
        </div>
        <div className="fw-cov-chart-axis">
          <span>0%</span><span>50%</span><span>100%</span>
        </div>
      </div>
      <div className="fw-cov-chart-body">
        {sorted.map(fw => {
          const pct = coveragePct(fw.counts);
          const r = readinessLabel(pct);
          const isFocused = focused === fw.id;
          // breakdown tooltip
          const tip = `${fw.counts.pass} pass · ${fw.counts.warn} warn · ${fw.counts.fail} fail` +
            (fw.counts.review > 0 ? ` · ${fw.counts.review} review` : '') +
            (fw.counts.info > 0 ? ` · ${fw.counts.info} info` : '');
          return (
            <button key={fw.id}
              className={'fw-cov-row' + (isFocused ? ' focused' : '')}
              onClick={() => onFocus(fw.id)}
              title={tip}>
              <div className="fw-cov-name">{fw.short}</div>
              <div className="fw-cov-track">
                <div className="fw-bar fw-cov-bar">
                  {fw.counts.pass>0   && <div className="fw-seg pass"   style={{flex:fw.counts.pass}}/>}
                  {fw.counts.warn>0   && <div className="fw-seg warn"   style={{flex:fw.counts.warn}}/>}
                  {fw.counts.fail>0   && <div className="fw-seg fail"   style={{flex:fw.counts.fail}}/>}
                  {fw.counts.review>0 && <div className="fw-seg review" style={{flex:fw.counts.review}}/>}
                  {fw.counts.info>0   && <div className="fw-seg info"   style={{flex:fw.counts.info}}/>}
                </div>
                <div className="fw-cov-marker" style={{left: `${pct}%`}}>
                  <span className={'fw-cov-marker-pct ' + r.tone}>{pct}%</span>
                </div>
              </div>
              <div className={'fw-cov-gaps ' + (fw.counts.fail > 10 ? 'fail' : fw.counts.fail > 4 ? 'warn' : 'pass')}>
                {fw.counts.fail} gap{fw.counts.fail!==1?'s':''}
              </div>
            </button>
          );
        })}
      </div>
      <div className="fw-cov-chart-legend">
        <span><i className="leg-dot pass"/>Pass</span>
        <span><i className="leg-dot warn"/>Warn</span>
        <span><i className="leg-dot fail"/>Fail</span>
        <span><i className="leg-dot review"/>Review</span>
        <span><i className="leg-dot info"/>Info</span>
      </div>
    </div>
  );
}

/* ---------- Compare table (multi) — sortable ---------- */
function CompareTableM({ frameworks, focused, onFocus, onRemove }) {
  const [sort, setSort] = useStateM({ key: 'coverage', dir: 'desc' });

  const sorted = useMemoM(() => {
    const arr = [...frameworks];
    arr.sort((a, b) => {
      let av, bv;
      if (sort.key === 'coverage') { av = coveragePct(a.counts); bv = coveragePct(b.counts); }
      else if (sort.key === 'gaps') { av = a.counts.fail; bv = b.counts.fail; }
      else if (sort.key === 'name') { av = a.full.toLowerCase(); bv = b.full.toLowerCase(); }
      else if (sort.key === 'controls') { av = a.counts.total; bv = b.counts.total; }
      else { av = 0; bv = 0; }
      if (av < bv) return sort.dir === 'asc' ? -1 : 1;
      if (av > bv) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [frameworks, sort]);

  const setSortKey = (key) => {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' });
  };
  const Caret = ({ k }) => sort.key !== k ? <span className="fw-sort-caret"/> :
    <span className={'fw-sort-caret active ' + sort.dir}>{sort.dir === 'asc' ? '▲' : '▼'}</span>;

  return (
    <div className="fw-cmp-table">
      <div className="fw-cmp-row fw-cmp-head">
        <button className="fw-cmp-sort" onClick={() => setSortKey('name')}>Framework <Caret k="name"/></button>
        <button className="fw-cmp-sort" style={{textAlign:'right'}} onClick={() => setSortKey('coverage')}>Coverage <Caret k="coverage"/></button>
        <div>Status</div>
        <button className="fw-cmp-sort" onClick={() => setSortKey('gaps')}>Gaps <Caret k="gaps"/></button>
        <div>Distribution</div>
        <div></div>
      </div>
      {sorted.map(fw => {
        const pct = coveragePct(fw.counts);
        const r = readinessLabel(pct);
        const isFocused = focused === fw.id;
        return (
          <div key={fw.id}
               className={'fw-cmp-row' + (isFocused ? ' focused' : '')}
               onClick={() => onFocus(fw.id)}
               role="button"
               tabIndex={0}
               onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFocus(fw.id); }}}>
            <div className="fw-cmp-name-cell">
              <div className="fw-cmp-name">{fw.full}</div>
              <div className="fw-cmp-id">{fw.id}</div>
            </div>
            <div className="fw-cmp-pct-cell">
              <div className={'fw-cmp-pct ' + r.tone}>{pct}%</div>
              <div className="fw-cmp-pct-sub">{fw.counts.pass}/{fw.counts.total}</div>
            </div>
            <div>
              <span className={'fw-readiness-pill ' + r.tone}>{r.label}</span>
            </div>
            <div className="fw-cmp-gaps">
              <span className={fw.counts.fail > 10 ? 'fail' : fw.counts.fail > 4 ? 'warn' : 'pass'}>
                {fw.counts.fail}
              </span>
              {fw.counts.warn > 0 && <span style={{color:'var(--warn-text)', fontSize:11, marginLeft:4}}>+ {fw.counts.warn} warn</span>}
            </div>
            <div className="fw-cmp-dist">
              <div className="fw-bar" style={{height:8, borderRadius:4}}>
                {fw.counts.pass>0   && <div className="fw-seg pass"   style={{flex:fw.counts.pass}}/>}
                {fw.counts.warn>0   && <div className="fw-seg warn"   style={{flex:fw.counts.warn}}/>}
                {fw.counts.fail>0   && <div className="fw-seg fail"   style={{flex:fw.counts.fail}}/>}
                {fw.counts.review>0 && <div className="fw-seg review" style={{flex:fw.counts.review}}/>}
                {fw.counts.info>0   && <div className="fw-seg info"   style={{flex:fw.counts.info}}/>}
              </div>
            </div>
            <div className="fw-cmp-act">
              {frameworks.length > 1 && (
                <button className="fw-cmp-rm-btn" title="Remove from scope"
                  onClick={e => { e.stopPropagation(); onRemove(fw.id); }}>×</button>
              )}
              <span className="fw-cmp-chev">{isFocused ? '▾' : '▸'}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Primary CTA button ---------- */
function GapsCTA({ count }) {
  return (
    <button className="fw-gaps-cta" type="button">
      <span className="fw-gaps-cta-num">{count}</span>
      <span className="fw-gaps-cta-label">View gaps in findings</span>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5 3l5 5-5 5"/>
      </svg>
    </button>
  );
}

/* ---------- Single framework view (1 framework in scope) ---------- */
function SingleView({ fw, profiles, onProfilesChange, family, onFamilyFocus, onClearFilters }) {
  return (
    <div>
      <FilterBanner profiles={profiles} family={family} onClear={onClearFilters}/>
      <div className="fw-tb-score fw-merged-score">
        <div className="fw-merged-score-grid">
          <ScoreDonut counts={fw.counts} animKey={fw.id}/>
          <div className="fw-merged-score-info">
            <div className="fw-merged-score-name">{fw.full}</div>
            <div className="fw-merged-score-org">{fw.org}</div>
            <div style={{display:'flex', gap:8, alignItems:'center', marginTop:8, marginBottom:14}}>
              <span className={'fw-readiness-pill ' + readinessLabel(coveragePct(fw.counts)).tone}>{readinessLabel(coveragePct(fw.counts)).label}</span>
              <span style={{fontSize:12, color:'var(--muted)', fontFamily:'var(--font-mono)'}}>{fw.counts.pass}/{fw.counts.total} controls passing</span>
            </div>
            <div className="fw-bar fw-tb-score-bar">
              {fw.counts.pass>0   && <div className="fw-seg pass"   style={{flex:fw.counts.pass}}/>}
              {fw.counts.warn>0   && <div className="fw-seg warn"   style={{flex:fw.counts.warn}}/>}
              {fw.counts.fail>0   && <div className="fw-seg fail"   style={{flex:fw.counts.fail}}/>}
              {fw.counts.review>0 && <div className="fw-seg review" style={{flex:fw.counts.review}}/>}
              {fw.counts.info>0   && <div className="fw-seg info"   style={{flex:fw.counts.info}}/>}
            </div>
            <div className="fw-tb-score-legend" style={{marginTop:10}}>
              <span><i className="leg-dot pass"/>{fw.counts.pass} pass</span>
              <span><i className="leg-dot warn"/>{fw.counts.warn} warn</span>
              <span><i className="leg-dot fail"/>{fw.counts.fail} fail</span>
              {fw.counts.review > 0 && <span><i className="leg-dot review"/>{fw.counts.review} review</span>}
              {fw.counts.info > 0 && <span><i className="leg-dot info"/>{fw.counts.info} info</span>}
            </div>
          </div>
          <div className="fw-merged-score-cta">
            {fw.profileType && <ProfileChipsM framework={fw} active={profiles} onChange={onProfilesChange}/>}
            <GapsCTA count={fw.counts.fail}/>
          </div>
        </div>
      </div>

      {fw.families && (
        <div className="fw-tb-fam-section">
          <div className="fw-tb-fam-head">
            <div>
              <div style={{fontSize:11, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.1em', fontWeight:700, marginBottom:2}}>Coverage by control family</div>
              <div style={{fontSize:12, color:'var(--text-soft)'}}>{fw.families.length} families · sorted by gaps · click a row to filter</div>
            </div>
          </div>
          <FamilyChartM families={[...fw.families].sort((a,b) => b.fail - a.fail)} focused={family} onFocus={onFamilyFocus}/>
        </div>
      )}
    </div>
  );
}

/* ---------- Multi framework view ---------- */
function MultiView({ frameworks, focusedId, onFocus, onRemove, profiles, onProfilesChange, family, onFamilyFocus, onClearFilters }) {
  const focused = frameworks.find(f => f.id === focusedId) || frameworks[0];
  // fade detail on focus change
  const [fadeKey, setFadeKey] = useStateM(focused.id);
  useEffectM(() => {
    setFadeKey(focused.id);
  }, [focused.id]);

  return (
    <div>
      <CompareTableM frameworks={frameworks} focused={focused.id} onFocus={onFocus} onRemove={onRemove}/>
      <CoverageChart frameworks={frameworks} focused={focused.id} onFocus={onFocus}/>

      <FilterBanner profiles={profiles} family={family} onClear={onClearFilters}/>

      {/* Drill-down detail */}
      <div className="fw-cmp-detail fw-merged-detail" key={fadeKey}>
        <div className="fw-merged-detail-anim">
          <div className="fw-merged-score-grid">
            <ScoreDonut counts={focused.counts} size={140} stroke={16} animKey={focused.id}/>
            <div className="fw-merged-score-info">
              <div className="fw-merged-detail-eyebrow">
                <span className="fw-merged-detail-arrow">↓</span>
                Selected · {focused.org}
              </div>
              <div className="fw-merged-score-name" style={{fontSize:20}}>{focused.full}</div>
              <div style={{display:'flex', gap:8, alignItems:'center', marginTop:8, marginBottom:10}}>
                <span className={'fw-readiness-pill ' + readinessLabel(coveragePct(focused.counts)).tone}>{readinessLabel(coveragePct(focused.counts)).label}</span>
                <span style={{fontSize:12, color:'var(--muted)', fontFamily:'var(--font-mono)'}}>{focused.counts.pass}/{focused.counts.total}</span>
              </div>
              {focused.profileType && <ProfileChipsM framework={focused} active={profiles} onChange={onProfilesChange} compact/>}
            </div>
            <div className="fw-merged-score-cta">
              <GapsCTA count={focused.counts.fail}/>
            </div>
          </div>

          {focused.families && (
            <div style={{marginTop:18, paddingTop:16, borderTop:'1px solid var(--border)'}}>
              <div style={{fontSize:11, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.1em', fontWeight:700, marginBottom:8, display:'flex', alignItems:'center', gap:8}}>
                Coverage by control family
                <span style={{fontSize:11, color:'var(--text-soft)', textTransform:'none', letterSpacing:0, fontWeight:400}}>· click a row to filter</span>
              </div>
              <FamilyChartM families={[...focused.families].sort((a,b) => b.fail - a.fail)} focused={family} onFocus={onFamilyFocus}/>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Empty state ---------- */
function EmptyState({ allFw, onSetAll }) {
  return (
    <div className="fw-empty-state">
      <div className="fw-empty-icon">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".6">
          <rect x="4" y="6" width="32" height="6" rx="1.5"/>
          <rect x="4" y="16" width="32" height="6" rx="1.5"/>
          <rect x="4" y="26" width="32" height="6" rx="1.5"/>
          <line x1="2" y1="38" x2="38" y2="2" stroke="var(--danger)" strokeWidth="1.5"/>
        </svg>
      </div>
      <div className="fw-empty-title">No frameworks in scope</div>
      <div className="fw-empty-msg">Pick at least one framework to see coverage data.</div>
      <button className="fw-gaps-cta" onClick={() => onSetAll(allFw.filter(f => f.pinned).map(f => f.id))}>
        <span className="fw-gaps-cta-label">Restore default frameworks</span>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M5 3l5 5-5 5"/>
        </svg>
      </button>
    </div>
  );
}

/* ---------- Top-level component ---------- */
function DirectionMerged({ initialIds }) {
  const defaultIds = initialIds || MOCK_FRAMEWORKS.filter(f => f.pinned).map(f => f.id);
  const [visibleIds, setVisibleIds] = useStateM(defaultIds);
  const [focusedId, setFocusedId] = useStateM(defaultIds[0]);
  const [profiles, setProfiles] = useStateM([]);
  const [family, setFamily] = useStateM(null);

  // reset filters when focus changes
  useEffectM(() => { setProfiles([]); setFamily(null); }, [focusedId]);

  const visibleFw = MOCK_FRAMEWORKS.filter(f => visibleIds.includes(f.id));
  // ensure focus stays valid
  useEffectM(() => {
    if (visibleIds.length > 0 && !visibleIds.includes(focusedId)) setFocusedId(visibleIds[0]);
  }, [visibleIds]);

  const toggle = (id) => setVisibleIds(v => v.includes(id) ? v.filter(x => x !== id) : [...v, id]);
  const remove = (id) => setVisibleIds(v => v.filter(x => x !== id));
  const setAll = (ids) => setVisibleIds(ids);
  const clearFilters = () => { setProfiles([]); setFamily(null); };

  const isEmpty = visibleFw.length === 0;
  const isSingle = visibleFw.length === 1;
  const fwForSingle = visibleFw[0];

  return (
    <div className="dir-merged">
      <div className="section-head" style={{display:'flex',alignItems:'baseline',gap:12,marginBottom:14}}>
        <span className="eyebrow">01 · Compliance</span>
        <h2 style={{margin:0}}>Framework coverage</h2>
        <span style={{fontSize:13, color:'var(--muted)', fontWeight:400}}>
          {isEmpty ? 'Nothing in scope' : isSingle ? '1 framework in scope' : `Comparing ${visibleFw.length} of ${MOCK_FRAMEWORKS.length}`}
        </span>
        <div style={{marginLeft:'auto'}}>
          <ManageButton allFw={MOCK_FRAMEWORKS} visible={visibleIds} onToggle={toggle} onSetAll={setAll}/>
        </div>
      </div>

      {isEmpty
        ? <EmptyState allFw={MOCK_FRAMEWORKS} onSetAll={setAll}/>
        : isSingle
          ? <SingleView fw={fwForSingle} profiles={profiles} onProfilesChange={setProfiles}
                        family={family} onFamilyFocus={setFamily} onClearFilters={clearFilters}/>
          : <MultiView frameworks={visibleFw} focusedId={focusedId} onFocus={setFocusedId} onRemove={remove}
                       profiles={profiles} onProfilesChange={setProfiles}
                       family={family} onFamilyFocus={setFamily} onClearFilters={clearFilters}/>}
    </div>
  );
}

window.DirectionMerged = DirectionMerged;
