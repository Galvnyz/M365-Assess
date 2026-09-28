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
  clone.querySelector('#report-overrides').textContent = `window.REPORT_OVERRIDES = ${JSON.stringify(overrides).replace(/</g, '\\u003c')};`;
  const dataScript = [...clone.querySelectorAll('script')].find(x => x.textContent.trim().startsWith('window.REPORT_DATA ='));
  if (dataScript) dataScript.textContent = `window.REPORT_DATA = ${JSON.stringify({...D, assessmentDecisions: assessmentDecisionDocument}).replace(/</g, '\\u003c')};`;
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

// #963: headline framework id(s) for the Executive Briefing. Honors the
// -HeadlineFramework run-time parameter when present, else CIS M365. Always
// filtered to frameworks that exist in this report's data so a stale id can
// never blank the verdict card.
const HEADLINE_FWS = (() => {
  const ids = [].concat(D.headlineFrameworks || []).filter(id => FRAMEWORKS.some(fw => fw.id === id));
  if (ids.length > 0) return ids;
  return FRAMEWORKS.some(fw => fw.id === 'cis-m365-v6') ? ['cis-m365-v6'] : [FRAMEWORKS[0].id];
})();

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

// --------------------- Status grouping for summary visuals (#962) ---------------------
// Summary charts collapse the four "not assessed" statuses into ONE muted bucket so
// non-expert readers see a single honest category. The FindingsTable, FilterBar chips,
// Roadmap, and Appendix keep the full nine-status vocabulary (technical layer).
const NOT_ASSESSED_STATUSES = new Set(['Skipped', 'Unknown', 'NotApplicable', 'NotLicensed']);
const NOT_ASSESSED_LABEL = 'Not assessed';
const NOT_ASSESSED_TIP = 'Skipped, could not be collected, not applicable, or not licensed. Never counted in any score.';

// Summary bucket for a status: 'pass' | 'warn' | 'fail' | 'review' | 'info' | 'na'
const summaryBucket = s => NOT_ASSESSED_STATUSES.has(s) ? 'na' : (STATUS_COLORS[s] || 'na');

// One-sentence explanation per status (legend + badge tooltips).
// Copy aligned with docs/reference/CHECK-STATUS-MODEL.md.
const STATUS_TIP = {
  Pass:          'Verified secure. The tenant setting matches the recommendation.',
  Fail:          'Verified insecure. This setting needs remediation.',
  Warning:       'Configured, but in a way that raises a concern worth reviewing.',
  Review:        'Data was collected; a person must judge whether it is acceptable.',
  Info:          'Background information only, not a pass/fail judgment.',
  Skipped:       'Not assessed. This check was intentionally excluded from the run.',
  Unknown:       'Not assessed. Data could not be collected (often a missing permission).',
  NotApplicable: 'Not assessed. The tenant does not use the service this check covers.',
  NotLicensed:   'Not assessed. The tenant lacks the license this feature requires.',
};
const SEV_TIP = {
  critical: 'Exploitable path to tenant takeover or data loss. Fix first, regardless of effort.',
  high:     'Material risk. Schedule remediation within the month.',
  medium:   'Closes a common attack path. Batch into planned work.',
  low:      'Defense-in-depth hardening. Address after higher tiers are clear.',
};

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
function Sidebar({ active, activeSubsection, counts, domainCounts, activeDomain, onDomainJump, onBriefingClick, navOpen, onClose }) {
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
    { id: 'briefing', label: 'Executive briefing' },
    { id: 'overview', label: 'Overview' },
    ...(FINDINGS.some(f => f.criticalExposure) ? [{ id: 'critical-exposure', label: 'Critical exposure' }] : []),
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
                 onClick={e => { if (it.id === 'briefing') { e.preventDefault(); onBriefingClick(); } closeIfMobile(); }}
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
                             className={'nav-subitem' + (activeDomain===d?' active':'')}
                             title={fails ? `${fails} failing of ${total} checks` : `${total} checks, none failing`}>
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
            {MFA_STATS.phishResistant > 0 && <div className="sc-row"><span title="Phishing-resistant MFA (FIDO2 keys, Windows Hello, certificates)">phish-res</span><span>{fmt(MFA_STATS.phishResistant)}</span></div>}
            {MFA_STATS.standard > 0     && <div className="sc-row"><span>standard</span><span>{fmt(MFA_STATS.standard)}</span></div>}
            {MFA_STATS.weak > 0         && <div className="sc-row"><span>weak</span><span className="sc-warn">{fmt(MFA_STATS.weak)}</span></div>}
            <div className="sc-row"><span>none</span><span className={MFA_STATS.none > 0 ? 'sc-danger' : ''}>{fmt(MFA_STATS.none)}</span></div>
            {MFA_STATS.adminsWithoutMfa > 0 && <div className="sc-row"><span title="Admin accounts not enrolled in MFA">adm gap</span><span className="sc-danger">{fmt(MFA_STATS.adminsWithoutMfa)}</span></div>}
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
  // Review is outstanding evidence, never a confirmed pass.
  // Excludes Skipped/Unknown/NotApplicable/NotLicensed -- you can't be ready for
  // a control you literally cannot assess.
  const items = (arr || []).filter(f => ['Pass', 'Fail', 'Warning', 'Review'].includes(f.status));
  if (items.length === 0) return null;
  const ready = items.filter(f => f.status === 'Pass').length;
  return Math.round((ready / items.length) * 100);
};
// 3 list views (return an array of findings, sorted/filtered for the workflow):
const getQuickWins = arr => {
  // Fail status × low effort, sorted by severity (critical > high > medium > low > none).
  const sevOrder = { critical: 0, high: 1, medium: 2, low: 3, none: 4, info: 5 };
  return (arr || [])
    .filter(f => isActionableFinding(f) && f.status === 'Fail' && (f.effort === 'small' || f.effort === 'low'))
    .sort((a, b) => (sevOrder[a.severity] ?? 99) - (sevOrder[b.severity] ?? 99));
};
const getRequiresLicensing = arr => (arr || []).filter(f => f.status === 'NotLicensed');
const getManualValidation  = arr => (arr || []).filter(f => f.status === 'Review' && isActionableFinding(f));

