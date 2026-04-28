// Direction B — "Pinned chips + side rail"
// Persistent horizontal chip row of all visible frameworks (pinnable via menu).
// Click any chip to focus it. Active framework's full panel renders below.
// "Compare" toggle pivots into a 2-up split-view that lets users see two
// frameworks at once with shared semantic groups overlay.

const { useState: useStateB, useRef: useRefB, useEffect: useEffectB, useMemo: useMemoB } = React;

function FwChipB({ fw, active, onClick }) {
  const pct = coveragePct(fw.counts);
  const r = readinessLabel(pct);
  return (
    <button className={'fw-chip-b' + (active ? ' active' : '')} onClick={onClick}>
      <div className="fw-chip-b-top">
        <span className="fw-chip-b-name">{fw.short}</span>
        <span className={'fw-chip-b-pct ' + r.tone}>{pct}%</span>
      </div>
      <div className="fw-bar fw-chip-b-bar">
        {fw.counts.pass>0   && <div className="fw-seg pass"   style={{flex:fw.counts.pass}}/>}
        {fw.counts.warn>0   && <div className="fw-seg warn"   style={{flex:fw.counts.warn}}/>}
        {fw.counts.fail>0   && <div className="fw-seg fail"   style={{flex:fw.counts.fail}}/>}
        {fw.counts.review>0 && <div className="fw-seg review" style={{flex:fw.counts.review}}/>}
        {fw.counts.info>0   && <div className="fw-seg info"   style={{flex:fw.counts.info}}/>}
      </div>
      <div className="fw-chip-b-meta">
        <span>{fw.counts.fail} gaps</span>
        <span>·</span>
        <span>{fw.counts.total} ctrl</span>
      </div>
    </button>
  );
}

