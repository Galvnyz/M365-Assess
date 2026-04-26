/* global React, ReactDOM */
const {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback
} = React;

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
function finalizeReport({
  hiddenFindings,
  roadmapOverrides
}) {
  const overridesEl = document.getElementById('report-overrides');
  if (!overridesEl) {
    alert('This report is missing the overrides injection point. Regenerate it with the latest template.');
    return;
  }
  const overrides = {
    hiddenFindings: [...(hiddenFindings || [])],
    roadmapOverrides: roadmapOverrides || {}
  };
  const clone = document.documentElement.cloneNode(true);
  clone.querySelector('#report-overrides').textContent = `window.REPORT_OVERRIDES = ${JSON.stringify(overrides)};`;
  clone.querySelector('#root').replaceChildren();
  const blob = new Blob(['<!DOCTYPE html>\n' + clone.outerHTML], {
    type: 'text/html'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (TENANT.OrgDisplayName || 'Assessment').replace(/[^a-z0-9 ]/gi, '').trim().replace(/\s+/g, '-') + '-M365-Report.html';
  a.click();
  URL.revokeObjectURL(url);
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
  now: _RM.filter(t => t.lane === 'now').length,
  soon: _RM.filter(t => t.lane === 'soon').length,
  later: _RM.filter(t => t.lane === 'later' || !t.lane).length
};
const FRAMEWORKS = D.frameworks && D.frameworks.length ? D.frameworks : [{
  id: 'cis-m365-v6',
  full: 'CIS Microsoft 365 v6.0.1'
}, {
  id: 'nist-800-53',
  full: 'NIST SP 800-53 Rev 5'
}, {
  id: 'cmmc',
  full: 'CMMC 2.0'
}, {
  id: 'cisa-scuba',
  full: 'CISA SCuBA'
}, {
  id: 'iso-27001',
  full: 'ISO 27001:2022'
}, {
  id: 'cis-controls-v8',
  full: 'CIS Controls v8.1'
}, {
  id: 'essential-eight',
  full: 'ASD Essential Eight'
}, {
  id: 'fedramp',
  full: 'FedRAMP Rev 5'
}, {
  id: 'hipaa',
  full: 'HIPAA'
}, {
  id: 'mitre-attack',
  full: 'MITRE ATT&CK'
}, {
  id: 'nist-csf',
  full: 'NIST CSF 2.0'
}, {
  id: 'pci-dss',
  full: 'PCI DSS v4.0.1'
}, {
  id: 'soc2',
  full: 'SOC 2 Trust Services Criteria'
}, {
  id: 'stig',
  full: 'DISA STIG'
}];
const FW_BLURB = {
  'cis-m365-v6': {
    desc: 'Prescriptive configuration recommendations for Microsoft 365 services, organized into L1/L2 profiles and E3/E5 licensing tiers. Maintained by the Center for Internet Security.',
    url: 'https://www.cisecurity.org/benchmark/microsoft_365'
  },
  'cis-controls-v8': {
    desc: 'Prioritized set of 18 critical security controls defending against the most pervasive attacks, organized into three Implementation Groups (IG1–IG3) by organizational maturity.',
    url: 'https://www.cisecurity.org/controls'
  },
  'cisa-scuba': {
    desc: 'Federal cloud security baselines from CISA covering M365 configurations. Required for US federal agencies and widely adopted by state/local government.',
    url: 'https://www.cisa.gov/resources-tools/services/secure-cloud-business-applications-scuba-project'
  },
  'cmmc': {
    desc: 'DoD supply chain cybersecurity standard with three maturity levels. Required for contractors handling Federal Contract Information (FCI) or Controlled Unclassified Information (CUI).',
    url: 'https://dodcio.defense.gov/CMMC/'
  },
  'essential-eight': {
    desc: 'Eight foundational mitigation strategies from the Australian Signals Directorate, rated across four maturity levels. Mandatory for Australian government agencies.',
    url: 'https://www.cyber.gov.au/resources-business-and-government/essential-cyber-security/essential-eight'
  },
  'fedramp': {
    desc: 'US government standardized authorization program for cloud services. FedRAMP Moderate covers the majority of federal workloads with 325 security controls.',
    url: 'https://www.fedramp.gov/'
  },
  'hipaa': {
    desc: 'US federal law establishing security and privacy standards for protected health information (PHI). Applies to covered entities and their business associates.',
    url: 'https://www.hhs.gov/hipaa/index.html'
  },
  'iso-27001': {
    desc: 'International standard for information security management systems (ISMS). Specifies requirements for establishing, maintaining, and continually improving an ISMS. Widely used for third-party certification.',
    url: 'https://www.iso.org/standard/27001'
  },
  'mitre-attack': {
    desc: 'Globally-accessible knowledge base of adversary tactics and techniques based on real-world threat intelligence. Used for threat modeling, detection engineering, and red team exercises.',
    url: 'https://attack.mitre.org/'
  },
  'nist-800-53': {
    desc: 'Comprehensive catalog of security and privacy controls for US federal information systems (FISMA). Widely adopted beyond government as a baseline security framework.',
    url: 'https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final'
  },
  'nist-csf': {
    desc: 'Voluntary framework for managing cybersecurity risk, organized around six core functions: Govern, Identify, Protect, Detect, Respond, Recover. Version 2.0 adds supply chain guidance.',
    url: 'https://www.nist.gov/cyberframework'
  },
  'pci-dss': {
    desc: 'Security requirements for organizations that store, process, or transmit cardholder data. v4.0.1 introduced customized implementation options and expanded multi-factor authentication requirements.',
    url: 'https://www.pcisecuritystandards.org/'
  },
  'soc2': {
    desc: 'AICPA attestation framework for service organizations covering five Trust Services Criteria: security, availability, processing integrity, confidentiality, and privacy.',
    url: 'https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services'
  },
  'stig': {
    desc: 'DISA Security Technical Implementation Guides provide prescriptive hardening requirements for information systems. The M365 STIG covers configurations required for DoD cloud deployments.',
    url: 'https://public.cyber.mil/stigs/'
  }
};
const DOMAIN_ORDER = ['Entra ID', 'Conditional Access', 'Enterprise Apps', 'Exchange Online', 'Intune', 'Defender', 'Purview / Compliance', 'SharePoint & OneDrive', 'Teams', 'Forms', 'Power BI', 'Active Directory', 'SOC 2', 'Value Opportunity', 'Other'];

// --------------------- SVG icons ---------------------
const Icon = {
  search: () => /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "7",
    cy: "7",
    r: "5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M11 11l3 3"
  })),
  moon: () => /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 16 16",
    fill: "currentColor"
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("mask", {
    id: "mm"
  }, /*#__PURE__*/React.createElement("rect", {
    width: "16",
    height: "16",
    fill: "white"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "10",
    cy: "5",
    r: "4.5",
    fill: "black"
  }))), /*#__PURE__*/React.createElement("circle", {
    cx: "7.5",
    cy: "8",
    r: "5.5",
    mask: "url(#mm)"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12.5",
    cy: "3.5",
    r: "1",
    opacity: ".5"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "14",
    cy: "7",
    r: ".6",
    opacity: ".35"
  })),
  sun: () => /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 16 16",
    fill: "currentColor"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "8",
    cy: "8",
    r: "3.2"
  }), /*#__PURE__*/React.createElement("g", {
    stroke: "currentColor",
    strokeWidth: "1.4",
    strokeLinecap: "round",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M12.4 3.6l-1.3 1.3M4.9 11.1l-1.3 1.3"
  }))),
  print: () => /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M4 5V2h8v3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M4 13H2V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6h-2"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "4",
    y: "10",
    width: "8",
    height: "4"
  })),
  xlsx: () => /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "2.5",
    y: "2.5",
    width: "11",
    height: "11",
    rx: "1.5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M5 6l2.5 4M7.5 6L5 10M9.5 6v4M11 9h-1.5"
  })),
  sliders: () => /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M3 5h10M3 11h10"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "6",
    cy: "5",
    r: "1.5",
    fill: "currentColor",
    stroke: "none"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "10",
    cy: "11",
    r: "1.5",
    fill: "currentColor",
    stroke: "none"
  })),
  chevron: () => /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M6 4l4 4-4 4"
  })),
  download: () => /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M8 2v8M5 7l3 3 3-3M2 12v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1"
  })),
  menu: () => /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2 4h12M2 8h12M2 12h12"
  })),
  close: () => /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M3 3l10 10M13 3L3 13"
  }))
};

// Status -> CSS chip class name. See docs/CHECK-STATUS-MODEL.md for semantics.
const STATUS_COLORS = {
  Fail: 'fail',
  Warning: 'warn',
  Pass: 'pass',
  Review: 'review',
  Info: 'info',
  Skipped: 'skipped',
  Unknown: 'unknown',
  NotApplicable: 'notapplicable',
  NotLicensed: 'notlicensed'
};

// Short display label for the inline status-badge in narrow table columns.
// The data value (status key) is unchanged; only the rendered text differs.
// Filter chips use longer friendly labels via the statusChips array's third
// element (see FilterBar).
const STATUS_LABEL = {
  NotApplicable: 'N/A',
  NotLicensed: 'No License'
};
const statusLabel = s => STATUS_LABEL[s] || s;
const SEV_LABEL = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: '—',
  info: 'Info'
};

// --------------------- Helpers ---------------------
const pct = (n, d) => d ? Math.round(n / d * 100) : 0;

// Pass% denominator per docs/CHECK-STATUS-MODEL.md (#802):
//   Pass% = Pass / (Pass + Fail + Warning)
// All other statuses (Review, Info, Skipped, Unknown, NotApplicable, NotLicensed)
// are excluded from BOTH numerator and denominator -- not-collected results
// can never inflate or deflate the score.
const SCORED_STATUSES = new Set(['Pass', 'Fail', 'Warning']);
const scoreDenom = arr => (arr || []).filter(f => SCORED_STATUSES.has(f.status)).length;
const fmt = n => Number(n).toLocaleString();

// ======================== Sidebar ========================
function Sidebar({
  active,
  activeSubsection,
  counts,
  domainCounts,
  activeDomain,
  onDomainJump,
  onOverviewClick,
  navOpen,
  onClose
}) {
  const [roadmapOpen, setRoadmapOpen] = useState(false);
  const [domainNavOpen, setDomainNavOpen] = useState(false);
  const [domainsCollapsed, setDomainsCollapsed] = useState(true);
  function toggleRoadmap(e) {
    e.preventDefault();
    e.stopPropagation();
    setRoadmapOpen(o => !o);
  }
  function toggleDomainNav(e) {
    e.preventDefault();
    e.stopPropagation();
    setDomainNavOpen(o => !o);
  }
  const DOM_ORDER = ['Entra ID', 'Conditional Access', 'Enterprise Apps', 'Exchange Online', 'Intune', 'Defender', 'Purview / Compliance', 'SharePoint & OneDrive', 'Teams', 'Forms', 'Power BI', 'Active Directory', 'SOC 2', 'Value Opportunity'];
  const domains = DOM_ORDER.filter(d => domainCounts.total[d]).concat(Object.keys(domainCounts.total).filter(d => !DOM_ORDER.includes(d)).sort());
  const exec = [{
    id: 'overview',
    label: 'Overview'
  }, {
    id: 'posture',
    label: 'Posture score'
  }, {
    id: 'frameworks',
    label: 'Frameworks'
  }, {
    id: 'identity',
    label: 'Domain posture'
  }];
  const details = [{
    id: 'findings',
    label: 'All findings',
    count: counts.total
  }, {
    id: 'roadmap',
    label: 'Remediation roadmap'
  }, {
    id: 'appendix',
    label: 'Appendix · tenant'
  }];
  const isMobile = () => window.matchMedia('(max-width: 720px)').matches;
  const closeIfMobile = () => {
    if (isMobile()) onClose();
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: 'sidebar-overlay' + (navOpen ? ' open' : ''),
    onClick: onClose
  }), /*#__PURE__*/React.createElement("aside", {
    className: 'sidebar' + (navOpen ? ' open' : '')
  }, /*#__PURE__*/React.createElement("div", {
    className: "brand"
  }, /*#__PURE__*/React.createElement("div", {
    className: "brand-mark"
  }, "M"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "brand-name"
  }, "M365 Assess"), /*#__PURE__*/React.createElement("div", {
    className: "brand-sub"
  }, "Security Report")), /*#__PURE__*/React.createElement("button", {
    className: "sidebar-close",
    onClick: onClose,
    "aria-label": "Close navigation"
  }, /*#__PURE__*/React.createElement(Icon.close, null))), /*#__PURE__*/React.createElement("nav", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "nav-label"
  }, "Executive"), exec.map(it => /*#__PURE__*/React.createElement(React.Fragment, {
    key: it.id
  }, /*#__PURE__*/React.createElement("a", {
    href: `#${it.id}`,
    onClick: e => {
      if (it.id === 'overview') {
        e.preventDefault();
        onOverviewClick();
      }
      closeIfMobile();
    },
    className: 'nav-item' + (active === it.id ? ' active' : '')
  }, /*#__PURE__*/React.createElement("span", null, it.label), it.id === 'identity' && /*#__PURE__*/React.createElement("span", {
    className: "nav-expand-icon",
    onClick: toggleDomainNav
  }, domainNavOpen || active === 'identity' ? '\u2212' : '+')), it.id === 'identity' && (domainNavOpen || active === 'identity') && /*#__PURE__*/React.createElement("div", {
    className: "nav-subitems"
  }, FINDINGS.some(f => f.domain === 'Intune') && /*#__PURE__*/React.createElement("a", {
    href: "#identity-intune",
    className: 'nav-subitem' + (activeSubsection === 'identity-intune' ? ' active' : ''),
    onClick: closeIfMobile
  }, "Intune coverage"), FINDINGS.some(f => f.domain === 'SharePoint & OneDrive') && /*#__PURE__*/React.createElement("a", {
    href: "#identity-sharepoint",
    className: 'nav-subitem' + (activeSubsection === 'identity-sharepoint' ? ' active' : ''),
    onClick: closeIfMobile
  }, "SharePoint & OneDrive"), D.adHybrid && /*#__PURE__*/React.createElement("a", {
    href: "#identity-ad",
    className: 'nav-subitem' + (activeSubsection === 'identity-ad' ? ' active' : ''),
    onClick: closeIfMobile
  }, "AD & hybrid"), (D.dns || []).length > 0 && /*#__PURE__*/React.createElement("a", {
    href: "#identity-email",
    className: 'nav-subitem' + (activeSubsection === 'identity-email' ? ' active' : ''),
    onClick: closeIfMobile
  }, "Email auth")))), /*#__PURE__*/React.createElement("div", {
    className: "nav-label nav-label-collapsible",
    style: {
      marginTop: 14
    },
    onClick: () => setDomainsCollapsed(c => !c)
  }, /*#__PURE__*/React.createElement("span", null, "Domains"), /*#__PURE__*/React.createElement("span", {
    className: "nav-label-chev"
  }, domainsCollapsed ? '+' : '−')), !domainsCollapsed && domains.map(d => {
    const fails = domainCounts.fail[d] || 0;
    const total = domainCounts.total[d] || 0;
    return /*#__PURE__*/React.createElement("a", {
      href: "#findings-anchor",
      key: d,
      onClick: e => {
        e.preventDefault();
        onDomainJump(d);
        closeIfMobile();
      },
      className: 'nav-item' + (activeDomain === d ? ' active' : '')
    }, /*#__PURE__*/React.createElement("span", null, d), /*#__PURE__*/React.createElement("span", {
      className: 'count' + (fails ? ' pill-fail' : '')
    }, fails || total));
  }), /*#__PURE__*/React.createElement("div", {
    className: "nav-label nav-label-emphasis",
    style: {
      marginTop: 14
    }
  }, "Findings & action"), details.map(it => /*#__PURE__*/React.createElement(React.Fragment, {
    key: it.id
  }, /*#__PURE__*/React.createElement("a", {
    href: `#${it.id}`,
    onClick: e => {
      if (it.id === 'findings') onDomainJump(null);
      closeIfMobile();
    },
    className: 'nav-item' + (active === it.id && !(it.id === 'findings' && activeDomain) ? ' active' : '')
  }, /*#__PURE__*/React.createElement("span", null, it.label), it.id === 'roadmap' ? /*#__PURE__*/React.createElement("span", {
    className: "nav-expand-icon",
    onClick: toggleRoadmap
  }, roadmapOpen || active === 'roadmap' ? '\u2212' : '+') : it.count !== undefined && /*#__PURE__*/React.createElement("span", {
    className: "count"
  }, it.count)), it.id === 'roadmap' && (roadmapOpen || active === 'roadmap') && /*#__PURE__*/React.createElement("div", {
    className: "nav-subitems"
  }, /*#__PURE__*/React.createElement("a", {
    href: "#roadmap-now",
    className: "nav-subitem"
  }, "Now   ", /*#__PURE__*/React.createElement("span", {
    className: "count"
  }, ROADMAP_COUNTS.now)), /*#__PURE__*/React.createElement("a", {
    href: "#roadmap-next",
    className: "nav-subitem"
  }, "Next  ", /*#__PURE__*/React.createElement("span", {
    className: "count"
  }, ROADMAP_COUNTS.soon)), /*#__PURE__*/React.createElement("a", {
    href: "#roadmap-later",
    className: "nav-subitem"
  }, "Later ", /*#__PURE__*/React.createElement("span", {
    className: "count"
  }, ROADMAP_COUNTS.later)))))), /*#__PURE__*/React.createElement("div", {
    className: "sidebar-cards"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sc-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sc-header"
  }, /*#__PURE__*/React.createElement("span", {
    className: "sc-dot",
    style: {
      background: 'var(--success)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "sc-title"
  }, "TENANT"), /*#__PURE__*/React.createElement("span", {
    className: "sc-sub"
  }, "\xB7 SNAPSHOT")), /*#__PURE__*/React.createElement("div", {
    className: "sc-row"
  }, /*#__PURE__*/React.createElement("span", null, "org"), /*#__PURE__*/React.createElement("span", null, TENANT.DefaultDomain || TENANT.OrgDisplayName)), /*#__PURE__*/React.createElement("div", {
    className: "sc-row"
  }, /*#__PURE__*/React.createElement("span", null, "tenant"), /*#__PURE__*/React.createElement("span", null, (TENANT.TenantId || '').slice(0, 8) + '…')), TENANT.tenantAgeYears != null && /*#__PURE__*/React.createElement("div", {
    className: "sc-row"
  }, /*#__PURE__*/React.createElement("span", null, "age"), /*#__PURE__*/React.createElement("span", null, TENANT.tenantAgeYears, " yrs")), /*#__PURE__*/React.createElement("div", {
    className: "sc-row"
  }, /*#__PURE__*/React.createElement("span", null, "users"), /*#__PURE__*/React.createElement("span", null, fmt(USERS.TotalUsers))), /*#__PURE__*/React.createElement("div", {
    className: "sc-row sc-row-indent"
  }, /*#__PURE__*/React.createElement("span", null, "licensed"), /*#__PURE__*/React.createElement("span", null, fmt(USERS.Licensed))), /*#__PURE__*/React.createElement("div", {
    className: "sc-row sc-row-indent"
  }, /*#__PURE__*/React.createElement("span", null, "guests"), /*#__PURE__*/React.createElement("span", null, fmt(USERS.GuestUsers))), USERS.SyncedFromOnPrem > 0 && /*#__PURE__*/React.createElement("div", {
    className: "sc-row sc-row-indent"
  }, /*#__PURE__*/React.createElement("span", null, "synced"), /*#__PURE__*/React.createElement("span", null, fmt(USERS.SyncedFromOnPrem))), USERS.DisabledUsers > 0 && /*#__PURE__*/React.createElement("div", {
    className: "sc-row sc-row-indent"
  }, /*#__PURE__*/React.createElement("span", null, "disabled"), /*#__PURE__*/React.createElement("span", {
    className: "sc-warn"
  }, fmt(USERS.DisabledUsers))), USERS.NeverSignedIn > 0 && /*#__PURE__*/React.createElement("div", {
    className: "sc-row sc-row-indent"
  }, /*#__PURE__*/React.createElement("span", null, "never signed in"), /*#__PURE__*/React.createElement("span", {
    className: "sc-warn"
  }, fmt(USERS.NeverSignedIn))), USERS.StaleMember > 0 && /*#__PURE__*/React.createElement("div", {
    className: "sc-row sc-row-indent"
  }, /*#__PURE__*/React.createElement("span", null, "stale"), /*#__PURE__*/React.createElement("span", {
    className: "sc-warn"
  }, fmt(USERS.StaleMember))), D.deviceStats != null && (() => {
    const ds = D.deviceStats;
    const other = Math.max(0, ds.total - ds.compliant - ds.nonCompliant);
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "sc-row"
    }, /*#__PURE__*/React.createElement("span", null, "devices"), /*#__PURE__*/React.createElement("span", null, fmt(ds.total))), ds.compliant > 0 && /*#__PURE__*/React.createElement("div", {
      className: "sc-row sc-row-indent"
    }, /*#__PURE__*/React.createElement("span", null, "compliant"), /*#__PURE__*/React.createElement("span", {
      className: "sc-good"
    }, fmt(ds.compliant))), ds.nonCompliant > 0 && /*#__PURE__*/React.createElement("div", {
      className: "sc-row sc-row-indent"
    }, /*#__PURE__*/React.createElement("span", null, "non-compliant"), /*#__PURE__*/React.createElement("span", {
      className: "sc-danger"
    }, fmt(ds.nonCompliant))), other > 0 && /*#__PURE__*/React.createElement("div", {
      className: "sc-row sc-row-indent",
      title: "Grace period, error, unknown, or not-applicable states"
    }, /*#__PURE__*/React.createElement("span", null, "other state"), /*#__PURE__*/React.createElement("span", {
      className: "sc-warn"
    }, fmt(other))));
  })()), /*#__PURE__*/React.createElement("div", {
    className: "sc-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sc-header"
  }, /*#__PURE__*/React.createElement("span", {
    className: "sc-dot",
    style: {
      background: MFA_STATS.adminsWithoutMfa > 0 ? 'var(--warn)' : 'var(--success)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "sc-title"
  }, "MFA"), /*#__PURE__*/React.createElement("span", {
    className: "sc-sub"
  }, "\xB7 COVERAGE")), MFA_STATS.phishResistant > 0 && /*#__PURE__*/React.createElement("div", {
    className: "sc-row"
  }, /*#__PURE__*/React.createElement("span", null, "phish-res"), /*#__PURE__*/React.createElement("span", null, fmt(MFA_STATS.phishResistant))), MFA_STATS.standard > 0 && /*#__PURE__*/React.createElement("div", {
    className: "sc-row"
  }, /*#__PURE__*/React.createElement("span", null, "standard"), /*#__PURE__*/React.createElement("span", null, fmt(MFA_STATS.standard))), MFA_STATS.weak > 0 && /*#__PURE__*/React.createElement("div", {
    className: "sc-row"
  }, /*#__PURE__*/React.createElement("span", null, "weak"), /*#__PURE__*/React.createElement("span", {
    className: "sc-warn"
  }, fmt(MFA_STATS.weak))), /*#__PURE__*/React.createElement("div", {
    className: "sc-row"
  }, /*#__PURE__*/React.createElement("span", null, "none"), /*#__PURE__*/React.createElement("span", {
    className: MFA_STATS.none > 0 ? 'sc-danger' : ''
  }, fmt(MFA_STATS.none))), MFA_STATS.adminsWithoutMfa > 0 && /*#__PURE__*/React.createElement("div", {
    className: "sc-row"
  }, /*#__PURE__*/React.createElement("span", null, "adm gap"), /*#__PURE__*/React.createElement("span", {
    className: "sc-danger"
  }, fmt(MFA_STATS.adminsWithoutMfa)))))));
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
    onKeyDown: e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(o => !o);
      }
    }
  };
  return {
    open,
    headProps
  };
}

