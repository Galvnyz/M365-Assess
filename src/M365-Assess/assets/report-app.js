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
const USERS = D.users[0] || {};
const SCORE = D.score[0] || {};
const MFA_STATS = D.mfaStats;
const FINDINGS = D.findings;
const DOMAIN_STATS = D.domainStats;
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
  }, /*#__PURE__*/React.createElement("path", {
    d: "M13 9.4A6 6 0 1 1 6.6 3 5 5 0 0 0 13 9.4z"
  })),
  sun: () => /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "8",
    cy: "8",
    r: "3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M13 3l-1.4 1.4M4.4 11.6L3 13"
  })),
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
const STATUS_COLORS = {
  Fail: 'fail',
  Warning: 'warn',
  Pass: 'pass',
  Review: 'review',
  Info: 'info'
};
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
const fmt = n => Number(n).toLocaleString();

// ======================== Sidebar ========================
function Sidebar({
  active,
  counts,
  domainCounts,
  activeDomain,
  onDomainJump,
  navOpen,
  onClose
}) {
  const DOM_ORDER = ['Entra ID', 'Conditional Access', 'Enterprise Apps', 'Exchange Online', 'Intune', 'Defender', 'Purview / Compliance', 'SharePoint & OneDrive', 'Teams', 'Forms', 'Power BI', 'Active Directory', 'SOC 2', 'Value Opportunity'];
  const domains = DOM_ORDER.filter(d => domainCounts.total[d]).concat(Object.keys(domainCounts.total).filter(d => !DOM_ORDER.includes(d)).sort());
  const exec = [{
    id: 'overview',
    label: 'Overview'
  }, {
    id: 'posture',
    label: 'Posture score'
  }, {
    id: 'identity',
    label: 'Domain posture'
  }, {
    id: 'frameworks',
    label: 'Frameworks'
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
  }, /*#__PURE__*/React.createElement(Icon.close, null))), /*#__PURE__*/React.createElement("nav", null, /*#__PURE__*/React.createElement("div", {
    className: "nav-label"
  }, "Executive"), exec.map(it => /*#__PURE__*/React.createElement("a", {
    href: `#${it.id}`,
    key: it.id,
    onClick: closeIfMobile,
    className: 'nav-item' + (active === it.id ? ' active' : '')
  }, /*#__PURE__*/React.createElement("span", null, it.label))), /*#__PURE__*/React.createElement("div", {
    className: "nav-label",
    style: {
      marginTop: 14
    }
  }, "Domains"), domains.map(d => {
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
    className: "nav-label",
    style: {
      marginTop: 14
    }
  }, "Details"), details.map(it => /*#__PURE__*/React.createElement("a", {
    href: `#${it.id}`,
    key: it.id,
    onClick: e => {
      if (it.id === 'findings') onDomainJump(null);
      closeIfMobile();
    },
    className: 'nav-item' + (active === it.id && !(it.id === 'findings' && activeDomain) ? ' active' : '')
  }, /*#__PURE__*/React.createElement("span", null, it.label), it.count !== undefined && /*#__PURE__*/React.createElement("span", {
    className: "count"
  }, it.count)))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 24,
      padding: '12px 8px',
      borderTop: '1px solid var(--border)',
      fontSize: 11,
      color: 'var(--muted)',
      lineHeight: 1.5
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)'
    }
  }, TENANT.OrgDisplayName), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 2,
      opacity: .7
    }
  }, "Run \xB7 ", new Date(SCORE.CreatedDateTime || Date.now()).toLocaleDateString()))));
}

