/* global React, ReactDOM */
const { useState, useEffect, useMemo, useRef, useCallback } = React;

// --------------------- Data shape from bundle.js ---------------------
const D = window.REPORT_DATA;
const TENANT = D.tenant[0] || {};
const FILTER_KEY = 'm365-filters-' + (TENANT.TenantId || 'default');
const USERS = D.users[0] || {};
const SCORE = D.score[0] || {};
const MFA_STATS = D.mfaStats;
const FINDINGS = D.findings;
const DOMAIN_STATS = D.domainStats;

const LS = key => `${key}-${TENANT.TenantId || 'anon'}`;
const RO = window.REPORT_OVERRIDES || null;

function finalizeReport({ hiddenFindings, hiddenElements, roadmapOverrides }) {
  const overridesEl = document.getElementById('report-overrides');
  if (!overridesEl) {
    alert('This report is missing the overrides injection point. Regenerate it with the latest template.');
    return;
  }
  const overrides = {
    hiddenFindings:   [...(hiddenFindings || [])],
    hiddenElements:   [...(hiddenElements || [])],
    roadmapOverrides: roadmapOverrides || {},
  };
  const clone = document.documentElement.cloneNode(true);
  clone.querySelector('#report-overrides').textContent = `window.REPORT_OVERRIDES = ${JSON.stringify(overrides)};`;
  clone.querySelector('#root').replaceChildren();
  const blob = new Blob(['<!DOCTYPE html>\n' + clone.outerHTML], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (TENANT.OrgDisplayName || 'Assessment').replace(/[^a-z0-9 ]/gi, '').trim().replace(/\s+/g, '-') + '-M365-Report.html';
  a.click();
  URL.revokeObjectURL(url);
}

// Issue #712: edit-mode generic hide capability for any card or section.
// Context lets HideableBlock read editMode + hiddenElements without prop
// drilling through every parent component (App > Posture > KPI cards, etc.).
const EditModeContext = React.createContext({ editMode: false, hiddenElements: new Set(), toggleHideElement: () => {} });

// HideableBlock wraps any element to make it hideable in edit mode.
//  - In production view (editMode=false) and the key is hidden → renders nothing
//  - In production view and not hidden → renders children with a transparent wrapper (display:contents)
//  - In edit mode → renders a positioning wrapper with a ✕ overlay (or ↩ Restore when hidden)
function HideableBlock({ hideKey, children, label }) {
  const { editMode, hiddenElements, toggleHideElement } = React.useContext(EditModeContext);
  const isHidden = hiddenElements?.has(hideKey);
  if (!editMode && isHidden) return null;
  if (!editMode) return <>{children}</>;
  return (
    <div className={'hideable-block' + (isHidden ? ' hideable-block-hidden' : '')} data-hide-key={hideKey}>
      {children}
      <button
        className={'hideable-btn' + (isHidden ? ' restore' : '')}
        title={isHidden ? `Restore ${label || 'this section'}` : `Hide ${label || 'this section'}`}
        onClick={e => { e.stopPropagation(); toggleHideElement(hideKey); }}>
        {isHidden ? '↩' : '✕'}
      </button>
    </div>
  );
}

// Issue #715: roadmap lane counts now read from t.lane (precomputed by
// Get-RemediationLane.ps1 in the data bridge) so sidebar nav, Roadmap, and
// XLSX export all agree on bucketing without parallel JS rules.
// Statuses that should NOT become remediation tasks. See docs/CHECK-STATUS-MODEL.md
//   Pass / Info       — no remediation needed
//   Skipped           — user intentionally didn't run this check
//   Unknown           — data couldn't be collected; remediation is "fix permissions", not the check itself
//   NotApplicable     — service not in use in this tenant
//   NotLicensed       — surfaced separately as "Requires Licensing", not as a Now/Next/Later task
const NON_REMEDIATION_STATUSES = new Set(['Pass', 'Info', 'Skipped', 'Unknown', 'NotApplicable', 'NotLicensed']);
const _RM = FINDINGS.filter(f => !NON_REMEDIATION_STATUSES.has(f.status));
const ROADMAP_COUNTS = {
  now:   _RM.filter(t => t.lane === 'now').length,
  soon:  _RM.filter(t => t.lane === 'soon').length,
  later: _RM.filter(t => t.lane === 'later' || !t.lane).length,
};

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
  moon: () => (<svg viewBox="0 0 16 16" fill="currentColor"><defs><mask id="mm"><rect width="16" height="16" fill="white"/><circle cx="10" cy="5" r="4.5" fill="black"/></mask></defs><circle cx="7.5" cy="8" r="5.5" mask="url(#mm)"/><circle cx="12.5" cy="3.5" r="1" opacity=".5"/><circle cx="14" cy="7" r=".6" opacity=".35"/></svg>),
  sun: () => (<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="3.2"/><g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"><path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M12.4 3.6l-1.3 1.3M4.9 11.1l-1.3 1.3"/></g></svg>),
  print: () => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 5V2h8v3"/><path d="M4 13H2V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6h-2"/><rect x="4" y="10" width="8" height="4"/></svg>),
  xlsx: () => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5 6l2.5 4M7.5 6L5 10M9.5 6v4M11 9h-1.5"/></svg>),
  sliders: () => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 5h10M3 11h10"/><circle cx="6" cy="5" r="1.5" fill="currentColor" stroke="none"/><circle cx="10" cy="11" r="1.5" fill="currentColor" stroke="none"/></svg>),
  chevron: () => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 4l4 4-4 4"/></svg>),
  download: () => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2v8M5 7l3 3 3-3M2 12v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1"/></svg>),
  menu: () => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12M2 8h12M2 12h12"/></svg>),
  close: () => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 3l10 10M13 3L3 13"/></svg>),
};

// Status -> CSS chip class name. See docs/CHECK-STATUS-MODEL.md for semantics.
const STATUS_COLORS = {
  Fail:          'fail',
  Warning:       'warn',
  Pass:          'pass',
  Review:        'review',
  Info:          'info',
  Skipped:       'skipped',
  Unknown:       'unknown',
  NotApplicable: 'notapplicable',
  NotLicensed:   'notlicensed',
};

// Short display label for the inline status-badge in narrow table columns.
// The data value (status key) is unchanged; only the rendered text differs.
// Filter chips use longer friendly labels via the statusChips array's third
// element (see FilterBar).
const STATUS_LABEL = {
  NotApplicable: 'N/A',
  NotLicensed:   'No License',
};
const statusLabel = s => STATUS_LABEL[s] || s;
const SEV_LABEL = { critical:'Critical', high:'High', medium:'Medium', low:'Low', none:'—', info:'Info' };

// --------------------- Helpers ---------------------
const pct = (n,d) => d ? Math.round((n/d)*100) : 0;

// Pass% denominator per docs/CHECK-STATUS-MODEL.md (#802):
//   Pass% = Pass / (Pass + Fail + Warning)
// All other statuses (Review, Info, Skipped, Unknown, NotApplicable, NotLicensed)
// are excluded from BOTH numerator and denominator -- not-collected results
// can never inflate or deflate the score.
const SCORED_STATUSES = new Set(['Pass', 'Fail', 'Warning']);
const scoreDenom = arr => (arr || []).filter(f => SCORED_STATUSES.has(f.status)).length;
const fmt = n => Number(n).toLocaleString();

// ======================== Sidebar ========================
function Sidebar({ active, activeSubsection, counts, domainCounts, activeDomain, onDomainJump, onOverviewClick, navOpen, onClose }) {
  const [roadmapOpen, setRoadmapOpen] = useState(false);
  const [domainNavOpen, setDomainNavOpen] = useState(false);
  const [domainsCollapsed, setDomainsCollapsed] = useState(true);
  function toggleRoadmap(e) {
    e.preventDefault(); e.stopPropagation();
    setRoadmapOpen(o => !o);
  }
  function toggleDomainNav(e) {
    e.preventDefault(); e.stopPropagation();
    setDomainNavOpen(o => !o);
  }
  const DOM_ORDER = ['Entra ID','Conditional Access','Enterprise Apps','Exchange Online','Intune','Defender','Purview / Compliance','SharePoint & OneDrive','Teams','Forms','Power BI','Active Directory','SOC 2','Value Opportunity'];
  const domains = DOM_ORDER.filter(d => domainCounts.total[d]).concat(
    Object.keys(domainCounts.total).filter(d => !DOM_ORDER.includes(d)).sort()
  );
  const exec = [
    { id: 'overview', label: 'Overview' },
    { id: 'posture',  label: 'Posture score' },
    { id: 'frameworks', label: 'Frameworks' },
    { id: 'identity', label: 'Domain posture' },
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
            <React.Fragment key={it.id}>
              <a href={`#${it.id}`}
                 onClick={e => { if (it.id === 'overview') { e.preventDefault(); onOverviewClick(); } closeIfMobile(); }}
                 className={'nav-item' + (active===it.id?' active':'')}>
                <span>{it.label}</span>
                {it.id === 'identity' && (
                  <span className="nav-expand-icon" onClick={toggleDomainNav}>
                    {(domainNavOpen || active === 'identity') ? '\u2212' : '+'}
                  </span>
                )}
              </a>
              {it.id === 'identity' && (domainNavOpen || active === 'identity') && (
                <div className="nav-subitems">
                  {FINDINGS.some(f => f.domain === 'Intune') && (
                    <a href="#identity-intune"     className={'nav-subitem' + (activeSubsection==='identity-intune'?' active':'')}     onClick={closeIfMobile}>Intune coverage</a>
                  )}
                  {FINDINGS.some(f => f.domain === 'SharePoint & OneDrive') && (
                    <a href="#identity-sharepoint" className={'nav-subitem' + (activeSubsection==='identity-sharepoint'?' active':'')} onClick={closeIfMobile}>SharePoint &amp; OneDrive</a>
                  )}
                  {D.adHybrid && (
                    <a href="#identity-ad"         className={'nav-subitem' + (activeSubsection==='identity-ad'?' active':'')}         onClick={closeIfMobile}>AD &amp; hybrid</a>
                  )}
                  {(D.dns || []).length > 0 && (
                    <a href="#identity-email"      className={'nav-subitem' + (activeSubsection==='identity-email'?' active':'')}      onClick={closeIfMobile}>Email auth</a>
                  )}
                </div>
              )}
            </React.Fragment>
          ))}
          <div className="nav-label nav-label-emphasis" style={{marginTop:14}}>Findings &amp; action</div>
          {details.map(it => (
            <React.Fragment key={it.id}>
              <a href={`#${it.id}`}
                 onClick={e => { if (it.id === 'findings') onDomainJump(null); closeIfMobile(); }}
                 className={'nav-item' + (active===it.id && !(it.id==='findings' && activeDomain)?' active':'')}>
                <span>{it.label}</span>
                {it.id === 'roadmap'
                  ? <span className="nav-expand-icon" onClick={toggleRoadmap}>{(roadmapOpen || active === 'roadmap') ? '\u2212' : '+'}</span>
                  : it.count !== undefined && <span className="count">{it.count}</span>
                }
              </a>
              {it.id === 'roadmap' && (roadmapOpen || active === 'roadmap') && (
                <div className="nav-subitems">
                  <a href="#roadmap-now"   className="nav-subitem">Now   <span className="count">{ROADMAP_COUNTS.now}</span></a>
                  <a href="#roadmap-next"  className="nav-subitem">Next  <span className="count">{ROADMAP_COUNTS.soon}</span></a>
                  <a href="#roadmap-later" className="nav-subitem">Later <span className="count">{ROADMAP_COUNTS.later}</span></a>
                </div>
              )}
              {it.id === 'findings' && (
                <React.Fragment>
                  <a href="#findings-anchor"
                     onClick={e => { e.preventDefault(); setDomainsCollapsed(c => !c); }}
                     className="nav-item">
                    <span>Domains</span>
                    <span className="nav-expand-icon">{domainsCollapsed ? '+' : '−'}</span>
                  </a>
                  {!domainsCollapsed && (
                    <div className="nav-subitems">
                      {domains.map(d => {
                        const fails = domainCounts.fail[d] || 0;
                        const total = domainCounts.total[d] || 0;
                        return (
                          <a href="#findings-anchor" key={d}
                             onClick={(e)=>{ e.preventDefault(); onDomainJump(d); closeIfMobile(); }}
                             className={'nav-subitem' + (activeDomain===d?' active':'')}>
                            <span>{d}</span>
                            <span className={'count' + (fails ? ' pill-fail' : '')}>{fails || total}</span>
                          </a>
                        );
                      })}
                    </div>
                  )}
                </React.Fragment>
              )}
            </React.Fragment>
          ))}
        </nav>
        <div className="sidebar-cards">
          <div className="sc-card">
            <div className="sc-header">
              <span className="sc-dot" style={{background:'var(--success)'}}/>
              <span className="sc-title">TENANT</span>
              <span className="sc-sub">· SNAPSHOT</span>
            </div>
            <div className="sc-row"><span>org</span><span>{TENANT.DefaultDomain || TENANT.OrgDisplayName}</span></div>
            <div className="sc-row"><span>tenant</span><span>{(TENANT.TenantId||'').slice(0,8)+'…'}</span></div>
            {TENANT.tenantAgeYears != null && <div className="sc-row"><span>age</span><span>{TENANT.tenantAgeYears} yrs</span></div>}
            <div className="sc-row"><span>users</span><span>{fmt(USERS.TotalUsers)}</span></div>
            <div className="sc-row sc-row-indent"><span>licensed</span><span>{fmt(USERS.Licensed)}</span></div>
            <div className="sc-row sc-row-indent"><span>guests</span><span>{fmt(USERS.GuestUsers)}</span></div>
            {USERS.SyncedFromOnPrem > 0 && <div className="sc-row sc-row-indent"><span>synced</span><span>{fmt(USERS.SyncedFromOnPrem)}</span></div>}
            {USERS.DisabledUsers  > 0 && <div className="sc-row sc-row-indent"><span>disabled</span><span className="sc-warn">{fmt(USERS.DisabledUsers)}</span></div>}
            {USERS.NeverSignedIn  > 0 && <div className="sc-row sc-row-indent"><span>never signed in</span><span className="sc-warn">{fmt(USERS.NeverSignedIn)}</span></div>}
            {USERS.StaleMember    > 0 && <div className="sc-row sc-row-indent"><span>stale</span><span className="sc-warn">{fmt(USERS.StaleMember)}</span></div>}
            {D.deviceStats != null && (() => {
              const ds = D.deviceStats;
              const other = Math.max(0, ds.total - ds.compliant - ds.nonCompliant);
              return (
                <React.Fragment>
                  <div className="sc-row"><span>devices</span><span>{fmt(ds.total)}</span></div>
                  {ds.compliant > 0    && <div className="sc-row sc-row-indent"><span>compliant</span><span className="sc-good">{fmt(ds.compliant)}</span></div>}
                  {ds.nonCompliant > 0 && <div className="sc-row sc-row-indent"><span>non-compliant</span><span className="sc-danger">{fmt(ds.nonCompliant)}</span></div>}
                  {other > 0           && <div className="sc-row sc-row-indent" title="Grace period, error, unknown, or not-applicable states"><span>other state</span><span className="sc-warn">{fmt(other)}</span></div>}
                </React.Fragment>
              );
            })()}
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