// ======================== Topbar ========================
function Topbar({
  search,
  setSearch,
  searchMatches,
  matchIdx,
  onAdvanceMatch,
  onRetreatMatch,
  mode,
  setMode,
  theme,
  setTheme,
  textScale,
  setTextScale,
  onPrint,
  onTweaks,
  onHamburger,
  editMode,
  onEditToggle,
  onFinalize,
  onReset,
  hiddenCount
}) {
  const SCALE_CYCLE = ['normal', 'large', 'xlarge'];
  const cycleScale = () => setTextScale(s => SCALE_CYCLE[(SCALE_CYCLE.indexOf(s) + 1) % SCALE_CYCLE.length] || 'normal');
  const scaleLabel = {
    normal: 'A',
    large: 'A+',
    xlarge: 'A++'
  }[textScale] || 'A';
  const scaleTitle = `Text size: ${textScale} (click to cycle)`;
  return /*#__PURE__*/React.createElement(React.Fragment, null, editMode && /*#__PURE__*/React.createElement("div", {
    className: "edit-toolbar"
  }, /*#__PURE__*/React.createElement("span", {
    className: "edit-toolbar-badge"
  }, "\u270E Edit Mode"), hiddenCount > 0 && /*#__PURE__*/React.createElement("span", {
    className: "edit-toolbar-info"
  }, hiddenCount, " finding", hiddenCount === 1 ? '' : 's', " hidden"), /*#__PURE__*/React.createElement("button", {
    className: "edit-toolbar-reset",
    onClick: onReset
  }, "\u21BA Reset all"), /*#__PURE__*/React.createElement("button", {
    className: "edit-toolbar-finalize",
    onClick: onFinalize
  }, "\u2193 Finalize report"), /*#__PURE__*/React.createElement("button", {
    className: "edit-toolbar-exit",
    onClick: onEditToggle
  }, "\u2715 Exit edit mode")), /*#__PURE__*/React.createElement("div", {
    className: "topbar"
  }, /*#__PURE__*/React.createElement("button", {
    className: "hamburger-btn",
    onClick: onHamburger,
    "aria-label": "Open navigation"
  }, /*#__PURE__*/React.createElement(Icon.menu, null)), /*#__PURE__*/React.createElement("div", {
    className: "title"
  }, "Security posture report", /*#__PURE__*/React.createElement("span", {
    className: "title-sub"
  }, "\xB7 ", TENANT.OrgDisplayName)), /*#__PURE__*/React.createElement("div", {
    className: "spacer"
  }), /*#__PURE__*/React.createElement("div", {
    className: "search"
  }, /*#__PURE__*/React.createElement(Icon.search, null), /*#__PURE__*/React.createElement("input", {
    value: search,
    onChange: e => setSearch(e.target.value),
    onKeyDown: e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) onRetreatMatch?.();else onAdvanceMatch?.();
      } else if (e.key === 'Escape') {
        setSearch('');
      }
    },
    placeholder: "Search findings, check IDs, remediation\u2026 (Enter to cycle)"
  }), search && /*#__PURE__*/React.createElement("span", {
    className: 'search-counter' + ((searchMatches || []).length === 0 ? ' is-empty' : '')
  }, (searchMatches || []).length === 0 ? '0/0' : matchIdx + 1 + '/' + searchMatches.length), /*#__PURE__*/React.createElement("kbd", null, "/")), /*#__PURE__*/React.createElement("div", {
    className: "palette-switch"
  }, /*#__PURE__*/React.createElement("button", {
    className: theme === 'neon' ? 'active' : '',
    onClick: () => setTheme('neon')
  }, "Neon"), /*#__PURE__*/React.createElement("button", {
    className: theme === 'console' ? 'active' : '',
    onClick: () => setTheme('console')
  }, "Console"), /*#__PURE__*/React.createElement("button", {
    className: theme === 'saas' ? 'active' : '',
    onClick: () => setTheme('saas')
  }, "Vibe"), /*#__PURE__*/React.createElement("button", {
    className: theme === 'high-contrast' ? 'active' : '',
    onClick: () => setTheme('high-contrast')
  }, "High Contrast")), /*#__PURE__*/React.createElement("div", {
    className: "icon-btn-group"
  }, /*#__PURE__*/React.createElement("button", {
    className: 'icon-btn text-scale-btn scale-' + textScale,
    title: scaleTitle,
    onClick: cycleScale
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      fontSize: 13,
      letterSpacing: '-0.02em'
    }
  }, scaleLabel)), /*#__PURE__*/React.createElement("button", {
    className: "icon-btn",
    title: mode === 'dark' ? 'Light mode' : 'Dark mode',
    onClick: () => setMode(mode === 'dark' ? 'light' : 'dark')
  }, mode === 'dark' ? /*#__PURE__*/React.createElement(Icon.sun, null) : /*#__PURE__*/React.createElement(Icon.moon, null)), D.xlsxFileName && /*#__PURE__*/React.createElement("a", {
    className: "icon-btn",
    href: D.xlsxFileName,
    download: true,
    title: `Download compliance matrix — ${D.xlsxFileName}`
  }, /*#__PURE__*/React.createElement(Icon.xlsx, null)), /*#__PURE__*/React.createElement("button", {
    className: "icon-btn",
    title: "Print / PDF",
    onClick: onPrint
  }, /*#__PURE__*/React.createElement(Icon.print, null)), /*#__PURE__*/React.createElement("button", {
    className: "icon-btn",
    title: "Tweaks",
    onClick: onTweaks
  }, /*#__PURE__*/React.createElement(Icon.sliders, null)))));
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
  return Math.round(pass / denom * 100);
};
const computeComplianceReadinessScore = arr => {
  // Compliance lens: count Review (manual-validation findings) AS Pass-equivalent
  // since "needs review" usually means "the auditor will accept it with attestation."
  // Excludes Skipped/Unknown/NotApplicable/NotLicensed -- you can't be ready for
  // a control you literally cannot assess.
  const items = (arr || []).filter(f => ['Pass', 'Fail', 'Warning', 'Review'].includes(f.status));
  if (items.length === 0) return null;
  const ready = items.filter(f => f.status === 'Pass' || f.status === 'Review').length;
  return Math.round(ready / items.length * 100);
};
const computeLicenseAdjustedScore = arr => {
  // Strips out NotLicensed entirely from BOTH numerator and denominator. SMBs
  // without E5 don't get penalised for E5-only controls they cannot enable.
  const items = (arr || []).filter(f => SCORED_STATUSES.has(f.status) && f.status !== 'NotLicensed');
  if (items.length === 0) return null;
  const pass = items.filter(f => f.status === 'Pass').length;
  return Math.round(pass / items.length * 100);
};
// 3 list views (return an array of findings, sorted/filtered for the workflow):
const getQuickWins = arr => {
  // Fail status × low effort, sorted by severity (critical > high > medium > low > none).
  const sevOrder = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    none: 4,
    info: 5
  };
  return (arr || []).filter(f => f.status === 'Fail' && (f.effort === 'small' || f.effort === 'low')).sort((a, b) => (sevOrder[a.severity] ?? 99) - (sevOrder[b.severity] ?? 99));
};
const getRequiresLicensing = arr => (arr || []).filter(f => f.status === 'NotLicensed');
const getManualValidation = arr => (arr || []).filter(f => f.status === 'Review');
const SCORING_VIEWS = [{
  id: 'security-risk',
  label: 'Security Risk',
  kind: 'score',
  compute: computeSecurityRiskScore,
  blurb: 'Strict rule: Pass / (Pass + Fail + Warning). Matches the headline.'
}, {
  id: 'compliance',
  label: 'Compliance Readiness',
  kind: 'score',
  compute: computeComplianceReadinessScore,
  blurb: 'Counts Review-status findings as ready (auditor will accept with attestation).'
}, {
  id: 'license-adjusted',
  label: 'License-Adjusted',
  kind: 'score',
  compute: computeLicenseAdjustedScore,
  blurb: 'Excludes NotLicensed from both numerator and denominator -- fair to SMBs without E5.'
}, {
  id: 'quick-wins',
  label: 'Quick Wins',
  kind: 'list',
  collect: getQuickWins,
  blurb: 'Failing controls with small remediation effort, sorted by severity.'
}, {
  id: 'requires-licensing',
  label: 'Requires Licensing',
  kind: 'list',
  collect: getRequiresLicensing,
  blurb: 'Findings blocked by missing license SKUs -- candidates for upgrade discussion.'
}, {
  id: 'manual-validation',
  label: 'Manual Validation',
  kind: 'list',
  collect: getManualValidation,
  blurb: 'Review-status findings that need human verification (audit log review, evidence collection).'
}];
function ScoringViews() {
  const [active, setActive] = useState('security-risk');
  const view = SCORING_VIEWS.find(v => v.id === active) || SCORING_VIEWS[0];
  let body;
  if (view.kind === 'score') {
    const value = view.compute(FINDINGS);
    body = /*#__PURE__*/React.createElement("div", {
      className: "scoring-view-body"
    }, /*#__PURE__*/React.createElement("div", {
      className: "scoring-view-num"
    }, value === null ? '—' : `${value}%`), /*#__PURE__*/React.createElement("div", {
      className: "scoring-view-blurb"
    }, view.blurb));
  } else {
    const items = view.collect(FINDINGS);
    body = /*#__PURE__*/React.createElement("div", {
      className: "scoring-view-body"
    }, /*#__PURE__*/React.createElement("div", {
      className: "scoring-view-blurb"
    }, view.blurb), items.length === 0 ? /*#__PURE__*/React.createElement("div", {
      className: "scoring-view-empty"
    }, "No findings match this view.") : /*#__PURE__*/React.createElement("ul", {
      className: "scoring-view-list"
    }, items.slice(0, 8).map(f => /*#__PURE__*/React.createElement("li", {
      key: f.checkId
    }, /*#__PURE__*/React.createElement("span", {
      className: 'sev-pill sev-' + (f.severity || 'medium')
    }, f.severity || 'medium'), /*#__PURE__*/React.createElement("a", {
      href: "#findings-anchor",
      onClick: e => {
        e.preventDefault();
        document.getElementById('findings-anchor')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    }, f.setting), /*#__PURE__*/React.createElement("span", {
      className: "scoring-view-domain"
    }, f.domain))), items.length > 8 && /*#__PURE__*/React.createElement("li", {
      className: "scoring-view-more"
    }, "+ ", items.length - 8, " more \u2014 see ", /*#__PURE__*/React.createElement("a", {
      href: "#findings-anchor",
      onClick: e => {
        e.preventDefault();
        document.getElementById('findings-anchor')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    }, "findings table"))));
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "scoring-views"
  }, /*#__PURE__*/React.createElement("div", {
    className: "scoring-views-tabs",
    role: "tablist"
  }, SCORING_VIEWS.map(v => /*#__PURE__*/React.createElement("button", {
    key: v.id,
    role: "tab",
    "aria-selected": v.id === active,
    className: 'scoring-views-tab' + (v.id === active ? ' active' : ''),
    onClick: () => setActive(v.id)
  }, v.label))), body);
}

// ======================== Permissions panel (#812 B2 followup) ========================
// Renders the deficit map written by Test-GraphPermissions / Test-GraphAppRolePermissions.
// Source: window.REPORT_DATA.permissions; null when the assessment ran without
// the deficit-write seam (older runs, SkipConnection mode, etc.).
function PermissionsPanel() {
  const p = D.permissions;
  if (!p || !p.sections) return null;
  const sections = Object.entries(p.sections);
  const allOk = sections.every(([, s]) => s.ok);
  return /*#__PURE__*/React.createElement("section", {
    className: "permissions-panel",
    id: "permissions"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-header"
  }, /*#__PURE__*/React.createElement("h2", null, "Permissions"), /*#__PURE__*/React.createElement("div", {
    className: "section-sub"
  }, p.authMode, " auth | ", sections.length, " section", sections.length === 1 ? '' : 's', " checked | ", allOk ? 'all granted' : `${(p.missing || []).length} role(s) missing`)), /*#__PURE__*/React.createElement("table", {
    className: "permissions-table"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Section"), /*#__PURE__*/React.createElement("th", null, "Required"), /*#__PURE__*/React.createElement("th", null, "Missing"), /*#__PURE__*/React.createElement("th", null, "Status"))), /*#__PURE__*/React.createElement("tbody", null, sections.map(([name, s]) => /*#__PURE__*/React.createElement("tr", {
    key: name
  }, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("strong", null, name)), /*#__PURE__*/React.createElement("td", null, s.required && s.required.length ? s.required.join(', ') : /*#__PURE__*/React.createElement("span", {
    className: "muted"
  }, "none")), /*#__PURE__*/React.createElement("td", null, s.missing && s.missing.length ? s.missing.map((m, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    className: "status-badge unknown"
  }, m)) : /*#__PURE__*/React.createElement("span", {
    className: "muted"
  }, "\u2014")), /*#__PURE__*/React.createElement("td", null, s.ok ? /*#__PURE__*/React.createElement("span", {
    className: "status-badge pass"
  }, "OK") : /*#__PURE__*/React.createElement("span", {
    className: "status-badge fail"
  }, "deficit")))))));
}

// ======================== Posture hero ========================
function Posture() {
  const score = parseFloat(SCORE.Percentage);
  const avg = parseFloat(SCORE.AverageComparativeScore);
  const delta = (score - avg).toFixed(1);
  const deltaPos = parseFloat(delta) >= 0;
  const fail = FINDINGS.filter(f => f.status === 'Fail').length;
  const warn = FINDINGS.filter(f => f.status === 'Warning').length;
  const pass = FINDINGS.filter(f => f.status === 'Pass').length;
  const review = FINDINGS.filter(f => f.status === 'Review').length;
  const critical = FINDINGS.filter(f => f.severity === 'critical').length;
  return /*#__PURE__*/React.createElement("section", {
    className: "block",
    id: "posture"
  }, /*#__PURE__*/React.createElement("div", {
    className: "posture-grid"
  }, /*#__PURE__*/React.createElement("div", {
    className: "score-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "score-eyebrow"
  }, "Microsoft Secure Score"), /*#__PURE__*/React.createElement("div", {
    className: "score-headline"
  }, /*#__PURE__*/React.createElement("span", {
    className: "score-num"
  }, score.toFixed(1)), /*#__PURE__*/React.createElement("span", {
    className: "score-denom"
  }, "/ 100%"), /*#__PURE__*/React.createElement("span", {
    className: 'score-delta ' + (deltaPos ? '' : 'neg')
  }, deltaPos ? '▲' : '▼', " ", Math.abs(delta), " pts vs peers")), /*#__PURE__*/React.createElement("div", {
    className: "score-label"
  }, fmt(SCORE.CurrentScore), " of ", fmt(SCORE.MaxScore), " points achieved. Peer average is ", avg.toFixed(1), "%."), /*#__PURE__*/React.createElement("div", {
    className: "score-bar"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: score + '%'
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "bench",
    style: {
      left: avg + '%'
    },
    title: `Peer avg ${avg}%`
  })), /*#__PURE__*/React.createElement("div", {
    className: "score-footnote"
  }, /*#__PURE__*/React.createElement("span", null, "0"), /*#__PURE__*/React.createElement("span", null, "Peer avg \xB7 ", avg.toFixed(1), "%"), /*#__PURE__*/React.createElement("span", null, "100")), /*#__PURE__*/React.createElement(Sparkline, {
    scores: D.score,
    avg: avg
  }), SCORE.MicrosoftScore != null && SCORE.CustomerScore != null && SCORE.MicrosoftScore > 0 && /*#__PURE__*/React.createElement("div", {
    className: "score-split"
  }, /*#__PURE__*/React.createElement("div", {
    className: "score-split-item"
  }, /*#__PURE__*/React.createElement("div", {
    className: "score-split-label"
  }, "Microsoft-managed"), /*#__PURE__*/React.createElement("div", {
    className: "score-split-value"
  }, fmt(SCORE.MicrosoftScore), " pts")), /*#__PURE__*/React.createElement("div", {
    className: "score-split-item"
  }, /*#__PURE__*/React.createElement("div", {
    className: "score-split-label"
  }, "Customer-earned"), /*#__PURE__*/React.createElement("div", {
    className: "score-split-value"
  }, fmt(SCORE.CustomerScore), " pts")))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "kpi-strip",
    style: {
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: 'kpi ' + (critical ? 'bad' : 'good')
  }, /*#__PURE__*/React.createElement("div", {
    className: "kpi-label"
  }, "Critical findings"), /*#__PURE__*/React.createElement("div", {
    className: "kpi-value"
  }, critical, /*#__PURE__*/React.createElement("span", {
    className: "kpi-suffix"
  }, "open")), /*#__PURE__*/React.createElement("div", {
    className: "kpi-hint"
  }, "Admin, PIM & break-glass exposure"), /*#__PURE__*/React.createElement("div", {
    className: "tiny-bar"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: Math.min(100, critical * 15) + '%',
      background: 'var(--danger)'
    }
  }))), /*#__PURE__*/React.createElement("div", {
    className: "kpi bad"
  }, /*#__PURE__*/React.createElement("div", {
    className: "kpi-label"
  }, "Fails"), /*#__PURE__*/React.createElement("div", {
    className: "kpi-value"
  }, fail), /*#__PURE__*/React.createElement("div", {
    className: "kpi-hint"
  }, "of ", FINDINGS.length, " checks"), /*#__PURE__*/React.createElement("div", {
    className: "tiny-bar"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: pct(fail, scoreDenom(FINDINGS)) + '%',
      background: 'var(--danger)'
    }
  }))), /*#__PURE__*/React.createElement("div", {
    className: "kpi warn"
  }, /*#__PURE__*/React.createElement("div", {
    className: "kpi-label"
  }, "Warnings"), /*#__PURE__*/React.createElement("div", {
    className: "kpi-value"
  }, warn), /*#__PURE__*/React.createElement("div", {
    className: "kpi-hint"
  }, "Review & harden"), /*#__PURE__*/React.createElement("div", {
    className: "tiny-bar"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: pct(warn, scoreDenom(FINDINGS)) + '%',
      background: 'var(--warn)'
    }
  }))), /*#__PURE__*/React.createElement("div", {
    className: "kpi good"
  }, /*#__PURE__*/React.createElement("div", {
    className: "kpi-label"
  }, "Passing"), /*#__PURE__*/React.createElement("div", {
    className: "kpi-value"
  }, pass), /*#__PURE__*/React.createElement("div", {
    className: "kpi-hint"
  }, "Controls validated"), /*#__PURE__*/React.createElement("div", {
    className: "tiny-bar"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: pct(pass, scoreDenom(FINDINGS)) + '%',
      background: 'var(--success)'
    }
  })))), /*#__PURE__*/React.createElement(MFABreakdown, null))), /*#__PURE__*/React.createElement(ExecSummaryRow, null), /*#__PURE__*/React.createElement(ScoringViews, null), critical > 0 && /*#__PURE__*/React.createElement("div", {
    className: "banner"
  }, /*#__PURE__*/React.createElement("div", {
    className: "banner-icon"
  }, "!"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("strong", null, critical, " critical finding", critical === 1 ? '' : 's'), " require immediate remediation.", MFA_STATS.adminsWithoutMfa > 0 && ` ${MFA_STATS.adminsWithoutMfa} admin${MFA_STATS.adminsWithoutMfa === 1 ? ' is' : ' are'} not MFA-enrolled.`, ' ', "Prioritized using CISA KEV and CIS Critical Controls guidance.", ' ', /*#__PURE__*/React.createElement("a", {
    href: "#findings-anchor",
    onClick: e => {
      e.preventDefault();
      document.getElementById('findings-anchor')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  }, "Review in findings table \u2192"))));
}

