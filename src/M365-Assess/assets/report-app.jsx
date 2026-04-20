/* global React, ReactDOM */
const { useState, useEffect, useMemo, useRef, useCallback } = React;

// --------------------- Data shape from bundle.js ---------------------
const D = window.REPORT_DATA;
const TENANT = D.tenant[0] || {};
const USERS = D.users[0] || {};
const SCORE = D.score[0] || {};
const MFA_STATS = D.mfaStats;
const FINDINGS = D.findings;
const DOMAIN_STATS = D.domainStats;

// Pre-compute roadmap lane counts for sidebar sub-nav (mirrors Roadmap bucketing logic)
const _RM = FINDINGS.filter(f => f.status !== 'Pass' && f.status !== 'Info');
const _RM_NOW   = _RM.filter(t => t.severity === 'critical' || (t.severity === 'high' && t.effort === 'small'));
const _RM_SOON  = _RM.filter(t => !_RM_NOW.includes(t) && (t.severity === 'high' || (t.severity === 'medium' && t.effort !== 'large')));
const _RM_LATER = _RM.filter(t => !_RM_NOW.includes(t) && !_RM_SOON.includes(t));
const ROADMAP_COUNTS = { now: _RM_NOW.length, soon: _RM_SOON.length, later: _RM_LATER.length };

const FRAMEWORKS = (D.frameworks && D.frameworks.length) ? D.frameworks : [
  { id: 'cis-m365-v6',     full: 'CIS Microsoft 365 v6.0.1' },
  { id: 'nist-800-53',     full: 'NIST SP 800-53 Rev 5' },
  { id: 'cmmc',            full: 'CMMC 2.0' },
  { id: 'cisa-scuba',      full: 'CISA SCuBA' },
  { id: 'iso-27001',       full: 'ISO 27001:2022' },
  { id: 'cis-controls-v8', full: 'CIS Controls v8.1' },
  { id: 'essential-eight', full: 'ASD Essential Eight' },
  { id: 'fedramp',         full: 'FedRAMP Rev 5' },
  { id: 'hipaa',           full: 'HIPAA' },
  { id: 'mitre-attack',    full: 'MITRE ATT&CK' },
  { id: 'nist-csf',        full: 'NIST CSF 2.0' },
  { id: 'pci-dss',         full: 'PCI DSS v4.0.1' },
  { id: 'soc2',            full: 'SOC 2 Trust Services Criteria' },
  { id: 'stig',            full: 'DISA STIG' },
];

const FW_BLURB = {
  'cis-m365-v6':     { desc: 'Prescriptive configuration recommendations for Microsoft 365 services, organized into L1/L2 profiles and E3/E5 licensing tiers. Maintained by the Center for Internet Security.', url: 'https://www.cisecurity.org/benchmark/microsoft_365' },
  'cis-controls-v8': { desc: 'Prioritized set of 18 critical security controls defending against the most pervasive attacks, organized into three Implementation Groups (IG1–IG3) by organizational maturity.', url: 'https://www.cisecurity.org/controls' },
  'cisa-scuba':      { desc: 'Federal cloud security baselines from CISA covering M365 configurations. Required for US federal agencies and widely adopted by state/local government.', url: 'https://www.cisa.gov/resources-tools/services/secure-cloud-business-applications-scuba-project' },
  'cmmc':            { desc: 'DoD supply chain cybersecurity standard with three maturity levels. Required for contractors handling Federal Contract Information (FCI) or Controlled Unclassified Information (CUI).', url: 'https://dodcio.defense.gov/CMMC/' },
  'essential-eight': { desc: 'Eight foundational mitigation strategies from the Australian Signals Directorate, rated across four maturity levels. Mandatory for Australian government agencies.', url: 'https://www.cyber.gov.au/resources-business-and-government/essential-cyber-security/essential-eight' },
  'fedramp':         { desc: 'US government standardized authorization program for cloud services. FedRAMP Moderate covers the majority of federal workloads with 325 security controls.', url: 'https://www.fedramp.gov/' },
  'hipaa':           { desc: 'US federal law establishing security and privacy standards for protected health information (PHI). Applies to covered entities and their business associates.', url: 'https://www.hhs.gov/hipaa/index.html' },
  'iso-27001':       { desc: 'International standard for information security management systems (ISMS). Specifies requirements for establishing, maintaining, and continually improving an ISMS. Widely used for third-party certification.', url: 'https://www.iso.org/standard/27001' },
  'mitre-attack':    { desc: 'Globally-accessible knowledge base of adversary tactics and techniques based on real-world threat intelligence. Used for threat modeling, detection engineering, and red team exercises.', url: 'https://attack.mitre.org/' },
  'nist-800-53':     { desc: 'Comprehensive catalog of security and privacy controls for US federal information systems (FISMA). Widely adopted beyond government as a baseline security framework.', url: 'https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final' },
  'nist-csf':        { desc: 'Voluntary framework for managing cybersecurity risk, organized around six core functions: Govern, Identify, Protect, Detect, Respond, Recover. Version 2.0 adds supply chain guidance.', url: 'https://www.nist.gov/cyberframework' },
  'pci-dss':         { desc: 'Security requirements for organizations that store, process, or transmit cardholder data. v4.0.1 introduced customized implementation options and expanded multi-factor authentication requirements.', url: 'https://www.pcisecuritystandards.org/' },
  'soc2':            { desc: 'AICPA attestation framework for service organizations covering five Trust Services Criteria: security, availability, processing integrity, confidentiality, and privacy.', url: 'https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services' },
  'stig':            { desc: 'DISA Security Technical Implementation Guides provide prescriptive hardening requirements for information systems. The M365 STIG covers configurations required for DoD cloud deployments.', url: 'https://public.cyber.mil/stigs/' },
};

const DOMAIN_ORDER = [
  'Entra ID',
  'Conditional Access',
  'Enterprise Apps',
  'Exchange Online',
  'Intune',
  'Defender',
  'Purview / Compliance',
  'SharePoint & OneDrive',
  'Teams',
  'Forms',
  'Power BI',
  'Active Directory',
  'SOC 2',
  'Value Opportunity',
  'Other',
];

// --------------------- SVG icons ---------------------
const Icon = {
  search: () => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="5"/><path d="M11 11l3 3"/></svg>),
  moon: () => (<svg viewBox="0 0 16 16" fill="currentColor"><path d="M13 9.4A6 6 0 1 1 6.6 3 5 5 0 0 0 13 9.4z"/></svg>),
  sun: () => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M13 3l-1.4 1.4M4.4 11.6L3 13"/></svg>),
  print: () => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 5V2h8v3"/><path d="M4 13H2V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6h-2"/><rect x="4" y="10" width="8" height="4"/></svg>),
  xlsx: () => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5 6l2.5 4M7.5 6L5 10M9.5 6v4M11 9h-1.5"/></svg>),
  sliders: () => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 5h10M3 11h10"/><circle cx="6" cy="5" r="1.5" fill="currentColor" stroke="none"/><circle cx="10" cy="11" r="1.5" fill="currentColor" stroke="none"/></svg>),
  chevron: () => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 4l4 4-4 4"/></svg>),
  download: () => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2v8M5 7l3 3 3-3M2 12v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1"/></svg>),
  menu: () => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12M2 8h12M2 12h12"/></svg>),
  close: () => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 3l10 10M13 3L3 13"/></svg>),
};

const STATUS_COLORS = { Fail:'fail', Warning:'warn', Pass:'pass', Review:'review', Info:'info' };
const SEV_LABEL = { critical:'Critical', high:'High', medium:'Medium', low:'Low', none:'—', info:'Info' };

// --------------------- Helpers ---------------------
const pct = (n,d) => d ? Math.round((n/d)*100) : 0;
const fmt = n => Number(n).toLocaleString();