// Issue #737: shared collapsible-section hook. Each top-level section's
// .section-head spreads `headProps` to gain click + keyboard toggle. The
// `beforeprint` listener auto-expands so PDF/print exports never lose
// content that happens to be collapsed in-screen.
function useCollapsibleSection(defaultOpen = true) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    const expand = () => setOpen(true);
    window.addEventListener('beforeprint', expand);
    return () => window.removeEventListener('beforeprint', expand);
  }, []);
  const headProps = {
    role: 'button',
    tabIndex: 0,
    'aria-expanded': open,
    className: 'section-head section-head-toggle' + (open ? '' : ' is-closed'),
    onClick: () => setOpen(o => !o),
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); }
    },
  };
  return { open, headProps };
}

// ======================== Topbar ========================
function Topbar({ search, setSearch, searchMatches, matchIdx, onAdvanceMatch, onRetreatMatch, mode, setMode, theme, setTheme, textScale, setTextScale, onPrint, onTweaks, onHamburger, editMode, onEditToggle, onFinalize, onReset, hiddenCount }) {
  // Issue #852: split the single cycling A/A+/A++ button into separate
  // A− (decrement) and A+ (increment) controls. Each disables at the
  // boundary (normal/xlarge) instead of wrapping around.
  const SCALE_CYCLE = ['normal', 'large', 'xlarge'];
  const scaleIdx = SCALE_CYCLE.indexOf(textScale);
  const safeIdx = scaleIdx === -1 ? 0 : scaleIdx;
  const canIncrement = safeIdx < SCALE_CYCLE.length - 1;
  const canDecrement = safeIdx > 0;
  const incScale = () => { if (canIncrement) setTextScale(SCALE_CYCLE[safeIdx + 1]); };
  const decScale = () => { if (canDecrement) setTextScale(SCALE_CYCLE[safeIdx - 1]); };
  const scaleNames = { normal: 'normal', large: 'large', xlarge: 'extra large' };
  const incTitle = canIncrement ? `Increase text size (currently ${scaleNames[textScale] || textScale})` : 'Already at max text size';
  const decTitle = canDecrement ? `Decrease text size (currently ${scaleNames[textScale] || textScale})` : 'Already at default text size';
  return (
    <>
      {editMode && (
        <div className="edit-toolbar">
          <span className="edit-toolbar-badge">✎ Edit Mode</span>
          {hiddenCount > 0 && (
            <span className="edit-toolbar-info">{hiddenCount} finding{hiddenCount===1?'':'s'} hidden</span>
          )}
          <button className="edit-toolbar-reset" onClick={onReset}>↺ Reset all</button>
          <button className="edit-toolbar-finalize" onClick={onFinalize}>↓ Finalize report</button>
          <button className="edit-toolbar-exit" onClick={onEditToggle}>✕ Exit edit mode</button>
        </div>
      )}
      <div className="topbar">
        <button className="hamburger-btn" onClick={onHamburger} aria-label="Open navigation"><Icon.menu/></button>
        <div className="title">
          Security posture report
          <span className="title-sub">· {TENANT.OrgDisplayName}</span>
        </div>
        <div className="spacer" />
        <div className="search">
          <Icon.search />
          <input value={search}
            onChange={e=>setSearch(e.target.value)}
            onKeyDown={e=>{
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) onRetreatMatch?.(); else onAdvanceMatch?.();
              } else if (e.key === 'Escape') {
                setSearch('');
              }
            }}
            placeholder="Search findings, check IDs, remediation… (Enter to cycle)" />
          {search && (
            <span className={'search-counter' + ((searchMatches||[]).length === 0 ? ' is-empty' : '')}>
              {(searchMatches||[]).length === 0 ? '0/0' : (matchIdx + 1) + '/' + searchMatches.length}
            </span>
          )}
          <kbd>/</kbd>
        </div>
        <div className="palette-switch">
          <button className={theme==='neon'?'active':''} onClick={()=>setTheme('neon')}>Neon</button>
          <button className={theme==='console'?'active':''} onClick={()=>setTheme('console')}>Console</button>
          <button className={theme==='saas'?'active':''} onClick={()=>setTheme('saas')}>Vibe</button>
          <button className={theme==='high-contrast'?'active':''} onClick={()=>setTheme('high-contrast')}>High Contrast</button>
        </div>
        <div className="icon-btn-group">
          <div className="text-scale-group" role="group" aria-label="Text size">
            <button className={'icon-btn text-scale-step text-scale-step-dec' + (!canDecrement ? ' disabled' : '')}
              title={decTitle} aria-disabled={!canDecrement} onClick={decScale}>
              <span style={{fontWeight:600,fontSize:13,letterSpacing:'-0.02em'}}>A−</span>
            </button>
            <button className={'icon-btn text-scale-step text-scale-step-inc' + (!canIncrement ? ' disabled' : '')}
              title={incTitle} aria-disabled={!canIncrement} onClick={incScale}>
              <span style={{fontWeight:600,fontSize:13,letterSpacing:'-0.02em'}}>A+</span>
            </button>
          </div>
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
    </>
  );
}

// ======================== Scoring views (D2 #786) ========================
// Six named views for the executive summary -- the headline strict-rule Pass%
// stays in the score card; these views are secondary perspectives consultants
// toggle between. See docs/SCORING.md for the per-view denominator math.
//
// 3 score views (return a number/percentage):
const computeSecurityRiskScore = arr => {
  // Same as the headline: Pass / (Pass + Fail + Warning).
  const denom = scoreDenom(arr);
  if (denom === 0) return null;
  const pass = (arr || []).filter(f => f.status === 'Pass').length;
  return Math.round((pass / denom) * 100);
};
const computeComplianceReadinessScore = arr => {
  // Compliance lens: count Review (manual-validation findings) AS Pass-equivalent
  // since "needs review" usually means "the auditor will accept it with attestation."
  // Excludes Skipped/Unknown/NotApplicable/NotLicensed -- you can't be ready for
  // a control you literally cannot assess.
  const items = (arr || []).filter(f => ['Pass', 'Fail', 'Warning', 'Review'].includes(f.status));
  if (items.length === 0) return null;
  const ready = items.filter(f => f.status === 'Pass' || f.status === 'Review').length;
  return Math.round((ready / items.length) * 100);
};
const computeLicenseAdjustedScore = arr => {
  // Strips out NotLicensed entirely from BOTH numerator and denominator. SMBs
  // without E5 don't get penalised for E5-only controls they cannot enable.
  const items = (arr || []).filter(f => SCORED_STATUSES.has(f.status) && f.status !== 'NotLicensed');
  if (items.length === 0) return null;
  const pass = items.filter(f => f.status === 'Pass').length;
  return Math.round((pass / items.length) * 100);
};
// 3 list views (return an array of findings, sorted/filtered for the workflow):
const getQuickWins = arr => {
  // Fail status × low effort, sorted by severity (critical > high > medium > low > none).
  const sevOrder = { critical: 0, high: 1, medium: 2, low: 3, none: 4, info: 5 };
  return (arr || [])
    .filter(f => f.status === 'Fail' && (f.effort === 'small' || f.effort === 'low'))
    .sort((a, b) => (sevOrder[a.severity] ?? 99) - (sevOrder[b.severity] ?? 99));
};
const getRequiresLicensing = arr => (arr || []).filter(f => f.status === 'NotLicensed');
const getManualValidation  = arr => (arr || []).filter(f => f.status === 'Review');

const SCORING_VIEWS = [
  { id: 'security-risk',     label: 'Security Risk',           kind: 'score', compute: computeSecurityRiskScore,
    blurb: 'Strict rule: Pass / (Pass + Fail + Warning). Matches the headline.' },
  { id: 'compliance',        label: 'Compliance Readiness',    kind: 'score', compute: computeComplianceReadinessScore,
    blurb: 'Counts Review-status findings as ready (auditor will accept with attestation).' },
  { id: 'license-adjusted',  label: 'License-Adjusted',        kind: 'score', compute: computeLicenseAdjustedScore,
    blurb: 'Excludes NotLicensed from both numerator and denominator -- fair to SMBs without E5.' },
  { id: 'quick-wins',        label: 'Quick Wins',              kind: 'list',  collect: getQuickWins,
    blurb: 'Failing controls with small remediation effort, sorted by severity.' },
  { id: 'requires-licensing',label: 'Requires Licensing',      kind: 'list',  collect: getRequiresLicensing,
    blurb: 'Findings blocked by missing license SKUs -- candidates for upgrade discussion.' },
  { id: 'manual-validation', label: 'Manual Validation',       kind: 'list',  collect: getManualValidation,
    blurb: 'Review-status findings that need human verification (audit log review, evidence collection).' },
];