// ======================== Exec summary row (posture indicators) ========================
function ExecSummaryRow() {
  const allRoles = D['admin-roles'] || [];
  const adminCount = allRoles.length;
  const adminsWithoutMfa = MFA_STATS.adminsWithoutMfa || 0;
  const ds = D.deviceStats;
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
      hint: adminsWithoutMfa > 0 ? `${adminsWithoutMfa} admin${adminsWithoutMfa === 1 ? '' : 's'} without MFA` : 'All admins MFA-enrolled',
      state: adminsWithoutMfa > 0 ? 'bad' : 'good'
    });
  }
  if (ds && ds.total > 0) {
    const compliantPct = Math.round(ds.compliant / ds.total * 100);
    tiles.push({
      label: 'Device compliance',
      primary: compliantPct,
      suffix: '%',
      hint: `${fmt(ds.compliant)} of ${fmt(ds.total)} devices compliant`,
      state: compliantPct >= 90 ? 'good' : compliantPct >= 70 ? 'warn' : 'bad'
    });
  }
  if (dnsTotal > 0) {
    const state = dmarcEnf === dnsTotal ? 'good' : dmarcEnf > 0 ? 'warn' : 'bad';
    tiles.push({
      label: 'Email authentication',
      primary: `${dmarcEnf}/${dnsTotal}`,
      suffix: 'enforced',
      hint: `DMARC p=reject or quarantine across ${dnsTotal} domain${dnsTotal === 1 ? '' : 's'}`,
      state
    });
  }
  const guestState = guests > 0 ? 'warn' : 'good';
  const sharingStateMap = {
    Anyone: 'bad',
    ExternalUserAndGuestSharing: 'warn',
    ExternalUserSharingOnly: 'warn',
    ExistingExternalUserSharingOnly: 'good',
    Disabled: 'good'
  };
  const sharingState = sharingLevel ? sharingStateMap[sharingLevel] || 'warn' : 'good';
  tiles.push({
    label: 'External exposure',
    primary: fmt(guests),
    suffix: guests === 1 ? 'guest' : 'guests',
    hint: sharingLevel ? `SPO sharing · ${sharingLevel}` : 'SPO sharing level unknown',
    state: sharingState === 'bad' || guestState === 'bad' ? 'bad' : sharingState === 'warn' || guestState === 'warn' ? 'warn' : 'good'
  });
  if (!tiles.length) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "exec-summary-row"
  }, tiles.map(t => /*#__PURE__*/React.createElement("div", {
    key: t.label,
    className: 'exec-tile ' + t.state
  }, /*#__PURE__*/React.createElement("div", {
    className: "exec-tile-label"
  }, t.label), /*#__PURE__*/React.createElement("div", {
    className: "exec-tile-value"
  }, t.primary, /*#__PURE__*/React.createElement("span", {
    className: "exec-tile-suffix"
  }, t.suffix)), /*#__PURE__*/React.createElement("div", {
    className: "exec-tile-hint"
  }, t.hint))));
}
function Sparkline({
  scores,
  avg
}) {
  // Graph returns newest-first; reverse to chronological for left→right chart
  const raw = (scores || []).map(s => parseFloat(s.Percentage) || 0).filter(v => v > 0).reverse();
  if (raw.length < 2) return null;

  // Sample down to ≤12 evenly-spaced points to keep the SVG uncluttered
  const n = Math.min(raw.length, 12);
  const pts = n === raw.length ? raw : Array.from({
    length: n
  }, (_, i) => raw[Math.round(i * (raw.length - 1) / (n - 1))]);
  const label = raw.length >= 150 ? '6 MO TREND' : raw.length >= 60 ? '2 MO TREND' : raw.length >= 14 ? '2 WK TREND' : 'RECENT TREND';
  const W = 260,
    H = 50,
    pad = 4;
  const min = Math.min(...pts, avg) - 2,
    max = Math.max(...pts, avg) + 2;
  const sx = i => pad + i / (pts.length - 1) * (W - pad * 2);
  const sy = v => pad + (1 - (v - min) / (max - min)) * (H - pad * 2);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(p).toFixed(1)}`).join(' ');
  const area = d + ` L ${sx(pts.length - 1)},${H - pad} L ${sx(0)},${H - pad} Z`;
  return /*#__PURE__*/React.createElement("div", {
    className: "score-sparkline"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: `0 0 ${W} ${H}`,
    width: "100%",
    height: H,
    preserveAspectRatio: "none"
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("linearGradient", {
    id: "sparkfill",
    x1: "0",
    x2: "0",
    y1: "0",
    y2: "1"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: "var(--accent)",
    stopOpacity: ".28"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: "var(--accent)",
    stopOpacity: "0"
  }))), /*#__PURE__*/React.createElement("line", {
    x1: pad,
    x2: W - pad,
    y1: sy(avg),
    y2: sy(avg),
    stroke: "var(--muted)",
    strokeDasharray: "2 3",
    opacity: ".5"
  }), /*#__PURE__*/React.createElement("path", {
    d: area,
    fill: "url(#sparkfill)"
  }), /*#__PURE__*/React.createElement("path", {
    d: d,
    fill: "none",
    stroke: "var(--accent)",
    strokeWidth: "1.8",
    strokeLinejoin: "round",
    strokeLinecap: "round"
  }), pts.map((p, i) => /*#__PURE__*/React.createElement("circle", {
    key: i,
    cx: sx(i),
    cy: sy(p),
    r: i === pts.length - 1 ? 3 : 1.5,
    fill: i === pts.length - 1 ? 'var(--accent)' : 'var(--surface)',
    stroke: "var(--accent)",
    strokeWidth: "1.5"
  })), /*#__PURE__*/React.createElement("text", {
    x: W - pad,
    y: H - pad,
    textAnchor: "end",
    fontSize: "9",
    fill: "var(--muted)",
    fontFamily: "var(--font-mono)"
  }, label)));
}

// ======================== TrendChart (assessment-to-assessment #642) ========================
function TrendChart() {
  const {
    open,
    headProps
  } = useCollapsibleSection();
  const trend = D.trendData;
  // Issue #750: Posture trend is opt-in. Renders only when the assessment was
  // run with -IncludeTrend (which propagates to D.trendOptIn) AND there are
  // enough snapshots for a meaningful chart.
  if (!D.trendOptIn) return null;
  if (!trend || trend.length < 2) return null;

  // One line per status track (Pass / Warn / Fail) — most informative triple for a quick read.
  // Review / Info / Skipped omitted to keep the chart legible; users who want detail can open
  // Compare-M365Baseline for a pairwise drill-down.
  const tracks = [{
    key: 'pass',
    label: 'Pass',
    color: 'var(--success)'
  }, {
    key: 'warn',
    label: 'Warn',
    color: 'var(--warn)'
  }, {
    key: 'fail',
    label: 'Fail',
    color: 'var(--danger)'
  }];
  const W = 880,
    H = 160,
    padL = 40,
    padR = 12,
    padT = 14,
    padB = 28;
  const innerW = W - padL - padR,
    innerH = H - padT - padB;
  const maxVal = Math.max(...trend.flatMap(s => tracks.map(t => s[t.key] || 0)), 10);
  // Round up to nearest "nice" value for y-axis (multiples of 10, 25, 50, 100)
  const niceMax = maxVal <= 20 ? Math.ceil(maxVal / 5) * 5 : maxVal <= 50 ? Math.ceil(maxVal / 10) * 10 : maxVal <= 200 ? Math.ceil(maxVal / 25) * 25 : Math.ceil(maxVal / 50) * 50;
  const sx = i => padL + i / (trend.length - 1) * innerW;
  const sy = v => padT + (1 - v / niceMax) * innerH;
  const first = new Date(trend[0].savedAt);
  const last = new Date(trend[trend.length - 1].savedAt);
  const daysSpan = Math.round((last - first) / (1000 * 60 * 60 * 24));

  // Y-axis gridlines (3 intermediate + 0 + max)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => niceMax * t);
  return /*#__PURE__*/React.createElement("section", {
    className: "block",
    id: "trend"
  }, /*#__PURE__*/React.createElement("div", headProps, /*#__PURE__*/React.createElement("span", {
    className: "eyebrow"
  }, "01b \xB7 Trend"), /*#__PURE__*/React.createElement("h2", null, "Posture trend"), /*#__PURE__*/React.createElement("span", {
    className: "trend-subtitle"
  }, trend.length, " snapshots \xB7 ", daysSpan, " day", daysSpan === 1 ? '' : 's', " span"), /*#__PURE__*/React.createElement("span", {
    className: "section-chevron",
    "aria-hidden": "true"
  }, open ? '▾' : '▸'), /*#__PURE__*/React.createElement("div", {
    className: "hr"
  })), open && /*#__PURE__*/React.createElement("div", {
    className: "trend-chart-wrap"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: `0 0 ${W} ${H}`,
    width: "100%",
    preserveAspectRatio: "xMidYMid meet",
    className: "trend-chart"
  }, yTicks.map((v, i) => /*#__PURE__*/React.createElement("g", {
    key: i
  }, /*#__PURE__*/React.createElement("line", {
    x1: padL,
    x2: W - padR,
    y1: sy(v),
    y2: sy(v),
    stroke: "var(--border)",
    strokeDasharray: i === 0 ? '' : '2 3',
    opacity: i === 0 ? 0.9 : 0.4
  }), /*#__PURE__*/React.createElement("text", {
    x: padL - 6,
    y: sy(v) + 3,
    textAnchor: "end",
    fontSize: "10",
    fill: "var(--muted)",
    fontFamily: "var(--font-mono)"
  }, v))), trend.map((s, i) => {
    const tickLabel = s.label || new Date(s.savedAt).toLocaleDateString();
    const rotate = trend.length > 5;
    return /*#__PURE__*/React.createElement("text", {
      key: i,
      x: sx(i),
      y: H - padB + 16,
      textAnchor: rotate ? 'end' : 'middle',
      transform: rotate ? `rotate(-30 ${sx(i)} ${H - padB + 16})` : '',
      fontSize: "10",
      fill: "var(--muted)",
      fontFamily: "var(--font-mono)"
    }, tickLabel.length > 14 ? tickLabel.slice(0, 13) + '…' : tickLabel);
  }), tracks.map(t => {
    const pts = trend.map((s, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(s[t.key] || 0).toFixed(1)}`).join(' ');
    return /*#__PURE__*/React.createElement("path", {
      key: t.key,
      d: pts,
      fill: "none",
      stroke: t.color,
      strokeWidth: "2",
      strokeLinejoin: "round",
      strokeLinecap: "round"
    });
  }), trend.map((s, i) => tracks.map(t => /*#__PURE__*/React.createElement("circle", {
    key: `${i}-${t.key}`,
    cx: sx(i),
    cy: sy(s[t.key] || 0),
    r: "3.2",
    fill: "var(--surface)",
    stroke: t.color,
    strokeWidth: "1.8"
  }, /*#__PURE__*/React.createElement("title", null, `${s.label || new Date(s.savedAt).toLocaleDateString()} · ${t.label}: ${s[t.key] || 0} of ${s.total}`))))), /*#__PURE__*/React.createElement("div", {
    className: "trend-legend"
  }, tracks.map(t => /*#__PURE__*/React.createElement("span", {
    key: t.key,
    className: "trend-legend-item"
  }, /*#__PURE__*/React.createElement("span", {
    className: "trend-legend-swatch",
    style: {
      background: t.color
    }
  }), /*#__PURE__*/React.createElement("span", null, t.label))))));
}
function MFABreakdown() {
  const s = MFA_STATS;
  // Exclude mailboxes/service for "identity floor"
  const denomH = s.total; // use raw total; service accounts intentionally none
  return /*#__PURE__*/React.createElement("div", {
    className: "mfa-breakdown"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, "Phish-resistant"), /*#__PURE__*/React.createElement("div", {
    className: "val"
  }, s.phishResistant, /*#__PURE__*/React.createElement("small", null, " / ", fmt(s.total))), /*#__PURE__*/React.createElement("div", {
    className: "prog"
  }, /*#__PURE__*/React.createElement("i", {
    className: "pr-good",
    style: {
      width: pct(s.phishResistant, denomH) + '%'
    }
  }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, "Standard MFA"), /*#__PURE__*/React.createElement("div", {
    className: "val"
  }, s.standard), /*#__PURE__*/React.createElement("div", {
    className: "prog"
  }, /*#__PURE__*/React.createElement("i", {
    className: "pr-ok",
    style: {
      width: pct(s.standard, denomH) + '%'
    }
  }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, "Weak / SMS"), /*#__PURE__*/React.createElement("div", {
    className: "val"
  }, s.weak), /*#__PURE__*/React.createElement("div", {
    className: "prog"
  }, /*#__PURE__*/React.createElement("i", {
    className: "pr-mid",
    style: {
      width: pct(s.weak, denomH) * 8 + '%'
    }
  }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, "No MFA"), /*#__PURE__*/React.createElement("div", {
    className: "val"
  }, s.none), /*#__PURE__*/React.createElement("div", {
    className: "prog"
  }, /*#__PURE__*/React.createElement("i", {
    className: "pr-bad",
    style: {
      width: pct(s.none, denomH) + '%'
    }
  }))));
}

// ======================== DNS auth panel (replaces flat Appendix table) ========================
function DnsAuthPanel() {
  const dns = D.dns || [];
  if (!dns.length) return null;
  const spfPass = dns.filter(r => r.SPF && !r.SPF.includes('Not')).length;
  const dkimPass = dns.filter(r => r.DKIMStatus === 'OK').length;
  const dmarcEnf = dns.filter(r => r.DMARCPolicy === 'reject' || r.DMARCPolicy === 'quarantine').length;
  const dmarcNone = dns.filter(r => r.DMARCPolicy && r.DMARCPolicy.includes('none')).length;
  const dmarcMiss = dns.filter(r => !r.DMARC || r.DMARC.includes('Not') || !r.DMARCPolicy).length;
  const n = dns.length;
  const statCards = [{
    label: 'SPF',
    pass: spfPass,
    total: n
  }, {
    label: 'DKIM',
    pass: dkimPass,
    total: n
  }, {
    label: 'DMARC enforced',
    pass: dmarcEnf,
    total: n
  }];
  const policyClass = p => p === 'reject' || p === 'quarantine' ? 'pass' : p && p.includes('none') ? 'warn' : 'fail';
  const risks = [n - spfPass > 0 && {
    cls: 'fail',
    msg: `${n - spfPass} domain${n - spfPass !== 1 ? 's' : ''} missing SPF`
  }, dmarcNone > 0 && {
    cls: 'warn',
    msg: `${dmarcNone} domain${dmarcNone !== 1 ? 's' : ''} with DMARC p=none`
  }, dmarcMiss > 0 && {
    cls: 'fail',
    msg: `${dmarcMiss} domain${dmarcMiss !== 1 ? 's' : ''} missing DMARC`
  }, n - dkimPass > 0 && {
    cls: 'warn',
    msg: `${n - dkimPass} domain${n - dkimPass !== 1 ? 's' : ''} missing DKIM`
  }].filter(Boolean);
  return /*#__PURE__*/React.createElement("div", {
    className: "card dns-auth-panel",
    style: {
      gridColumn: '1 / -1',
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "dns-panel-label"
  }, "Email authentication posture"), /*#__PURE__*/React.createElement("div", {
    className: "dns-stat-row"
  }, statCards.map(s => /*#__PURE__*/React.createElement("div", {
    key: s.label,
    className: "dns-stat-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "dns-stat-label"
  }, s.label), /*#__PURE__*/React.createElement("div", {
    className: "dns-stat-val"
  }, s.pass, /*#__PURE__*/React.createElement("span", null, "/", s.total)), /*#__PURE__*/React.createElement("div", {
    className: "dns-stat-bar dns-stat-bar-segments"
  }, Array.from({
    length: s.total
  }).map((_, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    className: i < s.pass ? 'seg seg-pass' : 'seg seg-fail'
  }))))), /*#__PURE__*/React.createElement("div", {
    className: "dns-stat-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "dns-stat-label"
  }, "DMARC policy mix"), /*#__PURE__*/React.createElement("div", {
    className: "dns-policy-chips"
  }, dmarcEnf > 0 && /*#__PURE__*/React.createElement("span", {
    className: "dns-policy-chip pass"
  }, dmarcEnf, " enforced"), dmarcNone > 0 && /*#__PURE__*/React.createElement("span", {
    className: "dns-policy-chip warn"
  }, dmarcNone, " monitor"), dmarcMiss > 0 && /*#__PURE__*/React.createElement("span", {
    className: "dns-policy-chip fail"
  }, dmarcMiss, " missing")))), /*#__PURE__*/React.createElement("table", {
    className: "dns-domain-table"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Domain"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'center'
    }
  }, "SPF"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'center'
    }
  }, "DMARC"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'center'
    }
  }, "Policy"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'center'
    }
  }, "DKIM"))), /*#__PURE__*/React.createElement("tbody", null, dns.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", {
    className: "dns-domain-name"
  }, r.Domain), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement(StatusDot, {
    ok: r.SPF && !r.SPF.includes('Not')
  })), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement(StatusDot, {
    ok: r.DMARC && !r.DMARC.includes('Not')
  })), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: 'dns-policy-chip ' + policyClass(r.DMARCPolicy)
  }, r.DMARCPolicy || 'missing')), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement(StatusDot, {
    ok: r.DKIMStatus === 'OK'
  })))))), risks.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "dns-risks"
  }, risks.map((r, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    className: 'dns-risk-chip ' + r.cls
  }, "\u26A0 ", r.msg))));
}

// ======================== Intune category grid ========================
function IntuneCategoryGrid() {
  const intune = FINDINGS.filter(f => f.domain === 'Intune');
  if (!intune.length) return null;
  const CATS = [{
    id: 'COMPLIANCE',
    label: 'Device Compliance',
    re: /^INTUNE-COMPLIANCE/
  }, {
    id: 'DEVICE',
    label: 'Device Config',
    re: /^INTUNE-DEVICE/
  }, {
    id: 'CONFIG',
    label: 'Config Profiles',
    re: /^INTUNE-CONFIG/
  }, {
    id: 'APP',
    label: 'App Protection',
    re: /^INTUNE-APP/
  }, {
    id: 'SECURITY',
    label: 'Security Baselines',
    re: /^INTUNE-SECURITY/
  }, {
    id: 'VPN',
    label: 'VPN / Network',
    re: /^INTUNE-(VPN|WIFI|REMOTE)/
  }, {
    id: 'MEDIA',
    label: 'Removable Media',
    re: /^INTUNE-REMOVABLEMEDIA/
  }, {
    id: 'ENROLLMENT',
    label: 'Enrollment',
    re: /^INTUNE-(ENROLLMENT|ENROLL|INVENTORY|AUTODISC)/
  }, {
    id: 'ENCRYPTION',
    label: 'Encryption',
    re: /^INTUNE-(ENCRYPTION|MOBILEENCRYPT|FIPS)/
  }, {
    id: 'ADMINOPS',
    label: 'Admin & Updates',
    re: /^INTUNE-(RBAC|MAA|WIPEAUDIT|UPDATE|MOBILECODE|PORTSTORAGE)/
  }];
  const buckets = CATS.map(cat => {
    const fs = intune.filter(f => cat.re.test(f.checkId));
    if (!fs.length) return null;
    const pass = fs.filter(f => f.status === 'Pass').length;
    const fail = fs.filter(f => f.status === 'Fail').length;
    const warn = fs.filter(f => f.status === 'Warning').length;
    return {
      ...cat,
      fs,
      pass,
      fail,
      warn,
      score: pct(pass, scoreDenom(fs))
    };
  }).filter(Boolean);
  const seen = new Set(buckets.flatMap(b => b.fs.map(f => f.checkId)));
  const other = intune.filter(f => !seen.has(f.checkId));
  if (other.length) {
    const pass = other.filter(f => f.status === 'Pass').length;
    buckets.push({
      id: 'OTHER',
      label: 'Other',
      fs: other,
      pass,
      fail: other.filter(f => f.status === 'Fail').length,
      warn: other.filter(f => f.status === 'Warning').length,
      score: pct(pass, scoreDenom(other))
    });
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "intune-cat-section"
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel-sublabel"
  }, "Intune coverage by category"), /*#__PURE__*/React.createElement("div", {
    className: "intune-category-grid"
  }, buckets.map(b => /*#__PURE__*/React.createElement("div", {
    key: b.id,
    className: 'intune-cat-card' + (b.fail > 0 ? ' has-fail' : b.warn > 0 ? ' has-warn' : ' all-pass')
  }, /*#__PURE__*/React.createElement("div", {
    className: "icat-label"
  }, b.label), /*#__PURE__*/React.createElement("div", {
    className: "icat-score"
  }, b.score, /*#__PURE__*/React.createElement("span", {
    className: "icat-pct"
  }, "%")), /*#__PURE__*/React.createElement("div", {
    className: "icat-meta"
  }, b.pass, "P \xB7 ", b.fail, "F \xB7 ", b.fs.length), /*#__PURE__*/React.createElement("div", {
    className: "dc-bar",
    style: {
      height: 4,
      marginTop: 6
    }
  }, b.pass > 0 && /*#__PURE__*/React.createElement("i", {
    className: "pass-seg",
    style: {
      flex: b.pass
    }
  }), b.warn > 0 && /*#__PURE__*/React.createElement("i", {
    className: "warn-seg",
    style: {
      flex: b.warn
    }
  }), b.fail > 0 && /*#__PURE__*/React.createElement("i", {
    className: "fail-seg",
    style: {
      flex: b.fail
    }
  }))))));
}