// ======================== Sidebar ========================
function Sidebar({ active, counts, domainCounts, activeDomain, onDomainJump, navOpen, onClose }) {
  const DOM_ORDER = ['Entra ID','Conditional Access','Enterprise Apps','Exchange Online','Intune','Defender','Purview / Compliance','SharePoint & OneDrive','Teams','Forms','Power BI','Active Directory','SOC 2','Value Opportunity'];
  const domains = DOM_ORDER.filter(d => domainCounts.total[d]).concat(
    Object.keys(domainCounts.total).filter(d => !DOM_ORDER.includes(d)).sort()
  );
  const exec = [
    { id: 'overview', label: 'Overview' },
    { id: 'posture',  label: 'Posture score' },
    { id: 'identity', label: 'Domain posture' },
    { id: 'frameworks', label: 'Frameworks' },
  ];
  const details = [
    { id: 'findings', label: 'All findings', count: counts.total },
    { id: 'roadmap',  label: 'Remediation roadmap' },
    { id: 'appendix', label: 'Appendix · tenant' },
  ];
  const isMobile = () => window.matchMedia('(max-width: 720px)').matches;
  const closeIfMobile = () => { if (isMobile()) onClose(); };
  return (
    <>
      <div className={'sidebar-overlay' + (navOpen ? ' open' : '')} onClick={onClose} />
      <aside className={'sidebar' + (navOpen ? ' open' : '')}>
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <div className="brand-name">M365 Assess</div>
            <div className="brand-sub">Security Report</div>
          </div>
          <button className="sidebar-close" onClick={onClose} aria-label="Close navigation"><Icon.close/></button>
        </div>
        <nav style={{flex:1}}>
          <div className="nav-label">Executive</div>
          {exec.map(it => (
            <a href={`#${it.id}`} key={it.id} onClick={closeIfMobile} className={'nav-item' + (active===it.id?' active':'')}>
              <span>{it.label}</span>
            </a>
          ))}
          <div className="nav-label" style={{marginTop:14}}>Domains</div>
          {domains.map(d => {
            const fails = domainCounts.fail[d] || 0;
            const total = domainCounts.total[d] || 0;
            return (
              <a href="#findings-anchor" key={d}
                 onClick={(e)=>{ e.preventDefault(); onDomainJump(d); closeIfMobile(); }}
                 className={'nav-item' + (activeDomain===d?' active':'')}>
                <span>{d}</span>
                <span className={'count' + (fails ? ' pill-fail' : '')}>{fails || total}</span>
              </a>
            );
          })}
          <div className="nav-label" style={{marginTop:14}}>Details</div>
          {details.map(it => (
            <React.Fragment key={it.id}>
              <a href={`#${it.id}`}
                 onClick={e => { if (it.id === 'findings') onDomainJump(null); closeIfMobile(); }}
                 className={'nav-item' + (active===it.id && !(it.id==='findings' && activeDomain)?' active':'')}>
                <span>{it.label}</span>
                {it.count !== undefined && <span className="count">{it.count}</span>}
              </a>
              {it.id === 'roadmap' && active === 'roadmap' && (
                <div className="nav-subitems">
                  <a href="#roadmap-now"   className="nav-subitem">Now   <span className="count">{ROADMAP_COUNTS.now}</span></a>
                  <a href="#roadmap-next"  className="nav-subitem">Next  <span className="count">{ROADMAP_COUNTS.soon}</span></a>
                  <a href="#roadmap-later" className="nav-subitem">Later <span className="count">{ROADMAP_COUNTS.later}</span></a>
                </div>
              )}
            </React.Fragment>
          ))}
        </nav>
        <div className="sidebar-cards">
          <div className="sc-card">
            <div className="sc-header">
              <span className="sc-dot" style={{background:'var(--success)'}}/>
              <span className="sc-title">TENANT</span>
              <span className="sc-sub">· LIVE</span>
            </div>
            <div className="sc-row"><span>org</span><span>{TENANT.DefaultDomain || TENANT.OrgDisplayName}</span></div>
            <div className="sc-row"><span>tenant</span><span>{(TENANT.TenantId||'').slice(0,8)+'…'}</span></div>
            <div className="sc-row"><span>users</span><span>{fmt(USERS.TotalUsers)}</span></div>
            <div className="sc-row"><span>licensed</span><span>{fmt(USERS.Licensed)}</span></div>
            <div className="sc-row"><span>guests</span><span>{fmt(USERS.GuestUsers)}</span></div>
            {USERS.SyncedFromOnPrem > 0 && <div className="sc-row"><span>synced</span><span>{fmt(USERS.SyncedFromOnPrem)}</span></div>}
          </div>
          <div className="sc-card">
            <div className="sc-header">
              <span className="sc-dot" style={{background: MFA_STATS.adminsWithoutMfa > 0 ? 'var(--warn)' : 'var(--success)'}}/>
              <span className="sc-title">MFA</span>
              <span className="sc-sub">· COVERAGE</span>
            </div>
            {MFA_STATS.phishResistant > 0 && <div className="sc-row"><span>phish-res</span><span>{fmt(MFA_STATS.phishResistant)}</span></div>}
            {MFA_STATS.standard > 0     && <div className="sc-row"><span>standard</span><span>{fmt(MFA_STATS.standard)}</span></div>}
            {MFA_STATS.weak > 0         && <div className="sc-row"><span>weak</span><span className="sc-warn">{fmt(MFA_STATS.weak)}</span></div>}
            <div className="sc-row"><span>none</span><span className={MFA_STATS.none > 0 ? 'sc-danger' : ''}>{fmt(MFA_STATS.none)}</span></div>
            {MFA_STATS.adminsWithoutMfa > 0 && <div className="sc-row"><span>adm gap</span><span className="sc-danger">{fmt(MFA_STATS.adminsWithoutMfa)}</span></div>}
          </div>
        </div>
      </aside>
    </>
  );
}

// ======================== Topbar ========================
function Topbar({ search, setSearch, mode, setMode, theme, setTheme, onPrint, onTweaks, onHamburger }) {
  return (
    <div className="topbar">
      <button className="hamburger-btn" onClick={onHamburger} aria-label="Open navigation"><Icon.menu/></button>
      <div className="title">
        Security posture report
        <span className="title-sub">· {TENANT.OrgDisplayName}</span>
      </div>
      <div className="spacer" />
      <div className="search">
        <Icon.search />
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search findings, check IDs, remediation…" />
        <kbd>/</kbd>
      </div>
      <div className="palette-switch">
        <button className={theme==='neon'?'active':''} onClick={()=>setTheme('neon')}>Neon</button>
        <button className={theme==='console'?'active':''} onClick={()=>setTheme('console')}>Console</button>
        <button className={theme==='high-contrast'?'active':''} onClick={()=>setTheme('high-contrast')}>High Contrast</button>
      </div>
      <div className="icon-btn-group">
        <button className="icon-btn" title={mode==='dark'?'Light mode':'Dark mode'} onClick={()=>setMode(mode==='dark'?'light':'dark')}>
          {mode==='dark' ? <Icon.sun/> : <Icon.moon/>}
        </button>
        {D.xlsxFileName && (
          <a className="icon-btn" href={D.xlsxFileName} download title={`Download compliance matrix — ${D.xlsxFileName}`}><Icon.xlsx/></a>
        )}
        <button className="icon-btn" title="Print / PDF" onClick={onPrint}><Icon.print/></button>
        <button className="icon-btn" title="Tweaks" onClick={onTweaks}><Icon.sliders/></button>
      </div>
    </div>
  );
}

