function Briefing({ onViewFinding, onShowCritical, onShowQuickWins }) {
  const [fwId, setFwId] = useState(HEADLINE_FWS[0]);
  const assessedRaw = D.assessedAt || SCORE.CreatedDateTime;
  const assessedDate = assessedRaw ? new Date(assessedRaw) : null;
  const assessedOk = assessedDate && !isNaN(assessedDate.getTime());
  return (
    <section className="block" id="briefing">
      <div className="briefing-header">
        <span className="briefing-header-org">{TENANT.OrgDisplayName || 'Microsoft 365 tenant'}</span>
        <span className="briefing-header-meta">
          {assessedOk ? `Assessed ${assessedDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} · ` : ''}
          {FINDINGS.length} settings checked
        </span>
      </div>
      <HideableBlock hideKey="briefing-verdict" label="Briefing verdict card">
        <BriefingVerdictCard fwId={fwId} setFwId={setFwId}/>
      </HideableBlock>
      <HideableBlock hideKey="briefing-stats" label="Briefing stat tiles">
        <BriefingStatRow onShowCritical={onShowCritical} onShowQuickWins={onShowQuickWins}/>
      </HideableBlock>
      <p className="score-disclaimer"><strong>Assessment scope:</strong> Results reflect observed settings against M365-Assess's baseline and best-effort framework mappings. Scores support security improvement and audit preparation; they do not establish overall security or compliance. Validate applicability and alternative implementations against your system's scope, policies, and required evidence.</p>
      <HideableBlock hideKey="briefing-actions" label="Briefing action list">
        <BriefingActions onViewFinding={onViewFinding}/>
      </HideableBlock>
    </section>
  );
}