// ======================== Mailbox summary panel ========================
function MailboxSummaryPanel() {
  const mb = D.mailboxSummary || {};
  const mf = D.mailflowStats || {};
  if (!mb.TotalMailboxes) return null;
  const total = mb.TotalMailboxes || 0;
  return /*#__PURE__*/React.createElement("div", {
    className: "domain-sub-panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel-sublabel"
  }, "Exchange Online \xB7 mailbox estate"), /*#__PURE__*/React.createElement("div", {
    className: "kpi-strip",
    style: {
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "kpi"
  }, /*#__PURE__*/React.createElement("div", {
    className: "kpi-label"
  }, "Total mailboxes"), /*#__PURE__*/React.createElement("div", {
    className: "kpi-value"
  }, fmt(total)), /*#__PURE__*/React.createElement("div", {
    className: "kpi-hint"
  }, fmt(mb.UserMailboxes || 0), " user \xB7 ", fmt(mb.SharedMailboxes || 0), " shared"), /*#__PURE__*/React.createElement("div", {
    className: "tiny-bar"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '100%',
      background: 'var(--accent-muted,var(--accent))'
    }
  }))), mb.SharedMailboxes > 0 && /*#__PURE__*/React.createElement("div", {
    className: "kpi"
  }, /*#__PURE__*/React.createElement("div", {
    className: "kpi-label"
  }, "Shared mailboxes"), /*#__PURE__*/React.createElement("div", {
    className: "kpi-value"
  }, fmt(mb.SharedMailboxes)), /*#__PURE__*/React.createElement("div", {
    className: "kpi-hint"
  }, pct(mb.SharedMailboxes, total), "% of estate"), /*#__PURE__*/React.createElement("div", {
    className: "tiny-bar"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: pct(mb.SharedMailboxes, total) + '%'
    }
  }))), mf.transportRules != null && /*#__PURE__*/React.createElement("div", {
    className: 'kpi' + (mf.transportRules > 10 ? ' warn' : '')
  }, /*#__PURE__*/React.createElement("div", {
    className: "kpi-label"
  }, "Transport rules"), /*#__PURE__*/React.createElement("div", {
    className: "kpi-value"
  }, fmt(mf.transportRules)), /*#__PURE__*/React.createElement("div", {
    className: "kpi-hint"
  }, "active rules"), /*#__PURE__*/React.createElement("div", {
    className: "tiny-bar"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: Math.min(100, mf.transportRules * 8) + '%',
      background: mf.transportRules > 10 ? 'var(--warn)' : 'var(--success)'
    }
  }))), mf.inboundConnectors != null && /*#__PURE__*/React.createElement("div", {
    className: "kpi"
  }, /*#__PURE__*/React.createElement("div", {
    className: "kpi-label"
  }, "Mail connectors"), /*#__PURE__*/React.createElement("div", {
    className: "kpi-value"
  }, fmt((mf.inboundConnectors || 0) + (mf.outboundConnectors || 0))), /*#__PURE__*/React.createElement("div", {
    className: "kpi-hint"
  }, mf.inboundConnectors || 0, " in \xB7 ", mf.outboundConnectors || 0, " out"), /*#__PURE__*/React.createElement("div", {
    className: "tiny-bar"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: Math.min(100, ((mf.inboundConnectors || 0) + (mf.outboundConnectors || 0)) * 20) + '%'
    }
  })))));
}

// ======================== SharePoint summary panel ========================
function SharePointSummaryPanel() {
  const spo = FINDINGS.filter(f => f.domain === 'SharePoint & OneDrive');
  if (!spo.length) return null;
  const pass = spo.filter(f => f.status === 'Pass').length;
  const fail = spo.filter(f => f.status === 'Fail').length;
  const warn = spo.filter(f => f.status === 'Warning').length;
  const cfg = D.sharepointConfig || {};
  const sharingLevel = cfg.SharingLevel;
  const sharingColor = sharingLevel === 'Disabled' ? 'var(--success-text)' : sharingLevel?.includes('ExternalUserAndGuestSharing') || sharingLevel === 'Anyone' ? 'var(--danger-text)' : sharingLevel ? 'var(--warn-text,var(--warn))' : 'var(--muted)';
  const SEV_ORDER = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1
  };
  const topFails = spo.filter(f => f.status === 'Fail').sort((a, b) => (SEV_ORDER[b.severity] || 0) - (SEV_ORDER[a.severity] || 0)).slice(0, 3);
  return /*#__PURE__*/React.createElement("div", {
    className: "domain-sub-panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel-sublabel"
  }, "SharePoint & OneDrive posture"), /*#__PURE__*/React.createElement("div", {
    className: "spo-summary-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "spo-stat-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "kpi-label"
  }, "Pass rate"), /*#__PURE__*/React.createElement("div", {
    className: "kpi-value"
  }, pct(pass, scoreDenom(spo)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14
    }
  }, "%")), /*#__PURE__*/React.createElement("div", {
    className: "kpi-hint"
  }, pass, " of ", spo.length, " checks"), /*#__PURE__*/React.createElement("div", {
    className: "tiny-bar"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: pct(pass, scoreDenom(spo)) + '%',
      background: 'var(--success)'
    }
  }))), /*#__PURE__*/React.createElement("div", {
    className: 'spo-stat-card' + (fail > 0 ? ' spo-stat-bad' : '')
  }, /*#__PURE__*/React.createElement("div", {
    className: "kpi-label"
  }, "Failures"), /*#__PURE__*/React.createElement("div", {
    className: "kpi-value"
  }, fail), /*#__PURE__*/React.createElement("div", {
    className: "kpi-hint"
  }, warn, " warnings"), /*#__PURE__*/React.createElement("div", {
    className: "tiny-bar"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: pct(fail, scoreDenom(spo)) + '%',
      background: 'var(--danger)'
    }
  }))), sharingLevel && /*#__PURE__*/React.createElement("div", {
    className: "spo-stat-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "kpi-label"
  }, "External sharing"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      color: sharingColor,
      marginTop: 6,
      lineHeight: 1.3
    }
  }, sharingLevel)), cfg.OneDriveSharingLevel && /*#__PURE__*/React.createElement("div", {
    className: "spo-stat-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "kpi-label"
  }, "OneDrive sharing"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      color: 'var(--text-soft)',
      marginTop: 6,
      lineHeight: 1.3
    }
  }, cfg.OneDriveSharingLevel))), topFails.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "spo-top-fails"
  }, /*#__PURE__*/React.createElement("div", {
    className: "spo-top-fails-label"
  }, "Top gaps"), topFails.map((f, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "spo-fail-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: 'sev-badge ' + f.severity
  }, /*#__PURE__*/React.createElement("span", {
    className: "bar"
  }, /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null)), /*#__PURE__*/React.createElement("span", null, SEV_LABEL[f.severity])), /*#__PURE__*/React.createElement("span", {
    className: "spo-fail-name"
  }, f.setting)))));
}

// ======================== AD / Hybrid panel ========================
function AdHybridPanel() {
  const ad = D.adHybrid;
  if (!ad) return null;
  const adFindings = FINDINGS.filter(f => f.domain === 'Active Directory');
  const pass = adFindings.filter(f => f.status === 'Pass').length;
  const fail = adFindings.filter(f => f.status === 'Fail').length;
  const syncOk = ad.syncEnabled;
  const phsOk = ad.pwHashSync;
  const phsUnknown = phsOk === null || phsOk === undefined;
  const syncColor = syncOk ? 'var(--success-text)' : 'var(--danger-text)';
  const phsColor = phsUnknown ? 'var(--warn-text)' : phsOk ? 'var(--success-text)' : 'var(--danger-text)';
  const fmtDate = d => {
    if (!d) return 'Unknown';
    try {
      return new Date(d).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return d;
    }
  };
  const SEV_ORDER = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1
  };
  const topFails = adFindings.filter(f => f.status === 'Fail').sort((a, b) => (SEV_ORDER[b.severity] || 0) - (SEV_ORDER[a.severity] || 0)).slice(0, 3);
  return /*#__PURE__*/React.createElement("div", {
    className: "domain-sub-panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel-sublabel"
  }, "Active Directory \xB7 hybrid posture", ad.entraOnly && /*#__PURE__*/React.createElement("span", {
    className: "kpi-hint",
    style: {
      marginLeft: 8,
      fontWeight: 400
    }
  }, "(Entra data \u2014 AD collectors not run)")), /*#__PURE__*/React.createElement("div", {
    className: "spo-summary-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "spo-stat-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "kpi-label"
  }, "Directory sync"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 700,
      color: syncColor,
      marginTop: 6
    }
  }, syncOk ? 'Enabled' : 'Disabled'), ad.syncType && /*#__PURE__*/React.createElement("div", {
    className: "kpi-hint"
  }, ad.syncType)), /*#__PURE__*/React.createElement("div", {
    className: "spo-stat-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "kpi-label"
  }, "Last sync"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      color: 'var(--text-soft)',
      marginTop: 6,
      lineHeight: 1.3
    }
  }, fmtDate(ad.lastSyncTime))), /*#__PURE__*/React.createElement("div", {
    className: 'spo-stat-card' + (phsOk === false ? ' spo-stat-bad' : '')
  }, /*#__PURE__*/React.createElement("div", {
    className: "kpi-label"
  }, "Password hash sync"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 700,
      color: phsColor,
      marginTop: 6
    }
  }, phsOk ? 'Enabled' : phsUnknown ? 'Verify' : 'Disabled'), phsOk === false && /*#__PURE__*/React.createElement("div", {
    className: "kpi-hint",
    style: {
      color: 'var(--danger-text)'
    }
  }, "Leaked credential detection and fallback auth may be impacted"), phsUnknown && /*#__PURE__*/React.createElement("div", {
    className: "kpi-hint",
    style: {
      color: 'var(--warn-text)'
    }
  }, "No PHS timestamp - verify in Microsoft Entra Connect or Entra Cloud Sync")), ad.syncErrorCount > 0 && /*#__PURE__*/React.createElement("div", {
    className: "spo-stat-card spo-stat-bad"
  }, /*#__PURE__*/React.createElement("div", {
    className: "kpi-label"
  }, "Sync errors"), /*#__PURE__*/React.createElement("div", {
    className: "kpi-value"
  }, ad.syncErrorCount), /*#__PURE__*/React.createElement("div", {
    className: "kpi-hint"
  }, "provisioning errors")), !ad.entraOnly && adFindings.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: 'spo-stat-card' + (fail > 0 ? ' spo-stat-bad' : '')
  }, /*#__PURE__*/React.createElement("div", {
    className: "kpi-label"
  }, "AD checks"), /*#__PURE__*/React.createElement("div", {
    className: "kpi-value"
  }, pct(pass, scoreDenom(adFindings)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14
    }
  }, "%")), /*#__PURE__*/React.createElement("div", {
    className: "kpi-hint"
  }, pass, " pass \xB7 ", fail, " fail"), /*#__PURE__*/React.createElement("div", {
    className: "tiny-bar"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: pct(pass, scoreDenom(adFindings)) + '%',
      background: 'var(--success)'
    }
  }))), !ad.entraOnly && ad.highRiskFindings > 0 && /*#__PURE__*/React.createElement("div", {
    className: "spo-stat-card spo-stat-bad"
  }, /*#__PURE__*/React.createElement("div", {
    className: "kpi-label"
  }, "High/Critical risks"), /*#__PURE__*/React.createElement("div", {
    className: "kpi-value"
  }, ad.highRiskFindings), /*#__PURE__*/React.createElement("div", {
    className: "kpi-hint"
  }, "security findings"))), topFails.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "spo-top-fails"
  }, /*#__PURE__*/React.createElement("div", {
    className: "spo-top-fails-label"
  }, "Top gaps"), topFails.map((f, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "spo-fail-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: 'sev-badge ' + f.severity
  }, /*#__PURE__*/React.createElement("span", {
    className: "bar"
  }, /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null)), /*#__PURE__*/React.createElement("span", null, SEV_LABEL[f.severity])), /*#__PURE__*/React.createElement("span", {
    className: "spo-fail-name"
  }, f.setting)))));
}

// ======================== Domain rollup ========================
function DomainRollup({
  onJump
}) {
  const [open, setOpen] = useState(true);
  function toggleOpen(e) {
    e.stopPropagation();
    setOpen(o => !o);
  }
  return /*#__PURE__*/React.createElement("section", {
    className: "block",
    id: "identity"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-head",
    style: {
      cursor: 'pointer'
    },
    onClick: toggleOpen
  }, /*#__PURE__*/React.createElement("span", {
    className: "eyebrow"
  }, "02 \xB7 Domains"), /*#__PURE__*/React.createElement("h2", null, "Security posture by domain ", /*#__PURE__*/React.createElement("span", {
    className: "section-chevron",
    "aria-hidden": "true"
  }, open ? '\u25be' : '\u25b8')), /*#__PURE__*/React.createElement("div", {
    className: "hr"
  })), open && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "domain-grid"
  }, DOMAIN_ORDER.map(name => {
    const d = DOMAIN_STATS[name];
    if (!d) return null;
    // #802: strict denominator -- removed previous (pass + info*0.5) / total
    // weighting in favor of the doc's Pass / (Pass + Fail + Warning).
    const denom = d.pass + d.fail + d.warn;
    const score = denom > 0 ? Math.round(d.pass / denom * 100) : 0;
    return /*#__PURE__*/React.createElement("div", {
      key: name,
      className: "domain-card",
      onClick: () => onJump(name)
    }, /*#__PURE__*/React.createElement("div", {
      className: "dc-head"
    }, /*#__PURE__*/React.createElement("div", {
      className: "dc-name"
    }, name), /*#__PURE__*/React.createElement("div", {
      className: "dc-score"
    }, score, "%")), /*#__PURE__*/React.createElement("div", {
      className: "dc-bar"
    }, d.pass > 0 && /*#__PURE__*/React.createElement("i", {
      className: "pass-seg",
      style: {
        flex: d.pass
      }
    }), d.warn > 0 && /*#__PURE__*/React.createElement("i", {
      className: "warn-seg",
      style: {
        flex: d.warn
      }
    }), d.fail > 0 && /*#__PURE__*/React.createElement("i", {
      className: "fail-seg",
      style: {
        flex: d.fail
      }
    }), d.review > 0 && /*#__PURE__*/React.createElement("i", {
      className: "review-seg",
      style: {
        flex: d.review
      }
    }), d.info > 0 && /*#__PURE__*/React.createElement("i", {
      className: "info-seg",
      style: {
        flex: d.info
      }
    }), (() => {
      const skipped = Math.max(0, d.total - d.pass - d.warn - d.fail - d.review - d.info);
      return skipped > 0 ? /*#__PURE__*/React.createElement("i", {
        className: "skipped-seg",
        style: {
          flex: skipped
        }
      }) : null;
    })()), /*#__PURE__*/React.createElement("div", {
      className: "dc-meta"
    }, /*#__PURE__*/React.createElement("span", {
      className: "dc-pass"
    }, /*#__PURE__*/React.createElement("b", null, d.pass), " pass"), /*#__PURE__*/React.createElement("span", {
      className: "dc-warn"
    }, /*#__PURE__*/React.createElement("b", null, d.warn), " warn"), /*#__PURE__*/React.createElement("span", {
      className: "dc-fail"
    }, /*#__PURE__*/React.createElement("b", null, d.fail), " fail"), d.review > 0 && /*#__PURE__*/React.createElement("span", {
      className: "dc-review"
    }, /*#__PURE__*/React.createElement("b", null, d.review), " review"), (() => {
      const skipped = Math.max(0, d.total - d.pass - d.warn - d.fail - d.review - d.info);
      return skipped > 0 ? /*#__PURE__*/React.createElement("span", {
        className: "dc-skipped",
        title: "Skipped \u2014 prerequisite unmet or not assessable"
      }, /*#__PURE__*/React.createElement("b", null, skipped), " skipped") : null;
    })()));
  })), FINDINGS.some(f => f.domain === 'Intune') && /*#__PURE__*/React.createElement("div", {
    id: "identity-intune"
  }, /*#__PURE__*/React.createElement(IntuneCategoryGrid, null)), D.mailboxSummary && /*#__PURE__*/React.createElement("div", {
    id: "identity-mailbox"
  }, /*#__PURE__*/React.createElement(MailboxSummaryPanel, null)), FINDINGS.some(f => f.domain === 'SharePoint & OneDrive') && /*#__PURE__*/React.createElement("div", {
    id: "identity-sharepoint"
  }, /*#__PURE__*/React.createElement(SharePointSummaryPanel, null)), D.adHybrid && /*#__PURE__*/React.createElement("div", {
    id: "identity-ad"
  }, /*#__PURE__*/React.createElement(AdHybridPanel, null)), (D.dns || []).length > 0 && /*#__PURE__*/React.createElement("div", {
    id: "identity-email"
  }, /*#__PURE__*/React.createElement(DnsAuthPanel, null))));
}

// Token semantics shared by the findings filter and the framework-panel chart:
// 'E3' matches profiles starting with E3; 'E5only' matches CIS profiles with E5 but no E3
// variant; bare 'L1'/'L2'/'L3' substring-match handles bare CMMC values and CIS suffixes alike.
const matchProfileToken = (profilesArr, token) => {
  if (token === 'E5only') return profilesArr.length > 0 && !profilesArr.some(p => p.startsWith('E3'));
  if (token === 'E3') return profilesArr.some(p => p.startsWith('E3'));
  return profilesArr.some(p => p.includes(token));
};