const SCORING_VIEWS = [
  { id: 'security-risk',     label: 'Security Risk',           kind: 'score', compute: computeSecurityRiskScore,
    blurb: 'The strict rule: passes divided by everything that could pass or fail. Matches the headline score.' },
  { id: 'compliance',        label: 'Compliance Readiness',    kind: 'score', compute: computeComplianceReadinessScore,
    blurb: 'Confirmed passes among findings requiring a conclusion. Unverified review items remain outstanding.' },
{ id: 'quick-wins',        label: 'Quick Wins',              kind: 'list',  collect: getQuickWins,
    blurb: 'Failing checks that take little effort to fix. The fastest score improvements.' },
  { id: 'requires-licensing',label: 'Requires Licensing',      kind: 'list',  collect: getRequiresLicensing,
    blurb: 'Checks that cannot be enabled on current licensing. Input for a license upgrade conversation.' },
  { id: 'manual-validation', label: 'Manual Validation',       kind: 'list',  collect: getManualValidation,
    blurb: 'Findings a person must verify (evidence collection, log review) before they can pass.' },
];

// #963: tab state lives in App so the Briefing's "Quick wins" tile can
// deep-link straight to the quick-wins view (plain useState, no persistence).
function ScoringViews({ view: activeId, setView }) {
  const view = SCORING_VIEWS.find(v => v.id === activeId) || SCORING_VIEWS[0];
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
            <button key={v.id} role="tab" aria-selected={v.id === view.id}
              className={'scoring-views-tab' + (v.id === view.id ? ' active' : '')}
              onClick={() => setView(v.id)}>
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

// ======================== Executive briefing (#963) ========================
// Compliance-led first screen: a verdict for the headline framework, three
// plain-language stat tiles, and the top "do first" actions. Language policy:
// no CheckIds, no status vocabulary, no unexpanded acronyms on this screen.
// The technical layers below keep full fidelity.
const EFFORT_HUMAN = { small: 'under an hour', low: 'under an hour', medium: 'a few hours', large: 'a longer project' };
const BRIEF_SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3, none: 4, info: 5 };
const BRIEF_EFFORT_ORDER = { small: 0, low: 0, medium: 1, large: 2 };