// ======================== Posture hero ========================
function Posture() {
  const score = parseFloat(SCORE.Percentage);
  const avg = parseFloat(SCORE.AverageComparativeScore);
  const scoreAvailable = Number.isFinite(score);
  const avgAvailable = Number.isFinite(avg) && avg > 0;
  const delta = scoreAvailable && avgAvailable ? (score - avg).toFixed(1) : null;
  const deltaPos = delta !== null && parseFloat(delta) >= 0;

  const fail = FINDINGS.filter(f=>f.status==='Fail').length;
  const warn = FINDINGS.filter(f=>f.status==='Warning').length;
  const pass = FINDINGS.filter(f=>f.status==='Pass').length;
  const critical = FINDINGS.filter(f=>f.severity==='critical').length;
  const notAssessed = FINDINGS.filter(f=>NOT_ASSESSED_STATUSES.has(f.status)).length;

  return (
    <section className="block" id="posture">
      <div className="posture-grid">
        <HideableBlock hideKey="posture-score-card" label="Microsoft Secure Score card">
        {scoreAvailable ? (
        <div className="score-card">
          <div className="score-eyebrow">Microsoft Secure Score</div>
          <div className="score-headline">
            <span className="score-num">{score.toFixed(1)}</span>
            <span className="score-denom">/ 100%</span>
            {delta !== null && (
              <span className={'score-delta ' + (deltaPos?'':'neg')}>
                {deltaPos?'▲':'▼'} {Math.abs(parseFloat(delta))} pts vs peers
              </span>
            )}
          </div>
          <div className="score-label">
            {fmt(SCORE.CurrentScore)} of {fmt(SCORE.MaxScore)} points achieved.
            {avgAvailable && ` Peer average is ${avg.toFixed(1)}%.`}
          </div>
          <div className="score-bar">
            <span style={{width: score + '%'}} />
            {avgAvailable && <div className="bench" style={{left: avg + '%'}} title={`Peer avg ${avg}%`} />}
          </div>
          <div className="score-footnote">
            <span>0</span>
            {avgAvailable && <span>Peer avg · {avg.toFixed(1)}%</span>}
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
          <div className="score-disclaimer">
            Microsoft refreshes Secure Score on a delay — recent configuration changes can take up to 24 hours to reflect. The score above reflects Microsoft's last published value at assessment time, not the live tenant state.
          </div>
        </div>
        ) : (
        <div className="score-card score-card--unavailable">
          <div className="score-eyebrow">Microsoft Secure Score</div>
          <div className="score-unavailable">Secure Score unavailable for this run. The SecurityEvents.Read.All permission may not have been granted at collection time.</div>
        </div>
        )}
        </HideableBlock>

        <div>
          <div className="kpi-strip" style={{marginBottom:10}}>
            <HideableBlock hideKey="kpi-critical" label="Critical findings KPI">
            <div className={'kpi ' + (critical?'bad':'good')}>
              <div className="kpi-label">Critical findings</div>
              <div className="kpi-value">{critical}<span className="kpi-suffix">open</span></div>
              <div className="kpi-hint">Admins, privileged roles (PIM) & emergency accounts</div>
              <div className="tiny-bar"><span style={{width: Math.min(100, critical*15)+'%', background:'var(--danger)'}}/></div>
            </div>
            </HideableBlock>
            <HideableBlock hideKey="kpi-fails" label="Fails KPI">
            <div className="kpi bad">
              <div className="kpi-label">Fails</div>
              <div className="kpi-value">{fail}</div>
              <div className="kpi-hint">of {scoreDenom(FINDINGS)} scored checks</div>
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
            {notAssessed > 0 && (
              <HideableBlock hideKey="kpi-notassessed" label="Not assessed KPI">
              <div className="kpi" title={NOT_ASSESSED_TIP}>
                <div className="kpi-label">Not assessed</div>
                <div className="kpi-value">{notAssessed}</div>
                <div className="kpi-hint">Skipped, no data, N/A, or unlicensed</div>
                <div className="tiny-bar"><span style={{width: pct(notAssessed, FINDINGS.length)+'%', background:'var(--muted)'}}/></div>
              </div>
              </HideableBlock>
            )}
          </div>
          <MFABreakdown />
        </div>
      </div>
      <ExecSummaryRow/>
      {/* #963: the critical banner moved to the Executive Briefing, which leads
          with a "Needs attention now" tile and the top remediation actions. */}
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
      primary: pct(dmarcEnf, dnsTotal),
      suffix: '%',
      hint: `${dmarcEnf} of ${dnsTotal} domain${dnsTotal===1?'':'s'} enforce DMARC (reject or quarantine)`,
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
        <div className="val">{s.phishResistant}<small> of {fmt(s.total)} users</small></div>
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
    { label: 'SPF',           pass: spfPass,  total: n, tip: 'Sender Policy Framework: lists the servers allowed to send mail for the domain' },
    { label: 'DKIM',          pass: dkimPass, total: n, tip: 'DomainKeys Identified Mail: cryptographically signs outbound mail so receivers can verify it' },
    { label: 'DMARC enforced',pass: dmarcEnf, total: n, tip: 'Domain-based Message Authentication, Reporting & Conformance: tells receivers to reject or quarantine mail that fails SPF/DKIM' },
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
      <div className="dns-panel-explainer">SPF, DKIM, and DMARC are DNS records that prove mail really came from your domain, and tell receiving servers what to do with mail that fails the check.</div>
      <div className="dns-stat-row">
        {statCards.map(s => (
          <div key={s.label} className="dns-stat-card">
            <div className="dns-stat-label" title={s.tip}>{s.label}</div>
            <div className="dns-stat-val">{s.pass}<span> of {s.total}</span></div>
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
            <div className="icat-meta">{b.pass} pass · {b.fail} fail · {b.fs.length} checks</div>
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
          <div className="kpi-hint">{pass} of {scoreDenom(spo)} scored checks</div>
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
        {/* #930: PHS only matters on tenants with hybrid Directory sync.
            On a cloud-only tenant (syncOk === false), render an N/A card
            with a muted hint instead of a red Disabled warning — there's
            no on-prem AD to sync hashes from. */}
        {syncOk ? (
          <div className={'spo-stat-card' + (phsOk === false ? ' spo-stat-bad' : '')}>
            <div className="kpi-label">Password hash sync</div>
            <div style={{fontSize:13, fontWeight:700, color: phsColor, marginTop:6}}>{phsOk ? 'Enabled' : phsUnknown ? 'Verify' : 'Disabled'}</div>
            {phsOk === false && <div className="kpi-hint" style={{color:'var(--danger-text)'}}>Leaked credential detection and fallback auth may be impacted</div>}
            {phsUnknown && <div className="kpi-hint" style={{color:'var(--warn-text)'}}>No PHS timestamp - verify in Microsoft Entra Connect or Entra Cloud Sync</div>}
          </div>
        ) : (
          <div className="spo-stat-card">
            <div className="kpi-label">Password hash sync</div>
            <div style={{fontSize:13, fontWeight:700, color:'var(--muted)', marginTop:6}}>N/A</div>
            <div className="kpi-hint">Cloud-only tenant — no on-prem hashes to sync</div>
          </div>
        )}
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