// ======================== Framework quilt ========================
function FrameworkQuilt({
  onSelect,
  selected,
  onProfileSelect,
  activeProfiles
}) {
  const {
    open,
    headProps
  } = useCollapsibleSection();
  const [visibleFws, setVisibleFws] = useState(['cis-m365-v6']);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Panel open by default (#735): the first visible framework ('cis-m365-v6' initially)
  // is expanded on mount so the L1/L2 chips + Coverage by Domain bars are visible
  // without requiring an extra click. User can still collapse via the × button.
  const [expandedFw, setExpandedFw] = useState('cis-m365-v6');
  const pickerRef = useRef(null);

  // Multi-select toggle: clicking a chip adds or removes its token from the active list.
  const handleProfileClick = token => {
    if (!expandedFw || !onProfileSelect) return;
    const cur = activeProfiles || [];
    const next = cur.includes(token) ? cur.filter(t => t !== token) : [...cur, token];
    onProfileSelect(expandedFw, next);
  };
  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = e => {
      if (e.key === 'Escape') setPickerOpen(false);
    };
    const onOut = e => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onOut);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onOut);
    };
  }, [pickerOpen]);
  useEffect(() => {
    const expand = () => {
      if (!expandedFw && visibleFws.length > 0) setExpandedFw(visibleFws[0]);
    };
    window.addEventListener('beforeprint', expand);
    return () => window.removeEventListener('beforeprint', expand);
  }, [expandedFw, visibleFws]);
  const toggleFw = fw => setVisibleFws(v => v.includes(fw) ? v.length > 1 ? v.filter(x => x !== fw) : v : [...v, fw]);
  const byFw = useMemo(() => {
    const out = {};
    FRAMEWORKS.forEach(f => out[f.id] = {
      pass: 0,
      warn: 0,
      fail: 0,
      review: 0,
      info: 0,
      total: 0
    });
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
    const tokens = activeProfiles || [];
    const out = {};
    FINDINGS.forEach(f => {
      if (!f.frameworks.includes(expandedFw)) return;
      if (tokens.length > 0) {
        const profs = [].concat(f.fwMeta?.[expandedFw]?.profiles || []);
        if (!tokens.some(t => matchProfileToken(profs, t))) return;
      }
      if (!out[f.domain]) out[f.domain] = {
        pass: 0,
        warn: 0,
        fail: 0,
        review: 0,
        info: 0,
        total: 0
      };
      out[f.domain].total++;
      const k = STATUS_COLORS[f.status];
      if (k) out[f.domain][k]++;
    });
    return out;
  }, [expandedFw, activeProfiles]);
  const fwProfileStats = useMemo(() => {
    if (!expandedFw) return null;
    const l1 = new Set(),
      l2 = new Set(),
      l3 = new Set(),
      e3 = new Set(),
      e5only = new Set();
    FINDINGS.forEach((f, idx) => {
      const profiles = [].concat(f.fwMeta?.[expandedFw]?.profiles || []);
      if (profiles.length === 0) return;
      const hasE3 = profiles.some(p => p.startsWith('E3'));
      profiles.forEach(p => {
        if (p.includes('L1')) l1.add(idx);
        if (p.includes('L2')) l2.add(idx);
        if (p.includes('L3')) l3.add(idx);
      });
      if (hasE3) e3.add(idx);else e5only.add(idx);
    });
    const isCmmc = expandedFw.startsWith('cmmc');
    return {
      l1: l1.size,
      l2: l2.size,
      l3: l3.size,
      e3: e3.size,
      e5only: e5only.size,
      isCmmc
    };
  }, [expandedFw]);
  const displayFws = FRAMEWORKS.filter(f => visibleFws.includes(f.id));
  const pickerLabel = visibleFws.length === 1 ? FRAMEWORKS.find(f => f.id === visibleFws[0])?.full || visibleFws[0] : `${visibleFws.length} frameworks`;
  const handleCardClick = fwId => setExpandedFw(e => e === fwId ? null : fwId);
  const expandedMeta = expandedFw ? FRAMEWORKS.find(f => f.id === expandedFw) : null;
  const expandedData = expandedFw ? byFw[expandedFw] : null;

  // Count of findings within the expanded framework that match the active level-chip
  // selection (L1/L2/L3/E3/E5only). When no chips are selected, falls back to the
  // framework total so the CTA renders the original phrasing. Uses the same
  // matchProfileToken semantics as fwDomainBreakdown above.
  const selectedCount = useMemo(() => {
    if (!expandedFw || !expandedData) return 0;
    const tokens = activeProfiles || [];
    if (tokens.length === 0) return expandedData.total;
    let n = 0;
    FINDINGS.forEach(f => {
      if (!f.frameworks.includes(expandedFw)) return;
      const profs = [].concat(f.fwMeta?.[expandedFw]?.profiles || []);
      if (tokens.some(t => matchProfileToken(profs, t))) n++;
    });
    return n;
  }, [expandedFw, activeProfiles, expandedData]);
  return /*#__PURE__*/React.createElement("section", {
    className: "block",
    id: "frameworks"
  }, /*#__PURE__*/React.createElement("div", headProps, /*#__PURE__*/React.createElement("span", {
    className: "eyebrow"
  }, "01 \xB7 Compliance"), /*#__PURE__*/React.createElement("h2", null, "Framework coverage"), /*#__PURE__*/React.createElement("div", {
    ref: pickerRef,
    style: {
      position: 'relative',
      marginLeft: 12,
      flexShrink: 0
    },
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("button", {
    className: 'chip chip-more' + (visibleFws.length > 1 ? ' selected' : ''),
    onClick: () => setPickerOpen(o => !o)
  }, pickerLabel, /*#__PURE__*/React.createElement("svg", {
    width: "10",
    height: "10",
    viewBox: "0 0 10 10",
    style: {
      marginLeft: 4,
      opacity: .6
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2 3l3 3 3-3",
    stroke: "currentColor",
    strokeWidth: "1.4",
    fill: "none"
  }))), pickerOpen && /*#__PURE__*/React.createElement("div", {
    className: "domain-menu",
    style: {
      right: 0,
      left: 'auto',
      minWidth: 280
    }
  }, FRAMEWORKS.map(f => /*#__PURE__*/React.createElement("label", {
    key: f.id,
    className: 'domain-opt' + (visibleFws.includes(f.id) ? ' sel' : '')
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: visibleFws.includes(f.id),
    onChange: () => toggleFw(f.id)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 500,
      lineHeight: 1.3
    }
  }, f.full || f.id), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      color: 'var(--muted)',
      marginTop: 1
    }
  }, f.id)), /*#__PURE__*/React.createElement("span", {
    className: "ct"
  }, byFw[f.id]?.total || 0))))), /*#__PURE__*/React.createElement("span", {
    className: "section-chevron",
    "aria-hidden": "true"
  }, open ? '▾' : '▸'), /*#__PURE__*/React.createElement("div", {
    className: "hr"
  })), open && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "quilt"
  }, displayFws.map(f => {
    const d = byFw[f.id];
    // #802: strict denominator -- removed (pass + info*0.5) weighting per doc rule.
    const score = pct(d.pass, d.pass + d.fail + d.warn);
    const isExpanded = expandedFw === f.id;
    return /*#__PURE__*/React.createElement("div", {
      key: f.id,
      className: 'quilt-cell' + (isExpanded ? ' expanded' : '') + (selected === f.id ? ' selected' : ''),
      role: "button",
      tabIndex: 0,
      "aria-expanded": isExpanded,
      "aria-label": `${f.full || f.id} — click to ${isExpanded ? 'collapse' : 'expand'} details`,
      onClick: () => handleCardClick(f.id),
      onKeyDown: e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardClick(f.id);
        }
      }
    }, /*#__PURE__*/React.createElement("svg", {
      className: "quilt-cell-chevron",
      viewBox: "0 0 16 16",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.8",
      "aria-hidden": "true"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M4 6l4 4 4-4"
    })), /*#__PURE__*/React.createElement("div", {
      className: "fw-name"
    }, f.id), /*#__PURE__*/React.createElement("div", {
      className: "fw-long"
    }, f.full), /*#__PURE__*/React.createElement("div", {
      className: "fw-bar",
      title: "Pass (green) / Warn (amber) / Fail (red) / Review (accent) / Skipped (grey, prerequisite unmet)"
    }, d.pass > 0 && /*#__PURE__*/React.createElement("div", {
      className: "fw-seg pass",
      style: {
        flex: d.pass
      }
    }), d.warn > 0 && /*#__PURE__*/React.createElement("div", {
      className: "fw-seg warn",
      style: {
        flex: d.warn
      }
    }), d.fail > 0 && /*#__PURE__*/React.createElement("div", {
      className: "fw-seg fail",
      style: {
        flex: d.fail
      }
    }), d.review > 0 && /*#__PURE__*/React.createElement("div", {
      className: "fw-seg review",
      style: {
        flex: d.review
      }
    }), d.info > 0 && /*#__PURE__*/React.createElement("div", {
      className: "fw-seg info",
      style: {
        flex: d.info
      }
    }), (() => {
      const skipped = Math.max(0, d.total - d.pass - d.warn - d.fail - d.review - d.info);
      return skipped > 0 ? /*#__PURE__*/React.createElement("div", {
        className: "fw-seg skipped",
        style: {
          flex: skipped
        }
      }) : null;
    })(), d.total === 0 && /*#__PURE__*/React.createElement("div", {
      className: "fw-seg empty",
      style: {
        flex: 1
      }
    })), /*#__PURE__*/React.createElement("div", {
      className: "fw-stat"
    }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, score, "%"), " covered"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, d.fail), " gaps"), /*#__PURE__*/React.createElement("span", null, d.total, " checks")));
  })), expandedFw && expandedMeta && expandedData && /*#__PURE__*/React.createElement("div", {
    className: "fw-detail-panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "fw-detail-header"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "fw-detail-name"
  }, expandedMeta.full), /*#__PURE__*/React.createElement("div", {
    className: "fw-detail-id"
  }, expandedFw)), /*#__PURE__*/React.createElement("button", {
    onClick: () => setExpandedFw(null),
    style: {
      background: 'none',
      border: 0,
      color: 'var(--muted)',
      cursor: 'pointer',
      fontSize: 18,
      lineHeight: 1,
      padding: '0 4px'
    }
  }, "\xD7")), (expandedMeta?.desc || FW_BLURB[expandedFw]) && /*#__PURE__*/React.createElement("div", {
    className: "fw-blurb"
  }, expandedMeta?.desc || FW_BLURB[expandedFw]?.desc, ' ', (expandedMeta?.url || FW_BLURB[expandedFw]?.url) && /*#__PURE__*/React.createElement("a", {
    href: expandedMeta?.url || FW_BLURB[expandedFw]?.url,
    target: "_blank",
    rel: "noopener noreferrer"
  }, "Official site \u2197")), /*#__PURE__*/React.createElement("div", {
    className: "fw-detail-summary"
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, expandedData.total), " controls"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", {
    style: {
      color: 'var(--success-text)'
    }
  }, expandedData.pass), " pass"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", {
    style: {
      color: 'var(--warn-text)'
    }
  }, expandedData.warn), " warn"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", {
    style: {
      color: 'var(--danger-text)'
    }
  }, expandedData.fail), " fail"), expandedData.review > 0 && /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, expandedData.review), " review")), fwProfileStats && fwProfileStats.l1 + fwProfileStats.l2 + fwProfileStats.l3 + fwProfileStats.e3 + fwProfileStats.e5only > 0 && /*#__PURE__*/React.createElement("div", {
    className: "fw-profile-stats"
  }, fwProfileStats.isCmmc ? /*#__PURE__*/React.createElement(React.Fragment, null, fwProfileStats.l1 > 0 && /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: 'fw-profile-chip level fw-profile-chip-btn' + ((activeProfiles || []).includes('L1') ? ' selected' : ''),
    onClick: () => handleProfileClick('L1'),
    "aria-pressed": (activeProfiles || []).includes('L1')
  }, "L1 ", /*#__PURE__*/React.createElement("b", null, fwProfileStats.l1)), fwProfileStats.l2 > 0 && /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: 'fw-profile-chip level2 fw-profile-chip-btn' + ((activeProfiles || []).includes('L2') ? ' selected' : ''),
    onClick: () => handleProfileClick('L2'),
    "aria-pressed": (activeProfiles || []).includes('L2')
  }, "L2 ", /*#__PURE__*/React.createElement("b", null, fwProfileStats.l2)), fwProfileStats.l3 > 0 && /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: 'fw-profile-chip level3 fw-profile-chip-btn' + ((activeProfiles || []).includes('L3') ? ' selected' : ''),
    onClick: () => handleProfileClick('L3'),
    "aria-pressed": (activeProfiles || []).includes('L3')
  }, "L3 ", /*#__PURE__*/React.createElement("b", null, fwProfileStats.l3)), fwProfileStats.l3 > 0 && /*#__PURE__*/React.createElement("span", {
    className: "fw-profile-info",
    title: "L2 includes all L3 practices. Every CMMC L3 control is also assessed at L2 by design \u2014 selecting L2 will count L3 checks too."
  }, "L2 \u2287 L3")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: 'fw-profile-chip level fw-profile-chip-btn' + ((activeProfiles || []).includes('L1') ? ' selected' : ''),
    onClick: () => handleProfileClick('L1'),
    "aria-pressed": (activeProfiles || []).includes('L1')
  }, "L1 ", /*#__PURE__*/React.createElement("b", null, fwProfileStats.l1)), fwProfileStats.l2 > 0 && /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: 'fw-profile-chip level2 fw-profile-chip-btn' + ((activeProfiles || []).includes('L2') ? ' selected' : ''),
    onClick: () => handleProfileClick('L2'),
    "aria-pressed": (activeProfiles || []).includes('L2')
  }, "L2 ", /*#__PURE__*/React.createElement("b", null, fwProfileStats.l2)), /*#__PURE__*/React.createElement("span", {
    className: "fw-profile-sep"
  }, "\xB7"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: 'fw-profile-chip lic fw-profile-chip-btn' + ((activeProfiles || []).includes('E3') ? ' selected' : ''),
    onClick: () => handleProfileClick('E3'),
    "aria-pressed": (activeProfiles || []).includes('E3')
  }, "E3 ", /*#__PURE__*/React.createElement("b", null, fwProfileStats.e3)), fwProfileStats.e5only > 0 && /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: 'fw-profile-chip lic5 fw-profile-chip-btn' + ((activeProfiles || []).includes('E5only') ? ' selected' : ''),
    onClick: () => handleProfileClick('E5only'),
    "aria-pressed": (activeProfiles || []).includes('E5only')
  }, "E5 only ", /*#__PURE__*/React.createElement("b", null, fwProfileStats.e5only)))), expandedFw === 'cmmc' && D.cmmcHandoff && D.cmmcHandoff.Summary && D.cmmcHandoff.Summary.Total && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      marginBottom: 12,
      padding: '10px 12px',
      background: 'var(--card-subtle, rgba(255,255,255,0.03))',
      borderRadius: 6,
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '.08em',
      color: 'var(--muted)',
      marginBottom: 6
    }
  }, "Handoff gaps"), /*#__PURE__*/React.createElement("div", {
    className: "fw-profile-stats",
    style: {
      marginTop: 0,
      marginBottom: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "fw-profile-chip"
  }, "Out of scope ", /*#__PURE__*/React.createElement("b", null, D.cmmcHandoff.Summary.Total.outOfScope)), /*#__PURE__*/React.createElement("span", {
    className: "fw-profile-chip"
  }, "Partial ", /*#__PURE__*/React.createElement("b", null, D.cmmcHandoff.Summary.Total.partial)), /*#__PURE__*/React.createElement("span", {
    className: "fw-profile-chip"
  }, "Coverable ", /*#__PURE__*/React.createElement("b", null, D.cmmcHandoff.Summary.Total.coverable)), D.cmmcHandoff.Summary.Total.inherent > 0 && /*#__PURE__*/React.createElement("span", {
    className: "fw-profile-chip"
  }, "Inherent ", /*#__PURE__*/React.createElement("b", null, D.cmmcHandoff.Summary.Total.inherent))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6,
      color: 'var(--muted)',
      lineHeight: 1.5
    }
  }, D.cmmcHandoff.Summary.Total.practices, " CMMC 2.0 practices require non-M365 controls (physical access, HR, inherent defaults) and are tracked separately.")), /*#__PURE__*/React.createElement("div", {
    className: "fw-bar",
    style: {
      marginBottom: 16,
      height: 10,
      borderRadius: 5
    }
  }, expandedData.pass > 0 && /*#__PURE__*/React.createElement("div", {
    className: "fw-seg pass",
    style: {
      flex: expandedData.pass
    }
  }), expandedData.warn > 0 && /*#__PURE__*/React.createElement("div", {
    className: "fw-seg warn",
    style: {
      flex: expandedData.warn
    }
  }), expandedData.fail > 0 && /*#__PURE__*/React.createElement("div", {
    className: "fw-seg fail",
    style: {
      flex: expandedData.fail
    }
  }), expandedData.review > 0 && /*#__PURE__*/React.createElement("div", {
    className: "fw-seg review",
    style: {
      flex: expandedData.review
    }
  }), expandedData.info > 0 && /*#__PURE__*/React.createElement("div", {
    className: "fw-seg info",
    style: {
      flex: expandedData.info
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '.1em',
      color: 'var(--muted)',
      marginBottom: 8
    }
  }, "Coverage by domain"), /*#__PURE__*/React.createElement("div", {
    className: "fw-detail-domains"
  }, Object.entries(fwDomainBreakdown).sort((a, b) => b[1].fail - a[1].fail || b[1].total - a[1].total).map(([domain, s]) => /*#__PURE__*/React.createElement("div", {
    key: domain,
    className: "fw-domain-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "fw-domain-name"
  }, domain), /*#__PURE__*/React.createElement("div", {
    className: "fw-domain-bar"
  }, s.pass > 0 && /*#__PURE__*/React.createElement("div", {
    className: "fw-seg pass",
    style: {
      flex: s.pass
    }
  }), s.warn > 0 && /*#__PURE__*/React.createElement("div", {
    className: "fw-seg warn",
    style: {
      flex: s.warn
    }
  }), s.fail > 0 && /*#__PURE__*/React.createElement("div", {
    className: "fw-seg fail",
    style: {
      flex: s.fail
    }
  }), s.review > 0 && /*#__PURE__*/React.createElement("div", {
    className: "fw-seg review",
    style: {
      flex: s.review
    }
  }), s.info > 0 && /*#__PURE__*/React.createElement("div", {
    className: "fw-seg info",
    style: {
      flex: s.info
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "fw-domain-stat"
  }, s.fail > 0 ? /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--danger-text)'
    }
  }, s.fail, " gap", s.fail !== 1 ? 's' : '') : /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--success-text)'
    }
  }, s.pass, " pass"))))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14,
      paddingTop: 12,
      borderTop: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "chip chip-more selected",
    onClick: () => {
      onSelect(expandedFw);
      document.getElementById('findings-anchor')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  }, (activeProfiles || []).length === 0 ? /*#__PURE__*/React.createElement(React.Fragment, null, "View all ", expandedData.total, " findings in this framework \u2192") : /*#__PURE__*/React.createElement(React.Fragment, null, "View ", selectedCount, " of ", expandedData.total, " findings matching ", (activeProfiles || []).join(' + '), " \u2192"))))));
}

// ======================== Filter bar ========================
function FilterBar({
  filters,
  setFilters,
  counts,
  total,
  search,
  setSearch
}) {
  const [domainOpen, setDomainOpen] = useState(false);
  const [fwOpen, setFwOpen] = useState(false);
  const domainRef = useRef(null);
  const fwRef = useRef(null);
  useEffect(() => {
    if (!domainOpen) return;
    const onKey = e => {
      if (e.key === 'Escape') setDomainOpen(false);
    };
    const onOutside = e => {
      if (domainRef.current && !domainRef.current.contains(e.target)) setDomainOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onOutside);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onOutside);
    };
  }, [domainOpen]);
  useEffect(() => {
    if (!fwOpen) return;
    const onKey = e => {
      if (e.key === 'Escape') setFwOpen(false);
    };
    const onOutside = e => {
      if (fwRef.current && !fwRef.current.contains(e.target)) setFwOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onOutside);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onOutside);
    };
  }, [fwOpen]);
  const update = (k, v) => {
    setFilters(f => {
      const cur = new Set(f[k]);
      if (cur.has(v)) cur.delete(v);else cur.add(v);
      return {
        ...f,
        [k]: [...cur]
      };
    });
  };
  const active = filters.status.length + filters.severity.length + filters.framework.length + filters.domain.length + (filters.profile || []).length;
  const isActive = search.length > 0 || active > 0;

  // [data-value, css-class, optional-display-label]
  const statusChips = [['Fail', 'fail'], ['Warning', 'warn'], ['Review', 'review'], ['Pass', 'pass'], ['Info', 'info'], ['Skipped', 'skipped'], ['Unknown', 'unknown'], ['NotApplicable', 'notapplicable', 'Not Applicable'], ['NotLicensed', 'notlicensed', 'Not Licensed']];
  const sevChips = [['critical', 'crit', 'Critical'], ['high', 'high', 'High'], ['medium', 'med', 'Medium'], ['low', 'low', 'Low']];
  const DOM_ORDER = ['Entra ID', 'Conditional Access', 'Enterprise Apps', 'Exchange Online', 'Intune', 'Defender', 'Purview / Compliance', 'SharePoint & OneDrive', 'Teams', 'Forms', 'Power BI', 'Active Directory', 'SOC 2', 'Value Opportunity'];
  const domainList = DOM_ORDER.filter(d => counts.domain[d]).concat(Object.keys(counts.domain).filter(d => !DOM_ORDER.includes(d)).sort());
  return /*#__PURE__*/React.createElement("div", {
    className: 'filter-bar' + (isActive ? ' filter-bar-active' : '')
  }, /*#__PURE__*/React.createElement("div", {
    className: "fb-row fb-row-search"
  }, /*#__PURE__*/React.createElement("div", {
    className: "fb-search"
  }, /*#__PURE__*/React.createElement("svg", {
    width: "15",
    height: "15",
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.6"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "7",
    cy: "7",
    r: "5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M11 11l3 3"
  })), /*#__PURE__*/React.createElement("input", {
    value: search,
    onChange: e => setSearch(e.target.value),
    placeholder: "Search findings, check IDs, categories\u2026"
  }), search && /*#__PURE__*/React.createElement("button", {
    className: "fb-clear-x",
    onClick: () => setSearch(''),
    "aria-label": "Clear"
  }, "\xD7"))), /*#__PURE__*/React.createElement("div", {
    className: "fb-row fb-row-chips"
  }, /*#__PURE__*/React.createElement("div", {
    className: "filter-group"
  }, /*#__PURE__*/React.createElement("span", {
    className: "filter-group-label"
  }, "Status"), statusChips.filter(([v]) => (counts.status[v] || 0) > 0 || filters.status.includes(v)).map(([v, cls, label]) => /*#__PURE__*/React.createElement("button", {
    key: v,
    className: 'chip ' + cls + (filters.status.includes(v) ? ' selected' : ''),
    onClick: () => update('status', v)
  }, /*#__PURE__*/React.createElement("span", {
    className: "dot"
  }), label || v, /*#__PURE__*/React.createElement("span", {
    className: "ct"
  }, counts.status[v] || 0)))), /*#__PURE__*/React.createElement("div", {
    className: "filter-divider"
  }), /*#__PURE__*/React.createElement("div", {
    className: "filter-group"
  }, /*#__PURE__*/React.createElement("span", {
    className: "filter-group-label"
  }, "Severity"), sevChips.map(([v, cls, label]) => /*#__PURE__*/React.createElement("button", {
    key: v,
    className: 'chip ' + cls + (filters.severity.includes(v) ? ' selected' : ''),
    onClick: () => update('severity', v)
  }, /*#__PURE__*/React.createElement("span", {
    className: "dot"
  }), label, /*#__PURE__*/React.createElement("span", {
    className: "ct"
  }, counts.severity[v] || 0))))), /*#__PURE__*/React.createElement("div", {
    className: "fb-row fb-row-dropdowns"
  }, /*#__PURE__*/React.createElement("div", {
    className: "filter-group",
    ref: fwRef
  }, /*#__PURE__*/React.createElement("span", {
    className: "filter-group-label"
  }, "Framework"), /*#__PURE__*/React.createElement("button", {
    className: 'chip chip-more' + (filters.framework.length ? ' selected' : ''),
    onClick: () => setFwOpen(o => !o)
  }, filters.framework.length ? `${filters.framework.length} selected` : 'All frameworks', /*#__PURE__*/React.createElement("svg", {
    width: "10",
    height: "10",
    viewBox: "0 0 10 10",
    style: {
      marginLeft: 4,
      opacity: .6
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2 3l3 3 3-3",
    stroke: "currentColor",
    strokeWidth: "1.4",
    fill: "none"
  }))), fwOpen && /*#__PURE__*/React.createElement("div", {
    className: "domain-menu"
  }, FRAMEWORKS.map(f => /*#__PURE__*/React.createElement("label", {
    key: f.id,
    className: 'domain-opt' + (filters.framework.includes(f.id) ? ' sel' : '')
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: filters.framework.includes(f.id),
    onChange: () => update('framework', f.id)
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 12
    }
  }, f.id), /*#__PURE__*/React.createElement("span", {
    className: "ct"
  }, counts.framework[f.id] || 0))))), /*#__PURE__*/React.createElement("div", {
    className: "filter-divider"
  }), /*#__PURE__*/React.createElement("div", {
    className: "filter-group",
    ref: domainRef
  }, /*#__PURE__*/React.createElement("span", {
    className: "filter-group-label"
  }, "Domain"), /*#__PURE__*/React.createElement("button", {
    className: 'chip chip-more' + (filters.domain.length ? ' selected' : ''),
    onClick: () => setDomainOpen(o => !o)
  }, filters.domain.length ? `${filters.domain.length} selected` : 'All domains', /*#__PURE__*/React.createElement("svg", {
    width: "10",
    height: "10",
    viewBox: "0 0 10 10",
    style: {
      marginLeft: 4,
      opacity: .6
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2 3l3 3 3-3",
    stroke: "currentColor",
    strokeWidth: "1.4",
    fill: "none"
  }))), domainOpen && /*#__PURE__*/React.createElement("div", {
    className: "domain-menu"
  }, domainList.map(d => /*#__PURE__*/React.createElement("label", {
    key: d,
    className: 'domain-opt' + (filters.domain.includes(d) ? ' sel' : '')
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: filters.domain.includes(d),
    onChange: () => update('domain', d)
  }), /*#__PURE__*/React.createElement("span", null, d), /*#__PURE__*/React.createElement("span", {
    className: "ct"
  }, counts.domain[d] || 0)))))), (() => {
    // Level / license filter row (#740). Appears when exactly one framework is active
    // and that framework has profile-bearing findings. CMMC shows L1/L2/L3; CIS shows
    // L1/L2/E3/E5 only. Single source of truth (filters.profile); chips here mirror
    // the Framework Quilt panel chips and both write to the same state.
    const singleFw = filters.framework.length === 1 ? filters.framework[0] : null;
    if (!singleFw) return null;
    const isCmmc = singleFw.startsWith('cmmc');
    const isCis = singleFw.startsWith('cis-');
    if (!isCmmc && !isCis) return null;

    // Token counts match the semantics in FrameworkQuilt's fwProfileStats.
    const c = {
      L1: 0,
      L2: 0,
      L3: 0,
      E3: 0,
      E5only: 0
    };
    FINDINGS.forEach(f => {
      const profs = [].concat(f.fwMeta?.[singleFw]?.profiles || []);
      if (profs.length === 0) return;
      if (profs.some(p => p.includes('L1'))) c.L1++;
      if (profs.some(p => p.includes('L2'))) c.L2++;
      if (profs.some(p => p.includes('L3'))) c.L3++;
      const hasE3 = profs.some(p => p.startsWith('E3'));
      if (hasE3) c.E3++;else c.E5only++;
    });
    const tokenList = isCmmc ? ['L1', 'L2', 'L3'].filter(t => c[t] > 0) : ['L1', 'L2', 'E3', 'E5only'].filter(t => c[t] > 0);
    if (!tokenList.length) return null;
    const lvlCss = {
      L1: 'level',
      L2: 'level2',
      L3: 'level3',
      E3: 'lic',
      E5only: 'lic5'
    };
    const lvlLabel = {
      L1: 'L1',
      L2: 'L2',
      L3: 'L3',
      E3: 'E3',
      E5only: 'E5 only'
    };
    return /*#__PURE__*/React.createElement("div", {
      className: "fb-row fb-row-level"
    }, /*#__PURE__*/React.createElement("div", {
      className: "filter-group"
    }, /*#__PURE__*/React.createElement("span", {
      className: "filter-group-label"
    }, "Level"), tokenList.map(tok => /*#__PURE__*/React.createElement("button", {
      key: tok,
      className: 'chip ' + (lvlCss[tok] || 'level') + ((filters.profile || []).includes(tok) ? ' selected' : ''),
      onClick: () => update('profile', tok)
    }, lvlLabel[tok], /*#__PURE__*/React.createElement("span", {
      className: "ct"
    }, c[tok] || 0)))));
  })(), active > 0 && /*#__PURE__*/React.createElement("div", {
    className: "fb-row fb-row-clear"
  }, /*#__PURE__*/React.createElement("button", {
    className: "filter-clear",
    onClick: () => setFilters({
      status: [],
      severity: [],
      framework: [],
      domain: [],
      profile: []
    })
  }, "Clear ", active, " filter", active === 1 ? '' : 's')));
}

