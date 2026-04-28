// Direction A — "Toolbar + Focus"
// Single framework at a time. Selector becomes a proper labeled dropdown
// in a clean toolbar with profile filters and view toggle. The detail
// area is the full canvas, not a popout panel.

const { useState, useRef, useEffect, useMemo } = React;

function FwToolbarSelector({ frameworks, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
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

  const active = frameworks.find(f => f.id === value);

  return (
    <div ref={ref} style={{position:'relative'}}>
      <div style={{fontSize:11, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.08em', fontWeight:600, marginBottom:6}}>Framework</div>
      <button onClick={()=>setOpen(o=>!o)} className="fw-tb-trigger" aria-expanded={open}>
        <span className="fw-tb-trigger-name">{active?.full}</span>
        <span className="fw-tb-trigger-id">{active?.id}</span>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" style={{marginLeft:'auto', opacity:.6, transform: open?'rotate(180deg)':'none', transition:'transform .15s'}}>
          <path d="M4 6l4 4 4-4"/>
        </svg>
      </button>
      {open && (
        <div className="fw-tb-menu">
          {frameworks.map(f => {
            const pct = coveragePct(f.counts);
            const r = readinessLabel(pct);
            return (
              <button key={f.id} className={'fw-tb-opt' + (f.id === value ? ' active' : '')}
                      onClick={() => { onChange(f.id); setOpen(false); }}>
                <div style={{minWidth:0, flex:1}}>
                  <div className="fw-tb-opt-name">{f.full}</div>
                  <div className="fw-tb-opt-id">{f.id} · {f.counts.total} controls</div>
                </div>
                <div className="fw-tb-opt-score">
                  <div className={'fw-tb-opt-pct ' + r.tone}>{pct}%</div>
                  <div className="fw-tb-opt-gaps">{f.counts.fail} gaps</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProfileChipRow({ framework, active, onChange }) {
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
      <div style={{fontSize:11, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.08em', fontWeight:600, marginBottom:6}}>
        Filter by {framework.profileType === 'cmmc' ? 'maturity level' : framework.profileType === 'cis' ? 'profile' : 'baseline'}
      </div>
      <div style={{display:'flex', gap:6, alignItems:'center'}}>
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

function ScoreBlock({ counts }) {
  const pct = coveragePct(counts);
  const r = readinessLabel(pct);
  return (
    <div className="fw-tb-score">
      <div className="fw-tb-score-num">
        <span className={'fw-tb-score-pct ' + r.tone}>{pct}<span style={{fontSize:'.45em', color:'var(--muted)', fontWeight:500}}>%</span></span>
        <div className="fw-tb-score-meta">
          <span className={'fw-readiness-pill ' + r.tone}>{r.label}</span>
          <div style={{fontSize:11, color:'var(--muted)', marginTop:4, fontFamily:'var(--font-mono)'}}>{counts.pass}/{counts.total} controls passing</div>
        </div>
      </div>
      <div className="fw-bar fw-tb-score-bar">
        {counts.pass>0   && <div className="fw-seg pass"   style={{flex:counts.pass}}/>}
        {counts.warn>0   && <div className="fw-seg warn"   style={{flex:counts.warn}}/>}
        {counts.fail>0   && <div className="fw-seg fail"   style={{flex:counts.fail}}/>}
        {counts.review>0 && <div className="fw-seg review" style={{flex:counts.review}}/>}
        {counts.info>0   && <div className="fw-seg info"   style={{flex:counts.info}}/>}
      </div>
      <div className="fw-tb-score-legend">
        <span><i className="leg-dot pass"/>{counts.pass} pass</span>
        <span><i className="leg-dot warn"/>{counts.warn} warn</span>
        <span><i className="leg-dot fail"/>{counts.fail} fail</span>
        {counts.review > 0 && <span><i className="leg-dot review"/>{counts.review} review</span>}
        {counts.info > 0 && <span><i className="leg-dot info"/>{counts.info} info</span>}
      </div>
    </div>
  );
}

function FamilyChart({ families }) {
  const max = Math.max(...families.map(f => f.total));
  return (
    <div className="fw-fam-chart">
      {families.map(fam => {
        const pct = Math.round(((fam.pass + fam.info * 0.5) / fam.total) * 100);
        const ok = pct >= 80;
        return (
          <div key={fam.code} className="fw-fam-row">
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
          </div>
        );
      })}
    </div>
  );
}

function DirectionA() {
  const [active, setActive] = useState('cis-m365-v6');
  const [profiles, setProfiles] = useState([]);
  const [showInfo, setShowInfo] = useState(false);
  const fw = MOCK_FRAMEWORKS.find(f => f.id === active);

  // reset profiles when framework changes
  useEffect(() => { setProfiles([]); }, [active]);

  return (
    <div className="dir-a">
      <div className="section-head" style={{display:'flex',alignItems:'baseline',gap:12,marginBottom:18}}>
        <span className="eyebrow">01 · Compliance</span>
        <h2 style={{margin:0}}>Framework coverage</h2>
        <span style={{fontSize:13, color:'var(--muted)', fontWeight:400}}>{MOCK_FRAMEWORKS.length} frameworks assessed</span>
      </div>

      {/* Toolbar */}
      <div className="fw-tb-toolbar">
        <FwToolbarSelector frameworks={MOCK_FRAMEWORKS} value={active} onChange={setActive}/>
        <div className="fw-tb-divider"/>
        {fw.profileType && (
          <>
            <ProfileChipRow framework={fw} active={profiles} onChange={setProfiles}/>
            <div className="fw-tb-divider"/>
          </>
        )}
        <div className="fw-tb-actions">
          <button className="fw-tb-info-btn" onClick={()=>setShowInfo(s=>!s)} title="About this framework">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="8" cy="8" r="6.5"/><path d="M8 7v4M8 5h.01" strokeLinecap="round"/></svg>
            About
          </button>
          <button className="chip chip-more selected fw-tb-cta">
            View {fw.counts.fail} gaps in findings →
          </button>
        </div>
      </div>

      {showInfo && fw.desc && (
        <div className="fw-tb-info-blurb">
          <div style={{fontSize:11, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.08em', fontWeight:600, marginBottom:4}}>{fw.org}</div>
          {fw.desc}
        </div>
      )}

      {/* Score row */}
      <ScoreBlock counts={fw.counts}/>

      {/* Families */}
      {fw.families && (
        <div className="fw-tb-fam-section">
          <div className="fw-tb-fam-head">
            <div>
              <div style={{fontSize:11, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.1em', fontWeight:700, marginBottom:2}}>Coverage by control family</div>
              <div style={{fontSize:12, color:'var(--text-soft)'}}>{fw.families.length} families · sorted by gaps</div>
            </div>
          </div>
          <FamilyChart families={[...fw.families].sort((a,b) => b.fail - a.fail)}/>
        </div>
      )}
    </div>
  );
}

window.DirectionA = DirectionA;