function ScoringViews() {
  const [active, setActive] = useState('security-risk');
  const view = SCORING_VIEWS.find(v => v.id === active) || SCORING_VIEWS[0];
  let body;
  if (view.kind === 'score') {
    const value = view.compute(FINDINGS);
    const tier = value === null ? '' : value >= 80 ? ' tier-good' : value >= 60 ? ' tier-warn' : ' tier-bad';
    body = (
      <div className="scoring-view-body">
        <div className={'scoring-view-num' + tier}>
          {value === null ? '—' : `${value}%`}
        </div>
        <div className="scoring-view-blurb">{view.blurb}</div>
      </div>
    );
  } else {
    const items = view.collect(FINDINGS);
    body = (
      <div className="scoring-view-body">
        <div className="scoring-view-blurb">{view.blurb}</div>
        {items.length === 0 ? (
          <div className="scoring-view-empty">No findings match this view.</div>
        ) : (
          <ul className="scoring-view-list">
            {items.slice(0, 8).map(f => (
              <li key={f.checkId}>
                <span className={'sev-pill sev-' + (f.severity || 'medium')}>{f.severity || 'medium'}</span>
                <a href="#findings-anchor" onClick={e => {
                  e.preventDefault();
                  document.getElementById('findings-anchor')?.scrollIntoView({behavior:'smooth',block:'start'});
                }}>{f.setting}</a>
                <span className="scoring-view-domain">{f.domain}</span>
              </li>
            ))}
            {items.length > 8 && (
              <li className="scoring-view-more">+ {items.length - 8} more — see <a href="#findings-anchor" onClick={e => {
                e.preventDefault();
                document.getElementById('findings-anchor')?.scrollIntoView({behavior:'smooth',block:'start'});
              }}>findings table</a></li>
            )}
          </ul>
        )}
      </div>
    );
  }
  return (
    <section className="block" id="scoring">
      <div className="section-head">
        <span className="eyebrow">01c · Scoring</span>
        <h2>Posture views by audience</h2>
        <div className="hr"/>
      </div>
      <div className="scoring-views">
        <div className="scoring-views-tabs" role="tablist">
          {SCORING_VIEWS.map(v => (
            <button key={v.id} role="tab" aria-selected={v.id === active}
              className={'scoring-views-tab' + (v.id === active ? ' active' : '')}
              onClick={() => setActive(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
        {body}
      </div>
    </section>
  );
}

// ======================== Permissions panel (#812 B2 followup) ========================
// Renders the deficit map written by Test-GraphPermissions / Test-GraphAppRolePermissions.
// Source: window.REPORT_DATA.permissions; null when the assessment ran without
// the deficit-write seam (older runs, SkipConnection mode, etc.).
function PermissionsPanel() {
  const p = D.permissions;
  if (!p || !p.sections) return null;
  // ConvertTo-Json round-trips empty arrays as null and single-element arrays
  // as bare scalars. Coerce defensively so .join() / .length / .map() always work.
  const asArray = v => Array.isArray(v) ? v : (v == null ? [] : [v]);
  const sections = Object.entries(p.sections);
  const allOk = sections.every(([, s]) => s.ok);
  const missingTotal = asArray(p.missing).length;
  const labelStyle = {fontSize:12,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.08em',fontWeight:600,marginBottom:6};
  return (
    <div className="card" id="permissions" style={{marginTop:14}}>
      <div style={labelStyle}>Permissions used by this run</div>
      <div style={{fontSize:12,color:'var(--text-soft)',marginBottom:10}}>
        {p.authMode} auth · {sections.length} section{sections.length===1?'':'s'} checked · {allOk ? 'all granted' : `${missingTotal} role(s) missing`}
      </div>
      <table className="permissions-table">
        <thead>
          <tr><th>Section</th><th>Required</th><th>Missing</th><th>Status</th></tr>
        </thead>
        <tbody>
          {sections.map(([name, s]) => {
            const req = asArray(s.required);
            const miss = asArray(s.missing);
            return (
              <tr key={name}>
                <td><strong>{name}</strong></td>
                <td>{req.length ? req.join(', ') : <span className="muted">none</span>}</td>
                <td>
                  {miss.length
                    ? miss.map((m, i) => <span key={i} className="status-badge unknown">{m}</span>)
                    : <span className="muted">&mdash;</span>}
                </td>
                <td>{s.ok ? <span className="status-badge pass">OK</span> : <span className="status-badge fail">deficit</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
        <HideableBlock hideKey="posture-score-card" label="Microsoft Secure Score card">
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
          {(SCORE.MicrosoftScore != null && SCORE.CustomerScore != null && SCORE.MicrosoftScore > 0) && (
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
        </HideableBlock>

        <div>
          <div className="kpi-strip" style={{marginBottom:10}}>
            <HideableBlock hideKey="kpi-critical" label="Critical findings KPI">
            <div className={'kpi ' + (critical?'bad':'good')}>
              <div className="kpi-label">Critical findings</div>
              <div className="kpi-value">{critical}<span className="kpi-suffix">open</span></div>
              <div className="kpi-hint">Admin, PIM & break-glass exposure</div>
              <div className="tiny-bar"><span style={{width: Math.min(100, critical*15)+'%', background:'var(--danger)'}}/></div>
            </div>
            </HideableBlock>
            <HideableBlock hideKey="kpi-fails" label="Fails KPI">
            <div className="kpi bad">
              <div className="kpi-label">Fails</div>
              <div className="kpi-value">{fail}</div>
              <div className="kpi-hint">of {FINDINGS.length} checks</div>
              <div className="tiny-bar"><span style={{width: pct(fail, scoreDenom(FINDINGS))+'%', background:'var(--danger)'}}/></div>
            </div>
            </HideableBlock>
            <HideableBlock hideKey="kpi-warnings" label="Warnings KPI">
            <div className="kpi warn">
              <div className="kpi-label">Warnings</div>
              <div className="kpi-value">{warn}</div>
              <div className="kpi-hint">Review & harden</div>
              <div className="tiny-bar"><span style={{width: pct(warn, scoreDenom(FINDINGS))+'%', background:'var(--warn)'}}/></div>
            </div>
            </HideableBlock>
            <HideableBlock hideKey="kpi-passing" label="Passing KPI">
            <div className="kpi good">
              <div className="kpi-label">Passing</div>
              <div className="kpi-value">{pass}</div>
              <div className="kpi-hint">Controls validated</div>
              <div className="tiny-bar"><span style={{width: pct(pass, scoreDenom(FINDINGS))+'%', background:'var(--success)'}}/></div>
            </div>
            </HideableBlock>
          </div>
          <MFABreakdown />
        </div>
      </div>
      <ExecSummaryRow/>
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

// ======================== Exec summary row (posture indicators) ========================
function ExecSummaryRow() {
  const allRoles = D['admin-roles'] || [];
  const adminCount = allRoles.length;
  const adminsWithoutMfa = MFA_STATS.adminsWithoutMfa || 0;

  const ds  = D.deviceStats;
  const dns = D.dns || [];
  const dnsTotal = dns.length;
  const dmarcEnf = dns.filter(r => r.DMARCPolicy === 'reject' || r.DMARCPolicy === 'quarantine').length;

  const guests = USERS.GuestUsers || 0;
  const sharingLevel = D.sharepointConfig?.SharingLevel;

  // Severity: a tile is "alert" when the underlying indicator is concerning.
  const tiles = [];

  if (adminCount > 0) {
    tiles.push({
      label: 'Privileged roles',
      primary: adminCount,
      suffix: 'assignments',
      hint: adminsWithoutMfa > 0
        ? `${adminsWithoutMfa} admin${adminsWithoutMfa===1?'':'s'} without MFA`
        : 'All admins MFA-enrolled',
      state: adminsWithoutMfa > 0 ? 'bad' : 'good',
    });
  }

  if (ds && ds.total > 0) {
    const compliantPct = Math.round((ds.compliant / ds.total) * 100);
    tiles.push({
      label: 'Device compliance',
      primary: compliantPct,
      suffix: '%',
      hint: `${fmt(ds.compliant)} of ${fmt(ds.total)} devices compliant`,
      state: compliantPct >= 90 ? 'good' : compliantPct >= 70 ? 'warn' : 'bad',
    });
  }

  if (dnsTotal > 0) {
    const state = dmarcEnf === dnsTotal ? 'good' : dmarcEnf > 0 ? 'warn' : 'bad';
    tiles.push({
      label: 'Email authentication',
      primary: `${dmarcEnf}/${dnsTotal}`,
      suffix: 'enforced',
      hint: `DMARC p=reject or quarantine across ${dnsTotal} domain${dnsTotal===1?'':'s'}`,
      state,
    });
  }

  const guestState = guests > 0 ? 'warn' : 'good';
  const sharingStateMap = { Anyone: 'bad', ExternalUserAndGuestSharing: 'warn', ExternalUserSharingOnly: 'warn', ExistingExternalUserSharingOnly: 'good', Disabled: 'good' };
  const sharingState = sharingLevel ? (sharingStateMap[sharingLevel] || 'warn') : 'good';
  tiles.push({
    label: 'External exposure',
    primary: fmt(guests),
    suffix: guests === 1 ? 'guest' : 'guests',
    hint: sharingLevel ? `SPO sharing · ${sharingLevel}` : 'SPO sharing level unknown',
    state: sharingState === 'bad' || guestState === 'bad' ? 'bad' : (sharingState === 'warn' || guestState === 'warn') ? 'warn' : 'good',
  });

  if (!tiles.length) return null;

  return (
    <div className="exec-summary-row">
      {tiles.map(t => (
        <div key={t.label} className={'exec-tile ' + t.state}>
          <div className="exec-tile-label">{t.label}</div>
          <div className="exec-tile-value">
            {t.primary}<span className="exec-tile-suffix">{t.suffix}</span>
          </div>
          <div className="exec-tile-hint">{t.hint}</div>
        </div>
      ))}
    </div>
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

// ======================== TrendChart (assessment-to-assessment #642) ========================
function TrendChart() {
  const { open, headProps } = useCollapsibleSection();
  const trend = D.trendData;
  // Issue #750: Posture trend is opt-in. Renders only when the assessment was
  // run with -IncludeTrend (which propagates to D.trendOptIn) AND there are
  // enough snapshots for a meaningful chart.
  if (!D.trendOptIn) return null;
  if (!trend || trend.length < 2) return null;

  // One line per status track (Pass / Warn / Fail) — most informative triple for a quick read.
  // Review / Info / Skipped omitted to keep the chart legible; users who want detail can open
  // Compare-M365Baseline for a pairwise drill-down.
  const tracks = [
    { key: 'pass', label: 'Pass',    color: 'var(--success)' },
    { key: 'warn', label: 'Warn',    color: 'var(--warn)'    },
    { key: 'fail', label: 'Fail',    color: 'var(--danger)'  },
  ];

  const W = 880, H = 160, padL = 40, padR = 12, padT = 14, padB = 28;
  const innerW = W - padL - padR, innerH = H - padT - padB;

  const maxVal = Math.max(...trend.flatMap(s => tracks.map(t => s[t.key] || 0)), 10);
  // Round up to nearest "nice" value for y-axis (multiples of 10, 25, 50, 100)
  const niceMax = maxVal <= 20 ? Math.ceil(maxVal / 5) * 5
                : maxVal <= 50 ? Math.ceil(maxVal / 10) * 10
                : maxVal <= 200 ? Math.ceil(maxVal / 25) * 25
                : Math.ceil(maxVal / 50) * 50;

  const sx = i => padL + (i / (trend.length - 1)) * innerW;
  const sy = v => padT + (1 - v / niceMax) * innerH;

  const first = new Date(trend[0].savedAt);
  const last = new Date(trend[trend.length - 1].savedAt);
  const daysSpan = Math.round((last - first) / (1000 * 60 * 60 * 24));

  // Y-axis gridlines (3 intermediate + 0 + max)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => niceMax * t);

  return (
    <section className="block" id="trend">
      <div {...headProps}>
        <span className="eyebrow">01b · Trend</span>
        <h2>Posture trend</h2>
        <span className="trend-subtitle">{trend.length} snapshots · {daysSpan} day{daysSpan===1?'':'s'} span</span>
        <span className="section-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <div className="hr"/>
      </div>
      {open && <div className="trend-chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" className="trend-chart">
          {/* Y-axis gridlines + labels */}
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={sy(v)} y2={sy(v)}
                    stroke="var(--border)" strokeDasharray={i === 0 ? '' : '2 3'} opacity={i === 0 ? 0.9 : 0.4}/>
              <text x={padL - 6} y={sy(v) + 3} textAnchor="end" fontSize="10" fill="var(--muted)"
                    fontFamily="var(--font-mono)">{v}</text>
            </g>
          ))}
          {/* X-axis baseline labels (rotated if many) */}
          {trend.map((s, i) => {
            const tickLabel = s.label || new Date(s.savedAt).toLocaleDateString();
            const rotate = trend.length > 5;
            return (
              <text key={i} x={sx(i)} y={H - padB + 16}
                    textAnchor={rotate ? 'end' : 'middle'}
                    transform={rotate ? `rotate(-30 ${sx(i)} ${H - padB + 16})` : ''}
                    fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono)">
                {tickLabel.length > 14 ? tickLabel.slice(0, 13) + '…' : tickLabel}
              </text>
            );
          })}
          {/* Data lines */}
          {tracks.map(t => {
            const pts = trend.map((s, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(s[t.key] || 0).toFixed(1)}`).join(' ');
            return <path key={t.key} d={pts} fill="none" stroke={t.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>;
          })}
          {/* Data points w/ hover tooltip */}
          {trend.map((s, i) => tracks.map(t => (
            <circle key={`${i}-${t.key}`} cx={sx(i)} cy={sy(s[t.key] || 0)} r="3.2"
                    fill="var(--surface)" stroke={t.color} strokeWidth="1.8">
              <title>{`${s.label || new Date(s.savedAt).toLocaleDateString()} · ${t.label}: ${s[t.key] || 0} of ${s.total}`}</title>
            </circle>
          )))}
        </svg>
        <div className="trend-legend">
          {tracks.map(t => (
            <span key={t.key} className="trend-legend-item">
              <span className="trend-legend-swatch" style={{background: t.color}}/>
              <span>{t.label}</span>
            </span>
          ))}
        </div>
      </div>}
    </section>
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

// ======================== DNS auth panel (replaces flat Appendix table) ========================
function DnsAuthPanel() {
  const dns = D.dns || [];
  if (!dns.length) return null;
  const spfPass    = dns.filter(r => r.SPF && !r.SPF.includes('Not')).length;
  const dkimPass   = dns.filter(r => r.DKIMStatus === 'OK').length;
  const dmarcEnf   = dns.filter(r => r.DMARCPolicy === 'reject' || r.DMARCPolicy === 'quarantine').length;
  const dmarcNone  = dns.filter(r => r.DMARCPolicy && r.DMARCPolicy.includes('none')).length;
  const dmarcMiss  = dns.filter(r => !r.DMARC || r.DMARC.includes('Not') || !r.DMARCPolicy).length;
  const n = dns.length;
  const statCards = [
    { label: 'SPF',           pass: spfPass,  total: n },
    { label: 'DKIM',          pass: dkimPass, total: n },
    { label: 'DMARC enforced',pass: dmarcEnf, total: n },
  ];
  const policyClass = p => p === 'reject' || p === 'quarantine' ? 'pass' : p && p.includes('none') ? 'warn' : 'fail';
  const risks = [
    n - spfPass   > 0 && { cls:'fail', msg:`${n-spfPass} domain${n-spfPass!==1?'s':''} missing SPF`         },
    dmarcNone     > 0 && { cls:'warn', msg:`${dmarcNone} domain${dmarcNone!==1?'s':''} with DMARC p=none`    },
    dmarcMiss     > 0 && { cls:'fail', msg:`${dmarcMiss} domain${dmarcMiss!==1?'s':''} missing DMARC`        },
    n - dkimPass  > 0 && { cls:'warn', msg:`${n-dkimPass} domain${n-dkimPass!==1?'s':''} missing DKIM`      },
  ].filter(Boolean);
  return (
    <div className="card dns-auth-panel" style={{gridColumn:'1 / -1', marginTop:14}}>
      <div className="dns-panel-label">Email authentication posture</div>
      <div className="dns-stat-row">
        {statCards.map(s => (
          <div key={s.label} className="dns-stat-card">
            <div className="dns-stat-label">{s.label}</div>
            <div className="dns-stat-val">{s.pass}<span>/{s.total}</span></div>
            <div className="dns-stat-bar dns-stat-bar-segments">
              {Array.from({length: s.total}).map((_, i) => (
                <span key={i} className={i < s.pass ? 'seg seg-pass' : 'seg seg-fail'}/>
              ))}
            </div>
          </div>
        ))}
        <div className="dns-stat-card">
          <div className="dns-stat-label">DMARC policy mix</div>
          <div className="dns-policy-chips">
            {dmarcEnf > 0  && <span className="dns-policy-chip pass">{dmarcEnf} enforced</span>}
            {dmarcNone > 0 && <span className="dns-policy-chip warn">{dmarcNone} monitor</span>}
            {dmarcMiss > 0 && <span className="dns-policy-chip fail">{dmarcMiss} missing</span>}
          </div>
        </div>
      </div>
      <table className="dns-domain-table">
        <thead>
          <tr>
            <th>Domain</th>
            <th style={{textAlign:'center'}}>SPF</th>
            <th style={{textAlign:'center'}}>DMARC</th>
            <th style={{textAlign:'center'}}>Policy</th>
            <th style={{textAlign:'center'}}>DKIM</th>
          </tr>
        </thead>
        <tbody>
          {dns.map((r, i) => (
            <tr key={i}>
              <td className="dns-domain-name">{r.Domain}</td>
              <td style={{textAlign:'center'}}><StatusDot ok={r.SPF && !r.SPF.includes('Not')}/></td>
              <td style={{textAlign:'center'}}><StatusDot ok={r.DMARC && !r.DMARC.includes('Not')}/></td>
              <td style={{textAlign:'center'}}>
                <span className={'dns-policy-chip ' + policyClass(r.DMARCPolicy)}>{r.DMARCPolicy || 'missing'}</span>
              </td>
              <td style={{textAlign:'center'}}><StatusDot ok={r.DKIMStatus === 'OK'}/></td>
            </tr>
          ))}
        </tbody>
      </table>
      {risks.length > 0 && (
        <div className="dns-risks">
          {risks.map((r, i) => <span key={i} className={'dns-risk-chip ' + r.cls}>⚠ {r.msg}</span>)}
        </div>
      )}
    </div>
  );
}

// ======================== Intune category grid ========================
function IntuneCategoryGrid() {
  const intune = FINDINGS.filter(f => f.domain === 'Intune');
  if (!intune.length) return null;
  const CATS = [
    { id: 'COMPLIANCE',  label: 'Device Compliance',  re: /^INTUNE-COMPLIANCE/ },
    { id: 'DEVICE',      label: 'Device Config',       re: /^INTUNE-DEVICE/     },
    { id: 'CONFIG',      label: 'Config Profiles',     re: /^INTUNE-CONFIG/     },
    { id: 'APP',         label: 'App Protection',      re: /^INTUNE-APP/        },
    { id: 'SECURITY',    label: 'Security Baselines',  re: /^INTUNE-SECURITY/   },
    { id: 'VPN',         label: 'VPN / Network',       re: /^INTUNE-(VPN|WIFI|REMOTE)/ },
    { id: 'MEDIA',       label: 'Removable Media',     re: /^INTUNE-REMOVABLEMEDIA/ },
    { id: 'ENROLLMENT',  label: 'Enrollment',          re: /^INTUNE-(ENROLLMENT|ENROLL|INVENTORY|AUTODISC)/ },
    { id: 'ENCRYPTION',  label: 'Encryption',          re: /^INTUNE-(ENCRYPTION|MOBILEENCRYPT|FIPS)/ },
    { id: 'ADMINOPS',    label: 'Admin & Updates',     re: /^INTUNE-(RBAC|MAA|WIPEAUDIT|UPDATE|MOBILECODE|PORTSTORAGE)/ },
  ];
  const buckets = CATS.map(cat => {
    const fs = intune.filter(f => cat.re.test(f.checkId));
    if (!fs.length) return null;
    const pass = fs.filter(f => f.status==='Pass').length;
    const fail = fs.filter(f => f.status==='Fail').length;
    const warn = fs.filter(f => f.status==='Warning').length;
    return { ...cat, fs, pass, fail, warn, score: pct(pass, scoreDenom(fs)) };
  }).filter(Boolean);
  const seen = new Set(buckets.flatMap(b => b.fs.map(f => f.checkId)));
  const other = intune.filter(f => !seen.has(f.checkId));
  if (other.length) {
    const pass = other.filter(f => f.status==='Pass').length;
    buckets.push({ id:'OTHER', label:'Other', fs:other, pass, fail:other.filter(f=>f.status==='Fail').length, warn:other.filter(f=>f.status==='Warning').length, score:pct(pass, scoreDenom(other)) });
  }
  return (
    <div className="intune-cat-section">
      <div className="panel-sublabel">Intune coverage by category</div>
      <div className="intune-category-grid">
        {buckets.map(b => (
          <div key={b.id} className={'intune-cat-card' + (b.fail>0?' has-fail':b.warn>0?' has-warn':' all-pass')}>
            <div className="icat-label">{b.label}</div>
            <div className="icat-score">{b.score}<span className="icat-pct">%</span></div>
            <div className="icat-meta">{b.pass}P · {b.fail}F · {b.fs.length}</div>
            <div className="dc-bar" style={{height:4, marginTop:6}}>
              {b.pass>0 && <i className="pass-seg" style={{flex:b.pass}}/>}
              {b.warn>0 && <i className="warn-seg" style={{flex:b.warn}}/>}
              {b.fail>0 && <i className="fail-seg" style={{flex:b.fail}}/>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ======================== Mailbox summary panel ========================
function MailboxSummaryPanel() {
  const mb = D.mailboxSummary || {};
  const mf = D.mailflowStats  || {};
  if (!mb.TotalMailboxes) return null;
  const total = mb.TotalMailboxes || 0;
  return (
    <div className="domain-sub-panel">
      <div className="panel-sublabel">Exchange Online · mailbox estate</div>
      <div className="kpi-strip" style={{flexWrap:'wrap'}}>
        <div className="kpi">
          <div className="kpi-label">Total mailboxes</div>
          <div className="kpi-value">{fmt(total)}</div>
          <div className="kpi-hint">{fmt(mb.UserMailboxes||0)} user · {fmt(mb.SharedMailboxes||0)} shared</div>
          <div className="tiny-bar"><span style={{width:'100%', background:'var(--accent-muted,var(--accent))'}}/></div>
        </div>
        {mb.SharedMailboxes > 0 && (
          <div className="kpi">
            <div className="kpi-label">Shared mailboxes</div>
            <div className="kpi-value">{fmt(mb.SharedMailboxes)}</div>
            <div className="kpi-hint">{pct(mb.SharedMailboxes, total)}% of estate</div>
            <div className="tiny-bar"><span style={{width: pct(mb.SharedMailboxes, total)+'%'}}/></div>
          </div>
        )}
        {mf.transportRules != null && (
          <div className={'kpi' + (mf.transportRules > 10 ? ' warn' : '')}>
            <div className="kpi-label">Transport rules</div>
            <div className="kpi-value">{fmt(mf.transportRules)}</div>
            <div className="kpi-hint">active rules</div>
            <div className="tiny-bar"><span style={{width: Math.min(100, mf.transportRules*8)+'%', background: mf.transportRules>10?'var(--warn)':'var(--success)'}}/></div>
          </div>
        )}
        {mf.inboundConnectors != null && (
          <div className="kpi">
            <div className="kpi-label">Mail connectors</div>
            <div className="kpi-value">{fmt((mf.inboundConnectors||0)+(mf.outboundConnectors||0))}</div>
            <div className="kpi-hint">{mf.inboundConnectors||0} in · {mf.outboundConnectors||0} out</div>
            <div className="tiny-bar"><span style={{width: Math.min(100, ((mf.inboundConnectors||0)+(mf.outboundConnectors||0))*20)+'%'}}/></div>
          </div>
        )}
      </div>
    </div>
  );
}

// ======================== SharePoint summary panel ========================
function SharePointSummaryPanel() {
  const spo = FINDINGS.filter(f => f.domain === 'SharePoint & OneDrive');
  if (!spo.length) return null;
  const pass = spo.filter(f => f.status==='Pass').length;
  const fail = spo.filter(f => f.status==='Fail').length;
  const warn = spo.filter(f => f.status==='Warning').length;
  const cfg  = D.sharepointConfig || {};
  const sharingLevel = cfg.SharingLevel;
  const sharingColor = sharingLevel === 'Disabled' ? 'var(--success-text)' :
    sharingLevel?.includes('ExternalUserAndGuestSharing') || sharingLevel === 'Anyone' ? 'var(--danger-text)' :
    sharingLevel ? 'var(--warn-text,var(--warn))' : 'var(--muted)';
  const SEV_ORDER = { critical:4, high:3, medium:2, low:1 };
  const topFails = spo.filter(f=>f.status==='Fail').sort((a,b)=>(SEV_ORDER[b.severity]||0)-(SEV_ORDER[a.severity]||0)).slice(0,3);
  return (
    <div className="domain-sub-panel">
      <div className="panel-sublabel">SharePoint &amp; OneDrive posture</div>
      <div className="spo-summary-row">
        <div className="spo-stat-card">
          <div className="kpi-label">Pass rate</div>
          <div className="kpi-value">{pct(pass, scoreDenom(spo))}<span style={{fontSize:14}}>%</span></div>
          <div className="kpi-hint">{pass} of {spo.length} checks</div>
          <div className="tiny-bar"><span style={{width: pct(pass, scoreDenom(spo))+'%', background:'var(--success)'}}/></div>
        </div>
        <div className={'spo-stat-card' + (fail>0?' spo-stat-bad':'')}>
          <div className="kpi-label">Failures</div>
          <div className="kpi-value">{fail}</div>
          <div className="kpi-hint">{warn} warnings</div>
          <div className="tiny-bar"><span style={{width: pct(fail, scoreDenom(spo))+'%', background:'var(--danger)'}}/></div>
        </div>
        {sharingLevel && (
          <div className="spo-stat-card">
            <div className="kpi-label">External sharing</div>
            <div style={{fontSize:12, fontWeight:600, color: sharingColor, marginTop:6, lineHeight:1.3}}>{sharingLevel}</div>
          </div>
        )}
        {cfg.OneDriveSharingLevel && (
          <div className="spo-stat-card">
            <div className="kpi-label">OneDrive sharing</div>
            <div style={{fontSize:12, fontWeight:600, color:'var(--text-soft)', marginTop:6, lineHeight:1.3}}>{cfg.OneDriveSharingLevel}</div>
          </div>
        )}
      </div>
      {topFails.length > 0 && (
        <div className="spo-top-fails">
          <div className="spo-top-fails-label">Top gaps</div>
          {topFails.map((f, i) => (
            <div key={i} className="spo-fail-row">
              <span className={'sev-badge ' + f.severity}><span className="bar"><i/><i/><i/><i/></span><span>{SEV_LABEL[f.severity]}</span></span>
              <span className="spo-fail-name">{f.setting}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ======================== AD / Hybrid panel ========================
function AdHybridPanel() {
  const ad = D.adHybrid;
  if (!ad) return null;
  const adFindings = FINDINGS.filter(f => f.domain === 'Active Directory');
  const pass = adFindings.filter(f => f.status==='Pass').length;
  const fail = adFindings.filter(f => f.status==='Fail').length;
  const syncOk      = ad.syncEnabled;
  const phsOk       = ad.pwHashSync;
  const phsUnknown  = phsOk === null || phsOk === undefined;
  const syncColor   = syncOk    ? 'var(--success-text)' : 'var(--danger-text)';
  const phsColor    = phsUnknown ? 'var(--warn-text)'   : phsOk ? 'var(--success-text)' : 'var(--danger-text)';
  const fmtDate   = d => {
    if (!d) return 'Unknown';
    try { return new Date(d).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' }); }
    catch { return d; }
  };
  const SEV_ORDER = { critical:4, high:3, medium:2, low:1 };
  const topFails = adFindings.filter(f=>f.status==='Fail')
    .sort((a,b)=>(SEV_ORDER[b.severity]||0)-(SEV_ORDER[a.severity]||0)).slice(0,3);
  return (
    <div className="domain-sub-panel">
      <div className="panel-sublabel">
        Active Directory · hybrid posture
        {ad.entraOnly && <span className="kpi-hint" style={{marginLeft:8, fontWeight:400}}>(Entra data — AD collectors not run)</span>}
      </div>
      <div className="spo-summary-row">
        <div className="spo-stat-card">
          <div className="kpi-label">Directory sync</div>
          <div style={{fontSize:13, fontWeight:700, color: syncColor, marginTop:6}}>{syncOk ? 'Enabled' : 'Disabled'}</div>
          {ad.syncType && <div className="kpi-hint">{ad.syncType}</div>}
        </div>
        <div className="spo-stat-card">
          <div className="kpi-label">Last sync</div>
          <div style={{fontSize:12, fontWeight:600, color:'var(--text-soft)', marginTop:6, lineHeight:1.3}}>{fmtDate(ad.lastSyncTime)}</div>
        </div>
        <div className={'spo-stat-card' + (phsOk === false ? ' spo-stat-bad' : '')}>
          <div className="kpi-label">Password hash sync</div>
          <div style={{fontSize:13, fontWeight:700, color: phsColor, marginTop:6}}>{phsOk ? 'Enabled' : phsUnknown ? 'Verify' : 'Disabled'}</div>
          {phsOk === false && <div className="kpi-hint" style={{color:'var(--danger-text)'}}>Leaked credential detection and fallback auth may be impacted</div>}
          {phsUnknown && <div className="kpi-hint" style={{color:'var(--warn-text)'}}>No PHS timestamp - verify in Microsoft Entra Connect or Entra Cloud Sync</div>}
        </div>
        {ad.syncErrorCount > 0 && (
          <div className="spo-stat-card spo-stat-bad">
            <div className="kpi-label">Sync errors</div>
            <div className="kpi-value">{ad.syncErrorCount}</div>
            <div className="kpi-hint">provisioning errors</div>
          </div>
        )}
        {!ad.entraOnly && adFindings.length > 0 && (
          <div className={'spo-stat-card' + (fail>0?' spo-stat-bad':'')}>
            <div className="kpi-label">AD checks</div>
            <div className="kpi-value">{pct(pass, scoreDenom(adFindings))}<span style={{fontSize:14}}>%</span></div>
            <div className="kpi-hint">{pass} pass · {fail} fail</div>
            <div className="tiny-bar"><span style={{width: pct(pass, scoreDenom(adFindings))+'%', background:'var(--success)'}}/></div>
          </div>
        )}
        {!ad.entraOnly && ad.highRiskFindings > 0 && (
          <div className="spo-stat-card spo-stat-bad">
            <div className="kpi-label">High/Critical risks</div>
            <div className="kpi-value">{ad.highRiskFindings}</div>
            <div className="kpi-hint">security findings</div>
          </div>
        )}
      </div>
      {topFails.length > 0 && (
        <div className="spo-top-fails">
          <div className="spo-top-fails-label">Top gaps</div>
          {topFails.map((f, i) => (
            <div key={i} className="spo-fail-row">
              <span className={'sev-badge ' + f.severity}><span className="bar"><i/><i/><i/><i/></span><span>{SEV_LABEL[f.severity]}</span></span>
              <span className="spo-fail-name">{f.setting}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
                      const skipped = Math.max(0, d.total - d.pass - d.warn - d.fail - d.review - d.info);
                      return skipped > 0 ? <i className="skipped-seg" style={{flex: skipped}}/> : null;
                    })()}
                  </div>
                  <div className="dc-meta">
                    <span className="dc-pass"><b>{d.pass}</b> pass</span>
                    <span className="dc-warn"><b>{d.warn}</b> warn</span>
                    <span className="dc-fail"><b>{d.fail}</b> fail</span>
                    {d.review>0 && <span className="dc-review"><b>{d.review}</b> review</span>}
                    {(() => {
                      const skipped = Math.max(0, d.total - d.pass - d.warn - d.fail - d.review - d.info);
                      return skipped > 0 ? <span className="dc-skipped" title="Skipped — prerequisite unmet or not assessable"><b>{skipped}</b> skipped</span> : null;
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
  const counts = { pass:0, warn:0, fail:0, review:0, info:0, total:0 };
  const familiesMap = {};
  const profileSets = { L1: new Set(), L2: new Set(), L3: new Set(), E3: new Set(), E5only: new Set(), Low: new Set(), Mod: new Set(), High: new Set() };
  const extract = meta.groupBy ? GROUP_EXTRACTORS[meta.groupBy] : null;
  const groupNames = meta.groups || {};
  FINDINGS.forEach((f, idx) => {
    if (!f.frameworks.includes(fwId)) return;
    const profs = [].concat(f.fwMeta?.[fwId]?.profiles || []);
    if (tokens.length > 0 && !tokens.some(t => matchProfileToken(profs, t))) return;
    counts.total++;
    const k = STATUS_COLORS[f.status];
    if (k) counts[k]++;
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
        if (!familiesMap[code]) familiesMap[code] = { code, name: groupNames[code] || (code === 'OTHER' ? 'Other' : code), pass:0, warn:0, fail:0, review:0, info:0, total:0 };
        familiesMap[code].total++;
        if (k) familiesMap[code][k]++;
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

function fwCoveragePct(c) { return c && c.total ? Math.round(((c.pass + c.info * 0.5) / c.total) * 100) : 0; }
function fwReadinessLabel(pct) {
  if (pct >= 90) return { label: 'Audit-ready', tone: 'pass' };
  if (pct >= 75) return { label: 'On track', tone: 'pass' };
  if (pct >= 55) return { label: 'At risk', tone: 'warn' };
  return { label: 'Failing', tone: 'fail' };
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
              stroke={s.color} strokeWidth={stroke} strokeLinecap="butt"
              strokeDasharray={`${Math.max(0, dash - gap)} ${c}`}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${cx} ${cy})`}
              style={{transition:'stroke-dasharray .7s cubic-bezier(.22,1,.36,1), stroke-dashoffset .7s cubic-bezier(.22,1,.36,1)'}}/>
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
                  <div style={{fontSize:11, color:'var(--muted)', fontFamily:'var(--font-mono)'}}>{f.id} · {data?.counts.total || 0} controls</div>
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
            (fw.counts.info > 0 ? ` · ${fw.counts.info} info` : '');
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
              <div className="fw-cmp-pct-sub">{fw.counts.pass}/{fw.counts.total}</div>
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
  const [visibleIds, setVisibleIds] = useState(['cis-m365-v6']);
  const [focusedId, setFocusedId] = useState('cis-m365-v6');
  const [family, setFamily] = useState(null);

  useEffect(() => { setFamily(null); }, [focusedId]);

  useEffect(() => {
    if (visibleIds.length > 0 && !visibleIds.includes(focusedId)) setFocusedId(visibleIds[0]);
  }, [visibleIds]);

  useEffect(() => {
    const expand = () => { if (visibleIds.length === 0) setVisibleIds([FRAMEWORKS[0]?.id || 'cis-m365-v6']); };
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
                    <span style={{fontSize:12, color:'var(--muted)', fontFamily:'var(--font-mono)'}}>{focused.counts.pass}/{focused.counts.total} controls passing</span>
                  </div>
                  <div className="fw-bar fw-tb-score-bar">
                    {focused.counts.pass>0   && <div className="fw-seg pass"   style={{flex:focused.counts.pass}}/>}
                    {focused.counts.warn>0   && <div className="fw-seg warn"   style={{flex:focused.counts.warn}}/>}
                    {focused.counts.fail>0   && <div className="fw-seg fail"   style={{flex:focused.counts.fail}}/>}
                    {focused.counts.review>0 && <div className="fw-seg review" style={{flex:focused.counts.review}}/>}
                    {focused.counts.info>0   && <div className="fw-seg info"   style={{flex:focused.counts.info}}/>}
                  </div>
                  <div className="fw-tb-score-legend" style={{marginTop:10}}>
                    <span><i className="leg-dot pass"/>{focused.counts.pass} pass</span>
                    <span><i className="leg-dot warn"/>{focused.counts.warn} warn</span>
                    <span><i className="leg-dot fail"/>{focused.counts.fail} fail</span>
                    {focused.counts.review > 0 && <span><i className="leg-dot review"/>{focused.counts.review} review</span>}
                    {focused.counts.info > 0 && <span><i className="leg-dot info"/>{focused.counts.info} info</span>}
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
                      <span style={{fontSize:12, color:'var(--muted)', fontFamily:'var(--font-mono)'}}>{focused.counts.pass}/{focused.counts.total}</span>
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
  const active = filters.status.length + filters.severity.length + filters.framework.length + filters.domain.length + (filters.profile||[]).length;
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
              <button key={v} className={'chip '+cls+(filters.status.includes(v)?' selected':'')} onClick={()=>update('status',v)}>
                <span className="dot"/>{label || v}<span className="ct">{counts.status[v]||0}</span>
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
            onClick={()=>setFilters({status:[],severity:[],framework:[],domain:[],profile:[]})}>
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

// Issue #846: enum orderings for sort. Status uses the "worst first" order
// that matches the row-color severity ramp; severity uses the standard
// critical-down ordering.
const FT_STATUS_ORDER = ['Fail','Warning','Review','Pass','Info','Skipped','Unknown','NotApplicable','NotLicensed'];
const FT_SEV_ORDER = ['critical','high','medium','low','info'];
const FT_SORTABLE = new Set(['status','finding','domain','checkId','severity']);

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
  useEffect(() => {
    try { localStorage.setItem(LS('m365-findings-sort'), JSON.stringify(sort)); } catch {}
  }, [sort]);
  useEffect(() => {
    try { localStorage.setItem(LS('m365-col-widths'), JSON.stringify(colWidths)); } catch {}
  }, [colWidths]);

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

  const cols = ALL_COLS.filter(c => visibleCols.includes(c.id));
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
      if (sort.key === 'status') { av = FT_STATUS_ORDER.indexOf(a.status); bv = FT_STATUS_ORDER.indexOf(b.status); }
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
          <span className={'status-badge ' + STATUS_COLORS[f.status]}>
            <span className="dot"/>{statusLabel(f.status)}
          </span>
          {f.intentDesign && <span className="badge-intent">By Design</span>}
        </div>
      );
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
          <div key="controlId" style={{display:'flex', flexDirection:'column', gap:2}}>
            <span className="check-id" style={cid ? undefined : {color:'var(--muted)', fontStyle:'italic'}}>{cid || '—'}</span>
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
        <div className="findings-head" style={{gridTemplateColumns: gridTpl}}>
          {cols.map(c => {
            const sortable = FT_SORTABLE.has(c.id);
            const isActive = sort?.key === c.id;
            return (
              <div key={c.id} className="findings-col-head">
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
                <div className="finding-detail">
                  {f.intentDesign && (
                    <div className="intent-callout">
                      <strong>Intentional by design.</strong>
                      {f.intentRationale && <span> {f.intentRationale}</span>}
                    </div>
                  )}
                  <div className="why">
                    <div className="why-label">Why it matters</div>
                    <div className="why-text">{whyItMatters(f)}</div>
                  </div>
                  <div>
                    <div className="block-title">Current value</div>
                    <div className={'value-box current finding-current-' + statusTier(f.status)}>{f.current || '—'}</div>
                  </div>
                  <div>
                    <div className="block-title">Recommended value</div>
                    <div className="value-box recommended">{f.recommended || '—'}</div>
                  </div>
                  {f.remediation && (
                    <div className="finding-remediation">
                      <div className="block-title">Remediation</div>
                      <div className="remediation-text">{f.remediation}</div>
                    </div>
                  )}
                  {f.references && f.references.length > 0 && (
                    <div className="finding-learn-more">
                      <div className="block-title">Learn more</div>
                      {f.references.map((r, i) => (
                        <a key={i} href={r.url} target="_blank" rel="noreferrer noopener">📖 {r.title} ↗</a>
                      ))}
                    </div>
                  )}
                  {f.evidence && <EvidenceBlock evidence={f.evidence} />}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>}
    </section>
  );
}

// D1 #785 -- structured evidence schema renderer.
// Accepts either the new object shape ({ observedValue, expectedValue, ..., raw }) or
// the legacy JSON-string shape (pre-v2.9 reports). Renders a structured table for
// typed fields and a collapsible <pre> for the legacy raw blob when present.
function EvidenceBlock({ evidence }) {
  if (!evidence) return null;
  // Defensive: legacy reports stored evidence as a JSON string. Try to parse.
  let ev = evidence;
  if (typeof ev === 'string') {
    try { ev = { raw: ev }; } catch { return null; }
  }
  const fields = [
    ['observedValue',      'Observed value'],
    ['expectedValue',      'Expected value'],
    ['evidenceSource',     'Source'],
    ['evidenceTimestamp',  'Collected at (UTC)'],
    ['collectionMethod',   'Collection method'],
    ['permissionRequired', 'Permission used'],
    ['confidence',         'Confidence'],
    ['limitations',        'Limitations'],
  ];
  const rows = fields.filter(([k]) => ev[k] !== undefined && ev[k] !== null && ev[k] !== '');
  let rawPretty = null;
  if (ev.raw) {
    try { rawPretty = JSON.stringify(JSON.parse(ev.raw), null, 2); }
    catch { rawPretty = String(ev.raw); }
  }
  if (rows.length === 0 && !rawPretty) return null;
  return (
    <details className="finding-evidence">
      <summary>Evidence</summary>
      {rows.length > 0 && (
        <table className="evidence-table">
          <tbody>
            {rows.map(([k, label]) => (
              <tr key={k}>
                <th>{label}</th>
                <td>{k === 'confidence' ? `${Math.round(ev[k] * 100)}%` : String(ev[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rawPretty && (
        <details className="finding-evidence-raw">
          <summary>Raw evidence</summary>
          <pre>{rawPretty}</pre>
        </details>
      )}
    </details>
  );
}

function renderRemediation(text) {
  if (!text) return <span style={{color:'var(--muted)'}}>No remediation guidance provided.</span>;
  // Split into ordered blocks: portal-text segments and Run: PowerShell commands.
  // Each block renders on its own line so a consultant can scan by action type.
  const parts = text.split(/(Run:[^.]*\.)/);
  const blocks = [];
  let portalBuf = '';
  parts.forEach(p => {
    if (!p) return;
    if (p.startsWith('Run:')) {
      const trimmed = portalBuf.trim();
      if (trimmed) blocks.push({ type: 'portal', text: trimmed });
      portalBuf = '';
      const cmd = p.replace(/^Run:\s*/, '').replace(/\.$/, '');
      blocks.push({ type: 'ps', cmd });
    } else {
      portalBuf += p;
    }
  });
  const tail = portalBuf.trim();
  if (tail) blocks.push({ type: 'portal', text: tail });
  if (blocks.length === 0) return <span style={{color:'var(--muted)'}}>No remediation guidance provided.</span>;
  return (
    <div className="remediation-blocks">
      {blocks.map((b, i) => b.type === 'ps'
        ? <div key={i} className="remediation-block remediation-ps">
            <span className="remediation-label">PowerShell</span>
            <pre><code>{b.cmd}</code></pre>
          </div>
        : <div key={i} className="remediation-block remediation-portal">
            <span className="remediation-label">Portal</span>
            <p>{b.text}</p>
          </div>
      )}
    </div>
  );
}

// Issue #674 (partial cherry-pick from PR #853): map a finding's status to a
// CSS-class tier so the Current value card's left-border color reflects
// pass/fail/warn/etc. — was always red, which incorrectly visually flagged
// passing values as failing.
function statusTier(status) {
  if (status === 'Pass') return 'pass';
  if (status === 'Fail') return 'fail';
  if (status === 'Warning') return 'warn';
  if (status === 'Review') return 'review';
  if (status === 'Info') return 'info';
  return 'neutral';
}

// Issue #854: per-prefix narrative content for the finding-detail "Why It Matters"
// callout. Order matters — more-specific prefixes MUST come before generic
// catch-alls (e.g., EXO-FORWARD before EXO-). Sources cited in commit message
// + docs/research/narrative-content-sources.md.
function whyItMatters(f) {
  const id = f.checkId;

  // ---- Identity (Entra) ----
  if (id.startsWith('ENTRA-MFA') || id.startsWith('ENTRA-AUTHMETHOD')) return 'Weak authentication methods (SMS, voice, email OTP) are phishable and subject to SIM-swap attacks. Phishing-resistant methods (FIDO2, Windows Hello, certificate) are the modern baseline.';
  if (id.startsWith('ENTRA-PERUSER')) return 'Per-user MFA is the legacy enforcement model superseded by Conditional Access. Mixed-mode tenants leave gaps where some users are CA-protected and others rely on the legacy switch.';
  if (id.startsWith('ENTRA-SECDEFAULT')) return 'Security Defaults provide a one-toggle baseline (MFA, blocked legacy auth, admin protection) for tenants without Entra ID P1+. Enabling them OR full Conditional Access is required — never both, and never neither.';
  if (id.startsWith('ENTRA-SSPR')) return 'Self-Service Password Reset reduces helpdesk load and account-lockout risk, but only when registration is enforced and reset methods exclude SMS for privileged users.';
  if (id.startsWith('ENTRA-ADMIN') || id.startsWith('ENTRA-CLOUDADMIN') || id.startsWith('ENTRA-SYNCADMIN') || id.startsWith('ENTRA-ADMINROLE') || id.startsWith('ENTRA-ROLEGROUP')) return 'Global Admin accounts are the crown jewels. Synced on-prem accounts, excess admin count, and admins without phishing-resistant MFA multiply blast radius if any one tier is compromised.';
  if (id.startsWith('ENTRA-PIM')) return 'Without PIM (Entra ID P2), privileged roles are permanently assigned. Just-in-time elevation with approval and access reviews is the industry baseline for zero-trust identity.';
  if (id.startsWith('ENTRA-STALEADMIN') || id.startsWith('ENTRA-DISABLED')) return 'Stale admins and disabled accounts that never sign in still hold privileges or licenses. Any compromise of their credentials yields access with low telemetry.';
  if (id.startsWith('ENTRA-BREAKGLASS')) return 'Break-glass accounts are the last-resort recovery mechanism. They must be cloud-only, CA-excluded, phishing-resistant, and quarterly-tested.';
  if (id.startsWith('ENTRA-PASSWORD')) return 'Password expiration with MFA causes fatigue and weaker passwords. NIST 800-63B recommends no forced rotation when phishing-resistant MFA is present.';
  if (id.startsWith('ENTRA-CONSENT') || id.startsWith('ENTRA-APPREG')) return 'User-consent and app-registration permissions are the primary vector for OAuth-app phishing and illicit consent grants. Lock both down and route approvals to admins.';
  if (id.startsWith('ENTRA-ENTAPP')) return 'Enterprise app governance (assignment required, user consent restrictions, certificate rotation) prevents unsanctioned apps from accumulating tenant-wide permissions and surviving employee turnover.';
  if (id.startsWith('ENTRA-APPS-002') || id.startsWith('APPS-002')) return 'Apps with Directory.ReadWrite.All or DeviceManagement write permissions can modify users, groups, and devices tenant-wide. Grant only read-only equivalents and monitor.';
  if (id.startsWith('ENTRA-GUEST') || id.startsWith('ENTRA-LINKEDIN')) return 'Guest access defaults are permissive — guests can read directory data, invite other guests, and persist after collaboration ends. Restrict invitation rights and review guest access regularly.';
  if (id.startsWith('ENTRA-DEVICE') || id.startsWith('ENTRA-HYBRID')) return 'Entra join and device settings define who can enroll devices and who gets local admin rights. Overly permissive defaults bypass Intune-enforced posture.';
  if (id.startsWith('ENTRA-GROUP')) return 'Group creation, classification, and ownership govern who can create distribution lists and Microsoft 365 Groups. Unrestricted creation accumulates orphaned groups that grant access nobody is reviewing.';
  if (id.startsWith('ENTRA-ORGSETTING') || id.startsWith('ENTRA-TENANT')) return 'Organisation-wide settings (account-restrictions allow-list, name change permissions, external collaboration) are the cross-cutting policies that override per-user/per-app config. Defaults often skew permissive.';
  if (id.startsWith('ENTRA-SESSION') || id.startsWith('ENTRA-SESSIONAUTH')) return 'Session and sign-in controls (token lifetime, sign-in frequency, persistent browser) determine how often a user re-authenticates. Long-lived sessions amplify the impact of a single phished token.';
  if (id.startsWith('ENTRA-SOD')) return 'Separation-of-duties controls prevent a single account from holding incompatible roles (e.g., Global Admin + Security Admin + Compliance Admin). Detection requires explicit role-pair reviews.';

  // ---- Conditional Access ----
  if (id.startsWith('CA-EXCLUSION')) return 'Admins excluded from Conditional Access bypass MFA and device-compliance enforcement. Only break-glass accounts should be excluded.';
  if (id.startsWith('CA-LEGACYAUTH')) return 'Legacy authentication (POP, IMAP, SMTP AUTH, basic auth) bypasses MFA entirely. A single tenant-wide policy blocking legacy protocols is the highest-leverage Conditional Access control.';
  if (id.startsWith('CA-PHISHRES')) return 'Conditional Access policies that require phishing-resistant MFA for admins are the modern equivalent of "no SMS for privileged accounts." FIDO2 / Windows Hello / certificate-based, scoped to admin roles.';
  if (id.startsWith('CA-DEVICE') || id.startsWith('CA-INTUNE') || id.startsWith('CA-REMOTEDEVICE')) return 'Device-compliance Conditional Access closes the unmanaged-endpoint gap. Without it, a personal laptop with a phished password reaches the same data as a managed corporate device.';
  if (id.startsWith('CA-SIGNINRISK') || id.startsWith('CA-RISKPOLICY') || id.startsWith('CA-USERRISK')) return 'Risk-based Conditional Access uses Identity Protection signals (impossible travel, leaked credentials, anomalous sign-in) to step up MFA or block access. Requires Entra ID P2.';
  if (id.startsWith('CA-NAMEDLOC')) return 'Named locations let CA policies trust corporate IPs as a factor (lower MFA friction inside, hard block from anonymous-proxy regions). Misconfig here either over-trusts or over-blocks.';
  if (id.startsWith('CA-REPORTONLY')) return 'Report-only CA policies stage rule changes safely, but policies left in report-only past their soak period provide no enforcement. Promote to On or delete.';
  if (id.startsWith('CA-DEVICECODE')) return 'Device code flow is a known phishing vector — attackers send victims a device code prompt that grants tokens to attacker-controlled devices. Block via CA unless specifically required.';
  if (id.startsWith('CA-')) return 'Conditional Access is the single control plane that enforces MFA, device compliance, and session policy. Coverage gaps and admin exclusions invalidate the model.';

  // ---- Defender for Office 365 ----
  if (id.startsWith('DEFENDER-ANTIPHISH')) return 'Anti-phishing impersonation, mailbox intelligence, and targeted-user protection stop Business Email Compromise and spoofing attacks that bypass basic filters.';
  if (id.startsWith('DEFENDER-SAFELINKS') || id.startsWith('DEFENDER-SAFEATTACH')) return 'Safe Links rewrites URLs to detonate at click-time; Safe Attachments detonates files in a sandbox. Without both, zero-day phishing links and malware sail through.';
  if (id.startsWith('DEFENDER-OUTBOUND')) return 'Auto-forwarding is a hallmark of compromised mailboxes exfiltrating data. Disabling external auto-forward and alerting on outbound spam is a BEC table stake.';
  if (id.startsWith('DEFENDER-ZAP')) return 'Zero-Hour Auto Purge removes phish/malware messages already delivered to mailboxes once new threat intel arrives. Disabling ZAP means a known-bad message stays in inboxes indefinitely.';
  if (id.startsWith('DEFENDER-ANTIMALWARE') || id.startsWith('DEFENDER-MALWARE')) return 'The common-attachment filter blocks high-risk file types (dmg, ps1, js, vhd). Missing types are routine initial-access vectors.';
  if (id.startsWith('DEFENDER-ANTISPAM') || id.startsWith('DEFENDER-PRIORITY')) return 'Allow-listing sender domains overrides every downstream filter for those senders. Phishing that spoofs allowed domains goes straight to the inbox.';
  if (id.startsWith('DEFENDER-SECURESCORE') || id.startsWith('DEFENDER-SECUREMON')) return 'Microsoft Secure Score is the tenant-level telemetry roll-up of identity, device, and email posture. Without monitoring + a baseline target, posture drift is invisible until an incident.';
  if (id.startsWith('DEFENDER-CLOUDAPPS') || id.startsWith('DEFENDER-CFGDETECT') || id.startsWith('DEFENDER-VULNSCAN') || id.startsWith('DEFENDER-REALTIMESCAN')) return 'Defender for Cloud Apps and the broader detection surface flag risky OAuth grants, anomalous downloads, and unmanaged SaaS use. Disabled signals = blind spots in the SOC playbook.';

  // ---- Exchange Online (specific before generic) ----
  if (id.startsWith('EXO-FORWARD')) return 'External auto-forwarding is the #1 BEC exfiltration channel — attackers create inbox rules that silently forward financial mail. Block at the org level via Outbound Spam policy AND mailbox transport rules.';
  if (id.startsWith('EXO-AUDIT')) return 'Mailbox auditing is the forensic record for compromise investigations. Without it, post-incident questions like "did the attacker read these messages?" cannot be answered.';
  if (id.startsWith('EXO-DKIM')) return 'DKIM signs outbound mail with a tenant-controlled key so receiving servers can verify the sender domain. Without DKIM, your domain is easier to spoof and downstream DMARC enforcement is incomplete.';
  if (id.startsWith('EXO-OWA')) return 'Outlook on the Web settings (attachment policy, calendar publishing, default app permissions) are the primary surface for accidental data sharing and add-in pivots.';
  if (id.startsWith('EXO-DIRECTSEND')) return 'Direct send and SMTP relay let internal devices submit mail without auth. Misconfigured relays are routinely abused by attackers as a tenant-trusted spoofing vector.';
  if (id.startsWith('EXO-AUTH')) return 'Modern authentication (OAuth) is required for MFA-enforced clients. Tenants with basic-auth still enabled have a parallel auth path that ignores Conditional Access.';
  if (id.startsWith('EXO-EXTTAG')) return 'External email tagging adds a visible "[External]" prefix that helps users spot impersonation. The org-level toggle is one PowerShell command and reduces phishing click-through measurably.';
  if (id.startsWith('EXO-MAILTIPS')) return 'MailTips warn senders about external recipients, large distribution lists, and out-of-office. Disabled MailTips = lost cheap phishing-and-mistake guardrail.';
  if (id.startsWith('EXO-TRANSPORT')) return 'Transport rules implement org-wide mail policy (block exfiltration patterns, encrypt outbound, route quarantine). Misconfigured rules can silently bypass downstream filters or break legitimate flow.';
  if (id.startsWith('EXO-ANTIPHISH')) return 'Anti-phishing protection at the Exchange tier (impersonation users + domains, mailbox intelligence) catches BEC patterns that pure content filters miss. Targeted-user protection covers high-value mailboxes (CFO, payroll).';
  if (id.startsWith('EXO-SHAREDMBX') || id.startsWith('EXO-HIDDEN')) return 'Shared mailboxes that allow direct sign-in inherit MFA exemptions (no human owner). Disable AccountEnabled or require Conditional Access; hidden mailboxes still surface in Outlook autocomplete.';
  if (id.startsWith('EXO-CONNFILTER') || id.startsWith('EXO-LOCKBOX') || id.startsWith('EXO-ADDINS') || id.startsWith('EXO-MALWARE') || id.startsWith('EXO-ANTISPAM') || id.startsWith('EXO-SHARING')) return 'Exchange-tier connectors, add-ins, and content-filter overrides are the surface where a single misconfig opens a parallel path that bypasses every other control. Audit them whenever the broader EXO policy changes.';
  if (id.startsWith('EXO-')) return 'Exchange Online config controls mail flow, connectors, and transport rules. Misconfig here bypasses every downstream security filter.';

  // ---- DNS (mail authentication) ----
  if (id.startsWith('DNS-SPF')) return 'SPF lists the IP addresses authorised to send mail for your domain. Missing or misconfigured SPF lets attackers spoof your domain freely; the record must end with -all (hard fail), not ~all.';
  if (id.startsWith('DNS-DKIM')) return 'DKIM signs outbound mail with a tenant-controlled key so receivers can verify the sender domain cryptographically. Required for downstream DMARC enforcement.';
  if (id.startsWith('DNS-DMARC')) return 'DMARC tells receiving servers what to do with mail that fails SPF/DKIM (reject, quarantine, or report). p=none provides telemetry only; reject/quarantine is the enforcement target.';
  if (id.startsWith('DNS-MX') || id.startsWith('DNS-')) return 'DNS misconfiguration is invisible to most M365 admins but shapes the entire inbound mail-security posture. SPF/DKIM/DMARC + MX hygiene is the foundation that Defender for Office sits on top of.';

  // ---- SharePoint / OneDrive (registry uses SPO- prefix, not SHAREPOINT-) ----
  if (id.startsWith('SPO-SHARING') || id.startsWith('SPO-B2B')) return 'External sharing scope (Anyone, New & Existing Guests, Existing, Only People) controls how SharePoint links can be shared. Anyone-links are public URLs that are forwarded, indexed, and outlive employment.';
  if (id.startsWith('SPO-SITE') || id.startsWith('SPO-ACCESS') || id.startsWith('SPO-CUIACCESS')) return 'Per-site sharing settings can override tenant defaults — a single team site with permissive sharing leaks data even when the tenant default is strict.';
  if (id.startsWith('SPO-SCRIPT') || id.startsWith('SPO-SWAY')) return 'Custom scripts on modern sites enable XSS and OAuth-phishing pivots. Disable except where SharePoint Designer or PnP customisation is genuinely required.';
  if (id.startsWith('SPO-SYNC') || id.startsWith('SPO-OD')) return 'OneDrive sync clients can pull tenant data to unmanaged personal devices. Domain-restricted sync + block sync from non-Entra-joined devices closes the easiest exfiltration path.';
  if (id.startsWith('SPO-MALWARE') || id.startsWith('SPO-VERSIONING') || id.startsWith('SPO-LOOP') || id.startsWith('SPO-AUTH') || id.startsWith('SPO-SESSION')) return 'SharePoint platform settings (malware quarantine, version retention, Loop component access, idle timeout) are the secondary controls that catch what the primary sharing policy misses.';
  if (id.startsWith('SPO-') || id.startsWith('SHAREPOINT-') || id.startsWith('20B-')) return 'External sharing, anonymous links, and guest access in SharePoint and OneDrive are common data-leakage paths. Lock down sharing scope and link expiration.';

  // ---- Teams ----
  if (id.startsWith('TEAMS-EXTACCESS') || id.startsWith('TEAMS-GUEST')) return 'Teams external access and federation control who can chat, call, and share meeting links with your users. Defaults are permissive — restrict to allow-listed domains for high-risk org units.';
  if (id.startsWith('TEAMS-MEETING')) return 'Meeting policies (lobby, recording, anonymous join) control privacy and recording sprawl. Anonymous join + auto-recording is a compliance landmine in regulated industries.';
  if (id.startsWith('TEAMS-APPS') || id.startsWith('TEAMS-CLIENT') || id.startsWith('TEAMS-INFO') || id.startsWith('TEAMS-REPORTING')) return 'Teams app permissions and client/reporting policies govern third-party app access and audit data. Default app permissions allow broader access than most orgs realise.';
  if (id.startsWith('TEAMS-')) return 'Teams external access and federation settings control who can message your users and share meeting links. Defaults often allow broader access than required.';

  // ---- Intune ----
  if (id.startsWith('INTUNE-COMPLIANCE')) return 'Compliance policies define what "managed and healthy" means (encrypted, patched, AV-active, jailbreak-free). Without a compliance policy, Conditional Access has no signal to block unhealthy devices.';
  if (id.startsWith('INTUNE-ENCRYPTION') || id.startsWith('INTUNE-MOBILEENCRYPT')) return 'Disk encryption (BitLocker / FileVault / Android Work Profile) is the last line of defence for lost or stolen devices. Required for HIPAA, PCI, and most state breach laws.';
  if (id.startsWith('INTUNE-ENROLL') || id.startsWith('INTUNE-AUTODISC') || id.startsWith('INTUNE-ENROLLMENT')) return 'Enrollment restrictions and auto-discovery (Apple ADE, Windows Autopilot) determine which devices can join. Permissive enrollment lets personal-device sprawl pull tenant data into MDM.';
  if (id.startsWith('INTUNE-UPDATE') || id.startsWith('INTUNE-SECURITY')) return 'Update rings and security baselines are the patch + hardening control surface. Stale rings keep known-CVE devices in production, often invisibly.';
  if (id.startsWith('INTUNE-')) return 'Device management policy controls what can join, stay, and execute. Missing config profiles and encryption leaves endpoints unmanaged.';

  // ---- Compliance / Purview ----
  if (id.startsWith('COMPLIANCE-AUDIT') || id.startsWith('PURVIEW-AUDIT')) return 'Unified audit log is the single forensic source for tenant-wide actions (sign-ins, sharing, role changes, mailbox reads). Disabled or unconfigured audit means incident investigations rely on best-guess inference.';
  if (id.startsWith('COMPLIANCE-ALERTPOLICY')) return 'Alert policies are the proactive detection layer — they fire on suspicious activity (impossible travel, mass downloads, elevation of privilege). Default policies cover ~30% of high-value scenarios; tenant-specific tuning is required.';
  if (id.startsWith('COMPLIANCE-DLP') || id.startsWith('DLP-')) return 'Data Loss Prevention prevents regulated content (PII, PCI, PHI) from leaving the tenant via email, SharePoint, or endpoints. Missing or report-only DLP is undetected exfiltration.';
  if (id.startsWith('PURVIEW-RETENTION') || id.startsWith('COMPLIANCE-LABELS') || id.startsWith('COMPLIANCE-COMMS')) return 'Retention labels and policies meet legal-hold + records-management obligations. Without explicit retention, deleted mail and chat are gone — including data subject to litigation hold.';
  if (id.startsWith('COMPLIANCE-')) return 'Data Loss Prevention and retention policies protect regulated content (PII, PCI, PHI). Missing policies = undetected exfiltration and legal-hold gaps.';

  // ---- Forms ----
  if (id.startsWith('FORMS-PHISHING') || id.startsWith('FORMS-CONFIG')) return 'Microsoft Forms is a recurring phishing surface — attackers create credential-harvest forms branded as Microsoft. The phishing-detection toggle + external-share restrictions are the org-level mitigations.';

  // ---- Power BI / Fabric ----
  if (id.startsWith('POWERBI-GUEST') || id.startsWith('PBI-GUEST') || id.startsWith('PBI-INVITE')) return 'Guest access in Power BI inherits tenant settings, but Power-BI-specific guest sharing toggles (publish to web, external sharing) override at the workspace level. Routinely permissive by default.';
  if (id.startsWith('POWERBI-SHARING') || id.startsWith('PBI-SHARING') || id.startsWith('PBI-LINK') || id.startsWith('PBI-PUBLISH') || id.startsWith('PBI-CONTENT')) return 'Power BI external sharing and "publish to web" expose datasets to anonymous URLs. Publish-to-web in particular is a one-click public-internet exposure with no expiration.';
  if (id.startsWith('POWERBI-AUTH') || id.startsWith('PBI-AUTH') || id.startsWith('PBI-API') || id.startsWith('PBI-PROFILE')) return 'Power BI service principal + API access controls govern automation accounts. Tenant-wide API enablement without per-app scoping grants broad service-account power.';
  if (id.startsWith('POWERBI-INFOPROT') || id.startsWith('PBI-LABELS') || id.startsWith('PBI-SCRIPT')) return 'Sensitivity labels in Power BI flow with exported reports (PDF, Excel) so DLP applies downstream. Without labels, exported tenant data leaves Microsoft 365 Information Protection coverage.';
  if (id.startsWith('POWERBI-SERVICEPRINCIPAL') || id.startsWith('PBI-TENANT')) return 'Service principal access to Power BI bypasses interactive sign-in controls. Required for embedded scenarios but should be scoped to specific workspaces, not tenant-wide.';
  if (id.startsWith('POWERBI-') || id.startsWith('PBI-')) return 'Power BI tenant settings govern data flow between workspaces and external recipients. Defaults skew toward sharing — most orgs need to tighten guest, publish, and export controls.';

  return 'This control maps to hardening guidance across CIS, NIST, and CMMC. Closing this gap reduces attack surface and tightens compliance posture.';
}

// ======================== Roadmap ========================
function Roadmap({ onViewFinding, editMode, hiddenFindings, roadmapOverrides, onRoadmapChange }) {
  const { open: sectionOpen, headProps } = useCollapsibleSection();
  const [open, setOpen] = useState(null);

  const moveTo = (checkId, lane) => {
    onRoadmapChange({ ...roadmapOverrides, [checkId]: lane });
    if (open === checkId) setOpen(null);
  };

  const resetCard = checkId => {
    const next = { ...roadmapOverrides };
    delete next[checkId];
    onRoadmapChange(next);
  };

  const resetLane = laneItems => {
    const next = { ...roadmapOverrides };
    laneItems.forEach(t => { delete next[t.checkId]; });
    onRoadmapChange(next);
  };

  const tasks = FINDINGS.filter(f => !NON_REMEDIATION_STATUSES.has(f.status) && !hiddenFindings?.has(f.checkId)).map(f => ({ ...f }));
  const score = f => {
    const sev = { critical:100, high:60, medium:30, low:10, none:0, info:5 }[f.severity];
    const eff = { small:3, medium:2, large:1 }[f.effort];
    return sev * eff;
  };
  tasks.sort((a,b) => score(b) - score(a));

  const FW_PREF_RM = ['cis-m365-v6','nist-800-53','cmmc','nist-csf','iso-27001'];
  const buildRoadmapCsv = (n, s, l) => {
    const cols = ['Lane','Setting','CheckID','Severity','Effort','Domain','Section',
                  'CurrentValue','RecommendedValue','Remediation','LearnMore','ControlRef'];
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [cols.join(',')];
    [['Do Now', n], ['Do Next', s], ['Later', l]].forEach(([label, items]) => {
      items.forEach(t => {
        const fw = FW_PREF_RM.find(k => t.fwMeta?.[k]?.controlId);
        const ref = fw ? `${fw}: ${t.fwMeta[fw].controlId}` : '';
        rows.push([label, t.setting, t.checkId, t.severity, t.effort ?? 'medium',
                   t.category, t.section, t.currentValue, t.recommendedValue,
                   t.remediation, (t.references && t.references.length > 0 ? t.references[0].url : ''), ref].map(esc).join(','));
      });
    });
    return rows.join('\r\n');
  };

  const downloadCsv = () => {
    const csv = buildRoadmapCsv(now, soon, later);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = 'Assessment-Roadmap.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  // Issue #715: lane bucketing now lives in Get-RemediationLane.ps1 (the single
  // source of truth shared by HTML + XLSX). Build-ReportData precomputes t.lane;
  // we just read it here. Falls back to 'later' for any unexpected missing value.
  const getNaturalLane = t => t.lane || 'later';
  const getEffectiveLane = t => roadmapOverrides[t.checkId] || getNaturalLane(t);
  const LANE_LABEL = { now: 'Now', soon: 'Next', later: 'Later' };

  const now   = tasks.filter(t => getEffectiveLane(t) === 'now');
  const soon  = tasks.filter(t => getEffectiveLane(t) === 'soon');
  const later = tasks.filter(t => getEffectiveLane(t) === 'later');

  const priorityReason = (t, lane) => {
    if (roadmapOverrides[t.checkId]) {
      const natural = LANE_LABEL[getNaturalLane(t)];
      return `Manually moved to ${LANE_LABEL[lane]}. Default lane was ${natural}. Click Reset to restore.`;
    }
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
    const isCustom = !!roadmapOverrides[key];
    return (
      <div className={'task'+(isOpen?' task-open':'')+(isCustom?' task-custom':'')} key={key}>
        <button className="task-head-btn" onClick={()=>setOpen(isOpen?null:key)} aria-expanded={isOpen}>
          <div className="task-head">
            <span>{t.setting}{isCustom && <span className="task-custom-badge">custom</span>}</span>
            <span className={'status-badge ' + STATUS_COLORS[t.status]}><span className="dot"/>{statusLabel(t.status)}</span>
          </div>
          <div className="task-id">{t.checkId} · {t.domain}</div>
          <div className="task-tags">
            <span className={'task-tag task-tag-sev sev-' + t.severity}>{SEV_LABEL[t.severity]}</span>
            {t.effort && <span className="task-tag task-tag-effort">{t.effort} effort</span>}
            {t.frameworks.slice(0,3).map(fw => <span key={fw} className="task-tag" style={{fontFamily:'var(--font-mono)'}}>{fw}</span>)}
            <span className="task-chev" aria-hidden="true">{isOpen ? '−' : '+'}</span>
          </div>
        </button>
        <div className="task-move-row">
          {lane === 'now'   && <button className="task-move-btn" onClick={e=>{e.stopPropagation();moveTo(key,'soon');}}>Next →</button>}
          {lane === 'soon'  && <button className="task-move-btn" onClick={e=>{e.stopPropagation();moveTo(key,'now');}}>← Now</button>}
          {lane === 'soon'  && <button className="task-move-btn" onClick={e=>{e.stopPropagation();moveTo(key,'later');}}>Later →</button>}
          {lane === 'later' && <button className="task-move-btn" onClick={e=>{e.stopPropagation();moveTo(key,'soon');}}>← Next</button>}
          {isCustom && <button className="task-move-btn task-move-reset" onClick={e=>{e.stopPropagation();resetCard(key);}}>Reset</button>}
        </div>
        {isOpen && (
          <div className="task-body">
            <div className="task-why">
              <div className="task-why-label">Why this is in {lane==='now'?'"Now"':lane==='soon'?'"Next"':'"Later"'}</div>
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
            {t.references && t.references.length > 0 && (
              <div className="task-field task-field-learn-more">
                <div className="task-field-label">Learn more</div>
                <div className="task-field-value" style={{display:'flex',flexDirection:'column',gap:'4px'}}>
                  {t.references.map((r, i) => (
                    <a key={i} href={r.url} target="_blank" rel="noreferrer noopener" style={{color:'var(--accent-text)',textDecoration:'none'}}>
                      📖 {r.title} ↗
                    </a>
                  ))}
                </div>
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

  const LaneReset = ({ laneItems }) => {
    const hasCustom = laneItems.some(t => roadmapOverrides[t.checkId]);
    if (!hasCustom) return null;
    return (
      <button className="lane-reset-btn" onClick={() => resetLane(laneItems)}>Reset lane</button>
    );
  };

  return (
    <section className="block" id="roadmap">
      <div {...headProps}>
        <span className="eyebrow">04 · Action plan</span>
        <h2>Remediation roadmap</h2>
        <span className="section-chevron" aria-hidden="true">{sectionOpen ? '▾' : '▸'}</span>
        <div className="hr"/>
        <button className="lane-reset-btn" style={{marginTop:'8px'}} onClick={e => {e.stopPropagation(); downloadCsv();}}>Download CSV</button>
      </div>
      {sectionOpen && <><div className="roadmap-intro">
        <div className="roadmap-intro-head">How we prioritized</div>
        <div className="roadmap-intro-body">
          Findings are bucketed by severity. Critical findings — identity takeover, data exfiltration, privilege escalation paths — always go in <b>Now</b>. High-severity findings land in <b>Next</b>: risk is real but remediation typically requires coordination or scheduling. Medium-severity items also join <b>Next</b> when tractable, or <b>Later</b> for larger hardening work. <br/>
          <span style={{color:'var(--muted)'}}>Click any task to expand it, or use the move buttons on each card to reprioritize. Use Finalize (✎) to bake lane changes into the report.</span>
        </div>
      </div>
      <div className="roadmap">
        <HideableBlock hideKey="roadmap-lane-now" label="Now lane">
        <div className="lane">
          <div className="lane-head">
            <div className="lane-title" id="roadmap-now"><span className="lane-dot crit"/>Now <span style={{color:'var(--muted)', fontWeight:400}}>· {now.length}</span></div>
            <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
              <LaneReset laneItems={now}/>
              <div className="lane-eta">&lt; 1 week</div>
            </div>
          </div>
          {now.map(t => renderTask(t, 'now'))}
        </div>
        </HideableBlock>
        <HideableBlock hideKey="roadmap-lane-next" label="Next lane">
        <div className="lane">
          <div className="lane-head">
            <div className="lane-title" id="roadmap-next"><span className="lane-dot soon"/>Next <span style={{color:'var(--muted)', fontWeight:400}}>· {soon.length}</span></div>
            <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
              <LaneReset laneItems={soon}/>
              <div className="lane-eta">1 – 4 weeks</div>
            </div>
          </div>
          {soon.map(t => renderTask(t, 'soon'))}
        </div>
        </HideableBlock>
        <HideableBlock hideKey="roadmap-lane-later" label="Later lane">
        <div className="lane">
          <div className="lane-head">
            <div className="lane-title" id="roadmap-later"><span className="lane-dot later"/>Later <span style={{color:'var(--muted)', fontWeight:400}}>· {later.length}</span></div>
            <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
              <LaneReset laneItems={later}/>
              <div className="lane-eta">1 – 3 months</div>
            </div>
          </div>
          {later.map(t => renderTask(t, 'later'))}
        </div>
        </HideableBlock>
      </div></>}
    </section>
  );
}

// ======================== Critical Exposure section ========================
function StrykerBlock() {
  const { open, headProps } = useCollapsibleSection();
  const stryker = FINDINGS.filter(f => f.domain === 'Stryker Readiness');
  if (!stryker.length) return null;
  const fail = stryker.filter(f => f.status==='Fail').length;
  const pass = stryker.filter(f => f.status==='Pass').length;
  return (
    <section className="block" id="stryker">
      <div {...headProps}>
        <span className="eyebrow">01b · Targeted</span>
        <h2>Critical exposure analysis</h2>
        <span className="section-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <div className="hr"/>
      </div>
      {open && <><div className="card" style={{marginBottom:12, display:'flex', gap:24, alignItems:'center', flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:12, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.1em', fontWeight:600}}>Coverage</div>
          <div style={{fontSize:34, fontWeight:700, fontFamily:'var(--font-display)', letterSpacing:'-.02em'}}>
            {pct(pass, scoreDenom(stryker))}<span style={{fontSize:18, color:'var(--muted)'}}>%</span>
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
            <div><span className={'status-badge '+STATUS_COLORS[f.status]}><span className="dot"/>{statusLabel(f.status)}</span></div>
            <div className="finding-title"><div className="t">{f.setting}</div><div className="sub">{f.section}</div></div>
            <div className="check-id">{f.checkId}</div>
            <div><span className={'sev-badge '+f.severity}><span className="bar"><i/><i/><i/><i/></span><span>{SEV_LABEL[f.severity]}</span></span></div>
            <div className="fw-list">{f.frameworks.map(fw => <span key={fw} className="fw-pill">{fw}</span>)}</div>
            <div/>
          </div>
        ))}
      </div></>}
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
                  <td style={{...cellStyle,...monoRight,color:spfPass===dnsTotal?'var(--success-text)':spfPass>0?'var(--warn-text)':'var(--danger-text)'}}>{spfPass}/{dnsTotal}</td>
                </tr>
                <tr style={rowStyle}>
                  <td style={cellStyle}>DKIM passing</td>
                  <td style={{...cellStyle,...monoRight,color:dkimPass===dnsTotal?'var(--success-text)':dkimPass>0?'var(--warn-text)':'var(--danger-text)'}}>{dkimPass}/{dnsTotal}</td>
                </tr>
                <tr style={rowStyle}>
                  <td style={cellStyle}>DMARC enforced</td>
                  <td style={{...cellStyle,...monoRight,color:dmarcEnf===dnsTotal?'var(--success-text)':dmarcEnf>0?'var(--warn-text)':'var(--danger-text)'}}>{dmarcEnf}/{dnsTotal}</td>
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
          severity:  Array.isArray(saved.severity)  ? saved.severity  : [],
          framework: Array.isArray(saved.framework) ? saved.framework : [],
          domain:    Array.isArray(saved.domain)    ? saved.domain    : [],
          profile:   Array.isArray(saved.profile)   ? saved.profile   : [],
        };
      }
    } catch {}
    return { status:[], severity:[], framework:[], domain:[], profile:[] };
  });
  const [active, setActive] = useState('overview');
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
  const onOverviewClick = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setActive('overview');
    onDomainJump(null);
  };
  const onViewFinding = useCallback((checkId) => {
    setFilters({ status:[], severity:[], framework:[], domain:[], profile:[] });
    setSearch('');
    setFocusFinding(checkId);
    document.getElementById('findings-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <EditModeContext.Provider value={editModeCtx}>
    <div className="app">
      <Sidebar active={active} activeSubsection={activeSubsection} counts={navCounts} domainCounts={domainCounts} activeDomain={filters.domain.length===1 ? filters.domain[0] : null} onDomainJump={onDomainJump} onOverviewClick={onOverviewClick} navOpen={navOpen} onClose={()=>setNavOpen(false)}/>
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
        <Overview/>
        <Posture/>
        <ScoringViews/>
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