// ======================== Search highlight helper ========================
function Highlight({
  text,
  query
}) {
  if (!query || !text) return text || null;
  const str = String(text);
  const q = query.toLowerCase();
  const parts = [];
  let lower = str.toLowerCase();
  let last = 0,
    idx;
  while ((idx = lower.indexOf(q, last)) !== -1) {
    if (idx > last) parts.push(str.slice(last, idx));
    parts.push(/*#__PURE__*/React.createElement("mark", {
      key: idx,
      className: "search-hl"
    }, str.slice(idx, idx + q.length)));
    last = idx + q.length;
  }
  if (last < str.length) parts.push(str.slice(last));
  return parts.length ? parts : text;
}

// ======================== Findings table ========================
const ALL_COLS = [{
  id: 'status',
  label: 'Status',
  width: '80px'
}, {
  id: 'finding',
  label: 'Finding',
  width: '1.5fr'
}, {
  id: 'domain',
  label: 'Domain',
  width: '140px'
}, {
  id: 'controlId',
  label: 'Control #',
  width: '100px'
}, {
  id: 'checkId',
  label: 'CheckID',
  width: '160px'
}, {
  id: 'severity',
  label: 'Severity',
  width: '100px'
}, {
  id: 'frameworks',
  label: 'Frameworks',
  width: '120px'
}];
const DEFAULT_COLS = ['status', 'finding', 'domain', 'controlId', 'checkId', 'severity'];
function FindingsTable({
  filters,
  search,
  focusFinding,
  onFocusClear,
  onMatchesChange,
  editMode,
  hiddenFindings,
  onHide,
  onHideBulk,
  onRestoreAll
}) {
  const {
    open: sectionOpen,
    headProps
  } = useCollapsibleSection();
  const [open, setOpen] = useState(new Set());
  const [visibleCols, setVisibleCols] = useState(DEFAULT_COLS);
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const colPickerRef = useRef(null);
  useEffect(() => {
    if (!colPickerOpen) return;
    const onKey = e => {
      if (e.key === 'Escape') setColPickerOpen(false);
    };
    const onOut = e => {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target)) setColPickerOpen(false);
    };
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
        const prevIdx = filtered.findIndex(f => f.checkId === prev);
        if (prevIdx >= 0) n.delete(prevIdx);
      }
      const idx = filtered.findIndex(f => f.checkId === focusFinding);
      if (idx >= 0) n.add(idx);
      return n;
    });
    prevFocusRef.current = focusFinding;
    const timer = setTimeout(() => {
      const rowId = 'finding-row-' + focusFinding.replace(/\./g, '-');
      const el = document.getElementById(rowId);
      if (el) {
        el.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
        el.classList.add('highlight-focus');
        setTimeout(() => {
          el.classList.remove('highlight-focus');
          onFocusClear?.();
        }, 2500);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [focusFinding]);
  const toggleCol = id => setVisibleCols(v => v.includes(id) ? v.length > 1 ? v.filter(c => c !== id) : v : [...v, id]);
  const cols = ALL_COLS.filter(c => visibleCols.includes(c.id));
  const gridTpl = cols.map(c => c.width).join(' ') + ' 28px';

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
      if ((filters.profile || []).length) {
        const activeFw = filters.framework.length === 1 ? filters.framework[0] : null;
        const fProfiles = activeFw ? [].concat(f.fwMeta?.[activeFw]?.profiles || []) : [];
        if (!filters.profile.some(token => matchProfileToken(fProfiles, token))) return false;
      }
      if (s) {
        const hay = (f.setting + ' ' + f.checkId + ' ' + f.current + ' ' + f.recommended + ' ' + f.remediation + ' ' + f.domain + ' ' + f.section).toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [filters, search, editMode, hiddenFindings]);

  // Issue #697: publish matches up to App. Only emit when there is a query;
  // empty list when search is cleared so the counter hides and cycling no-ops.
  useEffect(() => {
    if (!onMatchesChange) return;
    onMatchesChange(search ? filtered.map(f => f.checkId) : []);
  }, [filtered, search, onMatchesChange]);
  const isFiltered = search.length > 0 || filters.status.length > 0 || filters.severity.length > 0 || filters.framework.length > 0 || filters.domain.length > 0 || (filters.profile || []).length > 0;
  const toggle = i => setOpen(o => {
    const n = new Set(o);
    if (n.has(i)) n.delete(i);else n.add(i);
    return n;
  });
  const hl = (text, q) => {
    if (!q || !text) return text;
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i === -1) return text;
    return [text.slice(0, i), /*#__PURE__*/React.createElement("span", {
      style: {
        background: 'var(--accent-soft)',
        color: 'var(--accent-text)',
        borderRadius: 2,
        padding: '0 1px'
      }
    }, text.slice(i, i + q.length)), text.slice(i + q.length)];
  };
  const renderCell = (colId, f) => {
    switch (colId) {
      case 'status':
        return /*#__PURE__*/React.createElement("div", {
          key: "status",
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 3
          }
        }, /*#__PURE__*/React.createElement("span", {
          className: 'status-badge ' + STATUS_COLORS[f.status]
        }, /*#__PURE__*/React.createElement("span", {
          className: "dot"
        }), statusLabel(f.status)), f.intentDesign && /*#__PURE__*/React.createElement("span", {
          className: "badge-intent"
        }, "By Design"));
      case 'finding':
        return /*#__PURE__*/React.createElement("div", {
          key: "finding",
          className: "finding-title"
        }, /*#__PURE__*/React.createElement("div", {
          className: "t"
        }, /*#__PURE__*/React.createElement(Highlight, {
          text: f.setting,
          query: search
        })), /*#__PURE__*/React.createElement("div", {
          className: "sub"
        }, /*#__PURE__*/React.createElement(Highlight, {
          text: f.section,
          query: search
        })));
      case 'domain':
        return /*#__PURE__*/React.createElement("div", {
          key: "domain",
          className: "finding-dom"
        }, /*#__PURE__*/React.createElement(Highlight, {
          text: f.domain,
          query: search
        }));
      case 'controlId':
        {
          const activeFw = filters.framework.length === 1 ? filters.framework[0] : null;
          const meta = activeFw ? f.fwMeta?.[activeFw] : null;
          const FW_PREF = ['cis-m365-v6', 'nist-800-53', 'cmmc', 'nist-csf', 'iso-27001'];
          const cid = meta?.controlId || (() => {
            if (!f.fwMeta) return null;
            for (const fw of FW_PREF) {
              if (f.fwMeta[fw]?.controlId) return f.fwMeta[fw].controlId;
            }
            const first = Object.values(f.fwMeta).find(v => v?.controlId);
            return first?.controlId || null;
          })();
          const profiles = activeFw ? [].concat(meta?.profiles || []) : [];
          // Handles both "E3-L1" (CIS) and bare "L1" (CMMC) profile formats
          const rawLevels = [...new Set(profiles.flatMap(p => {
            const m = p.match(/(L\d+)/);
            return m ? [m[1]] : [];
          }))].sort();
          // For CMMC (cumulative model) show only the highest level; for others show full set
          const isCmmcFw = activeFw?.startsWith('cmmc');
          const lvl = isCmmcFw && rawLevels.length > 1 ? rawLevels[rawLevels.length - 1] : rawLevels.join('+');
          const lvlCls = lvl === 'L3' ? 'level3' : lvl.includes('L2') && !lvl.includes('L1') ? 'level2' : 'level';
          const lic = profiles.some(p => p.startsWith('E3')) && profiles.some(p => p.startsWith('E5')) ? 'E3+E5' : profiles.some(p => p.startsWith('E5')) ? 'E5' : profiles.some(p => p.startsWith('E3')) ? 'E3' : '';
          return /*#__PURE__*/React.createElement("div", {
            key: "controlId",
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: 2
            }
          }, /*#__PURE__*/React.createElement("span", {
            className: "check-id",
            style: cid ? undefined : {
              color: 'var(--muted)',
              fontStyle: 'italic'
            }
          }, cid || '—'), (lvl || lic) && /*#__PURE__*/React.createElement("span", {
            style: {
              display: 'inline-flex',
              gap: 3
            }
          }, lvl && /*#__PURE__*/React.createElement("span", {
            className: 'fw-profile-chip ' + lvlCls
          }, lvl), lic && /*#__PURE__*/React.createElement("span", {
            className: 'fw-profile-chip ' + (lic === 'E5' ? 'lic5' : 'lic')
          }, lic)));
        }
      case 'checkId':
        return /*#__PURE__*/React.createElement("div", {
          key: "checkId",
          className: "check-id"
        }, /*#__PURE__*/React.createElement(Highlight, {
          text: f.checkId,
          query: search
        }));
      case 'severity':
        return /*#__PURE__*/React.createElement("div", {
          key: "severity"
        }, /*#__PURE__*/React.createElement("span", {
          className: 'sev-badge ' + f.severity
        }, /*#__PURE__*/React.createElement("span", {
          className: "bar"
        }, /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null)), /*#__PURE__*/React.createElement("span", null, SEV_LABEL[f.severity])));
      case 'frameworks':
        return /*#__PURE__*/React.createElement("div", {
          key: "frameworks",
          className: "fw-list"
        }, f.frameworks.map(fw => /*#__PURE__*/React.createElement("span", {
          key: fw,
          className: "fw-pill"
        }, fw)));
      default:
        return null;
    }
  };
  return /*#__PURE__*/React.createElement("section", {
    className: "block",
    id: "findings"
  }, /*#__PURE__*/React.createElement("div", headProps, /*#__PURE__*/React.createElement("span", {
    className: "eyebrow"
  }, "03 \xB7 Detail"), /*#__PURE__*/React.createElement("h2", null, "All findings", isFiltered ? /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 8,
      fontSize: 12,
      fontWeight: 500,
      background: 'var(--accent-soft)',
      border: '1px solid var(--accent-border)',
      color: 'var(--accent-text)',
      borderRadius: 20,
      padding: '2px 10px',
      verticalAlign: 'middle'
    }
  }, "Showing ", filtered.length, " of ", FINDINGS.length) : /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 400,
      color: 'var(--muted)',
      fontSize: 13
    }
  }, " \xB7 ", FINDINGS.length, " total")), editMode && hiddenFindings?.size > 0 && /*#__PURE__*/React.createElement("button", {
    className: "restore-all-btn",
    onClick: e => {
      e.stopPropagation();
      onRestoreAll();
    }
  }, "\u21A9 Restore ", hiddenFindings.size, " hidden"), /*#__PURE__*/React.createElement("button", {
    className: "chip chip-more",
    style: {
      marginLeft: 12,
      flexShrink: 0
    },
    onClick: e => {
      e.stopPropagation();
      setOpen(open.size === filtered.length && filtered.length > 0 ? new Set() : new Set(filtered.map((_, i) => i)));
    },
    title: open.size === filtered.length && filtered.length > 0 ? 'Collapse all findings' : 'Expand all findings'
  }, open.size === filtered.length && filtered.length > 0 ? '− Collapse all' : '+ Expand all'), /*#__PURE__*/React.createElement("div", {
    ref: colPickerRef,
    style: {
      position: 'relative',
      marginLeft: 8,
      flexShrink: 0
    },
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("button", {
    className: 'chip chip-more' + (visibleCols.length !== DEFAULT_COLS.length ? ' selected' : ''),
    onClick: () => setColPickerOpen(o => !o),
    title: "Choose columns"
  }, /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.6",
    style: {
      marginRight: 4
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M3 5h10M3 11h10"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "6",
    cy: "5",
    r: "1.5",
    fill: "currentColor",
    stroke: "none"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "10",
    cy: "11",
    r: "1.5",
    fill: "currentColor",
    stroke: "none"
  })), "Columns"), colPickerOpen && /*#__PURE__*/React.createElement("div", {
    className: "domain-menu",
    style: {
      right: 0,
      left: 'auto',
      minWidth: 180
    }
  }, ALL_COLS.map(c => /*#__PURE__*/React.createElement("label", {
    key: c.id,
    className: 'domain-opt' + (visibleCols.includes(c.id) ? ' sel' : '')
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: visibleCols.includes(c.id),
    onChange: () => toggleCol(c.id)
  }), /*#__PURE__*/React.createElement("span", null, c.label))))), /*#__PURE__*/React.createElement("span", {
    className: "section-chevron",
    "aria-hidden": "true"
  }, sectionOpen ? '▾' : '▸'), /*#__PURE__*/React.createElement("div", {
    className: "hr"
  })), sectionOpen && /*#__PURE__*/React.createElement("div", {
    className: "findings"
  }, /*#__PURE__*/React.createElement("div", {
    className: "findings-head",
    style: {
      gridTemplateColumns: gridTpl
    }
  }, cols.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.id
  }, c.label)), /*#__PURE__*/React.createElement("div", null)), filtered.length === 0 && /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, "No findings match your filters."), filtered.map((f, i) => {
    const isOpen = open.has(i);
    const isHidden = hiddenFindings?.has(f.checkId);
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: i
    }, /*#__PURE__*/React.createElement("div", {
      id: 'finding-row-' + (f.checkId || '').replace(/\./g, '-'),
      className: 'finding-row' + (isOpen ? ' open' : '') + (isHidden ? ' finding-hidden' : ''),
      onClick: () => toggle(i),
      style: {
        gridTemplateColumns: gridTpl
      }
    }, cols.map(c => renderCell(c.id, f)), editMode ? /*#__PURE__*/React.createElement("button", {
      className: 'hide-finding-btn' + (isHidden ? ' restore' : ''),
      title: isHidden ? 'Restore finding' : 'Hide from report',
      onClick: e => {
        e.stopPropagation();
        onHide?.(f.checkId);
      }
    }, isHidden ? '↩' : '✕') : /*#__PURE__*/React.createElement("div", {
      className: "caret"
    }, /*#__PURE__*/React.createElement(Icon.chevron, null))), isOpen && /*#__PURE__*/React.createElement("div", {
      className: "finding-detail"
    }, f.intentDesign && /*#__PURE__*/React.createElement("div", {
      className: "intent-callout"
    }, /*#__PURE__*/React.createElement("strong", null, "Intentional by design."), f.intentRationale && /*#__PURE__*/React.createElement("span", null, " ", f.intentRationale)), /*#__PURE__*/React.createElement("div", {
      className: "why"
    }, /*#__PURE__*/React.createElement("div", {
      className: "why-label"
    }, "Why it matters"), /*#__PURE__*/React.createElement("div", {
      className: "why-text"
    }, whyItMatters(f))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "block-title"
    }, "Current value"), /*#__PURE__*/React.createElement("div", {
      className: "value-box current"
    }, f.current || '—')), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "block-title"
    }, "Recommended value"), /*#__PURE__*/React.createElement("div", {
      className: "value-box recommended"
    }, f.recommended || '—')), f.remediation && /*#__PURE__*/React.createElement("div", {
      className: "finding-remediation"
    }, /*#__PURE__*/React.createElement("div", {
      className: "block-title"
    }, "Remediation"), /*#__PURE__*/React.createElement("div", {
      className: "remediation-text"
    }, f.remediation)), f.references && f.references.length > 0 && /*#__PURE__*/React.createElement("div", {
      className: "finding-learn-more"
    }, /*#__PURE__*/React.createElement("div", {
      className: "block-title"
    }, "Learn more"), f.references.map((r, i) => /*#__PURE__*/React.createElement("a", {
      key: i,
      href: r.url,
      target: "_blank",
      rel: "noreferrer noopener"
    }, "\uD83D\uDCD6 ", r.title, " \u2197"))), f.evidence && /*#__PURE__*/React.createElement(EvidenceBlock, {
      evidence: f.evidence
    })));
  })));
}

