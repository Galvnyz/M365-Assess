// ======================== Posture tiles (#1060) ========================
// Spec: docs/specs/2026-11-19-posture-tiles-design.md
//
// Every tile is derived from the findings behind it and from the collectors
// that ran (REPORT_DATA.collection.collectors). A tile never reads a loose
// data field and treats "missing" as zero, which is how the old External
// exposure tile showed a green "0 guests" on a run that collected no users.
// Only 'good' is green, and 'good' requires every check in the tile to be
// measured and passing, every dependent section to have run, and every
// collector in those sections to be complete.
//
// Compromise indicators never appear here; the briefing's indicator summary
// is the one place the hunt result is shown.

const PT_NEEDS_PERSON = new Set(['Review', 'Info']);
const PT_SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4, none: 5 };

// Fixed set, ordered by blast radius. Membership is by check prefix so new
// checks in an existing family join their tile without a code change.
const PT_TILE_DEFS = [
  {
    id: 'admin', label: 'Admin protection', sections: ['Identity', 'Security'],
    prefixes: ['CA-MFA-ADMIN-', 'CA-PHISHRES-', 'ENTRA-ADMIN-', 'ENTRA-PIM-', 'ENTRA-BREAKGLASS-', 'ENTRA-STALEADMIN-',
               'ENTRA-CLOUDADMIN-', 'ENTRA-SYNCADMIN-', 'ENTRA-ROLEGROUP-', 'CA-EXCLUSION-'],
    metric: d => d.mfaStats && d.mfaStats.total > 0
      ? { value: d.mfaStats.adminsWithoutMfa, unit: d.mfaStats.adminsWithoutMfa === 1 ? 'admin without MFA' : 'admins without MFA', bad: d.mfaStats.adminsWithoutMfa > 0 }
      : null,
  },
  {
    id: 'signin', label: 'Sign-in protection', sections: ['Identity'],
    prefixes: ['CA-MFA-ALL-', 'CA-LEGACYAUTH-', 'CA-SIGNINRISK-', 'CA-USERRISK-', 'ENTRA-SECDEFAULT-', 'ENTRA-MFA-'],
    metric: d => d.mfaStats && d.mfaStats.total > 0
      ? { value: d.mfaStats.none, unit: d.mfaStats.none === 1 ? 'user with no MFA method' : 'users with no MFA method', bad: d.mfaStats.none > 0 }
      : null,
  },
  {
    id: 'apps', label: 'Apps and consent', sections: ['Identity', 'Security'],
    prefixes: ['ENTRA-CONSENT-', 'ENTRA-ENTAPP-', 'ENTRA-APPS-'],
    metric: null,
  },
  {
    id: 'email', label: 'Email security', sections: ['Email', 'Security'],
    prefixes: ['DNS-SPF-', 'DNS-DKIM-', 'DNS-DMARC-', 'EXO-FORWARD-', 'DEFENDER-ANTIPHISH-', 'DEFENDER-SAFELINKS-', 'DEFENDER-SAFEATTACH-'],
    metric: d => {
      if (!Array.isArray(d.dns) || d.dns.length === 0) return null;
      const enforced = d.dns.filter(r => r.DMARCPolicy === 'reject' || r.DMARCPolicy === 'quarantine').length;
      return { value: `${enforced}/${d.dns.length}`, unit: 'domains enforce DMARC', bad: enforced < d.dns.length };
    },
  },
  {
    id: 'external', label: 'External access', sections: ['Identity', 'Collaboration'],
    prefixes: ['ENTRA-GUEST-', 'SPO-SHARING-', 'TEAMS-EXTACCESS-'],
    metric: d => {
      const g = d.users && d.users[0] ? d.users[0].GuestUsers : undefined;
      if (g === undefined || g === null || g === '') return null;
      return { value: g, unit: Number(g) === 1 ? 'guest account' : 'guest accounts', bad: false };
    },
  },
  {
    id: 'devices', label: 'Devices', sections: ['Intune', 'Identity'],
    prefixes: ['INTUNE-COMPLIANCE-', 'INTUNE-ENROLL', 'ENTRA-DEVICE-'],
    metric: d => d.deviceStats && d.deviceStats.total > 0
      ? { value: `${d.deviceStats.compliant}/${d.deviceStats.total}`, unit: 'devices compliant', bad: d.deviceStats.compliant < d.deviceStats.total }
      : null,
  },
  {
    id: 'audit', label: 'Audit and investigation', sections: ['Email', 'Security'],
    prefixes: ['EXO-AUDIT-', 'COMPLIANCE-AUDIT-', 'PURVIEW-AUDIT-'],
    metric: null,
  },
];

