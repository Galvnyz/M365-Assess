// Direction C — "Comparison table + drilldown"
// Top: dense comparison table (rows = frameworks). Sortable, all visible at once,
// per-row inline gauge + family heatmap. Click a row to drill into its detail
// panel below. Selector becomes a "Manage frameworks" button that opens a sheet
// to add/remove rows. Best for execs scanning audit-readiness and MSPs.

const { useState: useStateC, useRef: useRefC, useEffect: useEffectC, useMemo: useMemoC } = React;

function CompareTable({ frameworks, focused, onFocus, onRemove }) {
  return (
    <div className="fw-cmp-table">
      <div className="fw-cmp-row fw-cmp-head">
        <div>Framework</div>
        <div style={{textAlign:'right'}}>Coverage</div>
        <div>Status</div>
        <div>Gaps</div>
        <div>Distribution</div>
        <div></div>
      </div>
      {frameworks.map(fw => {
        const pct = coveragePct(fw.counts);
        const r = readinessLabel(pct);
        const isFocused = focused === fw.id;
        return (
          <div key={fw.id}
               className={'fw-cmp-row' + (isFocused ? ' focused' : '')}
               onClick={() => onFocus(fw.id)}
               role="button"
               tabIndex={0}>
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
              <button className="fw-cmp-rm-btn" title="Remove"
                onClick={e => { e.stopPropagation(); onRemove(fw.id); }}>×</button>
              <span className="fw-cmp-chev">{isFocused ? '▾' : '▸'}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ManageSheet({ allFw, visible, onToggle, onClose }) {
  const ref = useRefC(null);
  useEffectC(() => {
    const onOut = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onEsc = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onOut);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onOut);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);
  return (
    <div className="domain-menu" ref={ref} style={{right:0, left:'auto', minWidth:340, top:'calc(100% + 6px)', maxHeight:'70vh'}}>
      <div style={{padding:'4px 10px 8px', fontSize:11, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.08em', fontWeight:600, borderBottom:'1px solid var(--border)', marginBottom:4}}>
        Frameworks shown in comparison
      </div>
      {allFw.map(f => {
        const sel = visible.includes(f.id);
        const pct = coveragePct(f.counts);
        return (
          <label key={f.id} className={'domain-opt' + (sel ? ' sel' : '')}>
            <input type="checkbox" checked={sel} onChange={() => onToggle(f.id)}/>
            <div style={{minWidth:0, flex:1}}>
              <div style={{fontSize:12, fontWeight:500}}>{f.full}</div>
              <div style={{fontSize:11, color:'var(--muted)', fontFamily:'var(--font-mono)'}}>{f.id} · {f.counts.total} controls</div>
            </div>
            <span className="ct">{pct}%</span>
          </label>
        );
      })}
    </div>
  );
}

function FocusedDetail({ fw, profiles, onProfilesChange }) {
  if (!fw) return null;
  return (
    <div className="fw-cmp-detail">
      <div className="fw-cmp-detail-head">
        <div>
          <div style={{fontSize:11, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.08em', fontWeight:600, marginBottom:2}}>Detail · {fw.org}</div>
          <div className="fw-cmp-detail-name">{fw.full}</div>
        </div>
        {fw.profileType && (
          <div style={{display:'flex', gap:6, alignItems:'center'}}>
            <span style={{fontSize:11, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.08em', fontWeight:600, marginRight:4}}>Filter:</span>
            {(fw.profileType === 'cmmc'
              ? [['L1','L1','level'],['L2','L2','level2'],['L3','L3','level3']]
              : fw.profileType === 'cis'
                ? [['L1','L1','level'],['L2','L2','level2'],['E3','E3','lic'],['E5only','E5','lic5']]
                : [['Low','Low','level'],['Mod','Mod','level2'],['High','High','level3']]
            ).map(([tok, label, cls]) => {
              const count = fw.profiles?.[tok] ?? 0;
              if (!count) return null;
              const sel = profiles.includes(tok);
              return (
                <button key={tok} className={'fw-profile-chip fw-profile-chip-btn ' + cls + (sel ? ' selected' : '')}
                  onClick={() => onProfilesChange(sel ? profiles.filter(t => t !== tok) : [...profiles, tok])}>
                  {label} <b>{count}</b>
                </button>
              );
            })}
          </div>
        )}
        <button className="chip chip-more selected">View {fw.counts.fail} gaps →</button>
      </div>
      {fw.families && (
        <div style={{marginTop:14}}>
          <div style={{fontSize:11, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.1em', fontWeight:700, marginBottom:8}}>Coverage by control family</div>
          <div className="fw-fam-chart">
            {[...fw.families].sort((a,b) => b.fail - a.fail).map(fam => {
              const pct = Math.round(((fam.pass + fam.info * 0.5) / fam.total) * 100);
              return (
                <div key={fam.code} className="fw-fam-row">
                  <div className="fw-fam-code">{fam.code}</div>
                  <div className="fw-fam-name">{fam.name}</div>
                  <div className="fw-fam-track" style={{flexBasis:'60%'}}>
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
        </div>
      )}
    </div>
  );
}

function DirectionC() {
  const [visible, setVisible] = useStateC(MOCK_FRAMEWORKS.filter(f => f.pinned).map(f => f.id));
  const [focused, setFocused] = useStateC('cis-m365-v6');
  const [profiles, setProfiles] = useStateC([]);
  const [manageOpen, setManageOpen] = useStateC(false);
  const manageRef = useRefC(null);

  useEffectC(() => { setProfiles([]); }, [focused]);

  const visibleFw = MOCK_FRAMEWORKS.filter(f => visible.includes(f.id));
  const focusedFw = MOCK_FRAMEWORKS.find(f => f.id === focused);

  const toggle = (id) => setVisible(v => v.includes(id) ? (v.length > 1 ? v.filter(x => x !== id) : v) : [...v, id]);
  const remove = (id) => { if (visible.length > 1) setVisible(v => v.filter(x => x !== id)); };

  return (
    <div className="dir-c">
      <div className="section-head" style={{display:'flex',alignItems:'baseline',gap:12,marginBottom:14}}>
        <span className="eyebrow">01 · Compliance</span>
        <h2 style={{margin:0}}>Framework coverage</h2>
        <span style={{fontSize:13, color:'var(--muted)', fontWeight:400}}>Comparing {visibleFw.length} of {MOCK_FRAMEWORKS.length}</span>
        <div ref={manageRef} style={{marginLeft:'auto', position:'relative'}}>
          <button className={'chip chip-more' + (manageOpen ? ' selected' : '')} onClick={() => setManageOpen(o => !o)}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" style={{marginRight:4}}><path d="M3 4h10M3 8h10M3 12h10"/><circle cx="6" cy="4" r="1.5" fill="currentColor" stroke="none"/><circle cx="11" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>
            Manage frameworks
            <svg width="10" height="10" viewBox="0 0 10 10" style={{marginLeft:6,opacity:.6}}><path d="M2 3l3 3 3-3" stroke="currentColor" strokeWidth="1.4" fill="none"/></svg>
          </button>
          {manageOpen && <ManageSheet allFw={MOCK_FRAMEWORKS} visible={visible} onToggle={toggle} onClose={() => setManageOpen(false)}/>}
        </div>
      </div>

      <CompareTable frameworks={visibleFw} focused={focused} onFocus={setFocused} onRemove={remove}/>

      <FocusedDetail fw={focusedFw} profiles={profiles} onProfilesChange={setProfiles}/>
    </div>
  );
}

window.DirectionC = DirectionC;