function BriefingVerdictCard({ fwId, setFwId }) {
  const [showAllFw, setShowAllFw] = useState(false);
  const data = useMemo(() => buildFrameworkData(fwId, []), [fwId]);
  if (!data) return null;
  const pctVal = fwCoveragePct(data.counts);
  const readiness = fwReadinessLabel(pctVal);
  // "Applicable" excludes the not-assessed bucket; the donut % keeps the
  // standard fwCoveragePct formula so Briefing and FrameworkQuilt always agree.
  const applicable = data.counts.pass + data.counts.fail + data.counts.warn;
  const qwInFw = getQuickWins(FINDINGS).filter(f => (f.frameworks || []).includes(fwId));
  const projected = qwInFw.length > 0
    ? fwCoveragePct({ ...data.counts, pass: data.counts.pass + qwInFw.length, fail: Math.max(0, data.counts.fail - qwInFw.length) })
    : pctVal;
  const meta = FRAMEWORKS.find(fw => fw.id === fwId);
  const chipIds = showAllFw
    ? FRAMEWORKS.map(fw => fw.id)
    : HEADLINE_FWS.concat(HEADLINE_FWS.includes(fwId) ? [] : [fwId]);
  return (
    <div className="brief-verdict">
      <ScoreDonut counts={data.counts} animKey={fwId} size={120} stroke={14}/>
      <div className="brief-verdict-info">
        <div className="brief-fw-chips">
          {chipIds.map(id => {
            const fw = FRAMEWORKS.find(x => x.id === id);
            return fw ? (
              <button key={id} className={'brief-fw-chip' + (id === fwId ? ' selected' : '')} onClick={() => setFwId(id)}>
                {fw.full}
              </button>
            ) : null;
          })}
          {!showAllFw && FRAMEWORKS.length > chipIds.length && (
            <button className="brief-fw-chip brief-fw-more" onClick={() => setShowAllFw(true)}>
              + {FRAMEWORKS.length - chipIds.length} more
            </button>
          )}
        </div>
        <div className={'brief-verdict-line ' + readiness.tone}>{readiness.label}</div>
        <div className="brief-verdict-sub">
          {data.counts.pass} of {applicable} assessed {meta ? meta.full : fwId} findings pass. This is configuration evidence, not an audit conclusion. {data.counts.na || 0} not assessed; {data.counts.review || 0} require review.
          {qwInFw.length > 0 && projected > pctVal &&
            ` Fixing the ${qwInFw.length} quick win${qwInFw.length === 1 ? '' : 's'} below would bring the observed pass rate to ${projected}%.`}
        </div>
      </div>
    </div>
  );
}

function BriefingStatRow({ onShowCritical, onShowQuickWins }) {
  // Actionable criticals only: critical-severity findings that still need
  // remediation. The Posture KPI counts ALL critical-severity findings
  // (including passing ones), so these two numbers can legitimately differ.
  const critical = FINDINGS.filter(f => f.severity === 'critical' && !NON_REMEDIATION_STATUSES.has(f.status)).length;
  const quickWins = getQuickWins(FINDINGS).length;
  const score = parseFloat(SCORE.Percentage);
  const avg = parseFloat(SCORE.AverageComparativeScore);
  return (
    <div className="brief-stat-row">
      <button className={'brief-stat ' + (critical > 0 ? 'bad' : 'good')} onClick={onShowCritical}>
        <div className="brief-stat-label">Needs attention now</div>
        <div className="brief-stat-value">{critical}</div>
        <div className="brief-stat-hint">{critical > 0 ? (critical === 1 ? 'issue to fix this week' : 'issues to fix this week') : 'no critical issues open'}</div>
      </button>
      <button className="brief-stat" onClick={onShowQuickWins}>
        <div className="brief-stat-label">Quick wins</div>
        <div className="brief-stat-value">{quickWins}</div>
        <div className="brief-stat-hint">{quickWins === 1 ? 'fix takes under an hour' : 'fixes take under an hour each'}</div>
      </button>
      {Number.isFinite(score) && (
        <div className="brief-stat">
          <div className="brief-stat-label">Microsoft secure score</div>
          <div className="brief-stat-value">{score.toFixed(1)}%</div>
          <div className="brief-stat-hint">
            {Number.isFinite(avg) && avg > 0
              ? (score >= avg ? `above the peer average of ${avg.toFixed(1)}%` : `below the peer average of ${avg.toFixed(1)}%`)
              : 'as last published by Microsoft'}
          </div>
        </div>
      )}
    </div>
  );
}

function BriefingActions({ onViewFinding }) {
  const actions = FINDINGS
    .filter(f => f.lane === 'now' && !NON_REMEDIATION_STATUSES.has(f.status))
    .sort((a, b) =>
      ((BRIEF_SEV_ORDER[a.severity] ?? 9) - (BRIEF_SEV_ORDER[b.severity] ?? 9)) ||
      ((BRIEF_EFFORT_ORDER[a.effort] ?? 3) - (BRIEF_EFFORT_ORDER[b.effort] ?? 3)))
    .slice(0, 5);
  if (actions.length === 0) return null;
  return (
    <div className="brief-actions">
      <div className="brief-actions-title">What to do first</div>
      {actions.map(f => (
        <button key={f.checkId} className="brief-action" onClick={() => onViewFinding(f.checkId)}>
          <span className={'brief-action-dot ' + (f.severity || 'medium')}/>
          <span className="brief-action-name">{f.setting}</span>
          {EFFORT_HUMAN[f.effort] && <span className="brief-action-effort">{EFFORT_HUMAN[f.effort]}</span>}
        </button>
      ))}
      <a className="brief-actions-more" href="#roadmap" onClick={e => { e.preventDefault(); document.getElementById('roadmap')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
        See the full remediation plan
      </a>
    </div>
  );
}