// D1 #785 -- structured evidence schema renderer.
// Accepts either the new object shape ({ observedValue, expectedValue, ..., raw }) or
// the legacy JSON-string shape (pre-v2.9 reports). Renders a structured table for
// typed fields and a collapsible <pre> for the legacy raw blob when present.
function EvidenceBlock({
  evidence
}) {
  if (!evidence) return null;
  // Defensive: legacy reports stored evidence as a JSON string. Try to parse.
  let ev = evidence;
  if (typeof ev === 'string') {
    try {
      ev = {
        raw: ev
      };
    } catch {
      return null;
    }
  }
  const fields = [['observedValue', 'Observed value'], ['expectedValue', 'Expected value'], ['evidenceSource', 'Source'], ['evidenceTimestamp', 'Collected at (UTC)'], ['collectionMethod', 'Collection method'], ['permissionRequired', 'Permission used'], ['confidence', 'Confidence'], ['limitations', 'Limitations']];
  const rows = fields.filter(([k]) => ev[k] !== undefined && ev[k] !== null && ev[k] !== '');
  let rawPretty = null;
  if (ev.raw) {
    try {
      rawPretty = JSON.stringify(JSON.parse(ev.raw), null, 2);
    } catch {
      rawPretty = String(ev.raw);
    }
  }
  if (rows.length === 0 && !rawPretty) return null;
  return /*#__PURE__*/React.createElement("details", {
    className: "finding-evidence"
  }, /*#__PURE__*/React.createElement("summary", null, "Evidence"), rows.length > 0 && /*#__PURE__*/React.createElement("table", {
    className: "evidence-table"
  }, /*#__PURE__*/React.createElement("tbody", null, rows.map(([k, label]) => /*#__PURE__*/React.createElement("tr", {
    key: k
  }, /*#__PURE__*/React.createElement("th", null, label), /*#__PURE__*/React.createElement("td", null, k === 'confidence' ? `${Math.round(ev[k] * 100)}%` : String(ev[k])))))), rawPretty && /*#__PURE__*/React.createElement("details", {
    className: "finding-evidence-raw"
  }, /*#__PURE__*/React.createElement("summary", null, "Raw evidence"), /*#__PURE__*/React.createElement("pre", null, rawPretty)));
}
function renderRemediation(text) {
  if (!text) return /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, "No remediation guidance provided.");
  // Split into ordered blocks: portal-text segments and Run: PowerShell commands.
  // Each block renders on its own line so a consultant can scan by action type.
  const parts = text.split(/(Run:[^.]*\.)/);
  const blocks = [];
  let portalBuf = '';
  parts.forEach(p => {
    if (!p) return;
    if (p.startsWith('Run:')) {
      const trimmed = portalBuf.trim();
      if (trimmed) blocks.push({
        type: 'portal',
        text: trimmed
      });
      portalBuf = '';
      const cmd = p.replace(/^Run:\s*/, '').replace(/\.$/, '');
      blocks.push({
        type: 'ps',
        cmd
      });
    } else {
      portalBuf += p;
    }
  });
  const tail = portalBuf.trim();
  if (tail) blocks.push({
    type: 'portal',
    text: tail
  });
  if (blocks.length === 0) return /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, "No remediation guidance provided.");
  return /*#__PURE__*/React.createElement("div", {
    className: "remediation-blocks"
  }, blocks.map((b, i) => b.type === 'ps' ? /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "remediation-block remediation-ps"
  }, /*#__PURE__*/React.createElement("span", {
    className: "remediation-label"
  }, "PowerShell"), /*#__PURE__*/React.createElement("pre", null, /*#__PURE__*/React.createElement("code", null, b.cmd))) : /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "remediation-block remediation-portal"
  }, /*#__PURE__*/React.createElement("span", {
    className: "remediation-label"
  }, "Portal"), /*#__PURE__*/React.createElement("p", null, b.text))));
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
function Roadmap({
  onViewFinding,
  editMode,
  hiddenFindings,
  roadmapOverrides,
  onRoadmapChange
}) {
  const {
    open: sectionOpen,
    headProps
  } = useCollapsibleSection();
  const [open, setOpen] = useState(null);
  const moveTo = (checkId, lane) => {
    onRoadmapChange({
      ...roadmapOverrides,
      [checkId]: lane
    });
    if (open === checkId) setOpen(null);
  };
  const resetCard = checkId => {
    const next = {
      ...roadmapOverrides
    };
    delete next[checkId];
    onRoadmapChange(next);
  };
  const resetLane = laneItems => {
    const next = {
      ...roadmapOverrides
    };
    laneItems.forEach(t => {
      delete next[t.checkId];
    });
    onRoadmapChange(next);
  };
  const tasks = FINDINGS.filter(f => !NON_REMEDIATION_STATUSES.has(f.status) && !hiddenFindings?.has(f.checkId)).map(f => ({
    ...f
  }));
  const score = f => {
    const sev = {
      critical: 100,
      high: 60,
      medium: 30,
      low: 10,
      none: 0,
      info: 5
    }[f.severity];
    const eff = {
      small: 3,
      medium: 2,
      large: 1
    }[f.effort];
    return sev * eff;
  };
  tasks.sort((a, b) => score(b) - score(a));
  const FW_PREF_RM = ['cis-m365-v6', 'nist-800-53', 'cmmc', 'nist-csf', 'iso-27001'];
  const buildRoadmapCsv = (n, s, l) => {
    const cols = ['Lane', 'Setting', 'CheckID', 'Severity', 'Effort', 'Domain', 'Section', 'CurrentValue', 'RecommendedValue', 'Remediation', 'LearnMore', 'ControlRef'];
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [cols.join(',')];
    [['Do Now', n], ['Do Next', s], ['Later', l]].forEach(([label, items]) => {
      items.forEach(t => {
        const fw = FW_PREF_RM.find(k => t.fwMeta?.[k]?.controlId);
        const ref = fw ? `${fw}: ${t.fwMeta[fw].controlId}` : '';
        rows.push([label, t.setting, t.checkId, t.severity, t.effort ?? 'medium', t.category, t.section, t.currentValue, t.recommendedValue, t.remediation, t.references && t.references.length > 0 ? t.references[0].url : '', ref].map(esc).join(','));
      });
    });
    return rows.join('\r\n');
  };
  const downloadCsv = () => {
    const csv = buildRoadmapCsv(now, soon, later);
    const blob = new Blob([csv], {
      type: 'text/csv'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Assessment-Roadmap.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Issue #715: lane bucketing now lives in Get-RemediationLane.ps1 (the single
  // source of truth shared by HTML + XLSX). Build-ReportData precomputes t.lane;
  // we just read it here. Falls back to 'later' for any unexpected missing value.
  const getNaturalLane = t => t.lane || 'later';
  const getEffectiveLane = t => roadmapOverrides[t.checkId] || getNaturalLane(t);
  const LANE_LABEL = {
    now: 'Now',
    soon: 'Next',
    later: 'Later'
  };
  const now = tasks.filter(t => getEffectiveLane(t) === 'now');
  const soon = tasks.filter(t => getEffectiveLane(t) === 'soon');
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
    return /*#__PURE__*/React.createElement("div", {
      className: 'task' + (isOpen ? ' task-open' : '') + (isCustom ? ' task-custom' : ''),
      key: key
    }, /*#__PURE__*/React.createElement("button", {
      className: "task-head-btn",
      onClick: () => setOpen(isOpen ? null : key),
      "aria-expanded": isOpen
    }, /*#__PURE__*/React.createElement("div", {
      className: "task-head"
    }, /*#__PURE__*/React.createElement("span", null, t.setting, isCustom && /*#__PURE__*/React.createElement("span", {
      className: "task-custom-badge"
    }, "custom")), /*#__PURE__*/React.createElement("span", {
      className: 'status-badge ' + STATUS_COLORS[t.status]
    }, /*#__PURE__*/React.createElement("span", {
      className: "dot"
    }), statusLabel(t.status))), /*#__PURE__*/React.createElement("div", {
      className: "task-id"
    }, t.checkId, " \xB7 ", t.domain), /*#__PURE__*/React.createElement("div", {
      className: "task-tags"
    }, /*#__PURE__*/React.createElement("span", {
      className: 'task-tag task-tag-sev sev-' + t.severity
    }, SEV_LABEL[t.severity]), t.effort && /*#__PURE__*/React.createElement("span", {
      className: "task-tag task-tag-effort"
    }, t.effort, " effort"), t.frameworks.slice(0, 3).map(fw => /*#__PURE__*/React.createElement("span", {
      key: fw,
      className: "task-tag",
      style: {
        fontFamily: 'var(--font-mono)'
      }
    }, fw)), /*#__PURE__*/React.createElement("span", {
      className: "task-chev",
      "aria-hidden": "true"
    }, isOpen ? '−' : '+'))), /*#__PURE__*/React.createElement("div", {
      className: "task-move-row"
    }, lane === 'now' && /*#__PURE__*/React.createElement("button", {
      className: "task-move-btn",
      onClick: e => {
        e.stopPropagation();
        moveTo(key, 'soon');
      }
    }, "Next \u2192"), lane === 'soon' && /*#__PURE__*/React.createElement("button", {
      className: "task-move-btn",
      onClick: e => {
        e.stopPropagation();
        moveTo(key, 'now');
      }
    }, "\u2190 Now"), lane === 'soon' && /*#__PURE__*/React.createElement("button", {
      className: "task-move-btn",
      onClick: e => {
        e.stopPropagation();
        moveTo(key, 'later');
      }
    }, "Later \u2192"), lane === 'later' && /*#__PURE__*/React.createElement("button", {
      className: "task-move-btn",
      onClick: e => {
        e.stopPropagation();
        moveTo(key, 'soon');
      }
    }, "\u2190 Next"), isCustom && /*#__PURE__*/React.createElement("button", {
      className: "task-move-btn task-move-reset",
      onClick: e => {
        e.stopPropagation();
        resetCard(key);
      }
    }, "Reset")), isOpen && /*#__PURE__*/React.createElement("div", {
      className: "task-body"
    }, /*#__PURE__*/React.createElement("div", {
      className: "task-why"
    }, /*#__PURE__*/React.createElement("div", {
      className: "task-why-label"
    }, "Why this is in ", lane === 'now' ? '"Now"' : lane === 'soon' ? '"Next"' : '"Later"'), /*#__PURE__*/React.createElement("div", {
      className: "task-why-text"
    }, priorityReason(t, lane))), /*#__PURE__*/React.createElement("div", {
      className: "task-grid"
    }, /*#__PURE__*/React.createElement("div", {
      className: "task-field"
    }, /*#__PURE__*/React.createElement("div", {
      className: "task-field-label"
    }, "Current"), /*#__PURE__*/React.createElement("div", {
      className: "task-field-value"
    }, t.current || /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--muted)'
      }
    }, "\u2014"))), /*#__PURE__*/React.createElement("div", {
      className: "task-field"
    }, /*#__PURE__*/React.createElement("div", {
      className: "task-field-label"
    }, "Recommended"), /*#__PURE__*/React.createElement("div", {
      className: "task-field-value"
    }, t.recommended || /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--muted)'
      }
    }, "\u2014")))), t.remediation && /*#__PURE__*/React.createElement("div", {
      className: "task-field"
    }, /*#__PURE__*/React.createElement("div", {
      className: "task-field-label"
    }, "Remediation"), /*#__PURE__*/React.createElement("div", {
      className: "task-field-value task-remediation"
    }, t.remediation)), t.rationale && /*#__PURE__*/React.createElement("div", {
      className: "task-field"
    }, /*#__PURE__*/React.createElement("div", {
      className: "task-field-label"
    }, "Business rationale"), /*#__PURE__*/React.createElement("div", {
      className: "task-field-value"
    }, t.rationale)), t.references && t.references.length > 0 && /*#__PURE__*/React.createElement("div", {
      className: "task-field task-field-learn-more"
    }, /*#__PURE__*/React.createElement("div", {
      className: "task-field-label"
    }, "Learn more"), /*#__PURE__*/React.createElement("div", {
      className: "task-field-value",
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px'
      }
    }, t.references.map((r, i) => /*#__PURE__*/React.createElement("a", {
      key: i,
      href: r.url,
      target: "_blank",
      rel: "noreferrer noopener",
      style: {
        color: 'var(--accent-text)',
        textDecoration: 'none'
      }
    }, "\uD83D\uDCD6 ", r.title, " \u2197")))), /*#__PURE__*/React.createElement("div", {
      className: "task-meta-row"
    }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, "Section:"), " ", t.section), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, "Severity:"), " ", SEV_LABEL[t.severity]), t.effort && /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, "Effort:"), " ", t.effort), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, "Frameworks:"), " ", t.frameworks.join(', ') || '—')), /*#__PURE__*/React.createElement("div", {
      className: "task-actions"
    }, /*#__PURE__*/React.createElement("a", {
      href: "#findings-anchor",
      onClick: e => {
        e.preventDefault();
        onViewFinding?.(t.checkId);
      }
    }, "View in findings table \u2192"))));
  };
  const LaneReset = ({
    laneItems
  }) => {
    const hasCustom = laneItems.some(t => roadmapOverrides[t.checkId]);
    if (!hasCustom) return null;
    return /*#__PURE__*/React.createElement("button", {
      className: "lane-reset-btn",
      onClick: () => resetLane(laneItems)
    }, "Reset lane");
  };
  return /*#__PURE__*/React.createElement("section", {
    className: "block",
    id: "roadmap"
  }, /*#__PURE__*/React.createElement("div", headProps, /*#__PURE__*/React.createElement("span", {
    className: "eyebrow"
  }, "04 \xB7 Action plan"), /*#__PURE__*/React.createElement("h2", null, "Remediation roadmap"), /*#__PURE__*/React.createElement("span", {
    className: "section-chevron",
    "aria-hidden": "true"
  }, sectionOpen ? '▾' : '▸'), /*#__PURE__*/React.createElement("div", {
    className: "hr"
  }), /*#__PURE__*/React.createElement("button", {
    className: "lane-reset-btn",
    style: {
      marginTop: '8px'
    },
    onClick: e => {
      e.stopPropagation();
      downloadCsv();
    }
  }, "Download CSV")), sectionOpen && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "roadmap-intro"
  }, /*#__PURE__*/React.createElement("div", {
    className: "roadmap-intro-head"
  }, "How we prioritized"), /*#__PURE__*/React.createElement("div", {
    className: "roadmap-intro-body"
  }, "Findings are bucketed by severity. Critical findings \u2014 identity takeover, data exfiltration, privilege escalation paths \u2014 always go in ", /*#__PURE__*/React.createElement("b", null, "Now"), ". High-severity findings land in ", /*#__PURE__*/React.createElement("b", null, "Next"), ": risk is real but remediation typically requires coordination or scheduling. Medium-severity items also join ", /*#__PURE__*/React.createElement("b", null, "Next"), " when tractable, or ", /*#__PURE__*/React.createElement("b", null, "Later"), " for larger hardening work. ", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, "Click any task to expand it, or use the move buttons on each card to reprioritize. Use Finalize (\u270E) to bake lane changes into the report."))), /*#__PURE__*/React.createElement("div", {
    className: "roadmap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lane"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lane-head"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lane-title",
    id: "roadmap-now"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lane-dot crit"
  }), "Now ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)',
      fontWeight: 400
    }
  }, "\xB7 ", now.length)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement(LaneReset, {
    laneItems: now
  }), /*#__PURE__*/React.createElement("div", {
    className: "lane-eta"
  }, "< 1 week"))), now.map(t => renderTask(t, 'now'))), /*#__PURE__*/React.createElement("div", {
    className: "lane"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lane-head"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lane-title",
    id: "roadmap-next"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lane-dot soon"
  }), "Next ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)',
      fontWeight: 400
    }
  }, "\xB7 ", soon.length)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement(LaneReset, {
    laneItems: soon
  }), /*#__PURE__*/React.createElement("div", {
    className: "lane-eta"
  }, "1 \u2013 4 weeks"))), soon.map(t => renderTask(t, 'soon'))), /*#__PURE__*/React.createElement("div", {
    className: "lane"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lane-head"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lane-title",
    id: "roadmap-later"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lane-dot later"
  }), "Later ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)',
      fontWeight: 400
    }
  }, "\xB7 ", later.length)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement(LaneReset, {
    laneItems: later
  }), /*#__PURE__*/React.createElement("div", {
    className: "lane-eta"
  }, "1 \u2013 3 months"))), later.map(t => renderTask(t, 'later'))))));
}

// ======================== Critical Exposure section ========================
function StrykerBlock() {
  const {
    open,
    headProps
  } = useCollapsibleSection();
  const stryker = FINDINGS.filter(f => f.domain === 'Stryker Readiness');
  if (!stryker.length) return null;
  const fail = stryker.filter(f => f.status === 'Fail').length;
  const pass = stryker.filter(f => f.status === 'Pass').length;
  return /*#__PURE__*/React.createElement("section", {
    className: "block",
    id: "stryker"
  }, /*#__PURE__*/React.createElement("div", headProps, /*#__PURE__*/React.createElement("span", {
    className: "eyebrow"
  }, "01b \xB7 Targeted"), /*#__PURE__*/React.createElement("h2", null, "Critical exposure analysis"), /*#__PURE__*/React.createElement("span", {
    className: "section-chevron",
    "aria-hidden": "true"
  }, open ? '▾' : '▸'), /*#__PURE__*/React.createElement("div", {
    className: "hr"
  })), open && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      marginBottom: 12,
      display: 'flex',
      gap: 24,
      alignItems: 'center',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--muted)',
      textTransform: 'uppercase',
      letterSpacing: '.1em',
      fontWeight: 600
    }
  }, "Coverage"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 34,
      fontWeight: 700,
      fontFamily: 'var(--font-display)',
      letterSpacing: '-.02em'
    }
  }, pct(pass, scoreDenom(stryker)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18,
      color: 'var(--muted)'
    }
  }, "%"))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 200,
      fontSize: 13,
      color: 'var(--text-soft)',
      lineHeight: 1.55
    }
  }, "Mapped to MITRE ATT&CK Enterprise techniques and CISA Known Exploited Vulnerabilities (KEV). Prioritized by CIS Critical Security Controls v8 \u2014 covers privileged account exposure, CA exclusions, dangerous Graph permissions, and audit trail gaps."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 18,
      fontVariantNumeric: 'tabular-nums'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--muted)'
    }
  }, "Pass"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      color: 'var(--success-text)'
    }
  }, pass)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--muted)'
    }
  }, "Fail"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      color: 'var(--danger-text)'
    }
  }, fail)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--muted)'
    }
  }, "Total"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700
    }
  }, stryker.length)))), /*#__PURE__*/React.createElement("div", {
    className: "findings"
  }, /*#__PURE__*/React.createElement("div", {
    className: "findings-head"
  }, /*#__PURE__*/React.createElement("div", null, "Status"), /*#__PURE__*/React.createElement("div", null, "Check"), /*#__PURE__*/React.createElement("div", null, "Check ID"), /*#__PURE__*/React.createElement("div", null, "Severity"), /*#__PURE__*/React.createElement("div", null, "Frameworks"), /*#__PURE__*/React.createElement("div", null)), stryker.map((f, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "finding-row",
    style: {
      cursor: 'default'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: 'status-badge ' + STATUS_COLORS[f.status]
  }, /*#__PURE__*/React.createElement("span", {
    className: "dot"
  }), statusLabel(f.status))), /*#__PURE__*/React.createElement("div", {
    className: "finding-title"
  }, /*#__PURE__*/React.createElement("div", {
    className: "t"
  }, f.setting), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, f.section)), /*#__PURE__*/React.createElement("div", {
    className: "check-id"
  }, f.checkId), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: 'sev-badge ' + f.severity
  }, /*#__PURE__*/React.createElement("span", {
    className: "bar"
  }, /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null)), /*#__PURE__*/React.createElement("span", null, SEV_LABEL[f.severity]))), /*#__PURE__*/React.createElement("div", {
    className: "fw-list"
  }, f.frameworks.map(fw => /*#__PURE__*/React.createElement("span", {
    key: fw,
    className: "fw-pill"
  }, fw))), /*#__PURE__*/React.createElement("div", null))))));
}

// ======================== Overview (tenant + summary) ========================
function Overview() {
  const totalChecks = D.summary.reduce((a, r) => a + parseInt(r.Items || 0), 0);
  return /*#__PURE__*/React.createElement("section", {
    className: "block",
    id: "overview"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tenant-line"
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, TENANT.OrgDisplayName)), /*#__PURE__*/React.createElement("span", {
    className: "sep"
  }, "\u2502"), /*#__PURE__*/React.createElement("span", null, "Tenant ", /*#__PURE__*/React.createElement("b", null, TENANT.TenantId)), /*#__PURE__*/React.createElement("span", {
    className: "sep"
  }, "\u2502"), /*#__PURE__*/React.createElement("span", null, "Default domain ", /*#__PURE__*/React.createElement("b", null, TENANT.DefaultDomain)), /*#__PURE__*/React.createElement("span", {
    className: "sep"
  }, "\u2502"), /*#__PURE__*/React.createElement("span", null, "Users ", /*#__PURE__*/React.createElement("b", null, USERS.TotalUsers), " \xB7 licensed ", /*#__PURE__*/React.createElement("b", null, USERS.Licensed)), /*#__PURE__*/React.createElement("span", {
    className: "sep"
  }, "\u2502"), /*#__PURE__*/React.createElement("span", null, "Run ", /*#__PURE__*/React.createElement("b", null, new Date(SCORE.CreatedDateTime || Date.now()).toLocaleString()))), /*#__PURE__*/React.createElement("div", {
    className: "overview-meta"
  }, /*#__PURE__*/React.createElement("span", null, "\u203A ", D.summary.length, " collectors executed"), /*#__PURE__*/React.createElement("span", null, "\u203A ", fmt(totalChecks), " data points inventoried"), /*#__PURE__*/React.createElement("span", null, "\u203A ", FINDINGS.length, " controls evaluated"), /*#__PURE__*/React.createElement("span", null, "\u203A ", FRAMEWORKS.length, " frameworks mapped")));
}