function MoreFwMenuB({ allFw, pinned, onTogglePin }) {
  const [open, setOpen] = useStateB(false);
  const ref = useRefB(null);
  useEffectB(() => {
    if (!open) return;
    const onOut = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, [open]);
  const unpinnedCount = allFw.filter(f => !pinned.includes(f.id)).length;
  return (
    <div ref={ref} style={{position:'relative'}}>
      <button className="fw-chip-b fw-chip-b-more" onClick={()=>setOpen(o=>!o)}>
        <div className="fw-chip-b-top" style={{justifyContent:'center'}}>
          <span style={{fontSize:13}}>+ {unpinnedCount} more</span>
        </div>
        <div style={{fontSize:11, color:'var(--muted)', textAlign:'center', marginTop:4}}>Manage frameworks</div>
      </button>
      {open && (
        <div className="domain-menu" style={{right:0, left:'auto', minWidth:300, top:'calc(100% + 6px)'}}>
          <div style={{padding:'4px 10px 8px', fontSize:11, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.08em', fontWeight:600, borderBottom:'1px solid var(--border)', marginBottom:4}}>
            Pin frameworks to the toolbar
          </div>
          {allFw.map(f => {
            const isPinned = pinned.includes(f.id);
            return (
              <label key={f.id} className={'domain-opt' + (isPinned ? ' sel' : '')}>
                <input type="checkbox" checked={isPinned} onChange={() => onTogglePin(f.id)}/>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:12, fontWeight:500}}>{f.full}</div>
                  <div style={{fontSize:11, color:'var(--muted)', fontFamily:'var(--font-mono)'}}>{f.id}</div>
                </div>
                <span className="ct">{f.counts.total}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FocusPanelB({ fw, profiles, onProfilesChange }) {
  const pct = coveragePct(fw.counts);
  const r = readinessLabel(pct);
  return (
    <div className="fw-focus-b">
      <div className="fw-focus-b-head">
        <div style={{minWidth:0}}>
          <div className="fw-focus-b-name">{fw.full}</div>
          <div className="fw-focus-b-org">{fw.org} · {fw.id}</div>
        </div>
        <div className="fw-focus-b-readiness">
          <div className={'fw-focus-b-pct ' + r.tone}>{pct}<span style={{fontSize:'.5em',color:'var(--muted)'}}>%</span></div>
          <div className={'fw-readiness-pill ' + r.tone}>{r.label}</div>
        </div>
      </div>
      {fw.profileType && (
        <div className="fw-focus-b-profiles">
          <span style={{fontSize:11, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.08em', fontWeight:600}}>Filter:</span>
          {(fw.profileType === 'cmmc'
            ? [['L1','L1','level'],['L2','L2','level2'],['L3','L3','level3']]
            : fw.profileType === 'cis'
              ? [['L1','L1','level'],['L2','L2','level2'],['E3','E3','lic'],['E5only','E5 only','lic5']]
              : [['Low','Low','level'],['Mod','Mod','level2'],['High','High','level3']]
          ).map(([tok, label, cls]) => {
            const count = fw.profiles?.[tok] ?? 0;
            if (!count) return null;
            const sel = profiles.includes(tok);
            return (
              <button key={tok} className={'fw-profile-chip fw-profile-chip-btn ' + cls + (sel ? ' selected' : '')}
                onClick={() => {
                  onProfilesChange(sel ? profiles.filter(t => t !== tok) : [...profiles, tok]);
                }}>{label} <b>{count}</b></button>
            );
          })}
        </div>
      )}
      <div className="fw-bar fw-focus-b-mainbar">
        {fw.counts.pass>0   && <div className="fw-seg pass"   style={{flex:fw.counts.pass}}/>}
        {fw.counts.warn>0   && <div className="fw-seg warn"   style={{flex:fw.counts.warn}}/>}
        {fw.counts.fail>0   && <div className="fw-seg fail"   style={{flex:fw.counts.fail}}/>}
        {fw.counts.review>0 && <div className="fw-seg review" style={{flex:fw.counts.review}}/>}
        {fw.counts.info>0   && <div className="fw-seg info"   style={{flex:fw.counts.info}}/>}
      </div>
      <div className="fw-focus-b-legend">
        <span><i className="leg-dot pass"/>{fw.counts.pass} pass</span>
        <span><i className="leg-dot warn"/>{fw.counts.warn} warn</span>
        <span><i className="leg-dot fail"/>{fw.counts.fail} fail</span>
        {fw.counts.review > 0 && <span><i className="leg-dot review"/>{fw.counts.review} review</span>}
        {fw.counts.info > 0 && <span><i className="leg-dot info"/>{fw.counts.info} info</span>}
        <button className="chip chip-more selected" style={{marginLeft:'auto'}}>View {fw.counts.fail} gaps →</button>
      </div>
      {fw.families && (
        <>
          <div style={{fontSize:11, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.1em', fontWeight:700, marginTop:18, marginBottom:8}}>Control families</div>
          <div className="fw-fam-chart">
            {[...fw.families].sort((a,b) => b.fail - a.fail).map(fam => {
              const pct = Math.round(((fam.pass + fam.info * 0.5) / fam.total) * 100);
              return (
                <div key={fam.code} className="fw-fam-row">
                  <div className="fw-fam-code">{fam.code}</div>
                  <div className="fw-fam-name">{fam.name}</div>
                  <div className="fw-fam-track" style={{flexBasis: '60%'}}>
                    <div className="fw-bar fw-fam-bar">
                      {fam.pass>0   && <div className="fw-seg pass"   style={{flex:fam.pass}}/>}
                      {fam.warn>0   && <div className="fw-seg warn"   style={{flex:fam.warn}}/>}
                      {fam.fail>0   && <div className="fw-seg fail"   style={{flex:fam.fail}}/>}
                      {fam.review>0 && <div className="fw-seg review" style={{flex:fam.review}}/>}
                      {fam.info>0   && <div className="fw-seg info"   style={{flex:fam.info}}/>}
                    </div>
                  </div>
                  <div className={'fw-fam-stat ' + (fam.fail > 2 ? 'fail' : fam.fail > 0 ? 'warn' : 'pass')}>
                    {fam.fail > 0 ? `${fam.fail} gap${fam.fail!==1?'s':''}` : 'clean'}
                  </div>
                  <div className="fw-fam-pct">{pct}%</div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function DirectionB() {
  const [pinned, setPinned] = useStateB(MOCK_FRAMEWORKS.filter(f => f.pinned).map(f => f.id));
  const [active, setActive] = useStateB('cis-m365-v6');
  const [compareWith, setCompareWith] = useStateB(null);
  const [profilesA, setProfilesA] = useStateB([]);
  const [profilesB, setProfilesB] = useStateB([]);

  useEffectB(() => { setProfilesA([]); }, [active]);
  useEffectB(() => { setProfilesB([]); }, [compareWith]);

  const togglePin = (id) => setPinned(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const visible = MOCK_FRAMEWORKS.filter(f => pinned.includes(f.id));
  const fwA = MOCK_FRAMEWORKS.find(f => f.id === active);
  const fwB = compareWith ? MOCK_FRAMEWORKS.find(f => f.id === compareWith) : null;

  return (
    <div className="dir-b">
      <div className="section-head" style={{display:'flex',alignItems:'baseline',gap:12,marginBottom:14}}>
        <span className="eyebrow">01 · Compliance</span>
        <h2 style={{margin:0}}>Framework coverage</h2>
        <div style={{marginLeft:'auto', display:'flex', gap:8}}>
          <button
            className={'chip' + (compareWith ? ' selected' : '')}
            onClick={() => {
              if (compareWith) setCompareWith(null);
              else {
                const next = visible.find(f => f.id !== active) || MOCK_FRAMEWORKS.find(f => f.id !== active);
                setCompareWith(next?.id);
              }
            }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" style={{marginRight:4}}><rect x="2" y="3" width="5" height="10"/><rect x="9" y="3" width="5" height="10"/></svg>
            {compareWith ? 'Exit compare' : 'Compare'}
          </button>
        </div>
      </div>

      <div className="fw-chips-rail">
        {visible.map(f => (
          <FwChipB key={f.id} fw={f} active={active === f.id || compareWith === f.id}
            onClick={() => {
              if (compareWith) {
                if (f.id === active) return;
                setCompareWith(f.id);
              } else {
                setActive(f.id);
              }
            }}/>
        ))}
        <MoreFwMenuB allFw={MOCK_FRAMEWORKS} pinned={pinned} onTogglePin={togglePin}/>
      </div>

      {compareWith && fwB ? (
        <div className="fw-compare-grid">
          <FocusPanelB fw={fwA} profiles={profilesA} onProfilesChange={setProfilesA}/>
          <FocusPanelB fw={fwB} profiles={profilesB} onProfilesChange={setProfilesB}/>
        </div>
      ) : (
        <FocusPanelB fw={fwA} profiles={profilesA} onProfilesChange={setProfilesA}/>
      )}
    </div>
  );
}

window.DirectionB = DirectionB;