// Stored check IDs are sub-numbered (CA-MFA-ALL-001.1); membership uses the base.
const ptBaseId = id => String(id || '').replace(/\.\d+$/, '');

// True when the finding's check belongs to the tile. Used by the findings
// filter, so a saved area filter stays correct for any later report.
function ptTileHasCheck(tileId, checkId) {
  const def = PT_TILE_DEFS.find(d => d.id === tileId);
  if (!def) return false;
  const base = ptBaseId(checkId);
  return def.prefixes.some(p => base.startsWith(p));
}

// Which of a tile's sections ran, which did not, and which collectors in them
// did not finish cleanly. A tile can only be green when every one of its
// sections ran: one guest check from Identity must not make "External access"
// green when Collaboration (SharePoint and Teams sharing) never ran.
function ptSectionCoverage(collection, sections) {
  const rows = (collection && Array.isArray(collection.collectors)) ? collection.collectors : [];
  const ranSection = s => rows.some(r => r && r.Section === s && (r.Status === 'Complete' || r.Status === 'Partial'));
  const mine = rows.filter(r => r && sections.includes(r.Section));
  return {
    ran: sections.some(ranSection),
    missing: sections.filter(s => !ranSection(s)),
    incomplete: mine.filter(r => r.Status !== 'Complete').map(r => `${r.Collector}: ${r.Status}`),
  };
}

// Pure. Returns everything a tile needs; the component decides only layout.
//   state: 'bad' | 'warn' | 'good' | 'partial' | 'missing' | 'na'
function ptDeriveTile(def, data) {
  const checks = (data.findings || []).filter(f => def.prefixes.some(p => ptBaseId(f.checkId).startsWith(p)));
  const cov = ptSectionCoverage(data.collection, def.sections);
  const counts = { pass: 0, warn: 0, fail: 0, person: 0, unmeasured: 0, unlicensed: 0 };
  for (const f of checks) {
    if (f.status === 'Pass') counts.pass++;
    else if (f.status === 'Warning') counts.warn++;
    else if (f.status === 'Fail') counts.fail++;
    else if (PT_NEEDS_PERSON.has(f.status)) counts.person++;
    else if (f.status === 'NotLicensed') { counts.unlicensed++; counts.unmeasured++; }
    else counts.unmeasured++;
  }
  const scored = counts.pass + counts.warn + counts.fail;
  const metric = def.metric ? def.metric(data) : null;
  const gaps = checks
    .filter(f => f.status === 'Fail' || f.status === 'Warning')
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'Fail' ? -1 : 1)
      || (PT_SEV_RANK[a.severity] ?? 9) - (PT_SEV_RANK[b.severity] ?? 9));
  const base = { id: def.id, label: def.label, counts, scored, total: checks.length, metric, hasMetric: !!def.metric,
                 gaps, incomplete: cov.incomplete, missingSections: cov.missing, sections: def.sections };

  if (checks.length === 0) {
    // "Nothing to check" is a claim about every dependent section, so it needs
    // all of them to have run. Otherwise name the ones that did not.
    if (!cov.ran) return { ...base, state: 'missing', verdict: 'Not collected', reason: `${def.sections.join(' or ')} section not run.` };
    if (cov.missing.length) return { ...base, state: 'missing', verdict: 'Not collected', reason: `${cov.missing.join(' and ')} section not run.` };
    return { ...base, state: 'na', verdict: 'Nothing to check', reason: 'The sections for this area ran but produced no checks for it.' };
  }
  if (scored === 0) {
    if (counts.unlicensed === checks.length) {
      return { ...base, state: 'na', verdict: 'Not licensed', reason: 'The tenant has no licence for the features these checks look at.' };
    }
    return { ...base, state: 'missing', verdict: 'Not measured',
             reason: counts.person > 0
               ? `${counts.person} check${counts.person === 1 ? '' : 's'} need a person to decide.`
               : 'Every check in this area was skipped or could not collect data.' };
  }
  const worstFail = gaps.find(f => f.status === 'Fail');
  if (worstFail && (worstFail.severity === 'critical' || worstFail.severity === 'high')) {
    return { ...base, state: 'bad', verdict: 'At risk' };
  }
  if (gaps.length > 0) return { ...base, state: 'warn', verdict: 'Needs work' };
  if (counts.unmeasured > 0 || counts.person > 0 || cov.incomplete.length > 0 || cov.missing.length > 0) {
    // No gaps among what was measured, but not everything was. The footer
    // names what is missing; the verdict never claims "no gaps".
    return { ...base, state: 'partial', verdict: 'Partly measured' };
  }
  return { ...base, state: 'good', verdict: 'No gaps found' };
}