// ======================== Topbar ========================
function Topbar({
  search,
  setSearch,
  mode,
  setMode,
  theme,
  setTheme,
  onPrint,
  onTweaks,
  onHamburger
}) {
  return /*#__PURE__*/React.createElement("div", {
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
    placeholder: "Search findings, check IDs, remediation\u2026"
  }), /*#__PURE__*/React.createElement("kbd", null, "/")), /*#__PURE__*/React.createElement("div", {
    className: "palette-switch"
  }, /*#__PURE__*/React.createElement("button", {
    className: theme === 'neon' ? 'active' : '',
    onClick: () => setTheme('neon')
  }, "Neon"), /*#__PURE__*/React.createElement("button", {
    className: theme === 'console' ? 'active' : '',
    onClick: () => setTheme('console')
  }, "Console"), /*#__PURE__*/React.createElement("button", {
    className: theme === 'high-contrast' ? 'active' : '',
    onClick: () => setTheme('high-contrast')
  }, "High Contrast")), /*#__PURE__*/React.createElement("div", {
    className: "icon-btn-group"
  }, /*#__PURE__*/React.createElement("button", {
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
  }, /*#__PURE__*/React.createElement(Icon.sliders, null))));
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
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
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
      width: pct(fail, FINDINGS.length) + '%',
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
      width: pct(warn, FINDINGS.length) + '%',
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
      width: pct(pass, FINDINGS.length) + '%',
      background: 'var(--success)'
    }
  })))), /*#__PURE__*/React.createElement(MFABreakdown, null))), critical > 0 && /*#__PURE__*/React.createElement("div", {
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

// ======================== Domain rollup ========================
function DomainRollup({
  onJump
}) {
  return /*#__PURE__*/React.createElement("section", {
    className: "block",
    id: "identity"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "eyebrow"
  }, "01 \xB7 Domains"), /*#__PURE__*/React.createElement("h2", null, "Security posture by domain"), /*#__PURE__*/React.createElement("div", {
    className: "hr"
  })), /*#__PURE__*/React.createElement("div", {
    className: "domain-grid"
  }, DOMAIN_ORDER.map(name => {
    const d = DOMAIN_STATS[name];
    if (!d) return null;
    const total = d.total;
    const score = Math.round((d.pass + d.info * 0.5) / total * 100);
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
    })), /*#__PURE__*/React.createElement("div", {
      className: "dc-meta"
    }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, d.pass), " pass"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, d.warn), " warn"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, d.fail), " fail"), d.review > 0 && /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, d.review), " review")));
  })));
}

