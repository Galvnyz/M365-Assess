// ======================== Domain rollup ========================
function DomainRollup({ onJump }) {
  const [open, setOpen] = useState(true);

  function toggleOpen(e) {
    e.stopPropagation();
    setOpen(o => !o);
  }

  return (
    <section className="block" id="identity">
      <div className="section-head" style={{cursor:'pointer'}} onClick={toggleOpen}>
        <span className="eyebrow">02 · Domains</span>
        <h2>Security posture by domain <span className="section-chevron" aria-hidden="true">{open ? '\u25be' : '\u25b8'}</span></h2>
        <div className="hr"/>
      </div>
      {open && (
        <>
          <p className="section-sub">One card per Microsoft 365 service area.</p>
          <div className="domain-grid">
            {DOMAIN_ORDER.map(name => {
              const d = DOMAIN_STATS[name];
              if (!d) return null;
              // #802: strict denominator -- removed previous (pass + info*0.5) / total
              // weighting in favor of the doc's Pass / (Pass + Fail + Warning).
              const denom = d.pass + d.fail + d.warn;
              const score = denom > 0 ? Math.round((d.pass / denom) * 100) : 0;
              return (
                <div key={name} className="domain-card" onClick={()=>onJump(name)}>
                  <div className="dc-head">
                    <div className="dc-name">{name}</div>
                    <div className="dc-score">{score}%</div>
                  </div>
                  <div className="dc-bar">
                    {d.pass>0 && <i className="pass-seg" style={{flex: d.pass}}/>}
                    {d.warn>0 && <i className="warn-seg" style={{flex: d.warn}}/>}
                    {d.fail>0 && <i className="fail-seg" style={{flex: d.fail}}/>}
                    {d.review>0 && <i className="review-seg" style={{flex: d.review}}/>}
                    {d.info>0 && <i className="info-seg" style={{flex: d.info}}/>}
                    {(() => {
                      const notAssessed = Math.max(0, d.total - d.pass - d.warn - d.fail - d.review - d.info);
                      return notAssessed > 0 ? <i className="skipped-seg" style={{flex: notAssessed}} title={NOT_ASSESSED_TIP}/> : null;
                    })()}
                  </div>
                  <div className="dc-meta">
                    <span className="dc-pass"><b>{d.pass}</b> pass</span>
                    <span className="dc-warn"><b>{d.warn}</b> warn</span>
                    <span className="dc-fail"><b>{d.fail}</b> fail</span>
                    {d.review>0 && <span className="dc-review"><b>{d.review}</b> review</span>}
                    {(() => {
                      const notAssessed = Math.max(0, d.total - d.pass - d.warn - d.fail - d.review - d.info);
                      return notAssessed > 0 ? <span className="dc-skipped" title={NOT_ASSESSED_TIP}><b>{notAssessed}</b> not assessed</span> : null;
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
          {FINDINGS.some(f => f.domain === 'Intune') && (
            <div id="identity-intune">
              <IntuneCategoryGrid />
            </div>
          )}
          {D.mailboxSummary && (
            <div id="identity-mailbox">
              <MailboxSummaryPanel />
            </div>
          )}
          {FINDINGS.some(f => f.domain === 'SharePoint & OneDrive') && (
            <div id="identity-sharepoint">
              <SharePointSummaryPanel />
            </div>
          )}
          {D.adHybrid && (
            <div id="identity-ad">
              <AdHybridPanel />
            </div>
          )}
          {(D.dns || []).length > 0 && (
            <div id="identity-email">
              <DnsAuthPanel />
            </div>
          )}
        </>
      )}
    </section>
  );
}

// Token semantics shared by the findings filter and the framework-panel chart:
// 'E3' matches profiles starting with E3; 'E5only' matches CIS profiles with E5 but no E3
// variant; bare 'L1'/'L2'/'L3' substring-match handles bare CMMC values and CIS suffixes alike.
// Issue #844: level/profile chip counts and filters use the registry's
// per-check designations EXACTLY as authored. We do NOT synthesize
// inheritance (e.g., "L2 must include L1") in code — that assumption is
// wrong in practice: CMMC L2 isn't always a strict superset of L1; CIS
// Profile Level 2 sometimes replaces L1 controls with stricter alternatives;
// NIST 800-53 Mod and High baselines select different control sets, not
// just additions. If a check should appear at multiple levels, the
// REGISTRY must tag it with each — code does not infer inheritance.
//
// 'E5only' is the one designed-exclusive case: checks that DON'T carry
// any 'E3-' prefixed profile (i.e., they require E5). All others match
// the literal token via substring. See docs/LEVELS.md.
const matchProfileToken = (profilesArr, token) => {
  if (token === 'E5only') return profilesArr.length > 0 && !profilesArr.some(p => p.startsWith('E3'));
  if (token === 'E3')      return profilesArr.some(p => p.startsWith('E3'));
  return profilesArr.some(p => p.includes(token));
};

// Issue #751 / #845: extraction strategies that derive a "group key" (section
// number, family code, function letter, service prefix, etc.) from a framework's
// native controlId. Each framework's JSON file declares its `groupBy` strategy
// + `groups` map (key → display name); the strategies are enumerated here.
const GROUP_EXTRACTORS = {
  // CIS M365 v6, CIS Controls v8, PCI DSS v4: leading numeric section (e.g. '5.2.2.5' → '5')
  'section-prefix': (cid) => {
    const m = String(cid).match(/^(\d+)/);
    return m ? m[1] : null;
  },
  // CMMC, NIST 800-53, FedRAMP: letter family before first non-letter (e.g. 'AC.L2-3.1.1' → 'AC', 'AC-1' → 'AC')
  'family-letter-prefix': (cid) => {
    const m = String(cid).match(/^([A-Z]{2,3})/);
    return m ? m[1] : null;
  },
  // NIST CSF: function letters before the first dot (e.g. 'ID.AM-1' → 'ID', 'PR.AC-1' → 'PR')
  'dot-prefix': (cid) => {
    const m = String(cid).match(/^([A-Z]+)\./);
    return m ? m[1] : null;
  },
  // ISO 27001:2022: 'A.5.1.1' → 'A.5'; ISO 27001:2013 also uses A.X.Y form
  'iso-clause-prefix': (cid) => {
    const m = String(cid).match(/^(A\.\d+)/);
    return m ? m[1] : null;
  },
  // HIPAA Security Rule: '164.308(a)(1)(ii)(A)' → '308'
  'hipaa-section': (cid) => {
    const m = String(cid).match(/^164\.(\d+)/);
    return m ? m[1] : null;
  },
  // SOC 2 Trust Services Criteria: 'CC1.1' → 'CC', 'PI1.2-POF1' → 'PI', 'A1.2' → 'A'
  // PI must be tested before P (longest-match). C is single-letter and ambiguous
  // with CC prefix; check CC first then C.
  'soc2-tsc-prefix': (cid) => {
    const s = String(cid);
    if (s.startsWith('CC')) return 'CC';
    if (s.startsWith('PI')) return 'PI';
    const m = s.match(/^([ACP])\d/);
    return m ? m[1] : null;
  },
  // Essential Eight: 'ML1-P3' → '3' (group by practice number, not maturity level)
  'essential-eight-practice': (cid) => {
    const m = String(cid).match(/-P(\d+)/);
    return m ? m[1] : null;
  },
  // CISA SCUBA: 'MS.AAD.1.1v1' → 'MS.AAD'
  'scuba-service': (cid) => {
    const m = String(cid).match(/^(MS\.[A-Z]+)/);
    return m ? m[1] : null;
  },
};

// Default: most groups sort alphanumerically; numeric-only keys sort numerically.
function compareGroupKeys(a, b) {
  const na = parseFloat(a);
  const nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b));
}

// ======================== Framework redesign helpers (#855) ========================
// Adapter that computes the design-shape per framework (counts + families +
// profile aggregates) from the live FRAMEWORKS metadata + FINDINGS.
function buildFrameworkData(fwId, activeProfiles) {
  const meta = FRAMEWORKS.find(f => f.id === fwId);
  if (!meta) return null;
  const tokens = activeProfiles || [];
  const counts = { pass:0, warn:0, fail:0, review:0, info:0, na:0, total:0 };
  const familiesMap = {};
  const profileSets = { L1: new Set(), L2: new Set(), L3: new Set(), E3: new Set(), E5only: new Set(), Low: new Set(), Mod: new Set(), High: new Set() };
  const extract = meta.groupBy ? GROUP_EXTRACTORS[meta.groupBy] : null;
  const groupNames = meta.groups || {};
  FINDINGS.forEach((f, idx) => {
    if (!f.frameworks.includes(fwId)) return;
    const profs = [].concat(f.fwMeta?.[fwId]?.profiles || []);
    if (tokens.length > 0 && !tokens.some(t => matchProfileToken(profs, t))) return;
    counts.total++;
    // summaryBucket folds Skipped/Unknown/NotApplicable/NotLicensed into 'na' —
    // previously STATUS_COLORS produced keys the counter never initialised (NaN).
    const k = summaryBucket(f.status);
    counts[k]++;
    const hasE3 = profs.some(p => p.startsWith('E3'));
    profs.forEach(p => {
      if (p.includes('L1')) profileSets.L1.add(idx);
      if (p.includes('L2')) profileSets.L2.add(idx);
      if (p.includes('L3')) profileSets.L3.add(idx);
      if (p.includes('Low')) profileSets.Low.add(idx);
      if (p.includes('Moderate') || p === 'Mod') profileSets.Mod.add(idx);
      if (p.includes('High')) profileSets.High.add(idx);
    });
    if (profs.length > 0) { if (hasE3) profileSets.E3.add(idx); else profileSets.E5only.add(idx); }
    if (extract) {
      const cidRaw = f.fwMeta?.[fwId]?.controlId;
      if (!cidRaw) return;
      const cids = String(cidRaw).split(/[;,]/).map(s => s.trim()).filter(Boolean);
      const groups = new Set();
      cids.forEach(cid => { const code = extract(cid); if (code) groups.add(code); });
      if (groups.size === 0) groups.add('OTHER');
      groups.forEach(code => {
        if (!familiesMap[code]) familiesMap[code] = { code, name: groupNames[code] || (code === 'OTHER' ? 'Other' : code), pass:0, warn:0, fail:0, review:0, info:0, na:0, total:0 };
        familiesMap[code].total++;
        familiesMap[code][k]++;
      });
    }
  });
  let profileType = null;
  if (fwId.startsWith('cmmc')) profileType = 'cmmc';
  else if (fwId.startsWith('cis-')) profileType = 'cis';
  else if (fwId.startsWith('nist-800-53') || fwId === 'fedramp') profileType = 'nist';

  // Issue #844: chip counts reflect the registry's per-check designations
  // EXACTLY as authored. No synthetic inheritance — see docs/LEVELS.md.

  const profiles = profileType === 'cmmc'
    ? { L1: profileSets.L1.size, L2: profileSets.L2.size, L3: profileSets.L3.size }
    : profileType === 'cis'
      ? { L1: profileSets.L1.size, L2: profileSets.L2.size, E3: profileSets.E3.size, E5only: profileSets.E5only.size }
      : profileType === 'nist'
        ? { Low: profileSets.Low.size, Mod: profileSets.Mod.size, High: profileSets.High.size }
        : null;
  return { id: fwId, full: meta.full, counts, families: extract ? Object.values(familiesMap) : null, profiles, profileType };
}

function fwCoveragePct(c) { const n = c ? c.pass + c.fail + c.warn : 0; return n ? Math.round(c.pass / n * 100) : 0; }
function fwReadinessLabel(pct) {
  if (pct >= 90) return { label: 'High observed pass rate', tone: 'pass' };
  if (pct >= 75) return { label: 'Mostly passing', tone: 'pass' };
  if (pct >= 55) return { label: 'At risk', tone: 'warn' };
  return { label: 'Findings need attention', tone: 'fail' };
}

function useFwCountUp(value, duration = 600) {
  const [n, setN] = useState(value);
  const startRef = useRef(null);
  const fromRef = useRef(value);
  const rafRef = useRef(0);
  useEffect(() => {
    fromRef.current = n;
    startRef.current = null;
    cancelAnimationFrame(rafRef.current);
    const tick = (ts) => {
      if (startRef.current == null) startRef.current = ts;
      const t = Math.min(1, (ts - startRef.current) / duration);
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

function ScoreDonut({ counts, size = 168, stroke = 18, animKey }) {
  const segs = [
    { key: 'pass', v: counts.pass, color: 'var(--success)' },
    { key: 'warn', v: counts.warn, color: 'var(--warn)' },
    { key: 'fail', v: counts.fail, color: 'var(--danger)' },
    { key: 'review', v: counts.review, color: 'var(--accent)' },
    { key: 'info', v: counts.info, color: 'var(--muted)' },
    { key: 'na', v: counts.na || 0, color: 'var(--muted)', op: 0.35 },
  ].filter(s => s.v > 0);
  const total = counts.total || 1;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;
  const targetPct = fwCoveragePct(counts);
  const animatedPct = useFwCountUp(targetPct, 700);
  const tone = fwReadinessLabel(targetPct).tone;
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    setProgress(0);
    const id = requestAnimationFrame(() => { setTimeout(() => setProgress(1), 40); });
    return () => cancelAnimationFrame(id);
  }, [animKey, counts.total, counts.pass, counts.warn, counts.fail]);
  let acc = 0;
  return (
    <div className="fw-donut-wrap" style={{width:size, height:size}}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="fw-donut">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} opacity=".4"/>
        {segs.map(s => {
          const frac = s.v / total;
          const dash = frac * c * progress;
          const offset = -acc * c * progress;
          acc += frac;
          const gap = segs.length > 1 ? 1.5 : 0;
          return (
            <circle key={s.key} cx={cx} cy={cy} r={r} fill="none"
              stroke={s.color} strokeWidth={stroke} strokeLinecap="butt" strokeOpacity={s.op || 1}
              strokeDasharray={`${Math.max(0, dash - gap)} ${c}`}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${cx} ${cy})`}
              style={{transition:'stroke-dasharray .7s cubic-bezier(.22,1,.36,1), stroke-dashoffset .7s cubic-bezier(.22,1,.36,1)'}}/>
          );
        })}
      </svg>
      <div className="fw-donut-center">
        <div className={'fw-donut-pct ' + tone}>{Math.round(animatedPct)}<span>%</span></div>
        <div className="fw-donut-sub">{counts.pass} of {counts.total}</div>
      </div>
    </div>
  );
}

function FwManageButton({ allFw, visibleIds, onToggle, onSetAll, fwDataById }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onOut = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onOut);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onOut); document.removeEventListener('keydown', onEsc); };
  }, [open]);
  return (
    <div ref={ref} style={{position:'relative'}}>
      <button className={'chip chip-more' + (open ? ' selected' : '')} onClick={()=>setOpen(o=>!o)}>
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
            <div className="fw-manage-eyebrow">Frameworks in scope · {visibleIds.length} of {allFw.length}</div>
            <div className="fw-manage-bulk">
              <button onClick={()=>onSetAll(allFw.map(f=>f.id))}>Select all</button>
              <span>·</span>
              <button onClick={()=>onSetAll([allFw[0].id])} disabled={visibleIds.length === 1}>Reset</button>
            </div>
          </div>
          {allFw.map(f => {
            const sel = visibleIds.includes(f.id);
            const data = fwDataById(f.id);
            const pct = data ? fwCoveragePct(data.counts) : 0;
            const r = fwReadinessLabel(pct);
            return (
              <label key={f.id} className={'domain-opt' + (sel ? ' sel' : '')}>
                <input type="checkbox" checked={sel} onChange={()=>onToggle(f.id)}/>
                <div style={{minWidth:0, flex:1}}>
                  <div style={{fontSize:12, fontWeight:500}}>{f.full}</div>
                  <div style={{fontSize:11, color:'var(--muted)', fontFamily:'var(--font-mono)'}}>{f.id} · {data?.counts.total || 0} findings</div>
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

function ProfileChipsM({ data, active, onChange, compact }) {
  if (!data.profileType || !data.profiles) return null;
  const tokens = data.profileType === 'cmmc'
    ? [
        { tok: 'L1', label: 'L1', count: data.profiles.L1, cls: 'level' },
        { tok: 'L2', label: 'L2', count: data.profiles.L2, cls: 'level2' },
        { tok: 'L3', label: 'L3', count: data.profiles.L3, cls: 'level3' },
      ]
    : data.profileType === 'cis'
      ? [
          { tok: 'L1', label: 'L1', count: data.profiles.L1, cls: 'level' },
          { tok: 'L2', label: 'L2', count: data.profiles.L2, cls: 'level2' },
          { tok: 'E3', label: 'E3', count: data.profiles.E3, cls: 'lic' },
          { tok: 'E5only', label: 'E5 only', count: data.profiles.E5only, cls: 'lic5' },
        ]
      : [
          { tok: 'Low', label: 'Low', count: data.profiles.Low, cls: 'level' },
          { tok: 'Mod', label: 'Moderate', count: data.profiles.Mod, cls: 'level2' },
          { tok: 'High', label: 'High', count: data.profiles.High, cls: 'level3' },
        ];
  return (
    <div>
      {!compact && (
        <div style={{fontSize:11, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.08em', fontWeight:600, marginBottom:6}}>
          Filter by {data.profileType === 'cmmc' ? 'maturity level' : data.profileType === 'cis' ? 'profile' : 'baseline'}
        </div>
      )}
      <div style={{display:'flex', gap:6, alignItems:'center', flexWrap:'wrap'}}>
        {tokens.map(t => (
          <button key={t.tok} className={'fw-profile-chip fw-profile-chip-btn ' + t.cls + (active.includes(t.tok) ? ' selected' : '')}
            onClick={()=>{ const next = active.includes(t.tok) ? active.filter(x=>x!==t.tok) : [...active, t.tok]; onChange(next); }}>
            {t.label} <b>{t.count}</b>
          </button>
        ))}
        {active.length > 0 && (<button className="fw-tb-clear" onClick={()=>onChange([])}>Clear</button>)}
      </div>
    </div>
  );
}

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

function FamilyChartM({ families, focused, onFocus }) {
  const max = Math.max(...families.map(f => f.total));
  return (
    <div className="fw-fam-chart">
      {families.map(fam => {
        const pct = fam.total ? Math.round(((fam.pass + fam.info * 0.5) / fam.total) * 100) : 0;
        const ok = pct >= 80;
        const isFocused = focused && focused.code === fam.code;
        return (
          <button key={fam.code} className={'fw-fam-row fw-fam-row-btn' + (isFocused ? ' focused' : '')}
            onClick={()=> onFocus && onFocus(isFocused ? null : fam)} type="button">
            <div className="fw-fam-code">{fam.code}</div>
            <div className="fw-fam-name">{fam.name}</div>
            <div className="fw-fam-track" style={{flexBasis: `${(fam.total / max) * 100}%`}}>
              <div className="fw-bar fw-fam-bar">
                {fam.pass>0   && <div className="fw-seg pass"   style={{flex:fam.pass}}/>}
                {fam.warn>0   && <div className="fw-seg warn"   style={{flex:fam.warn}}/>}
                {fam.fail>0   && <div className="fw-seg fail"   style={{flex:fam.fail}}/>}
                {fam.review>0 && <div className="fw-seg review" style={{flex:fam.review}}/>}
                {fam.info>0   && <div className="fw-seg info"   style={{flex:fam.info}}/>}
                {fam.na>0     && <div className="fw-seg na"     style={{flex:fam.na}} title={NOT_ASSESSED_TIP}/>}
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

function CoverageChart({ frameworks, focused, onFocus }) {
  const sorted = useMemo(() => [...frameworks].sort((a, b) => fwCoveragePct(b.counts) - fwCoveragePct(a.counts)), [frameworks]);
  return (
    <div className="fw-cov-chart">
      <div className="fw-cov-chart-head">
        <div>
          <div style={{fontSize:11, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.1em', fontWeight:700, marginBottom:2}}>Coverage comparison</div>
          <div style={{fontSize:12, color:'var(--text-soft)'}}>{frameworks.length} frameworks · sorted by coverage</div>
        </div>
        <div className="fw-cov-chart-axis"><span>0%</span><span>50%</span><span>100%</span></div>
      </div>
      <div className="fw-cov-chart-body">
        {sorted.map(fw => {
          const pct = fwCoveragePct(fw.counts);
          const r = fwReadinessLabel(pct);
          const isFocused = focused === fw.id;
          const tip = `${fw.counts.pass} pass · ${fw.counts.warn} warn · ${fw.counts.fail} fail` +
            (fw.counts.review > 0 ? ` · ${fw.counts.review} review` : '') +
            (fw.counts.info > 0 ? ` · ${fw.counts.info} info` : '') +
            (fw.counts.na > 0 ? ` · ${fw.counts.na} not assessed` : '');
          return (
            <button key={fw.id} className={'fw-cov-row' + (isFocused ? ' focused' : '')} onClick={()=>onFocus(fw.id)} title={tip}>
              <div className="fw-cov-name">{fw.full}</div>
              <div className="fw-cov-track">
                <div className="fw-bar fw-cov-bar">
                  {fw.counts.pass>0   && <div className="fw-seg pass"   style={{flex:fw.counts.pass}}/>}
                  {fw.counts.warn>0   && <div className="fw-seg warn"   style={{flex:fw.counts.warn}}/>}
                  {fw.counts.fail>0   && <div className="fw-seg fail"   style={{flex:fw.counts.fail}}/>}
                  {fw.counts.review>0 && <div className="fw-seg review" style={{flex:fw.counts.review}}/>}
                  {fw.counts.info>0   && <div className="fw-seg info"   style={{flex:fw.counts.info}}/>}
                  {fw.counts.na>0     && <div className="fw-seg na"     style={{flex:fw.counts.na}}/>}
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
        <span title={NOT_ASSESSED_TIP}><i className="leg-dot na"/>Not assessed</span>
      </div>
    </div>
  );
}

function CompareTableM({ frameworks, focused, onFocus, onRemove }) {
  const [sort, setSort] = useState({ key: 'coverage', dir: 'desc' });
  const sorted = useMemo(() => {
    const arr = [...frameworks];
    arr.sort((a, b) => {
      let av, bv;
      if (sort.key === 'coverage') { av = fwCoveragePct(a.counts); bv = fwCoveragePct(b.counts); }
      else if (sort.key === 'gaps') { av = a.counts.fail; bv = b.counts.fail; }
      else if (sort.key === 'name') { av = a.full.toLowerCase(); bv = b.full.toLowerCase(); }
      else { av = 0; bv = 0; }
      if (av < bv) return sort.dir === 'asc' ? -1 : 1;
      if (av > bv) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [frameworks, sort]);
  const setSortKey = (key) => setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' });
  const Caret = ({ k }) => sort.key !== k ? <span className="fw-sort-caret"/> :
    <span className={'fw-sort-caret active ' + sort.dir}>{sort.dir === 'asc' ? '▲' : '▼'}</span>;
  return (
    <div className="fw-cmp-table">
      <div className="fw-cmp-row fw-cmp-head">
        <button className="fw-cmp-sort" onClick={()=>setSortKey('name')}>Framework <Caret k="name"/></button>
        <button className="fw-cmp-sort" style={{textAlign:'right'}} onClick={()=>setSortKey('coverage')}>Coverage <Caret k="coverage"/></button>
        <div>Status</div>
        <button className="fw-cmp-sort" onClick={()=>setSortKey('gaps')}>Gaps <Caret k="gaps"/></button>
        <div>Distribution</div>
        <div></div>
      </div>
      {sorted.map(fw => {
        const pct = fwCoveragePct(fw.counts);
        const r = fwReadinessLabel(pct);
        const isFocused = focused === fw.id;
        return (
          <div key={fw.id} className={'fw-cmp-row' + (isFocused ? ' focused' : '')}
               onClick={()=>onFocus(fw.id)} role="button" tabIndex={0}
               onKeyDown={e=>{ if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFocus(fw.id); }}}>
            <div className="fw-cmp-name-cell">
              <div className="fw-cmp-name">{fw.full}</div>
              <div className="fw-cmp-id">{fw.id}</div>
            </div>
            <div className="fw-cmp-pct-cell">
              <div className={'fw-cmp-pct ' + r.tone}>{pct}%</div>
              <div className="fw-cmp-pct-sub">{fw.counts.pass} of {fw.counts.total}</div>
            </div>
            <div><span className={'fw-readiness-pill ' + r.tone}>{r.label}</span></div>
            <div className="fw-cmp-gaps">
              <span className={fw.counts.fail > 10 ? 'fail' : fw.counts.fail > 4 ? 'warn' : 'pass'}>{fw.counts.fail}</span>
              {fw.counts.warn > 0 && <span style={{color:'var(--warn-text)', fontSize:11, marginLeft:4}}>+ {fw.counts.warn} warn</span>}
            </div>
            <div className="fw-cmp-dist">
              <div className="fw-bar" style={{height:8, borderRadius:4}}>
                {fw.counts.pass>0   && <div className="fw-seg pass"   style={{flex:fw.counts.pass}}/>}
                {fw.counts.warn>0   && <div className="fw-seg warn"   style={{flex:fw.counts.warn}}/>}
                {fw.counts.fail>0   && <div className="fw-seg fail"   style={{flex:fw.counts.fail}}/>}
                {fw.counts.review>0 && <div className="fw-seg review" style={{flex:fw.counts.review}}/>}
                {fw.counts.info>0   && <div className="fw-seg info"   style={{flex:fw.counts.info}}/>}
                {fw.counts.na>0     && <div className="fw-seg na"     style={{flex:fw.counts.na}}/>}
              </div>
            </div>
            <div className="fw-cmp-act">
              {frameworks.length > 1 && (
                <button className="fw-cmp-rm-btn" title="Remove from scope" onClick={e=>{ e.stopPropagation(); onRemove(fw.id); }}>×</button>
              )}
              <span className="fw-cmp-chev">{isFocused ? '▾' : '▸'}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GapsCTA({ count, onClick }) {
  return (
    <button className="fw-gaps-cta" type="button" onClick={onClick}>
      <span className="fw-gaps-cta-num">{count}</span>
      <span className="fw-gaps-cta-label">View gaps in findings</span>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5 3l5 5-5 5"/>
      </svg>
    </button>
  );
}

// ======================== Framework quilt (#855 redesign) ========================
function FrameworkQuilt({ onSelect, selected, onProfileSelect, activeProfiles }) {
  const { open, headProps } = useCollapsibleSection();
  // #963: open on the headline framework so the quilt and the Executive
  // Briefing tell the same story by default.
  const [visibleIds, setVisibleIds] = useState([HEADLINE_FWS[0]]);
  const [focusedId, setFocusedId] = useState(HEADLINE_FWS[0]);
  const [family, setFamily] = useState(null);

  useEffect(() => { setFamily(null); }, [focusedId]);

  useEffect(() => {
    if (visibleIds.length > 0 && !visibleIds.includes(focusedId)) setFocusedId(visibleIds[0]);
  }, [visibleIds]);

  useEffect(() => {
    const expand = () => { if (visibleIds.length === 0) setVisibleIds([HEADLINE_FWS[0]]); };
    window.addEventListener('beforeprint', expand);
    return () => window.removeEventListener('beforeprint', expand);
  }, [visibleIds]);

  const toggle = (id) => setVisibleIds(v => v.includes(id) ? v.filter(x => x !== id) : [...v, id]);
  const remove = (id) => setVisibleIds(v => v.filter(x => x !== id));
  const setAll = (ids) => setVisibleIds(ids);

  const fwDataById = useMemo(() => {
    const cache = {};
    return (id) => {
      if (cache[id] !== undefined) return cache[id];
      cache[id] = buildFrameworkData(id, activeProfiles || []);
      return cache[id];
    };
    // eslint-disable-next-line
  }, [activeProfiles]);

  const visibleFw = visibleIds.map(id => fwDataById(id)).filter(Boolean);
  const focused = visibleFw.find(f => f.id === focusedId) || visibleFw[0];
  const isEmpty = visibleFw.length === 0;
  const isSingle = visibleFw.length === 1;

  const handleProfilesChange = (next) => {
    if (onProfileSelect && focused) onProfileSelect(focused.id, next);
  };
  const onClearFilters = () => {
    if (onProfileSelect && focused) onProfileSelect(focused.id, []);
    setFamily(null);
  };
  const handleGapsCTA = () => {
    if (focused && onSelect) {
      onSelect(focused.id);
      document.getElementById('findings-anchor')?.scrollIntoView({behavior:'smooth', block:'start'});
    }
  };

  return (
    <section className="block" id="frameworks">
      <div {...headProps}>
        <span className="eyebrow">01 · Compliance</span>
        <h2>Framework coverage</h2>
        <span style={{fontSize:13, color:'var(--muted)', fontWeight:400, marginLeft:8}}>
          {isEmpty ? 'Nothing in scope' : isSingle ? '1 framework in scope' : `Comparing ${visibleFw.length} of ${FRAMEWORKS.length}`}
        </span>
        <div style={{marginLeft:'auto', flexShrink:0}} onClick={e => e.stopPropagation()}>
          <FwManageButton allFw={FRAMEWORKS} visibleIds={visibleIds} onToggle={toggle} onSetAll={setAll} fwDataById={fwDataById}/>
        </div>
        <span className="section-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <div className="hr"/>
      </div>
      {open && (<>
        {isEmpty && (
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
            <button className="fw-gaps-cta" onClick={()=>setAll([FRAMEWORKS[0].id])}>
              <span className="fw-gaps-cta-label">Restore default framework</span>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 3l5 5-5 5"/></svg>
            </button>
          </div>
        )}
        {isSingle && focused && (
          <div>
            <FilterBanner profiles={activeProfiles || []} family={family} onClear={onClearFilters}/>
            <div className="fw-tb-score fw-merged-score">
              <div className="fw-merged-score-grid">
                <ScoreDonut counts={focused.counts} animKey={focused.id}/>
                <div className="fw-merged-score-info">
                  <div className="fw-merged-score-name">{focused.full}</div>
                  <div className="fw-merged-score-org" style={{fontFamily:'var(--font-mono)', fontSize:11, color:'var(--muted)'}}>{focused.id}</div>
                  <div style={{display:'flex', gap:8, alignItems:'center', marginTop:8, marginBottom:14}}>
                    <span className={'fw-readiness-pill ' + fwReadinessLabel(fwCoveragePct(focused.counts)).tone}>{fwReadinessLabel(fwCoveragePct(focused.counts)).label}</span>
                    <span style={{fontSize:12, color:'var(--muted)', fontFamily:'var(--font-mono)'}}>{focused.counts.pass} of {focused.counts.total} findings passing</span>
                  </div>
                  <div className="fw-bar fw-tb-score-bar">
                    {focused.counts.pass>0   && <div className="fw-seg pass"   style={{flex:focused.counts.pass}}/>}
                    {focused.counts.warn>0   && <div className="fw-seg warn"   style={{flex:focused.counts.warn}}/>}
                    {focused.counts.fail>0   && <div className="fw-seg fail"   style={{flex:focused.counts.fail}}/>}
                    {focused.counts.review>0 && <div className="fw-seg review" style={{flex:focused.counts.review}}/>}
                    {focused.counts.info>0   && <div className="fw-seg info"   style={{flex:focused.counts.info}}/>}
                    {focused.counts.na>0     && <div className="fw-seg na"     style={{flex:focused.counts.na}}/>}
                  </div>
                  <div className="fw-tb-score-legend" style={{marginTop:10}}>
                    <span><i className="leg-dot pass"/>{focused.counts.pass} pass</span>
                    <span><i className="leg-dot warn"/>{focused.counts.warn} warn</span>
                    <span><i className="leg-dot fail"/>{focused.counts.fail} fail</span>
                    {focused.counts.review > 0 && <span><i className="leg-dot review"/>{focused.counts.review} review</span>}
                    {focused.counts.info > 0 && <span><i className="leg-dot info"/>{focused.counts.info} info</span>}
                    {focused.counts.na > 0 && <span title={NOT_ASSESSED_TIP}><i className="leg-dot na"/>{focused.counts.na} not assessed</span>}
                  </div>
                </div>
                <div className="fw-merged-score-cta">
                  {focused.profileType && <ProfileChipsM data={focused} active={activeProfiles || []} onChange={handleProfilesChange}/>}
                  <GapsCTA count={focused.counts.fail} onClick={handleGapsCTA}/>
                </div>
              </div>
            </div>
            {focused.families && focused.families.length > 0 && (
              <div className="fw-tb-fam-section">
                <div className="fw-tb-fam-head">
                  <div>
                    <div style={{fontSize:11, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.1em', fontWeight:700, marginBottom:2}}>Coverage by control family</div>
                    <div style={{fontSize:12, color:'var(--text-soft)'}}>{focused.families.length} families · sorted by gaps · click a row to filter</div>
                  </div>
                </div>
                <FamilyChartM families={[...focused.families].sort((a,b) => b.fail - a.fail)} focused={family} onFocus={setFamily}/>
              </div>
            )}
          </div>
        )}
        {!isEmpty && !isSingle && focused && (
          <div>
            <CompareTableM frameworks={visibleFw} focused={focused.id} onFocus={setFocusedId} onRemove={remove}/>
            <CoverageChart frameworks={visibleFw} focused={focused.id} onFocus={setFocusedId}/>
            <FilterBanner profiles={activeProfiles || []} family={family} onClear={onClearFilters}/>
            <div className="fw-cmp-detail fw-merged-detail" key={focused.id}>
              <div className="fw-merged-detail-anim">
                <div className="fw-merged-score-grid">
                  <ScoreDonut counts={focused.counts} size={140} stroke={16} animKey={focused.id}/>
                  <div className="fw-merged-score-info">
                    <div className="fw-merged-detail-eyebrow">
                      <span className="fw-merged-detail-arrow">↓</span>
                      Selected · {focused.id}
                    </div>
                    <div className="fw-merged-score-name" style={{fontSize:20}}>{focused.full}</div>
                    <div style={{display:'flex', gap:8, alignItems:'center', marginTop:8, marginBottom:10}}>
                      <span className={'fw-readiness-pill ' + fwReadinessLabel(fwCoveragePct(focused.counts)).tone}>{fwReadinessLabel(fwCoveragePct(focused.counts)).label}</span>
                      <span style={{fontSize:12, color:'var(--muted)', fontFamily:'var(--font-mono)'}}>{focused.counts.pass} of {focused.counts.total}</span>
                    </div>
                    {focused.profileType && <ProfileChipsM data={focused} active={activeProfiles || []} onChange={handleProfilesChange} compact/>}
                  </div>
                  <div className="fw-merged-score-cta">
                    <GapsCTA count={focused.counts.fail} onClick={handleGapsCTA}/>
                  </div>
                </div>
                {focused.families && focused.families.length > 0 && (
                  <div style={{marginTop:18, paddingTop:16, borderTop:'1px solid var(--border)'}}>
                    <div style={{fontSize:11, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.1em', fontWeight:700, marginBottom:8, display:'flex', alignItems:'center', gap:8}}>
                      Coverage by control family
                      <span style={{fontSize:11, color:'var(--text-soft)', textTransform:'none', letterSpacing:0, fontWeight:400}}>· click a row to filter</span>
                    </div>
                    <FamilyChartM families={[...focused.families].sort((a,b) => b.fail - a.fail)} focused={family} onFocus={setFamily}/>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </>)}
    </section>
  );
}