// When no configuration section ran at all, the row collapses to one line
// instead of seven grey tiles. `huntRan` only words that line.
function ptDeriveRow(data) {
  const tiles = PT_TILE_DEFS.map(def => ptDeriveTile(def, data));
  const anyMeasured = tiles.some(t => t.state !== 'missing');
  const huntRan = Array.isArray(data.indicators) && data.indicators.length > 0;
  return { tiles: anyMeasured ? tiles : [], collapsed: !anyMeasured, huntRan };
}

function PostureTileBar({ t }) {
  const seg = (n, cls) => n > 0 ? <span key={cls} className={cls} style={{ flex: n }}/> : null;
  return (
    <div className="pt-bar" aria-hidden="true">
      {seg(t.counts.pass, 'pass')}{seg(t.counts.warn, 'warn')}{seg(t.counts.fail, 'fail')}
      {seg(t.counts.person, 'person')}{seg(t.counts.unmeasured, 'unmeasured')}
    </div>
  );
}

function PostureTile({ t, onSelect }) {
  const measured = t.state !== 'missing' && t.state !== 'na';
  const notes = [];
  if (measured && t.counts.unmeasured > 0) notes.push(`${t.counts.unmeasured} not measured`);
  if (measured && t.counts.person > 0) notes.push(`${t.counts.person} need${t.counts.person === 1 ? 's' : ''} a person`);
  if (measured && t.missingSections.length) notes.push(`${t.missingSections.join(' and ')} not run`);
  if (t.incomplete.length) notes.push(`partial collection: ${t.incomplete.join('; ')}`);
  const clickable = t.total > 0 && typeof onSelect === 'function';
  const body = (
    <>
      <div className="pt-head">
        <span className="pt-name">{t.label}</span>
        <span className="pt-verdict">{t.verdict}</span>
      </div>
      {measured
        ? <div className="pt-count"><b>{t.counts.pass}</b> of {t.scored} scored check{t.scored === 1 ? '' : 's'} pass</div>
        : <div className="pt-count pt-muted">{t.reason}</div>}
      {measured && <PostureTileBar t={t}/>}
      {t.metric
        ? <div className={'pt-metric' + (t.metric.bad ? ' bad' : '')}><b>{t.metric.value}</b> {t.metric.unit}</div>
        : (measured && t.hasMetric && <div className="pt-metric pt-muted">Supporting data not collected</div>)}
      {t.gaps.length > 0 && (
        <div className="pt-weakest">
          <span className="pt-label">Weakest</span>{t.gaps[0].setting}
          {t.gaps.length > 1 && <span className="pt-muted"> +{t.gaps.length - 1} more</span>}
        </div>
      )}
      <div className="pt-foot">
        {t.total ? `From ${t.total} check${t.total === 1 ? '' : 's'}` : 'No checks'}
        {notes.length > 0 && ' · ' + notes.join(' · ')}
      </div>
    </>
  );
  if (!clickable) return <div className={'pt-tile ' + t.state}>{body}</div>;
  return (
    <button type="button" className={'pt-tile ' + t.state} onClick={() => onSelect(t.id)}
      title={`Show the ${t.total} finding${t.total === 1 ? '' : 's'} behind ${t.label}`}>
      {body}
    </button>
  );
}

function PostureTiles({ onAreaSelect }) {
  const row = ptDeriveRow(D);
  if (row.collapsed) {
    return (
      <div className="pt-collapsed">
        No configuration areas were collected in this run, so there is nothing to summarise here.
        {row.huntRan && ' The compromise hunt result is in the briefing summary above.'}
        {' '}Run the standard sections to see posture by area.
      </div>
    );
  }
  return (
    <div className="pt-grid">
      {row.tiles.map(t => <PostureTile key={t.id} t={t} onSelect={onAreaSelect}/>)}
    </div>
  );
}
