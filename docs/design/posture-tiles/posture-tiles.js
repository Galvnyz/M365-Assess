// Posture tiles redesign (#1060) -- reference logic and mockup renderer.
//
// The part to port into the report is TILE_DEFS + deriveTile(). Both are plain
// JavaScript with no React or DOM use, so they can move into
// src/M365-Assess/assets/report/ as they are. renderTile() and the scenario
// switcher below exist only for this mockup.
//
// Design rule: a tile is derived from the findings behind it and from the
// collectors that ran (REPORT_DATA.collection.collectors). It never reads a
// loose data field and treats "missing" as zero, which is how the old
// External exposure tile showed a green "0 guests" on a run that collected no
// users.

/* global MOCK_SCENARIOS */

const SCORED = new Set(['Pass', 'Fail', 'Warning']);
const NEEDS_PERSON = new Set(['Review', 'Info']);
const NOT_MEASURED = new Set(['Skipped', 'Unknown', 'NotApplicable', 'NotLicensed']);
const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4, none: 5 };

// Fixed set, ordered by blast radius. Membership is by check prefix so new
// checks in an existing family join their tile without a code change.
const TILE_DEFS = [
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
    metric: d => Array.isArray(d.dns) && d.dns.length > 0
      ? (() => {
          const enforced = d.dns.filter(r => r.DMARCPolicy === 'reject' || r.DMARCPolicy === 'quarantine').length;
          return { value: `${enforced}/${d.dns.length}`, unit: 'domains enforce DMARC', bad: enforced < d.dns.length };
        })()
      : null,
  },
  {
    id: 'external', label: 'External access', sections: ['Identity', 'Collaboration'],
    prefixes: ['ENTRA-GUEST-', 'SPO-SHARING-', 'TEAMS-EXTACCESS-'],
    metric: d => (d.users && d.users[0] && d.users[0].GuestUsers !== undefined && d.users[0].GuestUsers !== null && d.users[0].GuestUsers !== '')
      ? { value: d.users[0].GuestUsers, unit: Number(d.users[0].GuestUsers) === 1 ? 'guest account' : 'guest accounts', bad: false }
      : null,
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

const baseId = id => String(id).replace(/\.\d+$/, '');

// Which of a tile's sections ran, which did not, and which collectors in them
// did not finish cleanly. A tile can only be green when every one of its
// sections ran: one guest check from Identity must not make "External access"
// green when Collaboration (SharePoint and Teams sharing) never ran.
function sectionCoverage(collection, sections) {
  const rows = (collection && Array.isArray(collection.collectors)) ? collection.collectors : [];
  const ranSection = s => rows.some(r => r.Section === s && (r.Status === 'Complete' || r.Status === 'Partial'));
  const mine = rows.filter(r => sections.includes(r.Section));
  return {
    ran: sections.some(ranSection),
    missing: sections.filter(s => !ranSection(s)),
    incomplete: mine.filter(r => r.Status !== 'Complete').map(r => `${r.Collector}: ${r.Status}`),
  };
}

// Pure. Returns everything a tile needs; the renderer decides only layout.
//   state: 'bad' | 'warn' | 'good' | 'partial' | 'missing' | 'na'
// Only 'good' is green, and 'good' requires every check in the tile to have
// been measured and passed.
function deriveTile(def, data) {
  const checks = (data.findings || []).filter(f => def.prefixes.some(p => baseId(f.checkId).startsWith(p)));
  const cov = sectionCoverage(data.collection, def.sections);
  const counts = { pass: 0, warn: 0, fail: 0, person: 0, unmeasured: 0, unlicensed: 0 };
  for (const f of checks) {
    if (f.status === 'Pass') counts.pass++;
    else if (f.status === 'Warning') counts.warn++;
    else if (f.status === 'Fail') counts.fail++;
    else if (NEEDS_PERSON.has(f.status)) counts.person++;
    else if (f.status === 'NotLicensed') { counts.unlicensed++; counts.unmeasured++; }
    else counts.unmeasured++;
  }
  const scored = counts.pass + counts.warn + counts.fail;
  const metric = def.metric ? def.metric(data) : null;
  const gaps = checks
    .filter(f => f.status === 'Fail' || f.status === 'Warning')
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'Fail' ? -1 : 1) || (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9));
  const base = { id: def.id, label: def.label, counts, scored, total: checks.length, metric, gaps,
                 checkIds: checks.map(f => f.checkId), incomplete: cov.incomplete, missingSections: cov.missing };

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
             reason: counts.person > 0 ? `${counts.person} check${counts.person === 1 ? '' : 's'} need a person to decide.` : 'Every check in this area was skipped or could not collect data.' };
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
// instead of seven grey tiles.
//
// Compromise indicators never appear in this row (decided on #1062): the
// briefing's indicator summary already leads with the hunt result, and these
// tiles describe configuration only. `huntRan` exists solely so the collapse
// sentence can point the reader to that summary.
function deriveRow(data) {
  const tiles = TILE_DEFS.map(def => deriveTile(def, data));
  const anyMeasured = tiles.some(t => t.state !== 'missing');
  const huntRan = (data.indicators || []).length > 0;
  return { tiles: anyMeasured ? tiles : [], collapsed: !anyMeasured, huntRan };
}