// ======================== Posture hero ========================
function Posture() {
  const score = parseFloat(SCORE.Percentage);
  const avg = parseFloat(SCORE.AverageComparativeScore);
  const delta = (score - avg).toFixed(1);
  const deltaPos = parseFloat(delta) >= 0;

  const fail = FINDINGS.filter(f=>f.status==='Fail').length;
  const warn = FINDINGS.filter(f=>f.status==='Warning').length;
  const pass = FINDINGS.filter(f=>f.status==='Pass').length;
  const review = FINDINGS.filter(f=>f.status==='Review').length;
  const critical = FINDINGS.filter(f=>f.severity==='critical').length;

  return (
    <section className="block" id="posture">
      <div className="posture-grid">
        <div className="score-card">
          <div className="score-eyebrow">Microsoft Secure Score</div>
          <div className="score-headline">
            <span className="score-num">{score.toFixed(1)}</span>
            <span className="score-denom">/ 100%</span>
            <span className={'score-delta ' + (deltaPos?'':'neg')}>
              {deltaPos?'▲':'▼'} {Math.abs(delta)} pts vs peers
            </span>
          </div>
          <div className="score-label">
            {fmt(SCORE.CurrentScore)} of {fmt(SCORE.MaxScore)} points achieved.
            Peer average is {avg.toFixed(1)}%.
          </div>
          <div className="score-bar">
            <span style={{width: score + '%'}} />
            <div className="bench" style={{left: avg + '%'}} title={`Peer avg ${avg}%`} />
          </div>
          <div className="score-footnote">
            <span>0</span>
            <span>Peer avg · {avg.toFixed(1)}%</span>
            <span>100</span>
          </div>
          <Sparkline scores={D.score} avg={avg} />
          {(SCORE.MicrosoftScore != null && SCORE.CustomerScore != null) && (
            <div className="score-split">
              <div className="score-split-item">
                <div className="score-split-label">Microsoft-managed</div>
                <div className="score-split-value">{fmt(SCORE.MicrosoftScore)} pts</div>
              </div>
              <div className="score-split-item">
                <div className="score-split-label">Customer-earned</div>
                <div className="score-split-value">{fmt(SCORE.CustomerScore)} pts</div>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="kpi-strip" style={{marginBottom:10}}>
            <div className={'kpi ' + (critical?'bad':'good')}>
              <div className="kpi-label">Critical findings</div>
              <div className="kpi-value">{critical}<span className="kpi-suffix">open</span></div>
              <div className="kpi-hint">Admin, PIM & break-glass exposure</div>
              <div className="tiny-bar"><span style={{width: Math.min(100, critical*15)+'%', background:'var(--danger)'}}/></div>
            </div>
            <div className="kpi bad">
              <div className="kpi-label">Fails</div>
              <div className="kpi-value">{fail}</div>
              <div className="kpi-hint">of {FINDINGS.length} checks</div>
              <div className="tiny-bar"><span style={{width: pct(fail, FINDINGS.length)+'%', background:'var(--danger)'}}/></div>
            </div>
            <div className="kpi warn">
              <div className="kpi-label">Warnings</div>
              <div className="kpi-value">{warn}</div>
              <div className="kpi-hint">Review & harden</div>
              <div className="tiny-bar"><span style={{width: pct(warn, FINDINGS.length)+'%', background:'var(--warn)'}}/></div>
            </div>
            <div className="kpi good">
              <div className="kpi-label">Passing</div>
              <div className="kpi-value">{pass}</div>
              <div className="kpi-hint">Controls validated</div>
              <div className="tiny-bar"><span style={{width: pct(pass, FINDINGS.length)+'%', background:'var(--success)'}}/></div>
            </div>
          </div>
          <MFABreakdown />
        </div>
      </div>
      {critical > 0 && (
        <div className="banner">
          <div className="banner-icon">!</div>
          <div>
            <strong>{critical} critical finding{critical===1?'':'s'}</strong> require immediate remediation.
            {MFA_STATS.adminsWithoutMfa > 0 && ` ${MFA_STATS.adminsWithoutMfa} admin${MFA_STATS.adminsWithoutMfa===1?' is':' are'} not MFA-enrolled.`}
            {' '}Prioritized using CISA KEV and CIS Critical Controls guidance.{' '}
            <a href="#findings-anchor" onClick={e=>{e.preventDefault();document.getElementById('findings-anchor')?.scrollIntoView({behavior:'smooth',block:'start'});}}>
              Review in findings table →
            </a>
          </div>
        </div>
      )}
    </section>
  );
}

function Sparkline({ scores, avg }) {
  // Graph returns newest-first; reverse to chronological for left→right chart
  const raw = (scores || []).map(s => parseFloat(s.Percentage) || 0).filter(v => v > 0).reverse();
  if (raw.length < 2) return null;

  // Sample down to ≤12 evenly-spaced points to keep the SVG uncluttered
  const n = Math.min(raw.length, 12);
  const pts = n === raw.length ? raw :
    Array.from({length: n}, (_, i) => raw[Math.round(i * (raw.length - 1) / (n - 1))]);

  const label = raw.length >= 150 ? '6 MO TREND' : raw.length >= 60 ? '2 MO TREND' :
                raw.length >= 14  ? '2 WK TREND' : 'RECENT TREND';

  const W = 260, H = 50, pad = 4;
  const min = Math.min(...pts, avg) - 2, max = Math.max(...pts, avg) + 2;
  const sx = i => pad + (i / (pts.length - 1)) * (W - pad * 2);
  const sy = v => pad + (1 - (v - min) / (max - min)) * (H - pad * 2);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(p).toFixed(1)}`).join(' ');
  const area = d + ` L ${sx(pts.length - 1)},${H - pad} L ${sx(0)},${H - pad} Z`;
  return (
    <div className="score-sparkline">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
        <defs>
          <linearGradient id="sparkfill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity=".28"/>
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0"/>
          </linearGradient>
        </defs>
        <line x1={pad} x2={W-pad} y1={sy(avg)} y2={sy(avg)} stroke="var(--muted)" strokeDasharray="2 3" opacity=".5"/>
        <path d={area} fill="url(#sparkfill)" />
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={sx(i)} cy={sy(p)} r={i === pts.length - 1 ? 3 : 1.5}
            fill={i === pts.length - 1 ? 'var(--accent)' : 'var(--surface)'}
            stroke="var(--accent)" strokeWidth="1.5"/>
        ))}
        <text x={W-pad} y={H-pad} textAnchor="end" fontSize="9" fill="var(--muted)" fontFamily="var(--font-mono)">{label}</text>
      </svg>
    </div>
  );
}

function MFABreakdown() {
  const s = MFA_STATS;
  // Exclude mailboxes/service for "identity floor"
  const denomH = s.total; // use raw total; service accounts intentionally none
  return (
    <div className="mfa-breakdown">
      <div>
        <div className="lbl">Phish-resistant</div>
        <div className="val">{s.phishResistant}<small> / {fmt(s.total)}</small></div>
        <div className="prog"><i className="pr-good" style={{width: pct(s.phishResistant, denomH)+'%'}}/></div>
      </div>
      <div>
        <div className="lbl">Standard MFA</div>
        <div className="val">{s.standard}</div>
        <div className="prog"><i className="pr-ok" style={{width: pct(s.standard, denomH)+'%'}}/></div>
      </div>
      <div>
        <div className="lbl">Weak / SMS</div>
        <div className="val">{s.weak}</div>
        <div className="prog"><i className="pr-mid" style={{width: pct(s.weak, denomH)*8+'%'}}/></div>
      </div>
      <div>
        <div className="lbl">No MFA</div>
        <div className="val">{s.none}</div>
        <div className="prog"><i className="pr-bad" style={{width: pct(s.none, denomH)+'%'}}/></div>
      </div>
    </div>
  );
}

// ======================== Domain rollup ========================
function DomainRollup({ onJump }) {
  return (
    <section className="block" id="identity">
      <div className="section-head">
        <span className="eyebrow">01 · Domains</span>
        <h2>Security posture by domain</h2>
        <div className="hr"/>
      </div>
      <div className="domain-grid">
        {DOMAIN_ORDER.map(name => {
          const d = DOMAIN_STATS[name];
          if (!d) return null;
          const total = d.total;
          const score = Math.round(((d.pass + d.info*0.5) / total) * 100);
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
              </div>
              <div className="dc-meta">
                <span><b>{d.pass}</b> pass</span>
                <span><b>{d.warn}</b> warn</span>
                <span><b>{d.fail}</b> fail</span>
                {d.review>0 && <span><b>{d.review}</b> review</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ======================== Framework quilt ========================
function FrameworkQuilt({ onSelect, selected }) {
  const [visibleFws, setVisibleFws] = useState(['cis-m365-v6']);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expandedFw, setExpandedFw] = useState(null);
  const pickerRef = useRef(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = e => { if (e.key === 'Escape') setPickerOpen(false); };
    const onOut = e => { if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onOut);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onOut);
    };
  }, [pickerOpen]);

  const toggleFw = fw =>
    setVisibleFws(v => v.includes(fw) ? (v.length > 1 ? v.filter(x => x !== fw) : v) : [...v, fw]);

  const byFw = useMemo(() => {
    const out = {};
    FRAMEWORKS.forEach(f => out[f.id] = { pass:0, warn:0, fail:0, review:0, info:0, total:0 });
    FINDINGS.forEach(f => f.frameworks.forEach(fw => {
      if (!out[fw]) return;
      out[fw].total++;
      const k = STATUS_COLORS[f.status];
      if (k) out[fw][k]++;
    }));
    return out;
  }, []);

  const fwDomainBreakdown = useMemo(() => {
    if (!expandedFw) return {};
    const out = {};
    FINDINGS.forEach(f => {
      if (!f.frameworks.includes(expandedFw)) return;
      if (!out[f.domain]) out[f.domain] = { pass:0, warn:0, fail:0, review:0, info:0, total:0 };
      out[f.domain].total++;
      const k = STATUS_COLORS[f.status];
      if (k) out[f.domain][k]++;
    });
    return out;
  }, [expandedFw]);

  const fwProfileStats = useMemo(() => {
    if (!expandedFw) return null;
    const l1 = new Set(), l2 = new Set(), e3 = new Set(), e5only = new Set();
    FINDINGS.forEach((f, idx) => {
      const profiles = [].concat(f.fwMeta?.[expandedFw]?.profiles || []);
      if (profiles.length === 0) return;
      const hasE3 = profiles.some(p => p.startsWith('E3'));
      profiles.forEach(p => {
        if (p.includes('L1')) l1.add(idx);
        if (p.includes('L2')) l2.add(idx);
      });
      if (hasE3) e3.add(idx); else e5only.add(idx);
    });
    return { l1: l1.size, l2: l2.size, e3: e3.size, e5only: e5only.size };
  }, [expandedFw]);

  const displayFws = FRAMEWORKS.filter(f => visibleFws.includes(f.id));
  const pickerLabel = visibleFws.length === 1
    ? (FRAMEWORKS.find(f => f.id === visibleFws[0])?.full || visibleFws[0])
    : `${visibleFws.length} frameworks`;

  const handleCardClick = fwId => setExpandedFw(e => e === fwId ? null : fwId);

  const expandedMeta = expandedFw ? FRAMEWORKS.find(f => f.id === expandedFw) : null;
  const expandedData = expandedFw ? byFw[expandedFw] : null;

  return (
    <section className="block" id="frameworks">
      <div className="section-head">
        <span className="eyebrow">02 · Compliance</span>
        <h2>Framework coverage</h2>
        <div ref={pickerRef} style={{position:'relative', marginLeft:12, flexShrink:0}}>
          <button className={'chip chip-more' + (visibleFws.length > 1 ? ' selected' : '')}
                  onClick={() => setPickerOpen(o => !o)}>
            {pickerLabel}
            <svg width="10" height="10" viewBox="0 0 10 10" style={{marginLeft:4,opacity:.6}}><path d="M2 3l3 3 3-3" stroke="currentColor" strokeWidth="1.4" fill="none"/></svg>
          </button>
          {pickerOpen && (
            <div className="domain-menu" style={{right:0, left:'auto', minWidth:280}}>
              {FRAMEWORKS.map(f => (
                <label key={f.id} className={'domain-opt' + (visibleFws.includes(f.id) ? ' sel' : '')}>
                  <input type="checkbox" checked={visibleFws.includes(f.id)} onChange={() => toggleFw(f.id)}/>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:12, fontWeight:500, lineHeight:1.3}}>{f.full || f.id}</div>
                    <div style={{fontFamily:'var(--font-mono)', fontSize:12, color:'var(--muted)', marginTop:1}}>{f.id}</div>
                  </div>
                  <span className="ct">{byFw[f.id]?.total || 0}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="hr"/>
      </div>
      <div className="quilt">
        {displayFws.map(f => {
          const d = byFw[f.id];
          const score = pct(d.pass + Math.round(d.info*0.5), d.total);
          const isExpanded = expandedFw === f.id;
          return (
            <div key={f.id} className={'quilt-cell' + (isExpanded?' expanded':'') + (selected===f.id?' selected':'')}
                 onClick={() => handleCardClick(f.id)}>
              <div className="fw-name">{f.id}</div>
              <div className="fw-long">{f.full}</div>
              <div className="fw-bar">
                {d.pass>0   && <div className="fw-seg pass"   style={{flex:d.pass}}/>}
                {d.warn>0   && <div className="fw-seg warn"   style={{flex:d.warn}}/>}
                {d.fail>0   && <div className="fw-seg fail"   style={{flex:d.fail}}/>}
                {d.review>0 && <div className="fw-seg review" style={{flex:d.review}}/>}
                {d.info>0   && <div className="fw-seg info"   style={{flex:d.info}}/>}
                {d.total===0 && <div className="fw-seg empty" style={{flex:1}}/>}
              </div>
              <div className="fw-stat">
                <span><b>{score}%</b> covered</span>
                <span><b>{d.fail}</b> gaps</span>
                <span>{d.total} checks</span>
              </div>
            </div>
          );
        })}
      </div>

      {expandedFw && expandedMeta && expandedData && (
        <div className="fw-detail-panel">
          <div className="fw-detail-header">
            <div>
              <div className="fw-detail-name">{expandedMeta.full}</div>
              <div className="fw-detail-id">{expandedFw}</div>
            </div>
            <button onClick={() => setExpandedFw(null)}
                    style={{background:'none',border:0,color:'var(--muted)',cursor:'pointer',fontSize:18,lineHeight:1,padding:'0 4px'}}>×</button>
          </div>
          {FW_BLURB[expandedFw] && (
            <div className="fw-blurb">
              {FW_BLURB[expandedFw].desc}{' '}
              <a href={FW_BLURB[expandedFw].url} target="_blank" rel="noopener noreferrer">Official site ↗</a>
            </div>
          )}
          <div className="fw-detail-summary">
            <span><b>{expandedData.total}</b> controls</span>
            <span><b style={{color:'var(--success-text)'}}>{expandedData.pass}</b> pass</span>
            <span><b style={{color:'var(--warn-text)'}}>{expandedData.warn}</b> warn</span>
            <span><b style={{color:'var(--danger-text)'}}>{expandedData.fail}</b> fail</span>
            {expandedData.review > 0 && <span><b>{expandedData.review}</b> review</span>}
          </div>
          {fwProfileStats && (fwProfileStats.l1 + fwProfileStats.l2 + fwProfileStats.e3 + fwProfileStats.e5only) > 0 && (
            <div className="fw-profile-stats">
              <span className="fw-profile-chip level">L1 <b>{fwProfileStats.l1}</b></span>
              {fwProfileStats.l2 > 0 && <span className="fw-profile-chip level2">L2 <b>{fwProfileStats.l2}</b></span>}
              <span className="fw-profile-sep">·</span>
              <span className="fw-profile-chip lic">E3 <b>{fwProfileStats.e3}</b></span>
              {fwProfileStats.e5only > 0 && <span className="fw-profile-chip lic5">E5 only <b>{fwProfileStats.e5only}</b></span>}
            </div>
          )}
          <div className="fw-bar" style={{marginBottom:16, height:10, borderRadius:5}}>
            {expandedData.pass>0   && <div className="fw-seg pass"   style={{flex:expandedData.pass}}/>}
            {expandedData.warn>0   && <div className="fw-seg warn"   style={{flex:expandedData.warn}}/>}
            {expandedData.fail>0   && <div className="fw-seg fail"   style={{flex:expandedData.fail}}/>}
            {expandedData.review>0 && <div className="fw-seg review" style={{flex:expandedData.review}}/>}
            {expandedData.info>0   && <div className="fw-seg info"   style={{flex:expandedData.info}}/>}
          </div>
          <div style={{fontSize:12, fontWeight:700, textTransform:'uppercase', letterSpacing:'.1em', color:'var(--muted)', marginBottom:8}}>
            Coverage by domain
          </div>
          <div className="fw-detail-domains">
            {Object.entries(fwDomainBreakdown)
              .sort((a,b) => b[1].fail - a[1].fail || b[1].total - a[1].total)
              .map(([domain, s]) => (
                <div key={domain} className="fw-domain-row">
                  <div className="fw-domain-name">{domain}</div>
                  <div className="fw-domain-bar">
                    {s.pass>0   && <div className="fw-seg pass"   style={{flex:s.pass}}/>}
                    {s.warn>0   && <div className="fw-seg warn"   style={{flex:s.warn}}/>}
                    {s.fail>0   && <div className="fw-seg fail"   style={{flex:s.fail}}/>}
                    {s.review>0 && <div className="fw-seg review" style={{flex:s.review}}/>}
                    {s.info>0   && <div className="fw-seg info"   style={{flex:s.info}}/>}
                  </div>
                  <div className="fw-domain-stat">
                    {s.fail > 0
                      ? <span style={{color:'var(--danger-text)'}}>{s.fail} gap{s.fail !== 1 ? 's' : ''}</span>
                      : <span style={{color:'var(--success-text)'}}>{s.pass} pass</span>}
                  </div>
                </div>
              ))}
          </div>
          <div style={{marginTop:14, paddingTop:12, borderTop:'1px solid var(--border)'}}>
            <button className="chip chip-more selected" onClick={() => {
              onSelect(expandedFw);
              document.getElementById('findings-anchor')?.scrollIntoView({behavior:'smooth', block:'start'});
            }}>
              View all {expandedData.total} findings in this framework →
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ======================== Filter bar ========================
function FilterBar({ filters, setFilters, counts, total, search, setSearch }) {
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
  const active = filters.status.length + filters.severity.length + filters.framework.length + filters.domain.length;

  const statusChips = [
    ['Fail','fail'], ['Warning','warn'], ['Review','review'], ['Pass','pass'], ['Info','info']
  ];
  const sevChips = [ ['critical','crit','Critical'],['high','high','High'],['medium','med','Medium'],['low','low','Low'] ];

  const DOM_ORDER = ['Entra ID','Conditional Access','Enterprise Apps','Exchange Online','Intune','Defender','Purview / Compliance','SharePoint & OneDrive','Teams','Forms','Power BI','Active Directory','SOC 2','Value Opportunity'];
  const domainList = DOM_ORDER.filter(d => counts.domain[d]).concat(
    Object.keys(counts.domain).filter(d => !DOM_ORDER.includes(d)).sort()
  );

  return (
    <div className="filter-bar">
      <div className="fb-search">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="5"/><path d="M11 11l3 3"/></svg>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search findings, check IDs, categories…"/>
        {search && <button className="fb-clear-x" onClick={()=>setSearch('')} aria-label="Clear">×</button>}
      </div>
      <div className="filter-divider"/>
      <div className="filter-group">
        <span className="filter-group-label">Status</span>
        {statusChips.map(([v,cls])=>(
          <button key={v} className={'chip '+cls+(filters.status.includes(v)?' selected':'')} onClick={()=>update('status',v)}>
            <span className="dot"/>{v}<span className="ct">{counts.status[v]||0}</span>
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
      {active > 0 && (
        <>
          <div className="filter-divider"/>
          <button className="filter-clear" onClick={()=>setFilters({status:[],severity:[],framework:[],domain:[]})}>
            Clear {active} filter{active===1?'':'s'}
          </button>
        </>
      )}
    </div>
  );
}

// ======================== Findings table ========================
const ALL_COLS = [
  { id: 'status',    label: 'Status',    width: '80px'  },
  { id: 'finding',   label: 'Finding',   width: '1.5fr' },
  { id: 'domain',    label: 'Domain',    width: '140px' },
  { id: 'controlId', label: 'Control #', width: '100px' },
  { id: 'checkId',   label: 'CheckID',   width: '160px' },
  { id: 'severity',  label: 'Severity',  width: '100px' },
  { id: 'frameworks',label: 'Frameworks',width: '120px' },
];
const DEFAULT_COLS = ['status', 'finding', 'domain', 'controlId', 'checkId', 'severity'];

function FindingsTable({ filters, search, focusFinding, onFocusClear }) {
  const [open, setOpen] = useState(new Set());
  const [visibleCols, setVisibleCols] = useState(DEFAULT_COLS);
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const colPickerRef = useRef(null);

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

  useEffect(() => {
    if (!focusFinding) return;
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

  const cols = ALL_COLS.filter(c => visibleCols.includes(c.id));
  const gridTpl = cols.map(c => c.width).join(' ') + ' 28px';

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return FINDINGS.filter(f => {
      if (filters.status.length && !filters.status.includes(f.status)) return false;
      if (filters.severity.length && !filters.severity.includes(f.severity)) return false;
      if (filters.framework.length && !f.frameworks.some(fw => filters.framework.includes(fw))) return false;
      if (filters.domain.length && !filters.domain.includes(f.domain)) return false;
      if (s) {
        const hay = (f.setting+' '+f.checkId+' '+f.current+' '+f.recommended+' '+f.remediation+' '+f.domain+' '+f.section).toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [filters, search]);

  const toggle = i => setOpen(o => {
    const n = new Set(o);
    if (n.has(i)) n.delete(i); else n.add(i);
    return n;
  });

  const renderCell = (colId, f) => {
    switch (colId) {
      case 'status': return (
        <div key="status">
          <span className={'status-badge ' + STATUS_COLORS[f.status]}>
            <span className="dot"/>{f.status}
          </span>
        </div>
      );
      case 'finding': return (
        <div key="finding" className="finding-title">
          <div className="t">{f.setting}</div>
          <div className="sub">{f.section}</div>
        </div>
      );
      case 'domain':    return <div key="domain" className="finding-dom">{f.domain}</div>;
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
        const lvl  = [...new Set(profiles.map(p => p.split('-')[1]).filter(Boolean))].join('+');
        const lic  = profiles.some(p => p.startsWith('E3')) && profiles.some(p => p.startsWith('E5')) ? 'E3+E5'
                   : profiles.some(p => p.startsWith('E5')) ? 'E5'
                   : profiles.some(p => p.startsWith('E3')) ? 'E3' : '';
        return (
          <div key="controlId" style={{display:'flex', flexDirection:'column', gap:2}}>
            <span className="check-id" style={cid ? undefined : {color:'var(--muted)', fontStyle:'italic'}}>{cid || '—'}</span>
            {(lvl || lic) && (
              <span style={{display:'inline-flex', gap:3}}>
                {lvl && <span className={'fw-profile-chip level' + (lvl.includes('L2') ? (lvl.includes('L1') ? '' : '2') : '')}>{lvl}</span>}
                {lic && <span className={'fw-profile-chip ' + (lic === 'E5' ? 'lic5' : 'lic')}>{lic}</span>}
              </span>
            )}
          </div>
        );
      }
      case 'checkId': return (
        <div key="checkId" className="check-id">{f.checkId}</div>
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
      <div className="section-head">
        <span className="eyebrow">03 · Detail</span>
        <h2>All findings <span style={{fontWeight:400, color:'var(--muted)', fontSize:13}}>· {filtered.length} of {FINDINGS.length}</span></h2>
        <div ref={colPickerRef} style={{position:'relative', marginLeft:12, flexShrink:0}}>
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
        <div className="hr"/>
      </div>

      <div className="findings">
        <div className="findings-head" style={{gridTemplateColumns: gridTpl}}>
          {cols.map(c => <div key={c.id}>{c.label}</div>)}
          <div/>
        </div>
        {filtered.length === 0 && <div className="empty">No findings match your filters.</div>}
        {filtered.map((f,i) => {
          const isOpen = open.has(i);
          return (
            <React.Fragment key={i}>
              <div id={'finding-row-'+(f.checkId||'').replace(/\./g,'-')}
                   className={'finding-row' + (isOpen?' open':'')} onClick={() => toggle(i)}
                   style={{gridTemplateColumns: gridTpl}}>
                {cols.map(c => renderCell(c.id, f))}
                <div className="caret"><Icon.chevron/></div>
              </div>
              {isOpen && (
                <div className="finding-detail">
                  <div className="why">
                    <div className="why-label">Why it matters</div>
                    <div className="why-text">{whyItMatters(f)}</div>
                  </div>
                  <div>
                    <div className="block-title">Current value</div>
                    <div className="value-box current">{f.current || '—'}</div>
                  </div>
                  <div>
                    <div className="block-title">Recommended value</div>
                    <div className="value-box recommended">{f.recommended || '—'}</div>
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </section>
  );
}

function renderRemediation(text) {
  if (!text) return <span style={{color:'var(--muted)'}}>No remediation guidance provided.</span>;
  // Highlight Run: PowerShell commands
  const parts = text.split(/(Run:[^.]*\.)/);
  return (
    <span>
      {parts.map((p,i) => {
        if (p.startsWith('Run:')) {
          const cmd = p.replace(/^Run:\s*/, '').replace(/\.$/, '');
          return <span key={i}><strong style={{color:'var(--accent-text)'}}>PowerShell:</strong> <code>{cmd}</code>. </span>;
        }
        return <span key={i}>{p}</span>;
      })}
    </span>
  );
}

function whyItMatters(f) {
  const id = f.checkId;
  if (id.startsWith('ENTRA-MFA') || id.startsWith('ENTRA-AUTHMETHOD')) return 'Weak authentication methods (SMS, voice, email OTP) are phishable and subject to SIM-swap attacks. Phishing-resistant methods (FIDO2, Windows Hello, certificate) are the modern baseline.';
  if (id.startsWith('ENTRA-ADMIN') || id.startsWith('ENTRA-CLOUDADMIN')) return 'Global Admin accounts are the crown jewels. Synced on-prem accounts, excess admin count, and admins without phishing-resistant MFA multiply blast radius if any one tier is compromised.';
  if (id.startsWith('ENTRA-PIM')) return 'Without PIM (Entra ID P2), privileged roles are permanently assigned. Just-in-time elevation with approval and access reviews is the industry baseline for zero-trust identity.';
  if (id.startsWith('ENTRA-PASSWORD')) return 'Password expiration with MFA causes fatigue and weaker passwords. NIST 800-63B recommends no forced rotation when phishing-resistant MFA is present.';
  if (id.startsWith('ENTRA-CONSENT') || id.startsWith('ENTRA-APPREG')) return 'User-consent and app-registration permissions are the primary vector for OAuth-app phishing and illicit consent grants. Lock both down and route approvals to admins.';
  if (id.startsWith('ENTRA-DEVICE')) return 'Entra join and device settings define who can enroll devices and who gets local admin rights. Overly permissive defaults bypass Intune-enforced posture.';
  if (id.startsWith('CA-') || id.startsWith('ENTRA-CA')) return 'Conditional Access is the single control plane that enforces MFA, device compliance, and session policy. Coverage gaps and admin exclusions invalidate the model.';
  if (id.startsWith('DEFENDER-ANTIPHISH')) return 'Anti-phishing impersonation, mailbox intelligence, and targeted-user protection stop Business Email Compromise and spoofing attacks that bypass basic filters.';
  if (id.startsWith('DEFENDER-SAFELINKS') || id.startsWith('DEFENDER-SAFEATTACH')) return 'Safe Links rewrites URLs to detonate at click-time; Safe Attachments detonates files in a sandbox. Without both, zero-day phishing links and malware sail through.';
  if (id.startsWith('DEFENDER-OUTBOUND')) return 'Auto-forwarding is a hallmark of compromised mailboxes exfiltrating data. Disabling external auto-forward and alerting on outbound spam is a BEC table stake.';
  if (id.startsWith('DEFENDER-ANTIMALWARE') || id.startsWith('DEFENDER-MALWARE')) return 'The common-attachment filter blocks high-risk file types (dmg, ps1, js, vhd). Missing types are routine initial-access vectors.';
  if (id.startsWith('DEFENDER-ANTISPAM')) return 'Allow-listing sender domains overrides every downstream filter for those senders. Phishing that spoofs allowed domains goes straight to the inbox.';
  if (id.startsWith('EXO-')) return 'Exchange Online config controls mail flow, connectors, and transport rules. Misconfig here bypasses every downstream security filter.';
  if (id.startsWith('ENTRA-APPS-002') || id.startsWith('APPS-002')) return 'Apps with Directory.ReadWrite.All or DeviceManagement write permissions can modify users, groups, and devices tenant-wide. Grant only read-only equivalents and monitor.';
  if (id.startsWith('ENTRA-STALEADMIN')) return 'Stale admins that never sign in still hold privileges. Any compromise of their credentials yields Global Admin access with low telemetry.';
  if (id.startsWith('CA-EXCLUSION')) return 'Admins excluded from Conditional Access bypass MFA and device-compliance enforcement. Only break-glass accounts should be excluded.';
  if (id.startsWith('ENTRA-BREAKGLASS')) return 'Break-glass accounts are the last-resort recovery mechanism. They must be cloud-only, CA-excluded, phishing-resistant, and quarterly-tested.';
  if (id.startsWith('INTUNE-') || id.startsWith('ENTRA-DEVICE')) return 'Device management policy controls what can join, stay, and execute. Missing config profiles and encryption leaves endpoints unmanaged.';
  if (id.startsWith('SHAREPOINT-') || id.startsWith('20B-')) return 'External sharing, anonymous links, and guest access in SharePoint and OneDrive are common data-leakage paths. Lock down sharing scope and link expiration.';
  if (id.startsWith('TEAMS-')) return 'Teams external access and federation settings control who can message your users and share meeting links. Defaults often allow broader access than required.';
  if (id.startsWith('DLP-') || id.startsWith('COMPLIANCE-')) return 'Data Loss Prevention and retention policies protect regulated content (PII, PCI, PHI). Missing policies = undetected exfiltration and legal-hold gaps.';
  return 'This control maps to hardening guidance across CIS, NIST, and CMMC. Closing this gap reduces attack surface and tightens compliance posture.';
}

// ======================== Roadmap ========================
function Roadmap({ onViewFinding }) {
  const [open, setOpen] = useState(null);
  const tasks = FINDINGS.filter(f => f.status !== 'Pass' && f.status !== 'Info').map(f => ({ ...f }));
  const score = f => {
    const sev = { critical:100, high:60, medium:30, low:10, none:0, info:5 }[f.severity];
    const eff = { small:3, medium:2, large:1 }[f.effort];
    return sev * eff;
  };
  tasks.sort((a,b) => score(b) - score(a));

  const now = tasks.filter(t => t.severity === 'critical' || (t.severity === 'high' && t.effort === 'small'));
  const soon = tasks.filter(t => !now.includes(t) && (t.severity === 'high' || (t.severity === 'medium' && t.effort !== 'large')));
  const later = tasks.filter(t => !now.includes(t) && !soon.includes(t));

  const priorityReason = (t, lane) => {
    if (lane === 'now') {
      if (t.severity === 'critical') return `Critical severity — exposes the tenant to identity takeover, data exfiltration, or privilege escalation. Fix immediately regardless of effort.`;
      return `High severity with small remediation effort — a config toggle or policy tweak that removes material risk in minutes. Low-hanging fruit; do it first.`;
    }
    if (lane === 'soon') {
      if (t.severity === 'high') return `High severity but non-trivial effort (${t.effort}). Risk is real but remediation requires coordination — schedule within the first month.`;
      return `Medium severity, tractable effort. Won't stop a breach on its own but closes a common lateral-movement path. Batch with other ${t.effort}-effort work this sprint.`;
    }
    if (t.severity === 'low') return `Low severity — defence-in-depth hardening. Worth doing, but only after the Now and Next lanes are clear.`;
    return `Medium severity + large effort. High design cost (policy rollout, user comms, license review). Slot into the quarterly plan, not the weekly one.`;
  };

  const renderTask = (t, lane) => {
    const key = t.checkId;
    const isOpen = open === key;
    return (
      <div className={'task'+(isOpen?' task-open':'')} key={key}>
        <button className="task-head-btn" onClick={()=>setOpen(isOpen?null:key)} aria-expanded={isOpen}>
          <div className="task-head">
            <span>{t.setting}</span>
            <span className={'status-badge ' + STATUS_COLORS[t.status]}><span className="dot"/>{t.status}</span>
          </div>
          <div className="task-id">{t.checkId} · {t.domain}</div>
          <div className="task-tags">
            <span className="task-tag">{SEV_LABEL[t.severity]}</span>
            {t.effort && <span className="task-tag">{t.effort} effort</span>}
            {t.frameworks.slice(0,3).map(fw => <span key={fw} className="task-tag" style={{fontFamily:'var(--font-mono)'}}>{fw}</span>)}
            <span className="task-chev" aria-hidden="true">{isOpen ? '−' : '+'}</span>
          </div>
        </button>
        {isOpen && (
          <div className="task-body">
            <div className="task-why">
              <div className="task-why-label">Why this is in {lane==='now'?'“Now”':lane==='soon'?'“Next”':'“Later”'}</div>
              <div className="task-why-text">{priorityReason(t, lane)}</div>
            </div>
            <div className="task-grid">
              <div className="task-field">
                <div className="task-field-label">Current</div>
                <div className="task-field-value">{t.current || <span style={{color:'var(--muted)'}}>—</span>}</div>
              </div>
              <div className="task-field">
                <div className="task-field-label">Recommended</div>
                <div className="task-field-value">{t.recommended || <span style={{color:'var(--muted)'}}>—</span>}</div>
              </div>
            </div>
            {t.remediation && (
              <div className="task-field">
                <div className="task-field-label">Remediation</div>
                <div className="task-field-value task-remediation">{t.remediation}</div>
              </div>
            )}
            {t.rationale && (
              <div className="task-field">
                <div className="task-field-label">Business rationale</div>
                <div className="task-field-value">{t.rationale}</div>
              </div>
            )}
            <div className="task-meta-row">
              <span><b>Section:</b> {t.section}</span>
              <span><b>Severity:</b> {SEV_LABEL[t.severity]}</span>
              {t.effort && <span><b>Effort:</b> {t.effort}</span>}
              <span><b>Frameworks:</b> {t.frameworks.join(', ') || '—'}</span>
            </div>
            <div className="task-actions">
              <a href="#findings-anchor" onClick={(e)=>{
                e.preventDefault();
                onViewFinding?.(t.checkId);
              }}>View in findings table →</a>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="block" id="roadmap">
      <div className="section-head">
        <span className="eyebrow">04 · Action plan</span>
        <h2>Remediation roadmap</h2>
        <div className="hr"/>
      </div>
      <div className="roadmap-intro">
        <div className="roadmap-intro-head">How we prioritized</div>
        <div className="roadmap-intro-body">
          Findings are bucketed by severity. Critical findings — identity takeover, data exfiltration, privilege escalation paths — always go in <b>Now</b>. High-severity findings land in <b>Next</b>: risk is real but remediation typically requires coordination or scheduling. Medium-severity items also join <b>Next</b> when tractable, or <b>Later</b> for larger hardening work. Once remediation effort data is available from the upstream registry, <b>Now</b> will additionally surface high-severity quick wins — config toggles, policy tweaks — via a <code>severity × (1/effort)</code> score. <br/>
          <span style={{color:'var(--muted)'}}>Click any task to see why it's in this lane, the current vs recommended state, and exact remediation steps. Customers with a different risk appetite (regulatory deadline, incident response, M&amp;A freeze) may reorder — the lanes are a starting point, not a mandate.</span>
        </div>
      </div>
      <div className="roadmap">
        <div className="lane">
          <div className="lane-head">
            <div className="lane-title" id="roadmap-now"><span className="lane-dot crit"/>Now <span style={{color:'var(--muted)', fontWeight:400}}>· {now.length}</span></div>
            <div className="lane-eta">&lt; 1 week</div>
          </div>
          {now.map(t => renderTask(t, 'now'))}
        </div>
        <div className="lane">
          <div className="lane-head">
            <div className="lane-title" id="roadmap-next"><span className="lane-dot soon"/>Next <span style={{color:'var(--muted)', fontWeight:400}}>· {soon.length}</span></div>
            <div className="lane-eta">1 – 4 weeks</div>
          </div>
          {soon.map(t => renderTask(t, 'soon'))}
        </div>
        <div className="lane">
          <div className="lane-head">
            <div className="lane-title" id="roadmap-later"><span className="lane-dot later"/>Later <span style={{color:'var(--muted)', fontWeight:400}}>· {later.length}</span></div>
            <div className="lane-eta">1 – 3 months</div>
          </div>
          {later.map(t => renderTask(t, 'later'))}
        </div>
      </div>
    </section>
  );
}

// ======================== Critical Exposure section ========================
function StrykerBlock() {
  const stryker = FINDINGS.filter(f => f.domain === 'Stryker Readiness');
  if (!stryker.length) return null;
  const fail = stryker.filter(f => f.status==='Fail').length;
  const pass = stryker.filter(f => f.status==='Pass').length;
  return (
    <section className="block" id="stryker">
      <div className="section-head">
        <span className="eyebrow">01b · Targeted</span>
        <h2>Critical exposure analysis</h2>
        <div className="hr"/>
      </div>
      <div className="card" style={{marginBottom:12, display:'flex', gap:24, alignItems:'center', flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:12, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.1em', fontWeight:600}}>Coverage</div>
          <div style={{fontSize:34, fontWeight:700, fontFamily:'var(--font-display)', letterSpacing:'-.02em'}}>
            {pct(pass, stryker.length)}<span style={{fontSize:18, color:'var(--muted)'}}>%</span>
          </div>
        </div>
        <div style={{flex:1, minWidth:200, fontSize:13, color:'var(--text-soft)', lineHeight:1.55}}>
          Mapped to MITRE ATT&amp;CK Enterprise techniques and CISA Known Exploited Vulnerabilities (KEV). Prioritized by CIS Critical Security Controls v8 — covers privileged account exposure, CA exclusions, dangerous Graph permissions, and audit trail gaps.
        </div>
        <div style={{display:'flex', gap:18, fontVariantNumeric:'tabular-nums'}}>
          <div><div style={{fontSize:12,color:'var(--muted)'}}>Pass</div><div style={{fontWeight:700, color:'var(--success-text)'}}>{pass}</div></div>
          <div><div style={{fontSize:12,color:'var(--muted)'}}>Fail</div><div style={{fontWeight:700, color:'var(--danger-text)'}}>{fail}</div></div>
          <div><div style={{fontSize:12,color:'var(--muted)'}}>Total</div><div style={{fontWeight:700}}>{stryker.length}</div></div>
        </div>
      </div>
      <div className="findings">
        <div className="findings-head">
          <div>Status</div><div>Check</div><div>Check ID</div><div>Severity</div><div>Frameworks</div><div/>
        </div>
        {stryker.map((f,i) => (
          <div key={i} className="finding-row" style={{cursor:'default'}}>
            <div><span className={'status-badge '+STATUS_COLORS[f.status]}><span className="dot"/>{f.status}</span></div>
            <div className="finding-title"><div className="t">{f.setting}</div><div className="sub">{f.section}</div></div>
            <div className="check-id">{f.checkId}</div>
            <div><span className={'sev-badge '+f.severity}><span className="bar"><i/><i/><i/><i/></span><span>{SEV_LABEL[f.severity]}</span></span></div>
            <div className="fw-list">{f.frameworks.map(fw => <span key={fw} className="fw-pill">{fw}</span>)}</div>
            <div/>
          </div>
        ))}
      </div>
    </section>
  );
}

// ======================== Overview (tenant + summary) ========================
function Overview() {
  const totalChecks = D.summary.reduce((a,r)=>a+parseInt(r.Items||0),0);
  return (
    <section className="block" id="overview">
      <div className="tenant-line">
        <span><b>{TENANT.OrgDisplayName}</b></span>
        <span className="sep">│</span>
        <span>Tenant <b>{TENANT.TenantId}</b></span>
        <span className="sep">│</span>
        <span>Default domain <b>{TENANT.DefaultDomain}</b></span>
        <span className="sep">│</span>
        <span>Users <b>{USERS.TotalUsers}</b> · licensed <b>{USERS.Licensed}</b></span>
        <span className="sep">│</span>
        <span>Run <b>{new Date(SCORE.CreatedDateTime || Date.now()).toLocaleString()}</b></span>
      </div>
      <div className="overview-meta">
        <span>› {D.summary.length} collectors executed</span>
        <span>› {fmt(totalChecks)} data points inventoried</span>
        <span>› {FINDINGS.length} controls evaluated</span>
        <span>› {FRAMEWORKS.length} frameworks mapped</span>
      </div>
    </section>
  );
}

// ======================== Appendix ========================
function Appendix() {
  return (
    <section className="block" id="appendix">
      <div className="section-head">
        <span className="eyebrow">05 · Reference</span>
        <h2>Tenant appendix</h2>
        <div className="hr"/>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:14}}>
        <div className="card">
          <div style={{fontSize:12,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.08em',fontWeight:600,marginBottom:10}}>Licenses</div>
          <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
            <thead><tr style={{textAlign:'left',color:'var(--muted)'}}><th style={{padding:'6px 0'}}>SKU</th><th style={{textAlign:'right'}}>Assigned</th><th style={{textAlign:'right'}}>Total</th></tr></thead>
            <tbody>
              {D.licenses.filter(l => parseInt(l.Assigned) > 0).map((l,i)=>(
                <tr key={i} style={{borderTop:'1px solid var(--border)'}}>
                  <td style={{padding:'6px 0'}}>{l.License}</td>
                  <td style={{textAlign:'right',fontFamily:'var(--font-mono)',fontVariantNumeric:'tabular-nums'}}>{l.Assigned}</td>
                  <td style={{textAlign:'right',fontFamily:'var(--font-mono)',fontVariantNumeric:'tabular-nums',color:'var(--muted)'}}>{l.Total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div style={{fontSize:12,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.08em',fontWeight:600,marginBottom:10}}>Email authentication posture</div>
          <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
            <thead><tr style={{textAlign:'left',color:'var(--muted)'}}><th style={{padding:'6px 0'}}>Domain</th><th>SPF</th><th>DMARC</th><th>DKIM</th></tr></thead>
            <tbody>
              {D.dns.map((r,i)=>(
                <tr key={i} style={{borderTop:'1px solid var(--border)'}}>
                  <td style={{padding:'6px 0',fontFamily:'var(--font-mono)',fontSize:12}}>{r.Domain}</td>
                  <td><StatusDot ok={r.SPF && !r.SPF.includes('Not')}/></td>
                  <td><StatusDot ok={r.DMARCPolicy === 'reject' || r.DMARCPolicy === 'quarantine'} warn={r.DMARCPolicy?.includes('none')}/></td>
                  <td><StatusDot ok={r.DKIMStatus === 'OK'}/></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div style={{fontSize:12,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.08em',fontWeight:600,marginBottom:10}}>Conditional Access policies</div>
          <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
            <tbody>
              {D.ca.map((r,i)=>(
                <tr key={i} style={{borderTop:'1px solid var(--border)'}}>
                  <td style={{padding:'6px 0'}}>{r.DisplayName}</td>
                  <td style={{textAlign:'right'}}><StatusDot ok={r.State === 'enabled'} warn={r.State?.includes('Report')}/></td>
                  <td style={{textAlign:'right',fontSize:12,color:'var(--muted)'}}>{r.State}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div style={{fontSize:12,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.08em',fontWeight:600,marginBottom:10}}>Global administrators</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
            {D['admin-roles'].filter(r=>r.RoleName==='Global Administrator').map((r,i)=>(
              <span key={i} className="fw-pill" style={{fontSize:12,padding:'4px 8px'}}>
                {r.MemberDisplayName}
              </span>
            ))}
          </div>
          <div style={{fontSize:12,color:'var(--muted)',marginTop:8}}>
            {D['admin-roles'].filter(r=>r.RoleName==='Global Administrator').length} Global Administrators detected (including break-glass).
          </div>
        </div>
      </div>
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
  const DEFAULTS = /*EDITMODE-BEGIN*/{
    "theme": "neon",
    "mode": "dark",
    "density": "compact"
  }/*EDITMODE-END*/;

  const [theme, setTheme] = useState(() => localStorage.getItem('m365-theme') || DEFAULTS.theme);
  const [mode, setMode] = useState(() => localStorage.getItem('m365-mode') || DEFAULTS.mode);
  const [density, setDensity] = useState(() => localStorage.getItem('m365-density') || DEFAULTS.density);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ status:[], severity:[], framework:[], domain:[] });
  const [active, setActive] = useState('overview');
  const [showTweaks, setShowTweaks] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [focusFinding, setFocusFinding] = useState(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.mode = mode;
    document.documentElement.dataset.density = density;
    localStorage.setItem('m365-theme', theme);
    localStorage.setItem('m365-mode', mode);
    localStorage.setItem('m365-density', density);
  }, [theme, mode, density]);

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

  // Scrollspy
  useEffect(() => {
    const sections = document.querySelectorAll('section.block');
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) setActive(e.target.id); });
    }, { rootMargin: '-40% 0px -55% 0px' });
    sections.forEach(s => obs.observe(s));
    return () => obs.disconnect();
  }, []);

  // Counts for filter bar
  const counts = useMemo(() => {
    const c = { status:{}, severity:{}, framework:{}, domain:{} };
    FINDINGS.forEach(f => {
      c.status[f.status] = (c.status[f.status]||0) + 1;
      c.severity[f.severity] = (c.severity[f.severity]||0) + 1;
      c.domain[f.domain] = (c.domain[f.domain]||0) + 1;
      f.frameworks.forEach(fw => c.framework[fw] = (c.framework[fw]||0) + 1);
    });
    return c;
  }, []);

  const navCounts = {
    total: FINDINGS.length,
    identity: FINDINGS.filter(f => ['Entra ID','Conditional Access','Enterprise Apps'].includes(f.domain) && f.status === 'Fail').length,
    stryker: FINDINGS.filter(f => f.domain === 'Stryker Readiness' && f.status === 'Fail').length,
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
  const onDomainJump = (d) => {
    setFilters(f => ({ ...f, domain: d ? [d] : [] }));
    if (d) document.getElementById('findings-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const onViewFinding = useCallback((checkId) => {
    setFilters({ status:[], severity:[], framework:[], domain:[] });
    setSearch('');
    setFocusFinding(checkId);
    document.getElementById('findings-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className="app">
      <Sidebar active={active} counts={navCounts} domainCounts={domainCounts} activeDomain={filters.domain.length===1 ? filters.domain[0] : null} onDomainJump={onDomainJump} navOpen={navOpen} onClose={()=>setNavOpen(false)}/>
      <main className="main">
        <Topbar
          search={search} setSearch={setSearch}
          mode={mode} setMode={setMode}
          theme={theme} setTheme={setTheme}
          onPrint={()=>window.print()}
          onTweaks={()=>setShowTweaks(s=>!s)}
          onHamburger={()=>setNavOpen(o=>!o)}
        />
        <Overview/>
        <Posture/>
        <DomainRollup onJump={onDomainJump}/>
        <FrameworkQuilt onSelect={onFrameworkSelect} selected={filters.framework[0]}/>
        <div id="findings-anchor"/>
        <div style={{marginTop:20}}/>
        <FilterBar filters={filters} setFilters={setFilters} counts={counts} total={FINDINGS.length} search={search} setSearch={setSearch}/>
        <FindingsTable filters={filters} search={search} focusFinding={focusFinding} onFocusClear={() => setFocusFinding(null)}/>
        <Roadmap onViewFinding={onViewFinding}/>
        <Appendix/>
        {!D.whiteLabel && (
          <div style={{textAlign:'center',padding:'30px 0 10px',fontSize:12,color:'var(--muted)',fontFamily:'var(--font-mono)',letterSpacing:'.06em'}}>
            <a href="https://github.com/Galvnyz/M365-Assess" target="_blank" rel="noreferrer" style={{color:'inherit',textDecoration:'underline',textUnderlineOffset:3}}>M365 ASSESS</a>
            {' · READ-ONLY SECURITY ASSESSMENT · '}
            <a href="https://galvnyz.com" target="_blank" rel="noreferrer" style={{color:'inherit',textDecoration:'underline',textUnderlineOffset:3}}>GALVNYZ</a>
          </div>
        )}
      </main>
      {showTweaks && <TweaksPanel onClose={()=>setShowTweaks(false)} theme={theme} setTheme={setTheme} mode={mode} setMode={setMode} density={density} setDensity={setDensity}/>}
    </div>
  );
}

// ---- Edit-mode protocol (Tweaks toolbar) ----
window.addEventListener('message', (e) => {
  if (e.data?.type === '__activate_edit_mode') {
    // No-op: the in-page Tweaks button already provides the UI
  }
});
window.parent?.postMessage({type:'__edit_mode_available'}, '*');

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App/>);
