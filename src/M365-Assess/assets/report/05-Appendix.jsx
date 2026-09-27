// ======================== Appendix ========================
function Appendix() {
  const { open, headProps } = useCollapsibleSection();
  const mfaTotal = MFA_STATS.total || 1;
  const mfaPct = n => Math.round((n / mfaTotal) * 100);

  const ca       = D.ca       || [];
  const licenses = D.licenses || [];
  const dns = D.dns || [];
  const dnsTotal = dns.length;
  // Issue #860: predicates aligned with DnsAuthPanel (line 986). The previous
  // === 'Pass' checks always counted 0 because the data fields contain raw
  // SPF records and 'OK' for DKIMStatus, never the literal 'Pass'.
  const spfPass  = dns.filter(r => r.SPF && !r.SPF.includes('Not')).length;
  const dkimPass = dns.filter(r => r.DKIMStatus === 'OK').length;
  const dmarcEnf = dns.filter(r => r.DMARCPolicy === 'reject' || r.DMARCPolicy === 'quarantine').length;

  const allRoles = D['admin-roles'] || [];
  const roleCounts = allRoles.reduce((acc, r) => {
    acc[r.RoleName] = (acc[r.RoleName] || 0) + 1;
    return acc;
  }, {});
  const roleEntries = Object.entries(roleCounts).sort((a,b) => b[1] - a[1]);

  const ad = D.adHybrid;
  const phsLabel = ad
    ? (ad.pwHashSync === true ? 'Enabled' : ad.pwHashSync === null || ad.pwHashSync === undefined ? 'Verify' : 'Disabled')
    : null;
  const phsColor = ad
    ? (ad.pwHashSync === true ? 'var(--success-text)' : ad.pwHashSync === null || ad.pwHashSync === undefined ? 'var(--warn-text)' : 'var(--danger-text)')
    : 'var(--muted)';

  const labelStyle = {fontSize:12,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.08em',fontWeight:600,marginBottom:10};
  const rowStyle   = {borderTop:'1px solid var(--border)'};
  const cellStyle  = {padding:'6px 0', fontSize:12};
  const monoRight  = {textAlign:'right',fontFamily:'var(--font-mono)',fontVariantNumeric:'tabular-nums'};

  return (
    <section className="block" id="appendix">
      <div {...headProps}>
        <span className="eyebrow">05 · Reference</span>
        <h2>Tenant appendix</h2>
        <span className="section-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <div className="hr"/>
      </div>

      {open && <>
      <HideableBlock hideKey="appendix-tenant" label="Tenant info">
      <div className="card" style={{marginBottom:14}}>
        <div style={labelStyle}>Tenant</div>
        <div style={{display:'flex',flexWrap:'wrap',gap:'6px 24px',fontSize:12}}>
          <span><span style={{color:'var(--muted)'}}>org</span> <b>{TENANT.OrgDisplayName}</b></span>
          <span><span style={{color:'var(--muted)'}}>domain</span> <b>{TENANT.DefaultDomain}</b></span>
          <span><span style={{color:'var(--muted)'}}>id</span> <span style={{fontFamily:'var(--font-mono)'}}>{TENANT.TenantId}</span></span>
          {TENANT.tenantAgeYears != null && (
            <span><span style={{color:'var(--muted)'}}>age</span> <b>{TENANT.tenantAgeYears} yrs</b></span>
          )}
          {TENANT.CreatedDateTime && (
            <span><span style={{color:'var(--muted)'}}>created</span> <b>{TENANT.CreatedDateTime.slice(0,10)}</b></span>
          )}
        </div>
      </div>
      </HideableBlock>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <HideableBlock hideKey="appendix-licenses" label="Licenses card">
        <div className="card">
          <div style={labelStyle}>Licenses</div>
          <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
            <thead><tr style={{textAlign:'left',color:'var(--muted)'}}><th style={{padding:'6px 0'}}>SKU</th><th style={{textAlign:'right'}}>Assigned</th><th style={{textAlign:'right'}}>Total</th></tr></thead>
            <tbody>
              {licenses.filter(l => parseInt(l.Assigned) > 0).map((l,i)=>(
                <tr key={i} style={rowStyle}>
                  <td style={cellStyle}>{l.License}</td>
                  <td style={{...cellStyle,...monoRight}}>{l.Assigned}</td>
                  <td style={{...cellStyle,...monoRight,color:'var(--muted)'}}>{l.Total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </HideableBlock>

        <HideableBlock hideKey="appendix-mfa-coverage" label="MFA coverage card">
        <div className="card">
          <div style={labelStyle}>MFA coverage ({fmt(mfaTotal)} users)</div>
          <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
            <tbody>
              {MFA_STATS.phishResistant > 0 && (
                <tr style={rowStyle}>
                  <td style={cellStyle}>Phish-resistant</td>
                  <td style={{...cellStyle,...monoRight}}>{fmt(MFA_STATS.phishResistant)}</td>
                  <td style={{...cellStyle,...monoRight,color:'var(--success-text)'}}>{mfaPct(MFA_STATS.phishResistant)}%</td>
                </tr>
              )}
              {MFA_STATS.standard > 0 && (
                <tr style={rowStyle}>
                  <td style={cellStyle}>Standard MFA</td>
                  <td style={{...cellStyle,...monoRight}}>{fmt(MFA_STATS.standard)}</td>
                  <td style={{...cellStyle,...monoRight,color:'var(--text-soft)'}}>{mfaPct(MFA_STATS.standard)}%</td>
                </tr>
              )}
              {MFA_STATS.weak > 0 && (
                <tr style={rowStyle}>
                  <td style={cellStyle}>Weak (SMS/voice)</td>
                  <td style={{...cellStyle,...monoRight}}>{fmt(MFA_STATS.weak)}</td>
                  <td style={{...cellStyle,...monoRight,color:'var(--warn-text)'}}>{mfaPct(MFA_STATS.weak)}%</td>
                </tr>
              )}
              <tr style={rowStyle}>
                <td style={cellStyle}>No MFA</td>
                <td style={{...cellStyle,...monoRight}}>{fmt(MFA_STATS.none)}</td>
                <td style={{...cellStyle,...monoRight,color:MFA_STATS.none>0?'var(--danger-text)':'var(--muted)'}}>{mfaPct(MFA_STATS.none)}%</td>
              </tr>
              {MFA_STATS.adminsWithoutMfa > 0 && (
                <tr style={rowStyle}>
                  <td style={{...cellStyle,color:'var(--danger-text)',fontWeight:600}}>Admins without MFA</td>
                  <td style={{...cellStyle,...monoRight,color:'var(--danger-text)',fontWeight:600}}>{fmt(MFA_STATS.adminsWithoutMfa)}</td>
                  <td style={cellStyle}/>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </HideableBlock>

        <HideableBlock hideKey="appendix-ca-policies" label="Conditional Access policies card">
        <div className="card">
          <div style={labelStyle}>Conditional Access policies ({ca.length})</div>
          <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
            <tbody>
              {ca.map((r,i)=>(
                <tr key={i} style={rowStyle}>
                  <td style={cellStyle}>{r.DisplayName}</td>
                  <td style={{textAlign:'right',paddingRight:6}}><StatusDot ok={r.State==='enabled'} warn={r.State?.includes('Report')}/></td>
                  <td style={{...cellStyle,textAlign:'right',color:'var(--muted)'}}>{r.State}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </HideableBlock>

        <HideableBlock hideKey="appendix-privileged-roles" label="Privileged roles card">
        <div className="card">
          <div style={labelStyle}>Privileged roles ({allRoles.length} assignments)</div>
          <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
            <tbody>
              {roleEntries.map(([role, count], i) => (
                <tr key={i} style={rowStyle}>
                  <td style={cellStyle}>{role}</td>
                  <td style={{...cellStyle,...monoRight,color:'var(--muted)'}}>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </HideableBlock>

        {dnsTotal > 0 && (
          <HideableBlock hideKey="appendix-email-auth" label="Email authentication card">
          <div className="card">
            <div style={labelStyle}>Email authentication ({dnsTotal} domain{dnsTotal!==1?'s':''})</div>
            <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
              <tbody>
                <tr style={rowStyle}>
                  <td style={cellStyle}>SPF passing</td>
                  <td style={{...cellStyle,...monoRight,color:spfPass===dnsTotal?'var(--success-text)':spfPass>0?'var(--warn-text)':'var(--danger-text)'}}>{spfPass} of {dnsTotal}</td>
                </tr>
                <tr style={rowStyle}>
                  <td style={cellStyle}>DKIM passing</td>
                  <td style={{...cellStyle,...monoRight,color:dkimPass===dnsTotal?'var(--success-text)':dkimPass>0?'var(--warn-text)':'var(--danger-text)'}}>{dkimPass} of {dnsTotal}</td>
                </tr>
                <tr style={rowStyle}>
                  <td style={cellStyle}>DMARC enforced</td>
                  <td style={{...cellStyle,...monoRight,color:dmarcEnf===dnsTotal?'var(--success-text)':dmarcEnf>0?'var(--warn-text)':'var(--danger-text)'}}>{dmarcEnf} of {dnsTotal}</td>
                </tr>
              </tbody>
            </table>
          </div>
          </HideableBlock>
        )}

        {ad && (
          <HideableBlock hideKey="appendix-hybrid-sync" label="Hybrid sync card">
          <div className="card">
            <div style={labelStyle}>Hybrid sync</div>
            <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
              <tbody>
                <tr style={rowStyle}>
                  <td style={cellStyle}>Sync type</td>
                  <td style={{...cellStyle,textAlign:'right'}}>{ad.syncType || 'Cloud-only'}</td>
                </tr>
                <tr style={rowStyle}>
                  <td style={cellStyle}>Password hash sync</td>
                  <td style={{...cellStyle,textAlign:'right',color:phsColor,fontWeight:600}}>{phsLabel}</td>
                </tr>
                {ad.lastSync && (
                  <tr style={rowStyle}>
                    <td style={cellStyle}>Last sync</td>
                    <td style={{...cellStyle,textAlign:'right',fontFamily:'var(--font-mono)'}}>{String(ad.lastSync).slice(0,19).replace('T',' ')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          </HideableBlock>
        )}
      </div>
      <PermissionsPanel/>
      </>}
    </section>
  );
}
function StatusDot({ ok, warn }) {
  const bg = ok ? 'var(--success)' : warn ? 'var(--warn)' : 'var(--danger)';
  return <span style={{display:'inline-block',width:8,height:8,borderRadius:'50%',background:bg}}/>;
}

// ======================== Tweaks panel ========================
function TweaksPanel({ onClose, theme, setTheme, mode, setMode, density, setDensity }) {
  return (
    <div className="tweaks-panel">
      <h3>Tweaks <button onClick={onClose} style={{background:'none',border:0,color:'var(--muted)',cursor:'pointer',fontSize:16,lineHeight:1}}>×</button></h3>
      <div className="tw-row">
        <div className="tw-label">Palette</div>
        <div className="swatches">
          <div className={'swatch'+(theme==='neon'?' active':'')} onClick={()=>setTheme('neon')}
               style={{background:'linear-gradient(135deg, #c084fc, #8b5cf6, #06b6d4)'}}/>
          <div className={'swatch'+(theme==='console'?' active':'')} onClick={()=>setTheme('console')}
               style={{background:'linear-gradient(135deg, #4c8bff, #2563eb)'}}/>
          <div className={'swatch'+(theme==='saas'?' active':'')} onClick={()=>setTheme('saas')}
               style={{background:'linear-gradient(135deg, #e8a598, #d4857a, #b86e6e)'}}/>
          <div className={'swatch'+(theme==='high-contrast'?' active':'')} onClick={()=>setTheme('high-contrast')}
               style={{background:'linear-gradient(135deg, #005da8, #003d7a)'}}/>
        </div>
      </div>
      <div className="tw-row">
        <div className="tw-label">Mode</div>
        <div className="seg">
          <button className={mode==='light'?'active':''} onClick={()=>setMode('light')}>Light</button>
          <button className={mode==='dark'?'active':''} onClick={()=>setMode('dark')}>Dark</button>
        </div>
      </div>
      <div className="tw-row">
        <div className="tw-label">Density</div>
        <div className="seg">
          <button className={density==='compact'?'active':''} onClick={()=>setDensity('compact')}>Compact</button>
          <button className={density==='comfort'?'active':''} onClick={()=>setDensity('comfort')}>Comfort</button>
        </div>
      </div>
      <div style={{fontSize:12,color:'var(--muted)',marginTop:4,borderTop:'1px solid var(--border)',paddingTop:10}}>
        Palette/mode/density settings are saved to localStorage and apply to this report.
      </div>
    </div>
  );
}

// ======================== App root ========================
function App() {
  const [, setDecisionRevision] = useState(0);
  useEffect(() => {
    const changed = () => setDecisionRevision(n => n + 1);
    window.addEventListener('assessment-decisions-changed', changed);
    return () => window.removeEventListener('assessment-decisions-changed', changed);
  }, []);
  const DEFAULTS = /*EDITMODE-BEGIN*/{
    "theme": "neon",
    "mode": "dark",
    "density": "compact"
  }/*EDITMODE-END*/;

  const lsGet = (k, def) => { try { return localStorage.getItem(k) || def; } catch(e) { return def; } };
  const [theme, setTheme] = useState(() => lsGet('m365-theme', DEFAULTS.theme));
  const [mode, setMode] = useState(() => lsGet('m365-mode', DEFAULTS.mode));
  const [density, setDensity] = useState(() => lsGet('m365-density', DEFAULTS.density));
  const [textScale, setTextScale] = useState(() => lsGet('m365-text-scale', 'normal'));
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FILTER_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        return {
          status:    Array.isArray(saved.status)    ? saved.status    : [],
          sequence:  Array.isArray(saved.sequence)  ? saved.sequence  : [],
          severity:  Array.isArray(saved.severity)  ? saved.severity  : [],
          framework: Array.isArray(saved.framework) ? saved.framework : [],
          domain:    Array.isArray(saved.domain)    ? saved.domain    : [],
          profile:   Array.isArray(saved.profile)   ? saved.profile   : [],
        };
      }
    } catch {}
    return { status:[], sequence:[], severity:[], framework:[], domain:[], profile:[] };
  });
  const [active, setActive] = useState('briefing');
  // #963: ScoringViews tab state (lifted so the Briefing can deep-link).
  const [scoringView, setScoringView] = useState('security-risk');
  const [activeSubsection, setActiveSubsection] = useState(null);
  const [showTweaks, setShowTweaks] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [focusFinding, setFocusFinding] = useState(null);
  // Issue #697: smart search — App owns the matches array (checkIds) and the
  // current cursor so FilterBar can render a counter and FindingsTable can
  // scroll/expand the active match. FindingsTable publishes its filtered set
  // via onMatchesChange; Topbar drives advance/retreat from the search input.
  const [searchMatches, setSearchMatches] = useState([]);
  const [matchIdx, setMatchIdx] = useState(0);
  // Reset cursor whenever the query changes; matches array re-derives anyway,
  // but we want index=0 to land on the first match for new queries.
  useEffect(() => { setMatchIdx(0); }, [search]);
  const handleAdvanceMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    const next = (matchIdx + 1) % searchMatches.length;
    setMatchIdx(next);
    setFocusFinding(searchMatches[next]);
  }, [matchIdx, searchMatches]);
  const handleRetreatMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    const prev = (matchIdx - 1 + searchMatches.length) % searchMatches.length;
    setMatchIdx(prev);
    setFocusFinding(searchMatches[prev]);
  }, [matchIdx, searchMatches]);
  const [editMode, setEditMode] = useState(false);
  const [hiddenFindings, setHiddenFindings] = useState(() => new Set(RO?.hiddenFindings || []));
  const [hiddenElements, setHiddenElements] = useState(() => new Set(RO?.hiddenElements || []));
  const [roadmapOverrides, setRoadmapOverrides] = useState(() => RO?.roadmapOverrides || {});

  const toggleHideFinding = id => setHiddenFindings(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s;
  });
  const toggleHideElement = key => setHiddenElements(prev => {
    const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s;
  });
  const restoreAllFindings = () => setHiddenFindings(new Set());

  const handleFinalize = () => finalizeReport({
    hiddenFindings: [...hiddenFindings],
    hiddenElements: [...hiddenElements],
    roadmapOverrides,
  });

  const handleResetAll = () => {
    setHiddenFindings(new Set());
    setHiddenElements(new Set());
    setRoadmapOverrides({});
  };

  const editModeCtx = useMemo(
    () => ({ editMode, hiddenElements, toggleHideElement }),
    [editMode, hiddenElements]
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.mode = mode;
    document.documentElement.dataset.density = density;
    document.documentElement.dataset.textScale = textScale;
    localStorage.setItem('m365-theme', theme);
    localStorage.setItem('m365-mode', mode);
    localStorage.setItem('m365-density', density);
    localStorage.setItem('m365-text-scale', textScale);
  }, [theme, mode, density, textScale]);

  useEffect(() => {
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(filters)); } catch {}
  }, [filters]);

  // Slash-key to focus search
  useEffect(() => {
    const h = (e) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        document.querySelector('.search input')?.focus();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Scrollspy — main sections
  useEffect(() => {
    const sections = document.querySelectorAll('section.block');
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) setActive(e.target.id); });
    }, { rootMargin: '-40% 0px -55% 0px' });
    sections.forEach(s => obs.observe(s));
    return () => obs.disconnect();
  }, []);

  // Scrollspy — Domain posture sub-sections (drives submenu auto-highlight)
  useEffect(() => {
    const subIds = ['identity-intune','identity-sharepoint','identity-ad','identity-email'];
    const elements = subIds.map(id => document.getElementById(id)).filter(Boolean);
    if (!elements.length) return;
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) setActiveSubsection(e.target.id); });
    }, { rootMargin: '-30% 0px -60% 0px' });
    elements.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  // Counts for filter bar
  const counts = useMemo(() => {
    const c = { status:{}, sequence:{}, severity:{}, framework:{}, domain:{} };
    FINDINGS.forEach(f => {
      c.status[f.status] = (c.status[f.status]||0) + 1;
      c.severity[f.severity] = (c.severity[f.severity]||0) + 1;
      c.domain[f.domain] = (c.domain[f.domain]||0) + 1;
      f.frameworks.forEach(fw => c.framework[fw] = (c.framework[fw]||0) + 1);
      // #898: sequence count for the FilterBar group. Same logic as the
      // column pill: lane → now/soon/later, Pass → done, otherwise no bucket.
      const seq = f.lane || (f.status === 'Pass' ? 'done' : null);
      if (seq) c.sequence[seq] = (c.sequence[seq]||0) + 1;
    });
    return c;
  }, []);

  const navCounts = {
    total: FINDINGS.length,
    identity: FINDINGS.filter(f => ['Entra ID','Conditional Access','Enterprise Apps'].includes(f.domain) && f.status === 'Fail').length,
  };

  const domainCounts = useMemo(() => {
    const total = {}, fail = {};
    FINDINGS.forEach(f => {
      total[f.domain] = (total[f.domain]||0) + 1;
      if (f.status === 'Fail') fail[f.domain] = (fail[f.domain]||0) + 1;
    });
    return { total, fail };
  }, []);

  const onFrameworkSelect = (fw) => {
    setFilters(f => ({ ...f, framework: fw ? [fw] : [] }));
    if (fw) document.getElementById('findings-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const onProfileSelect = (fw, nextProfiles) => {
    // Multi-select: nextProfiles is an array (possibly empty for "all cleared").
    // Stay in place visually — chart bars and findings table refresh in the background.
    const arr = Array.isArray(nextProfiles) ? nextProfiles : (nextProfiles ? [nextProfiles] : []);
    setFilters(f => ({
      ...f,
      framework: arr.length > 0 && fw ? [fw] : f.framework,
      profile: arr,
    }));
  };
  const onDomainJump = (d) => {
    setFilters(f => ({ ...f, domain: d ? [d] : [] }));
    if (d) document.getElementById('findings-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const onBriefingClick = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setActive('briefing');
    onDomainJump(null);
  };
  const onViewFinding = useCallback((checkId) => {
    setFilters({ status:[], sequence:[], severity:[], framework:[], domain:[], profile:[] });
    setSearch('');
    setFocusFinding(checkId);
    document.getElementById('findings-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  // #963: Briefing tile deep-links.
  const onShowCritical = useCallback(() => {
    setFilters({ status:[], sequence:[], severity:['critical'], framework:[], domain:[], profile:[] });
    setSearch('');
    document.getElementById('findings-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  const onShowQuickWins = useCallback(() => {
    setScoringView('quick-wins');
    document.getElementById('scoring')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <EditModeContext.Provider value={editModeCtx}>
    <div className="app">
      <Sidebar active={active} activeSubsection={activeSubsection} counts={navCounts} domainCounts={domainCounts} activeDomain={filters.domain.length===1 ? filters.domain[0] : null} onDomainJump={onDomainJump} onBriefingClick={onBriefingClick} navOpen={navOpen} onClose={()=>setNavOpen(false)}/>
      <main className="main">
        <Topbar
          search={search} setSearch={setSearch}
          searchMatches={searchMatches} matchIdx={matchIdx}
          onAdvanceMatch={handleAdvanceMatch} onRetreatMatch={handleRetreatMatch}
          mode={mode} setMode={setMode}
          theme={theme} setTheme={setTheme}
          textScale={textScale} setTextScale={setTextScale}
          onPrint={()=>window.print()}
          onTweaks={()=>setShowTweaks(s=>!s)}
          onHamburger={()=>setNavOpen(o=>!o)}
          editMode={editMode}
          onEditToggle={()=>setEditMode(e=>!e)}
          onFinalize={handleFinalize}
          onReset={handleResetAll}
          hiddenCount={hiddenFindings.size + hiddenElements.size}
        />
        <CollectionStatus/>
        <AssessorWorkflow editMode={editMode}/>
        <Briefing onViewFinding={onViewFinding} onShowCritical={onShowCritical} onShowQuickWins={onShowQuickWins}/>
        <Overview/>
        <Posture/>
        <CriticalExposureBlock/>
        <ScoringViews view={scoringView} setView={setScoringView}/>
        <TrendChart/>
        <FrameworkQuilt onSelect={onFrameworkSelect} selected={filters.framework[0]} onProfileSelect={onProfileSelect} activeProfiles={filters.profile || []}/>
        <DomainRollup onJump={onDomainJump}/>
        <div id="findings-anchor"/>
        <div style={{marginTop:20}}/>
        <FilterBar filters={filters} setFilters={setFilters} counts={counts} total={FINDINGS.length} search={search} setSearch={setSearch} inFindings={active === 'findings'}/>
        <FindingsTable filters={filters} search={search} focusFinding={focusFinding} onFocusClear={() => setFocusFinding(null)}
          onMatchesChange={setSearchMatches}
          editMode={editMode} hiddenFindings={hiddenFindings} onHide={toggleHideFinding} onRestoreAll={restoreAllFindings}/>
        <Roadmap onViewFinding={onViewFinding} editMode={editMode} hiddenFindings={hiddenFindings} roadmapOverrides={roadmapOverrides} onRoadmapChange={setRoadmapOverrides}/>
        <Appendix/>
        {!D.whiteLabel && (
          <div style={{textAlign:'center',padding:'30px 0 10px',fontSize:12,color:'var(--muted)',fontFamily:'var(--font-mono)',letterSpacing:'.06em',display:'flex',alignItems:'center',justifyContent:'center',gap:16}}>
            <a href="https://github.com/Galvnyz/M365-Assess" target="_blank" rel="noreferrer" style={{color:'inherit',textDecoration:'underline',textUnderlineOffset:3}}>M365 ASSESS</a>
            {' · READ-ONLY SECURITY ASSESSMENT · '}
            <a href="https://galvnyz.com" target="_blank" rel="noreferrer" style={{color:'inherit',textDecoration:'underline',textUnderlineOffset:3}}>GALVNYZ</a>
            <button className={'edit-mode-toggle'+(editMode?' active':'')} onClick={()=>setEditMode(e=>!e)} title="Toggle edit mode">✎</button>
          </div>
        )}
      </main>
      {showTweaks && <TweaksPanel onClose={()=>setShowTweaks(false)} theme={theme} setTheme={setTheme} mode={mode} setMode={setMode} density={density} setDensity={setDensity}/>}
    </div>
    </EditModeContext.Provider>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App/>);
