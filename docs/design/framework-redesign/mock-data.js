// Mock data approximating a real M365-Assess run.
// Numbers chosen so the visualizations have realistic distributions
// (some frameworks audit-ready, some heavy gaps, some moderate).

window.MOCK_FRAMEWORKS = [
  {
    id: 'cis-m365-v6',
    short: 'CIS M365 v6',
    full: 'CIS Microsoft 365 v6.0.1',
    org: 'Center for Internet Security',
    pinned: true,
    desc: 'Prescriptive configuration recommendations for M365 services, organized into L1/L2 profiles and E3/E5 licensing tiers.',
    counts: { pass: 78, warn: 12, fail: 31, review: 4, info: 6, total: 131 },
    profiles: { L1: 92, L2: 39, E3: 78, E5only: 53 },
    profileType: 'cis',
    families: [
      { code: '1', name: 'Account / Authentication', pass: 14, warn: 3, fail: 8, review: 0, info: 1, total: 26 },
      { code: '2', name: 'Application Permissions',  pass: 9,  warn: 2, fail: 5, review: 1, info: 0, total: 17 },
      { code: '3', name: 'Data Management',          pass: 11, warn: 1, fail: 4, review: 0, info: 2, total: 18 },
      { code: '4', name: 'Email Security & Exchange',pass: 16, warn: 3, fail: 6, review: 1, info: 1, total: 27 },
      { code: '5', name: 'Auditing',                 pass: 8,  warn: 1, fail: 2, review: 1, info: 1, total: 13 },
      { code: '6', name: 'Storage',                  pass: 10, warn: 1, fail: 3, review: 1, info: 0, total: 15 },
      { code: '7', name: 'Mobile Device Management', pass: 10, warn: 1, fail: 3, review: 0, info: 1, total: 15 },
    ],
  },
  {
    id: 'nist-800-53',
    short: 'NIST 800-53',
    full: 'NIST SP 800-53 Rev 5',
    org: 'NIST',
    pinned: true,
    desc: 'Comprehensive catalog of security and privacy controls for US federal information systems (FISMA).',
    counts: { pass: 64, warn: 18, fail: 22, review: 8, info: 12, total: 124 },
    profiles: { Low: 42, Mod: 78, High: 4 },
    profileType: 'nist',
    families: [
      { code: 'AC', name: 'Access Control',                  pass: 12, warn: 4, fail: 6, review: 2, info: 1, total: 25 },
      { code: 'AU', name: 'Audit & Accountability',          pass: 8,  warn: 2, fail: 3, review: 1, info: 1, total: 15 },
      { code: 'CM', name: 'Configuration Management',        pass: 6,  warn: 2, fail: 3, review: 1, info: 2, total: 14 },
      { code: 'IA', name: 'Identification & Authentication', pass: 10, warn: 3, fail: 4, review: 1, info: 2, total: 20 },
      { code: 'IR', name: 'Incident Response',               pass: 5,  warn: 2, fail: 1, review: 1, info: 2, total: 11 },
      { code: 'SC', name: 'System & Comm Protection',        pass: 9,  warn: 3, fail: 3, review: 1, info: 2, total: 18 },
      { code: 'SI', name: 'System & Info Integrity',         pass: 14, warn: 2, fail: 2, review: 1, info: 2, total: 21 },
    ],
  },
  {
    id: 'cmmc',
    short: 'CMMC 2.0',
    full: 'CMMC 2.0',
    org: 'US DoD',
    pinned: true,
    desc: 'DoD supply chain cybersecurity standard. Required for contractors handling FCI or CUI.',
    counts: { pass: 41, warn: 11, fail: 28, review: 3, info: 5, total: 88 },
    profiles: { L1: 17, L2: 88, L3: 22 },
    profileType: 'cmmc',
    families: [
      { code: 'AC', name: 'Access Control',          pass: 7,  warn: 2, fail: 5, review: 0, info: 1, total: 15 },
      { code: 'AU', name: 'Audit & Accountability',  pass: 5,  warn: 1, fail: 3, review: 1, info: 0, total: 10 },
      { code: 'CM', name: 'Configuration Mgmt',      pass: 4,  warn: 2, fail: 4, review: 0, info: 1, total: 11 },
      { code: 'IA', name: 'ID & Authentication',     pass: 6,  warn: 2, fail: 3, review: 0, info: 1, total: 12 },
      { code: 'SC', name: 'System & Comm Protection',pass: 8,  warn: 2, fail: 6, review: 1, info: 0, total: 17 },
      { code: 'SI', name: 'System & Info Integrity', pass: 7,  warn: 1, fail: 4, review: 1, info: 1, total: 14 },
      { code: 'AT', name: 'Awareness & Training',    pass: 4,  warn: 1, fail: 3, review: 0, info: 1, total: 9  },
    ],
  },
  {
    id: 'iso-27001',
    short: 'ISO 27001',
    full: 'ISO 27001:2022',
    org: 'ISO',
    pinned: true,
    desc: 'International standard for information security management systems (ISMS).',
    counts: { pass: 56, warn: 9, fail: 18, review: 4, info: 6, total: 93 },
    profileType: null,
    families: [
      { code: 'A.5', name: 'Organizational Controls', pass: 14, warn: 3, fail: 5, review: 1, info: 2, total: 25 },
      { code: 'A.6', name: 'People Controls',         pass: 8,  warn: 1, fail: 2, review: 0, info: 1, total: 12 },
      { code: 'A.7', name: 'Physical Controls',       pass: 6,  warn: 1, fail: 2, review: 1, info: 1, total: 11 },
      { code: 'A.8', name: 'Technological Controls',  pass: 28, warn: 4, fail: 9, review: 2, info: 2, total: 45 },
    ],
  },
  // additional frameworks (mostly tail-end / less-used)
  {
    id: 'cisa-scuba',
    short: 'CISA SCuBA',
    full: 'CISA SCuBA',
    org: 'CISA',
    pinned: false,
    counts: { pass: 35, warn: 6, fail: 14, review: 2, info: 3, total: 60 },
  },
  {
    id: 'nist-csf',
    short: 'NIST CSF',
    full: 'NIST CSF 2.0',
    org: 'NIST',
    pinned: false,
    counts: { pass: 48, warn: 8, fail: 12, review: 2, info: 4, total: 74 },
  },
  {
    id: 'cis-controls-v8',
    short: 'CIS Controls v8',
    full: 'CIS Controls v8.1',
    org: 'CIS',
    pinned: false,
    counts: { pass: 51, warn: 7, fail: 16, review: 3, info: 5, total: 82 },
  },
  {
    id: 'essential-eight',
    short: 'Essential 8',
    full: 'ASD Essential Eight',
    org: 'ASD',
    pinned: false,
    counts: { pass: 19, warn: 4, fail: 8, review: 1, info: 2, total: 34 },
  },
  {
    id: 'fedramp',
    short: 'FedRAMP',
    full: 'FedRAMP Rev 5',
    org: 'GSA',
    pinned: false,
    counts: { pass: 88, warn: 22, fail: 31, review: 6, info: 8, total: 155 },
  },
  {
    id: 'hipaa',
    short: 'HIPAA',
    full: 'HIPAA',
    org: 'HHS',
    pinned: false,
    counts: { pass: 32, warn: 5, fail: 9, review: 1, info: 3, total: 50 },
  },
  {
    id: 'mitre-attack',
    short: 'MITRE ATT&CK',
    full: 'MITRE ATT&CK',
    org: 'MITRE',
    pinned: false,
    counts: { pass: 29, warn: 7, fail: 11, review: 2, info: 4, total: 53 },
  },
  {
    id: 'pci-dss',
    short: 'PCI DSS',
    full: 'PCI DSS v4.0.1',
    org: 'PCI SSC',
    pinned: false,
    counts: { pass: 24, warn: 4, fail: 8, review: 1, info: 2, total: 39 },
  },
  {
    id: 'soc2',
    short: 'SOC 2',
    full: 'SOC 2 TSC',
    org: 'AICPA',
    pinned: false,
    counts: { pass: 38, warn: 6, fail: 11, review: 2, info: 3, total: 60 },
  },
  {
    id: 'stig',
    short: 'DISA STIG',
    full: 'DISA STIG',
    org: 'DISA',
    pinned: false,
    counts: { pass: 41, warn: 9, fail: 18, review: 3, info: 4, total: 75 },
  },
];

// Helpers shared by all directions
window.coveragePct = (c) => c.total ? Math.round(((c.pass + c.info * 0.5) / c.total) * 100) : 0;

window.readinessLabel = (pct) => {
  if (pct >= 90) return { label: 'Audit-ready',   tone: 'pass' };
  if (pct >= 75) return { label: 'On track',      tone: 'pass' };
  if (pct >= 55) return { label: 'At risk',       tone: 'warn' };
  return                  { label: 'Failing',     tone: 'fail' };
};

window.SHARED_DOMAINS = [
  'Identity & Access',
  'Email Security',
  'Endpoint',
  'Data Protection',
  'Logging & Audit',
  'Threat Detection',
];