// ---------------------------------------------------------------- mockup only

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function bar(t) {
  if (!t.total) return '<div class="pt-bar pt-bar-empty"></div>';
  const seg = (n, cls) => n > 0 ? `<span class="${cls}" style="flex:${n}"></span>` : '';
  return `<div class="pt-bar" aria-hidden="true">${seg(t.counts.pass, 'pass')}${seg(t.counts.warn, 'warn')}${seg(t.counts.fail, 'fail')}${seg(t.counts.person, 'person')}${seg(t.counts.unmeasured, 'unmeasured')}</div>`;
}

function renderTile(t) {
  const measured = t.state !== 'missing' && t.state !== 'na';
  const numbers = measured
    ? `<div class="pt-count"><b>${t.counts.pass}</b> of ${t.scored} scored checks pass</div>`
    : `<div class="pt-count pt-muted">${esc(t.reason)}</div>`;
  const metric = t.metric
    ? `<div class="pt-metric${t.metric.bad ? ' bad' : ''}"><b>${esc(t.metric.value)}</b> ${esc(t.metric.unit)}</div>`
    : (measured && TILE_DEFS.find(d => d.id === t.id)?.metric ? '<div class="pt-metric pt-muted">Supporting data not collected</div>' : '');
  const weakest = t.gaps && t.gaps.length
    ? `<div class="pt-weakest"><span class="pt-label">Weakest</span> ${esc(t.gaps[0].setting)}${t.gaps.length > 1 ? ` <span class="pt-muted">+${t.gaps.length - 1} more</span>` : ''}</div>`
    : '';
  const notes = [];
  if (t.counts.unmeasured > 0 && measured) notes.push(`${t.counts.unmeasured} not measured`);
  if (t.counts.person > 0 && measured) notes.push(`${t.counts.person} need a person`);
  if (measured && t.missingSections && t.missingSections.length) notes.push(`${t.missingSections.join(' and ')} not run`);
  if (t.incomplete.length) notes.push(`partial collection: ${t.incomplete.join('; ')}`);
  const foot = `<div class="pt-foot">${t.total ? `From ${t.total} check${t.total === 1 ? '' : 's'}` : 'No checks'}${notes.length ? ' · ' + esc(notes.join(' · ')) : ''}</div>`;
  const clickable = t.total > 0;
  const tag = clickable ? 'button' : 'div';
  const attrs = clickable ? ` type="button" title="Show the ${t.total} findings behind this tile" data-ids="${esc(t.checkIds.join(','))}"` : '';
  return `<${tag} class="pt-tile ${t.state}"${attrs}>
    <div class="pt-head"><span class="pt-name">${esc(t.label)}</span><span class="pt-verdict">${esc(t.verdict)}</span></div>
    ${numbers}${measured ? bar(t) : ''}${metric}${weakest}${foot}
  </${tag}>`;
}