// ======================== Framework quilt ========================
function FrameworkQuilt({
  onSelect,
  selected
}) {
  const [visibleFws, setVisibleFws] = useState(['cis-m365-v6']);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expandedFw, setExpandedFw] = useState(null);
  const pickerRef = useRef(null);
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
    const out = {};
    FINDINGS.forEach(f => {
      if (!f.frameworks.includes(expandedFw)) return;
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
  }, [expandedFw]);
  const fwProfileStats = useMemo(() => {
    if (!expandedFw) return null;
    const l1 = new Set(),
      l2 = new Set(),
      e3 = new Set(),
      e5only = new Set();
    FINDINGS.forEach((f, idx) => {
      const profiles = [].concat(f.fwMeta?.[expandedFw]?.profiles || []);
      if (profiles.length === 0) return;
      const hasE3 = profiles.some(p => p.startsWith('E3'));
      profiles.forEach(p => {
        if (p.includes('L1')) l1.add(idx);
        if (p.includes('L2')) l2.add(idx);
      });
      if (hasE3) e3.add(idx);else e5only.add(idx);
    });
    return {
      l1: l1.size,
      l2: l2.size,
      e3: e3.size,
      e5only: e5only.size
    };
  }, [expandedFw]);
  const displayFws = FRAMEWORKS.filter(f => visibleFws.includes(f.id));
  const pickerLabel = visibleFws.length === 1 ? FRAMEWORKS.find(f => f.id === visibleFws[0])?.full || visibleFws[0] : `${visibleFws.length} frameworks`;
  const handleCardClick = fwId => setExpandedFw(e => e === fwId ? null : fwId);
  const expandedMeta = expandedFw ? FRAMEWORKS.find(f => f.id === expandedFw) : null;
  const expandedData = expandedFw ? byFw[expandedFw] : null;
  return /*#__PURE__*/React.createElement("section", {
    className: "block",
    id: "frameworks"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "eyebrow"
  }, "02 \xB7 Compliance"), /*#__PURE__*/React.createElement("h2", null, "Framework coverage"), /*#__PURE__*/React.createElement("div", {
    ref: pickerRef,
    style: {
      position: 'relative',
      marginLeft: 12,
      flexShrink: 0
    }
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
      fontSize: 10,
      color: 'var(--muted)',
      marginTop: 1
    }
  }, f.id)), /*#__PURE__*/React.createElement("span", {
    className: "ct"
  }, byFw[f.id]?.total || 0))))), /*#__PURE__*/React.createElement("div", {
    className: "hr"
  })), /*#__PURE__*/React.createElement("div", {
    className: "quilt"
  }, displayFws.map(f => {
    const d = byFw[f.id];
    const score = pct(d.pass + Math.round(d.info * 0.5), d.total);
    const isExpanded = expandedFw === f.id;
    return /*#__PURE__*/React.createElement("div", {
      key: f.id,
      className: 'quilt-cell' + (isExpanded ? ' expanded' : '') + (selected === f.id ? ' selected' : ''),
      onClick: () => handleCardClick(f.id)
    }, /*#__PURE__*/React.createElement("div", {
      className: "fw-name"
    }, f.id), /*#__PURE__*/React.createElement("div", {
      className: "fw-long"
    }, f.full), /*#__PURE__*/React.createElement("div", {
      className: "fw-bar"
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
    }), d.total === 0 && /*#__PURE__*/React.createElement("div", {
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
  }, "\xD7")), /*#__PURE__*/React.createElement("div", {
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
  }, expandedData.fail), " fail"), expandedData.review > 0 && /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, expandedData.review), " review")), fwProfileStats && fwProfileStats.l1 + fwProfileStats.l2 + fwProfileStats.e3 + fwProfileStats.e5only > 0 && /*#__PURE__*/React.createElement("div", {
    className: "fw-profile-stats"
  }, /*#__PURE__*/React.createElement("span", {
    className: "fw-profile-chip level"
  }, "L1 ", /*#__PURE__*/React.createElement("b", null, fwProfileStats.l1)), fwProfileStats.l2 > 0 && /*#__PURE__*/React.createElement("span", {
    className: "fw-profile-chip level2"
  }, "L2 ", /*#__PURE__*/React.createElement("b", null, fwProfileStats.l2)), /*#__PURE__*/React.createElement("span", {
    className: "fw-profile-sep"
  }, "\xB7"), /*#__PURE__*/React.createElement("span", {
    className: "fw-profile-chip lic"
  }, "E3 ", /*#__PURE__*/React.createElement("b", null, fwProfileStats.e3)), fwProfileStats.e5only > 0 && /*#__PURE__*/React.createElement("span", {
    className: "fw-profile-chip lic5"
  }, "E5 only ", /*#__PURE__*/React.createElement("b", null, fwProfileStats.e5only))), /*#__PURE__*/React.createElement("div", {
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
      fontSize: 10,
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
  }, "View all ", expandedData.total, " findings in this framework \u2192"))));
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
  const active = filters.status.length + filters.severity.length + filters.framework.length + filters.domain.length;
  const statusChips = [['Fail', 'fail'], ['Warning', 'warn'], ['Review', 'review'], ['Pass', 'pass'], ['Info', 'info']];
  const sevChips = [['critical', 'crit', 'Critical'], ['high', 'high', 'High'], ['medium', 'med', 'Medium'], ['low', 'low', 'Low']];
  const DOM_ORDER = ['Entra ID', 'Conditional Access', 'Enterprise Apps', 'Exchange Online', 'Intune', 'Defender', 'Purview / Compliance', 'SharePoint & OneDrive', 'Teams', 'Forms', 'Power BI', 'Active Directory', 'SOC 2', 'Value Opportunity'];
  const domainList = DOM_ORDER.filter(d => counts.domain[d]).concat(Object.keys(counts.domain).filter(d => !DOM_ORDER.includes(d)).sort());
  return /*#__PURE__*/React.createElement("div", {
    className: "filter-bar"
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
    placeholder: "Search findings, check IDs, remediation\u2026"
  }), search && /*#__PURE__*/React.createElement("button", {
    className: "fb-clear-x",
    onClick: () => setSearch(''),
    "aria-label": "Clear"
  }, "\xD7")), /*#__PURE__*/React.createElement("div", {
    className: "filter-divider"
  }), /*#__PURE__*/React.createElement("div", {
    className: "filter-group"
  }, /*#__PURE__*/React.createElement("span", {
    className: "filter-group-label"
  }, "Status"), statusChips.map(([v, cls]) => /*#__PURE__*/React.createElement("button", {
    key: v,
    className: 'chip ' + cls + (filters.status.includes(v) ? ' selected' : ''),
    onClick: () => update('status', v)
  }, /*#__PURE__*/React.createElement("span", {
    className: "dot"
  }), v, /*#__PURE__*/React.createElement("span", {
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
  }, counts.severity[v] || 0)))), /*#__PURE__*/React.createElement("div", {
    className: "filter-divider"
  }), /*#__PURE__*/React.createElement("div", {
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
  }, counts.domain[d] || 0))))), active > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "filter-divider"
  }), /*#__PURE__*/React.createElement("button", {
    className: "filter-clear",
    onClick: () => setFilters({
      status: [],
      severity: [],
      framework: [],
      domain: []
    })
  }, "Clear ", active, " filter", active === 1 ? '' : 's')));
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
  search
}) {
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
  const toggleCol = id => setVisibleCols(v => v.includes(id) ? v.length > 1 ? v.filter(c => c !== id) : v : [...v, id]);
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
        const hay = (f.setting + ' ' + f.checkId + ' ' + f.current + ' ' + f.recommended + ' ' + f.remediation + ' ' + f.domain + ' ' + f.section).toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [filters, search]);
  const toggle = i => setOpen(o => {
    const n = new Set(o);
    if (n.has(i)) n.delete(i);else n.add(i);
    return n;
  });
  const renderCell = (colId, f) => {
    switch (colId) {
      case 'status':
        return /*#__PURE__*/React.createElement("div", {
          key: "status"
        }, /*#__PURE__*/React.createElement("span", {
          className: 'status-badge ' + STATUS_COLORS[f.status]
        }, /*#__PURE__*/React.createElement("span", {
          className: "dot"
        }), f.status));
      case 'finding':
        return /*#__PURE__*/React.createElement("div", {
          key: "finding",
          className: "finding-title"
        }, /*#__PURE__*/React.createElement("div", {
          className: "t"
        }, f.setting), /*#__PURE__*/React.createElement("div", {
          className: "sub"
        }, f.section));
      case 'domain':
        return /*#__PURE__*/React.createElement("div", {
          key: "domain",
          className: "finding-dom"
        }, f.domain);
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
          const lvl = [...new Set(profiles.map(p => p.split('-')[1]).filter(Boolean))].join('+');
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
            className: 'fw-profile-chip level' + (lvl.includes('L2') ? lvl.includes('L1') ? '' : '2' : '')
          }, lvl), lic && /*#__PURE__*/React.createElement("span", {
            className: 'fw-profile-chip ' + (lic === 'E5' ? 'lic5' : 'lic')
          }, lic)));
        }
      case 'checkId':
        return /*#__PURE__*/React.createElement("div", {
          key: "checkId",
          className: "check-id"
        }, f.checkId);
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
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "eyebrow"
  }, "03 \xB7 Detail"), /*#__PURE__*/React.createElement("h2", null, "All findings ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 400,
      color: 'var(--muted)',
      fontSize: 13
    }
  }, "\xB7 ", filtered.length, " of ", FINDINGS.length)), /*#__PURE__*/React.createElement("div", {
    ref: colPickerRef,
    style: {
      position: 'relative',
      marginLeft: 12,
      flexShrink: 0
    }
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
  }), /*#__PURE__*/React.createElement("span", null, c.label))))), /*#__PURE__*/React.createElement("div", {
    className: "hr"
  })), /*#__PURE__*/React.createElement("div", {
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
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: i
    }, /*#__PURE__*/React.createElement("div", {
      className: 'finding-row' + (isOpen ? ' open' : ''),
      onClick: () => toggle(i),
      style: {
        gridTemplateColumns: gridTpl
      }
    }, cols.map(c => renderCell(c.id, f)), /*#__PURE__*/React.createElement("div", {
      className: "caret"
    }, /*#__PURE__*/React.createElement(Icon.chevron, null))), isOpen && /*#__PURE__*/React.createElement("div", {
      className: "finding-detail"
    }, /*#__PURE__*/React.createElement("div", {
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
    }, f.recommended || '—')), /*#__PURE__*/React.createElement("div", {
      className: "remediation"
    }, /*#__PURE__*/React.createElement("div", {
      className: "block-title",
      style: {
        margin: '0 0 6px'
      }
    }, "Remediation"), renderRemediation(f.remediation))));
  })));
}
function renderRemediation(text) {
  if (!text) return /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, "No remediation guidance provided.");
  // Highlight Run: PowerShell commands
  const parts = text.split(/(Run:[^.]*\.)/);
  return /*#__PURE__*/React.createElement("span", null, parts.map((p, i) => {
    if (p.startsWith('Run:')) {
      const cmd = p.replace(/^Run:\s*/, '').replace(/\.$/, '');
      return /*#__PURE__*/React.createElement("span", {
        key: i
      }, /*#__PURE__*/React.createElement("strong", {
        style: {
          color: 'var(--accent-text)'
        }
      }, "PowerShell:"), " ", /*#__PURE__*/React.createElement("code", null, cmd), ". ");
    }
    return /*#__PURE__*/React.createElement("span", {
      key: i
    }, p);
  }));
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
function Roadmap() {
  const [open, setOpen] = useState(null);
  const tasks = FINDINGS.filter(f => f.status !== 'Pass' && f.status !== 'Info').map(f => ({
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
  const now = tasks.filter(t => t.severity === 'critical' || t.severity === 'high' && t.effort === 'small');
  const soon = tasks.filter(t => !now.includes(t) && (t.severity === 'high' || t.severity === 'medium' && t.effort !== 'large'));
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
    return /*#__PURE__*/React.createElement("div", {
      className: 'task' + (isOpen ? ' task-open' : ''),
      key: key
    }, /*#__PURE__*/React.createElement("button", {
      className: "task-head-btn",
      onClick: () => setOpen(isOpen ? null : key),
      "aria-expanded": isOpen
    }, /*#__PURE__*/React.createElement("div", {
      className: "task-head"
    }, /*#__PURE__*/React.createElement("span", null, t.setting), /*#__PURE__*/React.createElement("span", {
      className: 'status-badge ' + STATUS_COLORS[t.status]
    }, /*#__PURE__*/React.createElement("span", {
      className: "dot"
    }), t.status)), /*#__PURE__*/React.createElement("div", {
      className: "task-id"
    }, t.checkId, " \xB7 ", t.domain), /*#__PURE__*/React.createElement("div", {
      className: "task-tags"
    }, /*#__PURE__*/React.createElement("span", {
      className: "task-tag"
    }, SEV_LABEL[t.severity]), t.effort && /*#__PURE__*/React.createElement("span", {
      className: "task-tag"
    }, t.effort, " effort"), t.frameworks.slice(0, 3).map(fw => /*#__PURE__*/React.createElement("span", {
      key: fw,
      className: "task-tag",
      style: {
        fontFamily: 'var(--font-mono)'
      }
    }, fw)), /*#__PURE__*/React.createElement("span", {
      className: "task-chev",
      "aria-hidden": "true"
    }, isOpen ? '−' : '+'))), isOpen && /*#__PURE__*/React.createElement("div", {
      className: "task-body"
    }, /*#__PURE__*/React.createElement("div", {
      className: "task-why"
    }, /*#__PURE__*/React.createElement("div", {
      className: "task-why-label"
    }, "Why this is in ", lane === 'now' ? '“Now”' : lane === 'soon' ? '“Next”' : '“Later”'), /*#__PURE__*/React.createElement("div", {
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
    }, t.rationale)), /*#__PURE__*/React.createElement("div", {
      className: "task-meta-row"
    }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, "Section:"), " ", t.section), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, "Severity:"), " ", SEV_LABEL[t.severity]), t.effort && /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, "Effort:"), " ", t.effort), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, "Frameworks:"), " ", t.frameworks.join(', ') || '—')), /*#__PURE__*/React.createElement("div", {
      className: "task-actions"
    }, /*#__PURE__*/React.createElement("a", {
      href: "#findings-anchor",
      onClick: e => {
        e.preventDefault();
        document.getElementById('findings-anchor')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    }, "View in findings table \u2192"))));
  };
  return /*#__PURE__*/React.createElement("section", {
    className: "block",
    id: "roadmap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "eyebrow"
  }, "04 \xB7 Action plan"), /*#__PURE__*/React.createElement("h2", null, "Remediation roadmap"), /*#__PURE__*/React.createElement("div", {
    className: "hr"
  })), /*#__PURE__*/React.createElement("div", {
    className: "roadmap-intro"
  }, /*#__PURE__*/React.createElement("div", {
    className: "roadmap-intro-head"
  }, "How we prioritized"), /*#__PURE__*/React.createElement("div", {
    className: "roadmap-intro-body"
  }, "Every non-passing finding is scored ", /*#__PURE__*/React.createElement("code", null, "severity \xD7 (1/effort)"), " \u2014 risk weighted against the work needed to close it. Critical findings (identity takeover, data exfiltration, privilege escalation paths) go in ", /*#__PURE__*/React.createElement("b", null, "Now"), " regardless of effort. High-severity findings with small remediation effort \u2014 config toggles, policy tweaks \u2014 also land in ", /*#__PURE__*/React.createElement("b", null, "Now"), " as quick wins. ", /*#__PURE__*/React.createElement("b", null, "Next"), " captures the rest of the high-severity work plus tractable medium-severity items. ", /*#__PURE__*/React.createElement("b", null, "Later"), " holds low-severity hardening and large-effort medium items that need quarterly planning. ", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)'
    }
  }, "Click any task to see why it's in this lane, the current vs recommended state, and exact remediation steps. Customers with a different risk appetite (regulatory deadline, incident response, M&A freeze) may reorder \u2014 the lanes are a starting point, not a mandate."))), /*#__PURE__*/React.createElement("div", {
    className: "roadmap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lane"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lane-head"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lane-title"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lane-dot crit"
  }), "Now ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)',
      fontWeight: 400
    }
  }, "\xB7 ", now.length)), /*#__PURE__*/React.createElement("div", {
    className: "lane-eta"
  }, "< 1 week")), now.map(t => renderTask(t, 'now'))), /*#__PURE__*/React.createElement("div", {
    className: "lane"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lane-head"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lane-title"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lane-dot soon"
  }), "Next ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)',
      fontWeight: 400
    }
  }, "\xB7 ", soon.length)), /*#__PURE__*/React.createElement("div", {
    className: "lane-eta"
  }, "1 \u2013 4 weeks")), soon.map(t => renderTask(t, 'soon'))), /*#__PURE__*/React.createElement("div", {
    className: "lane"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lane-head"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lane-title"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lane-dot later"
  }), "Later ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted)',
      fontWeight: 400
    }
  }, "\xB7 ", later.length)), /*#__PURE__*/React.createElement("div", {
    className: "lane-eta"
  }, "1 \u2013 3 months")), later.map(t => renderTask(t, 'later')))));
}