// ======================== Appendix ========================
function Appendix() {
  const {
    open,
    headProps
  } = useCollapsibleSection();
  const mfaTotal = MFA_STATS.total || 1;
  const mfaPct = n => Math.round(n / mfaTotal * 100);
  const ca = D.ca || [];
  const licenses = D.licenses || [];
  const dns = D.dns || [];
  const dnsTotal = dns.length;
  const spfPass = dns.filter(r => r.SPF === 'Pass').length;
  const dkimPass = dns.filter(r => r.DKIMStatus === 'Pass' || r.DKIM === 'Pass').length;
  const dmarcEnf = dns.filter(r => r.DMARCPolicy === 'reject' || r.DMARCPolicy === 'quarantine').length;
  const allRoles = D['admin-roles'] || [];
  const roleCounts = allRoles.reduce((acc, r) => {
    acc[r.RoleName] = (acc[r.RoleName] || 0) + 1;
    return acc;
  }, {});
  const roleEntries = Object.entries(roleCounts).sort((a, b) => b[1] - a[1]);
  const ad = D.adHybrid;
  const phsLabel = ad ? ad.pwHashSync === true ? 'Enabled' : ad.pwHashSync === null || ad.pwHashSync === undefined ? 'Verify' : 'Disabled' : null;
  const phsColor = ad ? ad.pwHashSync === true ? 'var(--success-text)' : ad.pwHashSync === null || ad.pwHashSync === undefined ? 'var(--warn-text)' : 'var(--danger-text)' : 'var(--muted)';
  const labelStyle = {
    fontSize: 12,
    color: 'var(--muted)',
    textTransform: 'uppercase',
    letterSpacing: '.08em',
    fontWeight: 600,
    marginBottom: 10
  };
  const rowStyle = {
    borderTop: '1px solid var(--border)'
  };
  const cellStyle = {
    padding: '6px 0',
    fontSize: 12
  };
  const monoRight = {
    textAlign: 'right',
    fontFamily: 'var(--font-mono)',
    fontVariantNumeric: 'tabular-nums'
  };
  return /*#__PURE__*/React.createElement("section", {
    className: "block",
    id: "appendix"
  }, /*#__PURE__*/React.createElement("div", headProps, /*#__PURE__*/React.createElement("span", {
    className: "eyebrow"
  }, "05 \xB7 Reference"), /*#__PURE__*/React.createElement("h2", null, "Tenant appendix"), /*#__PURE__*/React.createElement("span", {
    className: "section-chevron",
    "aria-hidden": "true"
  }, open ? '▾' : '▸'), /*#__PURE__*/React.createElement("div", {
    className: "hr"
  })), open && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: labelStyle
  }, "Tenant"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px 24px',
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, "org"), " ", /*#__PURE__*/React.createElement("b", null, TENANT.OrgDisplayName)), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, "domain"), " ", /*#__PURE__*/React.createElement("b", null, TENANT.DefaultDomain)), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, "id"), " ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)'
    }
  }, TENANT.TenantId)), TENANT.tenantAgeYears != null && /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, "age"), " ", /*#__PURE__*/React.createElement("b", null, TENANT.tenantAgeYears, " yrs")), TENANT.CreatedDateTime && /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, "created"), " ", /*#__PURE__*/React.createElement("b", null, TENANT.CreatedDateTime.slice(0, 10))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    style: labelStyle
  }, "Licenses"), /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      fontSize: 12,
      borderCollapse: 'collapse'
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      textAlign: 'left',
      color: 'var(--muted)'
    }
  }, /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '6px 0'
    }
  }, "SKU"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right'
    }
  }, "Assigned"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right'
    }
  }, "Total"))), /*#__PURE__*/React.createElement("tbody", null, licenses.filter(l => parseInt(l.Assigned) > 0).map((l, i) => /*#__PURE__*/React.createElement("tr", {
    key: i,
    style: rowStyle
  }, /*#__PURE__*/React.createElement("td", {
    style: cellStyle
  }, l.License), /*#__PURE__*/React.createElement("td", {
    style: {
      ...cellStyle,
      ...monoRight
    }
  }, l.Assigned), /*#__PURE__*/React.createElement("td", {
    style: {
      ...cellStyle,
      ...monoRight,
      color: 'var(--muted)'
    }
  }, l.Total)))))), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    style: labelStyle
  }, "MFA coverage (", fmt(mfaTotal), " users)"), /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      fontSize: 12,
      borderCollapse: 'collapse'
    }
  }, /*#__PURE__*/React.createElement("tbody", null, MFA_STATS.phishResistant > 0 && /*#__PURE__*/React.createElement("tr", {
    style: rowStyle
  }, /*#__PURE__*/React.createElement("td", {
    style: cellStyle
  }, "Phish-resistant"), /*#__PURE__*/React.createElement("td", {
    style: {
      ...cellStyle,
      ...monoRight
    }
  }, fmt(MFA_STATS.phishResistant)), /*#__PURE__*/React.createElement("td", {
    style: {
      ...cellStyle,
      ...monoRight,
      color: 'var(--success-text)'
    }
  }, mfaPct(MFA_STATS.phishResistant), "%")), MFA_STATS.standard > 0 && /*#__PURE__*/React.createElement("tr", {
    style: rowStyle
  }, /*#__PURE__*/React.createElement("td", {
    style: cellStyle
  }, "Standard MFA"), /*#__PURE__*/React.createElement("td", {
    style: {
      ...cellStyle,
      ...monoRight
    }
  }, fmt(MFA_STATS.standard)), /*#__PURE__*/React.createElement("td", {
    style: {
      ...cellStyle,
      ...monoRight,
      color: 'var(--text-soft)'
    }
  }, mfaPct(MFA_STATS.standard), "%")), MFA_STATS.weak > 0 && /*#__PURE__*/React.createElement("tr", {
    style: rowStyle
  }, /*#__PURE__*/React.createElement("td", {
    style: cellStyle
  }, "Weak (SMS/voice)"), /*#__PURE__*/React.createElement("td", {
    style: {
      ...cellStyle,
      ...monoRight
    }
  }, fmt(MFA_STATS.weak)), /*#__PURE__*/React.createElement("td", {
    style: {
      ...cellStyle,
      ...monoRight,
      color: 'var(--warn-text)'
    }
  }, mfaPct(MFA_STATS.weak), "%")), /*#__PURE__*/React.createElement("tr", {
    style: rowStyle
  }, /*#__PURE__*/React.createElement("td", {
    style: cellStyle
  }, "No MFA"), /*#__PURE__*/React.createElement("td", {
    style: {
      ...cellStyle,
      ...monoRight
    }
  }, fmt(MFA_STATS.none)), /*#__PURE__*/React.createElement("td", {
    style: {
      ...cellStyle,
      ...monoRight,
      color: MFA_STATS.none > 0 ? 'var(--danger-text)' : 'var(--muted)'
    }
  }, mfaPct(MFA_STATS.none), "%")), MFA_STATS.adminsWithoutMfa > 0 && /*#__PURE__*/React.createElement("tr", {
    style: rowStyle
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      ...cellStyle,
      color: 'var(--danger-text)',
      fontWeight: 600
    }
  }, "Admins without MFA"), /*#__PURE__*/React.createElement("td", {
    style: {
      ...cellStyle,
      ...monoRight,
      color: 'var(--danger-text)',
      fontWeight: 600
    }
  }, fmt(MFA_STATS.adminsWithoutMfa)), /*#__PURE__*/React.createElement("td", {
    style: cellStyle
  }))))), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    style: labelStyle
  }, "Conditional Access policies (", ca.length, ")"), /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      fontSize: 12,
      borderCollapse: 'collapse'
    }
  }, /*#__PURE__*/React.createElement("tbody", null, ca.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i,
    style: rowStyle
  }, /*#__PURE__*/React.createElement("td", {
    style: cellStyle
  }, r.DisplayName), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'right',
      paddingRight: 6
    }
  }, /*#__PURE__*/React.createElement(StatusDot, {
    ok: r.State === 'enabled',
    warn: r.State?.includes('Report')
  })), /*#__PURE__*/React.createElement("td", {
    style: {
      ...cellStyle,
      textAlign: 'right',
      color: 'var(--muted)'
    }
  }, r.State)))))), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    style: labelStyle
  }, "Privileged roles (", allRoles.length, " assignments)"), /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      fontSize: 12,
      borderCollapse: 'collapse'
    }
  }, /*#__PURE__*/React.createElement("tbody", null, roleEntries.map(([role, count], i) => /*#__PURE__*/React.createElement("tr", {
    key: i,
    style: rowStyle
  }, /*#__PURE__*/React.createElement("td", {
    style: cellStyle
  }, role), /*#__PURE__*/React.createElement("td", {
    style: {
      ...cellStyle,
      ...monoRight,
      color: 'var(--muted)'
    }
  }, count)))))), dnsTotal > 0 && /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    style: labelStyle
  }, "Email authentication (", dnsTotal, " domain", dnsTotal !== 1 ? 's' : '', ")"), /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      fontSize: 12,
      borderCollapse: 'collapse'
    }
  }, /*#__PURE__*/React.createElement("tbody", null, /*#__PURE__*/React.createElement("tr", {
    style: rowStyle
  }, /*#__PURE__*/React.createElement("td", {
    style: cellStyle
  }, "SPF passing"), /*#__PURE__*/React.createElement("td", {
    style: {
      ...cellStyle,
      ...monoRight,
      color: spfPass === dnsTotal ? 'var(--success-text)' : spfPass > 0 ? 'var(--warn-text)' : 'var(--danger-text)'
    }
  }, spfPass, "/", dnsTotal)), /*#__PURE__*/React.createElement("tr", {
    style: rowStyle
  }, /*#__PURE__*/React.createElement("td", {
    style: cellStyle
  }, "DKIM passing"), /*#__PURE__*/React.createElement("td", {
    style: {
      ...cellStyle,
      ...monoRight,
      color: dkimPass === dnsTotal ? 'var(--success-text)' : dkimPass > 0 ? 'var(--warn-text)' : 'var(--danger-text)'
    }
  }, dkimPass, "/", dnsTotal)), /*#__PURE__*/React.createElement("tr", {
    style: rowStyle
  }, /*#__PURE__*/React.createElement("td", {
    style: cellStyle
  }, "DMARC enforced"), /*#__PURE__*/React.createElement("td", {
    style: {
      ...cellStyle,
      ...monoRight,
      color: dmarcEnf === dnsTotal ? 'var(--success-text)' : dmarcEnf > 0 ? 'var(--warn-text)' : 'var(--danger-text)'
    }
  }, dmarcEnf, "/", dnsTotal))))), ad && /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    style: labelStyle
  }, "Hybrid sync"), /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      fontSize: 12,
      borderCollapse: 'collapse'
    }
  }, /*#__PURE__*/React.createElement("tbody", null, /*#__PURE__*/React.createElement("tr", {
    style: rowStyle
  }, /*#__PURE__*/React.createElement("td", {
    style: cellStyle
  }, "Sync type"), /*#__PURE__*/React.createElement("td", {
    style: {
      ...cellStyle,
      textAlign: 'right'
    }
  }, ad.syncType || 'Cloud-only')), /*#__PURE__*/React.createElement("tr", {
    style: rowStyle
  }, /*#__PURE__*/React.createElement("td", {
    style: cellStyle
  }, "Password hash sync"), /*#__PURE__*/React.createElement("td", {
    style: {
      ...cellStyle,
      textAlign: 'right',
      color: phsColor,
      fontWeight: 600
    }
  }, phsLabel)), ad.lastSync && /*#__PURE__*/React.createElement("tr", {
    style: rowStyle
  }, /*#__PURE__*/React.createElement("td", {
    style: cellStyle
  }, "Last sync"), /*#__PURE__*/React.createElement("td", {
    style: {
      ...cellStyle,
      textAlign: 'right',
      fontFamily: 'var(--font-mono)'
    }
  }, String(ad.lastSync).slice(0, 19).replace('T', ' ')))))))));
}
function StatusDot({
  ok,
  warn
}) {
  const bg = ok ? 'var(--success)' : warn ? 'var(--warn)' : 'var(--danger)';
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-block',
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: bg
    }
  });
}

// ======================== Tweaks panel ========================
function TweaksPanel({
  onClose,
  theme,
  setTheme,
  mode,
  setMode,
  density,
  setDensity
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "tweaks-panel"
  }, /*#__PURE__*/React.createElement("h3", null, "Tweaks ", /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    style: {
      background: 'none',
      border: 0,
      color: 'var(--muted)',
      cursor: 'pointer',
      fontSize: 16,
      lineHeight: 1
    }
  }, "\xD7")), /*#__PURE__*/React.createElement("div", {
    className: "tw-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tw-label"
  }, "Palette"), /*#__PURE__*/React.createElement("div", {
    className: "swatches"
  }, /*#__PURE__*/React.createElement("div", {
    className: 'swatch' + (theme === 'neon' ? ' active' : ''),
    onClick: () => setTheme('neon'),
    style: {
      background: 'linear-gradient(135deg, #c084fc, #8b5cf6, #06b6d4)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: 'swatch' + (theme === 'console' ? ' active' : ''),
    onClick: () => setTheme('console'),
    style: {
      background: 'linear-gradient(135deg, #4c8bff, #2563eb)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: 'swatch' + (theme === 'saas' ? ' active' : ''),
    onClick: () => setTheme('saas'),
    style: {
      background: 'linear-gradient(135deg, #e8a598, #d4857a, #b86e6e)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: 'swatch' + (theme === 'high-contrast' ? ' active' : ''),
    onClick: () => setTheme('high-contrast'),
    style: {
      background: 'linear-gradient(135deg, #005da8, #003d7a)'
    }
  }))), /*#__PURE__*/React.createElement("div", {
    className: "tw-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tw-label"
  }, "Mode"), /*#__PURE__*/React.createElement("div", {
    className: "seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: mode === 'light' ? 'active' : '',
    onClick: () => setMode('light')
  }, "Light"), /*#__PURE__*/React.createElement("button", {
    className: mode === 'dark' ? 'active' : '',
    onClick: () => setMode('dark')
  }, "Dark"))), /*#__PURE__*/React.createElement("div", {
    className: "tw-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tw-label"
  }, "Density"), /*#__PURE__*/React.createElement("div", {
    className: "seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: density === 'compact' ? 'active' : '',
    onClick: () => setDensity('compact')
  }, "Compact"), /*#__PURE__*/React.createElement("button", {
    className: density === 'comfort' ? 'active' : '',
    onClick: () => setDensity('comfort')
  }, "Comfort"))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--muted)',
      marginTop: 4,
      borderTop: '1px solid var(--border)',
      paddingTop: 10
    }
  }, "Palette/mode/density settings are saved to localStorage and apply to this report."));
}

// ======================== App root ========================
function App() {
  const DEFAULTS = /*EDITMODE-BEGIN*/{
    "theme": "neon",
    "mode": "dark",
    "density": "compact"
  } /*EDITMODE-END*/;
  const lsGet = (k, def) => {
    try {
      return localStorage.getItem(k) || def;
    } catch (e) {
      return def;
    }
  };
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
          status: Array.isArray(saved.status) ? saved.status : [],
          severity: Array.isArray(saved.severity) ? saved.severity : [],
          framework: Array.isArray(saved.framework) ? saved.framework : [],
          domain: Array.isArray(saved.domain) ? saved.domain : [],
          profile: Array.isArray(saved.profile) ? saved.profile : []
        };
      }
    } catch {}
    return {
      status: [],
      severity: [],
      framework: [],
      domain: [],
      profile: []
    };
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
  useEffect(() => {
    setMatchIdx(0);
  }, [search]);
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
  const [roadmapOverrides, setRoadmapOverrides] = useState(() => RO?.roadmapOverrides || {});
  const toggleHideFinding = id => setHiddenFindings(prev => {
    const s = new Set(prev);
    s.has(id) ? s.delete(id) : s.add(id);
    return s;
  });
  const restoreAllFindings = () => setHiddenFindings(new Set());
  const handleFinalize = () => finalizeReport({
    hiddenFindings: [...hiddenFindings],
    roadmapOverrides
  });
  const handleResetAll = () => {
    setHiddenFindings(new Set());
    setRoadmapOverrides({});
  };
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
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
    } catch {}
  }, [filters]);

  // Slash-key to focus search
  useEffect(() => {
    const h = e => {
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
      entries.forEach(e => {
        if (e.isIntersecting) setActive(e.target.id);
      });
    }, {
      rootMargin: '-40% 0px -55% 0px'
    });
    sections.forEach(s => obs.observe(s));
    return () => obs.disconnect();
  }, []);

  // Scrollspy — Domain posture sub-sections (drives submenu auto-highlight)
  useEffect(() => {
    const subIds = ['identity-intune', 'identity-sharepoint', 'identity-ad', 'identity-email'];
    const elements = subIds.map(id => document.getElementById(id)).filter(Boolean);
    if (!elements.length) return;
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) setActiveSubsection(e.target.id);
      });
    }, {
      rootMargin: '-30% 0px -60% 0px'
    });
    elements.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  // Counts for filter bar
  const counts = useMemo(() => {
    const c = {
      status: {},
      severity: {},
      framework: {},
      domain: {}
    };
    FINDINGS.forEach(f => {
      c.status[f.status] = (c.status[f.status] || 0) + 1;
      c.severity[f.severity] = (c.severity[f.severity] || 0) + 1;
      c.domain[f.domain] = (c.domain[f.domain] || 0) + 1;
      f.frameworks.forEach(fw => c.framework[fw] = (c.framework[fw] || 0) + 1);
    });
    return c;
  }, []);
  const navCounts = {
    total: FINDINGS.length,
    identity: FINDINGS.filter(f => ['Entra ID', 'Conditional Access', 'Enterprise Apps'].includes(f.domain) && f.status === 'Fail').length,
    stryker: FINDINGS.filter(f => f.domain === 'Stryker Readiness' && f.status === 'Fail').length
  };
  const domainCounts = useMemo(() => {
    const total = {},
      fail = {};
    FINDINGS.forEach(f => {
      total[f.domain] = (total[f.domain] || 0) + 1;
      if (f.status === 'Fail') fail[f.domain] = (fail[f.domain] || 0) + 1;
    });
    return {
      total,
      fail
    };
  }, []);
  const onFrameworkSelect = fw => {
    setFilters(f => ({
      ...f,
      framework: fw ? [fw] : []
    }));
    if (fw) document.getElementById('findings-anchor')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  };
  const onProfileSelect = (fw, nextProfiles) => {
    // Multi-select: nextProfiles is an array (possibly empty for "all cleared").
    // Stay in place visually — chart bars and findings table refresh in the background.
    const arr = Array.isArray(nextProfiles) ? nextProfiles : nextProfiles ? [nextProfiles] : [];
    setFilters(f => ({
      ...f,
      framework: arr.length > 0 && fw ? [fw] : f.framework,
      profile: arr
    }));
  };
  const onDomainJump = d => {
    setFilters(f => ({
      ...f,
      domain: d ? [d] : []
    }));
    if (d) document.getElementById('findings-anchor')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  };
  const onOverviewClick = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
    setActive('overview');
    onDomainJump(null);
  };
  const onViewFinding = useCallback(checkId => {
    setFilters({
      status: [],
      severity: [],
      framework: [],
      domain: [],
      profile: []
    });
    setSearch('');
    setFocusFinding(checkId);
    document.getElementById('findings-anchor')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }, []);
  return /*#__PURE__*/React.createElement("div", {
    className: "app"
  }, /*#__PURE__*/React.createElement(Sidebar, {
    active: active,
    activeSubsection: activeSubsection,
    counts: navCounts,
    domainCounts: domainCounts,
    activeDomain: filters.domain.length === 1 ? filters.domain[0] : null,
    onDomainJump: onDomainJump,
    onOverviewClick: onOverviewClick,
    navOpen: navOpen,
    onClose: () => setNavOpen(false)
  }), /*#__PURE__*/React.createElement("main", {
    className: "main"
  }, /*#__PURE__*/React.createElement(Topbar, {
    search: search,
    setSearch: setSearch,
    searchMatches: searchMatches,
    matchIdx: matchIdx,
    onAdvanceMatch: handleAdvanceMatch,
    onRetreatMatch: handleRetreatMatch,
    mode: mode,
    setMode: setMode,
    theme: theme,
    setTheme: setTheme,
    textScale: textScale,
    setTextScale: setTextScale,
    onPrint: () => window.print(),
    onTweaks: () => setShowTweaks(s => !s),
    onHamburger: () => setNavOpen(o => !o),
    editMode: editMode,
    onEditToggle: () => setEditMode(e => !e),
    onFinalize: handleFinalize,
    onReset: handleResetAll,
    hiddenCount: hiddenFindings.size
  }), /*#__PURE__*/React.createElement(Overview, null), /*#__PURE__*/React.createElement(Posture, null), /*#__PURE__*/React.createElement(TrendChart, null), /*#__PURE__*/React.createElement(FrameworkQuilt, {
    onSelect: onFrameworkSelect,
    selected: filters.framework[0],
    onProfileSelect: onProfileSelect,
    activeProfiles: filters.profile || []
  }), /*#__PURE__*/React.createElement(DomainRollup, {
    onJump: onDomainJump
  }), /*#__PURE__*/React.createElement(PermissionsPanel, null), /*#__PURE__*/React.createElement("div", {
    id: "findings-anchor"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 20
    }
  }), /*#__PURE__*/React.createElement(FilterBar, {
    filters: filters,
    setFilters: setFilters,
    counts: counts,
    total: FINDINGS.length,
    search: search,
    setSearch: setSearch
  }), /*#__PURE__*/React.createElement(FindingsTable, {
    filters: filters,
    search: search,
    focusFinding: focusFinding,
    onFocusClear: () => setFocusFinding(null),
    onMatchesChange: setSearchMatches,
    editMode: editMode,
    hiddenFindings: hiddenFindings,
    onHide: toggleHideFinding,
    onRestoreAll: restoreAllFindings
  }), /*#__PURE__*/React.createElement(Roadmap, {
    onViewFinding: onViewFinding,
    editMode: editMode,
    hiddenFindings: hiddenFindings,
    roadmapOverrides: roadmapOverrides,
    onRoadmapChange: setRoadmapOverrides
  }), /*#__PURE__*/React.createElement(Appendix, null), !D.whiteLabel && /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      padding: '30px 0 10px',
      fontSize: 12,
      color: 'var(--muted)',
      fontFamily: 'var(--font-mono)',
      letterSpacing: '.06em',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "https://github.com/Galvnyz/M365-Assess",
    target: "_blank",
    rel: "noreferrer",
    style: {
      color: 'inherit',
      textDecoration: 'underline',
      textUnderlineOffset: 3
    }
  }, "M365 ASSESS"), ' · READ-ONLY SECURITY ASSESSMENT · ', /*#__PURE__*/React.createElement("a", {
    href: "https://galvnyz.com",
    target: "_blank",
    rel: "noreferrer",
    style: {
      color: 'inherit',
      textDecoration: 'underline',
      textUnderlineOffset: 3
    }
  }, "GALVNYZ"), /*#__PURE__*/React.createElement("button", {
    className: 'edit-mode-toggle' + (editMode ? ' active' : ''),
    onClick: () => setEditMode(e => !e),
    title: "Toggle edit mode"
  }, "\u270E"))), showTweaks && /*#__PURE__*/React.createElement(TweaksPanel, {
    onClose: () => setShowTweaks(false),
    theme: theme,
    setTheme: setTheme,
    mode: mode,
    setMode: setMode,
    density: density,
    setDensity: setDensity
  }));
}
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(/*#__PURE__*/React.createElement(App, null));
