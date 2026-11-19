// Synthetic REPORT_DATA slices for the posture tiles mockup (#1060).
// Contoso placeholder names only; no real tenant data.

/* exported MOCK_SCENARIOS */

const f = (checkId, status, severity, setting) => ({ checkId, status, severity, setting });
const col = (Section, Collector, Status) => ({ Section, Collector, Status });

const FULL_COLLECTORS = [
  col('Identity', 'Entra Security Config', 'Complete'), col('Identity', 'CA Policy Evaluation', 'Complete'),
  col('Identity', 'Enterprise App Security', 'Complete'), col('Email', 'EXO Security Config', 'Complete'),
  col('Email', 'DNS Security Config', 'Complete'), col('Intune', 'Intune Security Config', 'Partial'),
  col('Security', 'Defender Security Config', 'Complete'), col('Security', 'Critical Exposure', 'Complete'),
  col('Collaboration', 'SharePoint Security Config', 'Complete'), col('Collaboration', 'Teams Security Config', 'Complete'),
];

const MOCK_SCENARIOS = [
  {
    title: 'A. Full run with mixed results',
    blurb: 'Typical small tenant. Today the row shows four numbers with no link to the findings, and "External exposure" is amber for having any guests at all. Proposed: seven risk areas, each with how many scored checks pass, the weakest item, supporting data, and what was not measured. Click any tile.',
    data: {
      collection: { collectors: FULL_COLLECTORS },
      mfaStats: { total: 6, none: 1, admins: 4, adminsWithoutMfa: 3 },
      users: [{ GuestUsers: 2 }],
      'admin-roles': new Array(11).fill({}),
      deviceStats: { total: 3, compliant: 0 },
      dns: [{ DMARCPolicy: 'reject' }, { DMARCPolicy: 'reject' }, { DMARCPolicy: 'quarantine' }, { DMARCPolicy: 'none' }],
      sharepointConfig: { SharingLevel: 'ExternalUserAndGuestSharing' },
      findings: [
        f('CA-MFA-ADMIN-001.1', 'Fail', 'critical', 'MFA required for admin roles'),
        f('CA-PHISHRES-001.1', 'Fail', 'high', 'Phishing-resistant MFA for admins'),
        f('ENTRA-PIM-001.1', 'Fail', 'high', 'PIM manages privileged roles'),
        f('ENTRA-BREAKGLASS-001.1', 'Pass', 'high', 'Break-glass account present'),
        f('ENTRA-STALEADMIN-001.1', 'Fail', 'high', 'Admin accounts inactive over 90 days'),
        f('ENTRA-ADMIN-001.1', 'Pass', 'medium', 'Two to four global admins'),
        f('ENTRA-PIM-003.1', 'Unknown', 'medium', 'Access reviews for privileged roles'),
        f('CA-MFA-ALL-001.1', 'Fail', 'critical', 'MFA required for all users'),
        f('CA-LEGACYAUTH-001.1', 'Pass', 'critical', 'Legacy authentication blocked'),
        f('ENTRA-SECDEFAULT-001.1', 'Info', 'medium', 'Security Defaults state'),
        f('CA-SIGNINRISK-001.1', 'NotLicensed', 'high', 'Sign-in risk policy'),
        f('CA-USERRISK-001.1', 'NotLicensed', 'high', 'User risk policy'),
        f('ENTRA-CONSENT-001.1', 'Pass', 'high', 'User consent restricted'),
        f('ENTRA-CONSENT-003.1', 'Pass', 'medium', 'Consent limited to verified publishers'),
        f('ENTRA-ENTAPP-003.1', 'Pass', 'critical', 'Foreign apps with dangerous permissions'),
        f('ENTRA-ENTAPP-002.1', 'Warning', 'medium', 'Inactive apps with credentials'),
        f('DNS-SPF-001.1', 'Pass', 'high', 'SPF published for all domains'),
        f('DNS-DMARC-001.1', 'Warning', 'high', 'DMARC enforced for all domains'),
        f('DNS-DKIM-001.1', 'Pass', 'high', 'DKIM enabled for all domains'),
        f('EXO-FORWARD-001.1', 'Pass', 'high', 'External forwarding blocked'),
        f('DEFENDER-ANTIPHISH-001.1', 'Pass', 'high', 'Anti-phishing policy present'),
        f('ENTRA-GUEST-001.1', 'Pass', 'medium', 'Guest access restricted'),
        f('ENTRA-GUEST-004.1', 'Review', 'medium', 'Invitations to allowed domains only'),
        f('SPO-SHARING-001.1', 'Warning', 'high', 'External content sharing restricted'),
        f('SPO-SHARING-004.1', 'Pass', 'medium', 'Link sharing restricted'),
        f('TEAMS-EXTACCESS-001.1', 'Pass', 'medium', 'Unmanaged Teams users blocked'),
        f('INTUNE-COMPLIANCE-001.1', 'Fail', 'high', 'Devices without policy marked not compliant'),
        f('ENTRA-DEVICE-001.1', 'Pass', 'medium', 'Device join restricted'),
        f('EXO-AUDIT-001.1', 'Pass', 'high', 'Organisation audit enabled'),
        f('EXO-AUDIT-002.1', 'Pass', 'high', 'No mailbox audit bypass'),
        f('COMPLIANCE-AUDIT-001.1', 'Pass', 'high', 'Audit log search enabled'),
      ],
      indicators: [
        f('IOC-INBOXRULE-001.1', 'Pass', 'critical', 'Inbox rules forwarding to external domains'),
        f('IOC-INBOXRULE-002.1', 'Pass', 'high', 'Inbox rules that hide mail'),
        f('IOC-CONSENT-001.1', 'Pass', 'high', 'Consent grants for high-impact permissions'),
      ],
    },
  },
  {
    title: 'B. Compromise-only run',
    blurb: 'No configuration section ran. Today the row shows a green "0 guests" and "sharing level unknown". Proposed: the hunt tile reports what was found, and the configuration row collapses to one plain sentence instead of seven grey tiles.',
    data: {
      collection: { collectors: [col('Compromise', 'Compromise Indicators (Mailbox)', 'Complete'), col('Compromise', 'Compromise Indicators (Directory)', 'Complete')] },
      mfaStats: { total: 0, none: 0, admins: 0, adminsWithoutMfa: 0 },
      users: [], 'admin-roles': [], deviceStats: null, dns: [], sharepointConfig: null,
      findings: [],
      indicators: [
        f('IOC-INBOXRULE-001.1', 'Fail', 'critical', 'Inbox rules forwarding to external domains'),
        f('IOC-INBOXRULE-002.1', 'Warning', 'high', 'Inbox rules that hide mail'),
        f('IOC-FORWARD-001.1', 'Pass', 'high', 'Mailbox forwarding to external addresses'),
        f('IOC-CONSENT-001.1', 'Pass', 'high', 'Consent grants for high-impact permissions'),
        f('IOC-SPCRED-001.1', 'Pass', 'high', 'Credentials added to applications'),
        f('IOC-ROLEADD-001.1', 'Unknown', 'high', 'Members added to privileged roles'),
      ],
    },
  },
  {
    title: 'C. Partial run: Identity and Email only, one collector incomplete, no Intune licence',
    blurb: 'Collaboration and Intune were not run and Exchange collection was partial. Today the row hides the gaps and External exposure turns green from the guest count alone. Proposed: every area says what it could and could not see, and only fully measured, fully passing areas are green.',
    data: {
      collection: { collectors: [
        col('Identity', 'Entra Security Config', 'Complete'), col('Identity', 'CA Policy Evaluation', 'Complete'),
        col('Identity', 'Enterprise App Security', 'Complete'), col('Email', 'EXO Security Config', 'Partial'),
        col('Email', 'DNS Security Config', 'Complete'),
      ] },
      mfaStats: { total: 40, none: 0, admins: 3, adminsWithoutMfa: 0 },
      users: [{ GuestUsers: 0 }],
      'admin-roles': new Array(5).fill({}),
      deviceStats: null,
      dns: [{ DMARCPolicy: 'reject' }],
      sharepointConfig: null,
      findings: [
        f('CA-MFA-ADMIN-001.1', 'Pass', 'critical', 'MFA required for admin roles'),
        f('CA-PHISHRES-001.1', 'Pass', 'high', 'Phishing-resistant MFA for admins'),
        f('ENTRA-BREAKGLASS-001.1', 'Pass', 'high', 'Break-glass account present'),
        f('ENTRA-PIM-001.1', 'NotLicensed', 'high', 'PIM manages privileged roles'),
        f('CA-MFA-ALL-001.1', 'Pass', 'critical', 'MFA required for all users'),
        f('CA-LEGACYAUTH-001.1', 'Pass', 'critical', 'Legacy authentication blocked'),
        f('ENTRA-CONSENT-001.1', 'Pass', 'high', 'User consent restricted'),
        f('ENTRA-ENTAPP-003.1', 'Pass', 'critical', 'Foreign apps with dangerous permissions'),
        f('DNS-SPF-001.1', 'Pass', 'high', 'SPF published for all domains'),
        f('DNS-DMARC-001.1', 'Pass', 'high', 'DMARC enforced for all domains'),
        f('EXO-FORWARD-001.1', 'Pass', 'high', 'External forwarding blocked'),
        f('ENTRA-GUEST-001.1', 'Pass', 'medium', 'Guest access restricted'),
        f('ENTRA-DEVICE-001.1', 'NotLicensed', 'medium', 'Device join restricted'),
        f('EXO-AUDIT-001.1', 'Unknown', 'high', 'Organisation audit enabled'),
      ],
      indicators: [],
    },
  },
];