// ======================== Critical Exposure section ========================
function StrykerBlock() {
  const stryker = FINDINGS.filter(f => f.domain === 'Stryker Readiness');
  if (!stryker.length) return null;
  const fail = stryker.filter(f => f.status === 'Fail').length;
  const pass = stryker.filter(f => f.status === 'Pass').length;
  return /*#__PURE__*/React.createElement("section", {
    className: "block",
    id: "stryker"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "eyebrow"
  }, "01b \xB7 Targeted"), /*#__PURE__*/React.createElement("h2", null, "Critical exposure analysis"), /*#__PURE__*/React.createElement("div", {
    className: "hr"
  })), /*#__PURE__*/React.createElement("div", {
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
      fontSize: 11,
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
  }, pct(pass, stryker.length), /*#__PURE__*/React.createElement("span", {
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
      fontSize: 11,
      color: 'var(--muted)'
    }
  }, "Pass"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      color: 'var(--success-text)'
    }
  }, pass)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--muted)'
    }
  }, "Fail"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      color: 'var(--danger-text)'
    }
  }, fail)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
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
  }), f.status)), /*#__PURE__*/React.createElement("div", {
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
  }, fw))), /*#__PURE__*/React.createElement("div", null)))));
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
  return /*#__PURE__*/React.createElement("section", {
    className: "block",
    id: "appendix"
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "eyebrow"
  }, "05 \xB7 Reference"), /*#__PURE__*/React.createElement("h2", null, "Tenant appendix"), /*#__PURE__*/React.createElement("div", {
    className: "hr"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--muted)',
      textTransform: 'uppercase',
      letterSpacing: '.08em',
      fontWeight: 600,
      marginBottom: 10
    }
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
  }, "Total"))), /*#__PURE__*/React.createElement("tbody", null, D.licenses.filter(l => parseInt(l.Assigned) > 0).map((l, i) => /*#__PURE__*/React.createElement("tr", {
    key: i,
    style: {
      borderTop: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '6px 0'
    }
  }, l.License), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'right',
      fontFamily: 'var(--font-mono)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, l.Assigned), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'right',
      fontFamily: 'var(--font-mono)',
      fontVariantNumeric: 'tabular-nums',
      color: 'var(--muted)'
    }
  }, l.Total)))))), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--muted)',
      textTransform: 'uppercase',
      letterSpacing: '.08em',
      fontWeight: 600,
      marginBottom: 10
    }
  }, "Email authentication posture"), /*#__PURE__*/React.createElement("table", {
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
  }, "Domain"), /*#__PURE__*/React.createElement("th", null, "SPF"), /*#__PURE__*/React.createElement("th", null, "DMARC"), /*#__PURE__*/React.createElement("th", null, "DKIM"))), /*#__PURE__*/React.createElement("tbody", null, D.dns.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i,
    style: {
      borderTop: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '6px 0',
      fontFamily: 'var(--font-mono)',
      fontSize: 11
    }
  }, r.Domain), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(StatusDot, {
    ok: r.SPF && !r.SPF.includes('Not')
  })), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(StatusDot, {
    ok: r.DMARCPolicy === 'reject' || r.DMARCPolicy === 'quarantine',
    warn: r.DMARCPolicy?.includes('none')
  })), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(StatusDot, {
    ok: r.DKIMStatus === 'OK'
  }))))))), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--muted)',
      textTransform: 'uppercase',
      letterSpacing: '.08em',
      fontWeight: 600,
      marginBottom: 10
    }
  }, "Conditional Access policies"), /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      fontSize: 12,
      borderCollapse: 'collapse'
    }
  }, /*#__PURE__*/React.createElement("tbody", null, D.ca.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i,
    style: {
      borderTop: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '6px 0'
    }
  }, r.DisplayName), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement(StatusDot, {
    ok: r.State === 'enabled',
    warn: r.State?.includes('Report')
  })), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'right',
      fontSize: 11,
      color: 'var(--muted)'
    }
  }, r.State)))))), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--muted)',
      textTransform: 'uppercase',
      letterSpacing: '.08em',
      fontWeight: 600,
      marginBottom: 10
    }
  }, "Global administrators"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 6
    }
  }, D['admin-roles'].filter(r => r.RoleName === 'Global Administrator').map((r, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    className: "fw-pill",
    style: {
      fontSize: 11,
      padding: '4px 8px'
    }
  }, r.MemberDisplayName))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--muted)',
      marginTop: 8
    }
  }, D['admin-roles'].filter(r => r.RoleName === 'Global Administrator').length, " Global Administrators detected (including break-glass)."))));
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
      fontSize: 11,
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
  const [theme, setTheme] = useState(() => localStorage.getItem('m365-theme') || DEFAULTS.theme);
  const [mode, setMode] = useState(() => localStorage.getItem('m365-mode') || DEFAULTS.mode);
  const [density, setDensity] = useState(() => localStorage.getItem('m365-density') || DEFAULTS.density);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({
    status: [],
    severity: [],
    framework: [],
    domain: []
  });
  const [active, setActive] = useState('overview');
  const [showTweaks, setShowTweaks] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
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
    const h = e => {
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
      entries.forEach(e => {
        if (e.isIntersecting) setActive(e.target.id);
      });
    }, {
      rootMargin: '-40% 0px -55% 0px'
    });
    sections.forEach(s => obs.observe(s));
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
  return /*#__PURE__*/React.createElement("div", {
    className: "app"
  }, /*#__PURE__*/React.createElement(Sidebar, {
    active: active,
    counts: navCounts,
    domainCounts: domainCounts,
    activeDomain: filters.domain.length === 1 ? filters.domain[0] : null,
    onDomainJump: onDomainJump,
    navOpen: navOpen,
    onClose: () => setNavOpen(false)
  }), /*#__PURE__*/React.createElement("main", {
    className: "main"
  }, /*#__PURE__*/React.createElement(Topbar, {
    search: search,
    setSearch: setSearch,
    mode: mode,
    setMode: setMode,
    theme: theme,
    setTheme: setTheme,
    onPrint: () => window.print(),
    onTweaks: () => setShowTweaks(s => !s),
    onHamburger: () => setNavOpen(o => !o)
  }), /*#__PURE__*/React.createElement(Overview, null), /*#__PURE__*/React.createElement(Posture, null), /*#__PURE__*/React.createElement(DomainRollup, {
    onJump: onDomainJump
  }), /*#__PURE__*/React.createElement(FrameworkQuilt, {
    onSelect: onFrameworkSelect,
    selected: filters.framework[0]
  }), /*#__PURE__*/React.createElement("div", {
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
    search: search
  }), /*#__PURE__*/React.createElement(Roadmap, null), /*#__PURE__*/React.createElement(Appendix, null), !D.whiteLabel && /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      padding: '30px 0 10px',
      fontSize: 11,
      color: 'var(--muted)',
      fontFamily: 'var(--font-mono)',
      letterSpacing: '.06em'
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
  }, "GALVNYZ"))), showTweaks && /*#__PURE__*/React.createElement(TweaksPanel, {
    onClose: () => setShowTweaks(false),
    theme: theme,
    setTheme: setTheme,
    mode: mode,
    setMode: setMode,
    density: density,
    setDensity: setDensity
  }));
}

// ---- Edit-mode protocol (Tweaks toolbar) ----
window.addEventListener('message', e => {
  if (e.data?.type === '__activate_edit_mode') {
    // No-op: the in-page Tweaks button already provides the UI
  }
});
window.parent?.postMessage({
  type: '__edit_mode_available'
}, '*');
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(/*#__PURE__*/React.createElement(App, null));