function renderRow(data) {
  const row = deriveRow(data);
  if (!row.collapsed) return `<div class="pt-grid">${row.tiles.map(renderTile).join('')}</div>`;
  const pointer = row.huntRan ? ' The compromise hunt result is in the briefing summary above.' : '';
  return `<div class="pt-collapsed">No configuration areas were collected in this run, so there is nothing to summarise here.${pointer} Run the standard sections to see posture by area.</div>`;
}

function renderToday(data) {
  // Rough copy of today's ExecSummaryRow, kept for side-by-side comparison.
  const u = (data.users && data.users[0]) || {};
  const guests = u.GuestUsers || 0;
  const tiles = [];
  const roles = (data['admin-roles'] || []).length;
  if (roles > 0) tiles.push(['Privileged roles', roles, 'assignments', data.mfaStats.adminsWithoutMfa > 0 ? `${data.mfaStats.adminsWithoutMfa} admins without MFA` : 'All admins MFA-enrolled', data.mfaStats.adminsWithoutMfa > 0 ? 'bad' : 'good']);
  if (data.deviceStats && data.deviceStats.total > 0) {
    const p = Math.round(data.deviceStats.compliant / data.deviceStats.total * 100);
    tiles.push(['Device compliance', p, '%', `${data.deviceStats.compliant} of ${data.deviceStats.total} devices compliant`, p >= 90 ? 'good' : p >= 70 ? 'warn' : 'bad']);
  }
  if ((data.dns || []).length) {
    const e = data.dns.filter(r => r.DMARCPolicy === 'reject' || r.DMARCPolicy === 'quarantine').length;
    tiles.push(['Email authentication', Math.round(e / data.dns.length * 100), '%', `${e} of ${data.dns.length} domains enforce DMARC`, e === data.dns.length ? 'good' : 'warn']);
  }
  tiles.push(['External exposure', guests, 'guests', data.sharepointConfig?.SharingLevel ? `SPO sharing · ${data.sharepointConfig.SharingLevel}` : 'SPO sharing level unknown', guests > 0 ? 'warn' : 'good']);
  return `<div class="exec-summary-row">${tiles.map(([l, v, s, h, st]) => `<div class="exec-tile ${st}"><div class="exec-tile-label">${esc(l)}</div><div class="exec-tile-value">${esc(v)}<span class="exec-tile-suffix">${esc(s)}</span></div><div class="exec-tile-hint">${esc(h)}</div></div>`).join('')}</div>`;
}

function mount() {
  const host = document.getElementById('scenarios');
  host.innerHTML = MOCK_SCENARIOS.map((s, i) => `
    <section class="pt-scenario" id="scenario-${i}">
      <h2>${esc(s.title)}</h2>
      <p class="pt-blurb">${esc(s.blurb)}</p>
      <div class="pt-compare">
        <div><div class="pt-col-label">Today</div>${renderToday(s.data)}</div>
        <div><div class="pt-col-label">Proposed</div>${renderRow(s.data)}</div>
      </div>
    </section>`).join('');
  host.addEventListener('click', e => {
    const tile = e.target.closest('button.pt-tile');
    if (!tile) return;
    const out = tile.closest('.pt-scenario').querySelector('.pt-clickout') || Object.assign(document.createElement('div'), { className: 'pt-clickout' });
    out.textContent = `Click opens All findings filtered to: ${tile.dataset.ids.split(',').map(baseId).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`;
    tile.closest('.pt-compare').after(out);
  });
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', mount);
if (typeof module !== 'undefined') module.exports = { TILE_DEFS, deriveTile, deriveRow };
