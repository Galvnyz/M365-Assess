// Direction D — HYBRID (B + C + A)
// Synthesizes the strongest pieces of each model into a single shippable
// pattern designed for the live report and a Claude-Code handoff.
//
// Schema (target state — additions on top of today's finding shape):
//   {
//     // ── claim & diff (typed observed/expected from B) ──────────────
//     setting, section, domain, severity, status, checkId,
//     evidence: { observedValue, expectedValue, evidenceSource, evidenceTimestamp,
//                 collectionMethod, permissionRequired, confidence, limitations, raw },
//
//     // ── workflow state (from C) ────────────────────────────────────
//     lane: 'now'|'soon'|'later',  effort: 'small'|'medium'|'large',
//     owner: string|null,  ticket: { system, id, status }|null,
//     history: [{ date, status, note }],
//     affectedObjects: { kind, count, sample[] },
//
//     // ── narrative + action (from A) ────────────────────────────────
//     riskNarrative: string,                 // one paragraph: what an attacker can do
//     remediation: { portal: string, ps?: string, verify?: string },
//     references: [{ title, url }],
//     mitre: [string],
//
//     // ── compliance basis (typed mapping) ───────────────────────────
//     frameworks: [fwId],
//     fwMeta: { [fwId]: { controlId, profiles: [string] } },
//     relatedFindings: [checkId],
//   }
//
// Layout:
//   Row 1: state strip (lane · effort · affected · owner · ticket)
//   Row 2: risk narrative (the "why it matters" lede)
//   Row 3: split — left = typed observed/expected table + remediation tabs
//                  right = side rail (mappings · trend · related · evidence)
//   Footer: collapsible raw evidence (forensic depth on demand)

function DirectionD({ finding }) {
  const f = finding || window.MOCK_FINDINGS[0];
  const FW = window.FD_FW_NAMES;
  const ev = f.evidence || {};
  const [actionTab, setActionTab] = React.useState('portal');

  const laneLabel = { now: 'Do Now', soon: 'Do Next', later: 'Later' }[f.lane] || '—';
  const laneClass = { now: 'now', soon: 'next', later: '' }[f.lane] || 'empty';

  const ps = (f.remediation || '').match(/Run:\s*([^.]*)/)?.[1].trim();
  const portalSummary = (() => {
    const m = (f.remediation || '').match(/^(.*?)(Run:.*)$/s);
    return m ? m[1].trim() : f.remediation;
  })();

  // Structured claim sentence (B) — the typed assertion
  const claim = ({
    'ENTRA-MFA-001':       <>Phishable authentication methods are <b>enabled for the admin role-assignable group</b>. Phishing-resistant methods are <b>disabled tenant-wide</b>.</>,
    'DEFENDER-SAFELINKS-002': <>Safe Links is enabled for <b>Email only</b>. Office apps and Teams are <b>unprotected</b>, and click-through is <b>permitted</b>.</>,
    'CA-EXCLUSION-001':    <>The "Require MFA for admins" policy <b>excludes 4 directory roles</b> covering 4 admin users; only break-glass exclusions are sanctioned.</>,
  })[f.checkId];

  // Numbered remediation procedure (B) — the actual click-by-click
  const procedure = ({
    'ENTRA-MFA-001':       ['Open Entra admin center → Protection → Authentication methods → Policies.', 'For each phishable method (SMS, Voice, Email OTP), set Target → Exclude → "Admins (role-assignable)" group.', 'Enable FIDO2 for the same admin group with Target → Include.', 'Verify with Get-MgPolicyAuthenticationMethodPolicy.'],
    'DEFENDER-SAFELINKS-002': ['Microsoft 365 Defender → Email & collaboration → Policies & rules → Safe Links → "Default" policy.', 'Toggle "Office 365 apps" → ON.', 'Toggle "Teams" → ON.', 'Uncheck "Let users click through to original URL".', 'Save and verify with Get-SafeLinksPolicy "Default".'],
    'CA-EXCLUSION-001':    ['Entra admin center → Protection → Conditional Access → Policies → "Require MFA for admins".', 'Under Users → Exclude → remove all directory-role exclusions.', 'Remove individual admin user exclusions.', 'Keep only the dedicated break-glass user(s); document them in the runbook.', 'Quarterly: re-verify with Get-MgIdentityConditionalAccessPolicy.'],
  })[f.checkId] || [];
  const verify = ({
    'ENTRA-MFA-001':       'Get-MgPolicyAuthenticationMethodPolicy | Select-Object -ExpandProperty AuthenticationMethodConfigurations | Where-Object State -EQ "enabled"',
    'DEFENDER-SAFELINKS-002': 'Get-SafeLinksPolicy "Default" | Select EnableSafeLinksForEmail, EnableSafeLinksForOffice, EnableSafeLinksForTeams, AllowClickThrough',
    'CA-EXCLUSION-001':    'Get-MgIdentityConditionalAccessPolicy -Filter "displayName eq \'Require MFA for admins\'" | Select-Object -ExpandProperty Conditions',
  })[f.checkId];

  const risk = ({
    'ENTRA-MFA-001':       'A compromised admin password without phishing-resistant MFA hands an attacker the entire tenant. SMS and voice are subject to SIM-swap; push fatigue defeats Authenticator. FIDO2 / WHfB / cert-based are the only methods CISA still classifies as phishing-resistant.',
    'DEFENDER-SAFELINKS-002': 'Office and Teams are dominant phishing-link delivery channels. Without Safe Links rewriting URLs at click-time, zero-day phishing pages bypass perimeter scanning entirely. Click-through allow gives users a one-click escape from the protection.',
    'CA-EXCLUSION-001':    'Every excluded admin is an MFA-free path to Global Admin. Directory-role exclusions silently grant exclusion to any future user added to the role. Only documented, monitored break-glass accounts should ever appear here.',
  })[f.checkId];

  // Why it matters (compliance / audit consequence — from B's "Implication")
  const whyItMatters = ({
    'ENTRA-MFA-001':       <>This control maps to <b>{f.frameworks.length} frameworks</b>; the gap is a finding in any audit using {f.frameworks.slice(0,2).map(fw => FW[fw]).join(' or ')}. Phishing-resistant MFA for privileged accounts is also a CISA SCuBA M365 baseline requirement and a US federal mandate (M-22-09).</>,
    'DEFENDER-SAFELINKS-002': <>Safe Links coverage gaps fail explicit checks in <b>{f.frameworks.length} frameworks</b> including {f.frameworks.slice(0,2).map(fw => FW[fw]).join(' and ')}. The "Office apps + Teams" coverage is the line item assessors look for; "Email only" is documented as insufficient.</>,
    'CA-EXCLUSION-001':    <>Conditional Access exclusions are explicitly inventoried by <b>{f.frameworks.length} frameworks</b>; an exclusion list with anything beyond named break-glass accounts is a documented audit failure under {f.frameworks.slice(0,2).map(fw => FW[fw]).join(' and ')}. The control is also called out by name in CISA SCuBA AAD §2.1.</>,
  })[f.checkId];

  const initials = (s) => s ? s.split(/\s|@/)[0].slice(0,2).toUpperCase() : '—';

  return (
    <div className="fd-d">
      {/* Row 1 — state strip */}
      <div className="fdd-strip">
        <div className="fdd-strip-cell">
          <span className="label">Horizon</span>
          <span className={'fdc-pill ' + laneClass}>{laneLabel}</span>
        </div>
        <div className="fdd-strip-cell">
          <span className="label">Effort</span>
          <span className="val">{(f.effort || 'medium')[0].toUpperCase() + (f.effort || 'medium').slice(1)}</span>
        </div>
        <div className="fdd-strip-cell">
          <span className="label">Affected</span>
          <span className={'val ' + (f.severity === 'critical' ? 'danger' : 'warn')}>
            {f.affectedObjects?.count} {f.affectedObjects?.kind}
          </span>
        </div>
        <div className="fdd-strip-cell">
          <span className="label">Owner</span>
          {f.owner
            ? <span className="val ownerRow">
                <span className="fdc-avatar" style={{width:18, height:18, fontSize:9}}>{initials(f.owner)}</span>
                {f.owner}
              </span>
            : <span className="val muted">Unassigned · <a href="#" style={{color:'var(--accent-text)'}}>Assign</a></span>}
        </div>
        <div className="fdd-strip-cell">
          <span className="label">Ticket</span>
          {f.ticket
            ? <a href="#" className="val" style={{color:'var(--accent-text)', textDecoration:'none'}}>
                {f.ticket.system} {f.ticket.id} <span style={{fontSize:10, color:'var(--muted)'}}>· {f.ticket.status}</span>
              </a>
            : <span className="fdc-pill empty" style={{cursor:'pointer'}}>+ Create ticket</span>}
        </div>
      </div>

      {/* Row 2 — risk + why it matters */}
      <div className="fdd-risk">
        <div className="fdd-risk-icon">!</div>
        <div className="fdd-risk-body">
          <div className="fdd-risk-section">
            <div className="fdd-risk-head danger">Risk</div>
            <p>{risk}</p>
          </div>
          <div className="fdd-risk-section">
            <div className="fdd-risk-head">Why it matters</div>
            <p>{whyItMatters}</p>
          </div>
        </div>
        {f.mitre?.length > 0 && (
          <div className="fdd-risk-meta">
            <span className="fdd-risk-meta-label">MITRE ATT&CK</span>
            <div className="fdd-mitre">
              {f.mitre.map(m => <code key={m} title={m}>{m.split(' — ')[0]}</code>)}
            </div>
          </div>
        )}
      </div>

      {/* Row 3 — main + side rail */}
      <div className="fdd-grid">
        <div className="fdd-main">
          {/* Finding claim (from B) — the structured assertion */}
          <div className="fdd-claim">
            <span className="kicker">Finding</span>
            <span className="body">{claim}</span>
          </div>

          {/* Typed observed/expected/delta (from B) */}
          <table className="fdb-diff-table">
            <tbody>
              <tr>
                <th>Observed</th>
                <td className="observed">{ev.observedValue || f.current}</td>
              </tr>
              <tr>
                <th>Expected</th>
                <td className="expected">{ev.expectedValue || f.recommended}</td>
              </tr>
              <tr>
                <th>Delta</th>
                <td style={{color:'var(--danger-text)', fontSize:12.5}}>
                  {f.affectedObjects?.count} {f.affectedObjects?.kind} non-compliant
                  {window.FD_SEV_LABEL && <> · severity <b>{window.FD_SEV_LABEL[f.severity]}</b></>}
                  {f.affectedObjects?.sample?.length > 0 && (
                    <span className="fdd-samples">
                      {f.affectedObjects.sample.slice(0,4).map(s => (
                        <code key={s} className="fdd-sample">{s}</code>
                      ))}
                      {f.affectedObjects.sample.length > 4 && (
                        <span className="fdd-sample-more">+{f.affectedObjects.sample.length - 4} more</span>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Action block (from A) with numbered procedure (from B) */}
          <div className="fda-fix" style={{marginTop:0}}>
            <div className="fda-fix-tabs">
              <button className={'fda-fix-tab' + (actionTab==='portal'?' active':'')} onClick={()=>setActionTab('portal')}>
                Portal <span className="count">{procedure.length || 'UI'}{procedure.length ? ' steps' : ''}</span>
              </button>
              {ps && <button className={'fda-fix-tab' + (actionTab==='ps'?' active':'')} onClick={()=>setActionTab('ps')}>
                PowerShell <span className="count">script</span>
              </button>}
              {verify && <button className={'fda-fix-tab' + (actionTab==='verify'?' active':'')} onClick={()=>setActionTab('verify')}>
                Verify <span className="count">cmd</span>
              </button>}
            </div>
            <div className="fda-fix-body">
              {actionTab === 'portal' && (
                procedure.length > 0
                  ? <ol className="fdd-procedure">{procedure.map((step, i) => <li key={i}>{step}</li>)}</ol>
                  : <p>{portalSummary}</p>
              )}
              {actionTab === 'ps' && ps && <pre><button className="copy-btn">⧉ Copy</button>{ps}</pre>}
              {actionTab === 'verify' && verify && <pre><button className="copy-btn">⧉ Copy</button>{verify}</pre>}
            </div>
          </div>
        </div>

        {/* Side rail — provenance, mappings, trend, related */}
        <aside className="fdd-side">
          <div className="fdc-card">
            <div className="h">Compliance mappings</div>
            <div className="fdc-fws">
              {f.frameworks.map(fw => {
                const meta = f.fwMeta?.[fw];
                const profs = (meta?.profiles || []).filter(Boolean);
                return (
                  <div key={fw} className="fdd-fw-line">
                    <span className="nm">{FW[fw] || fw}</span>
                    <code>{meta?.controlId || '—'}</code>
                    {profs.length > 0 && (
                      <span className="lvls">
                        {profs.map(p => <span key={p} className="lvl">{p}</span>)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="fdc-card">
            <div className="h">Trend · last 3 runs</div>
            <div className="fdc-history">
              {(f.history || []).map(h => (
                <div key={h.date} className="fdc-hist-row">
                  <span className="date">{h.date}</span>
                  <span className={'pip ' + (h.status==='Pass'?'pass':h.status==='Warn'?'warn':'fail')}/>
                  <span className="note">{h.note}</span>
                </div>
              ))}
            </div>
          </div>

          {f.relatedFindings?.length > 0 && (
            <div className="fdc-card">
              <div className="h">Related</div>
              <div className="fdc-related">
                {f.relatedFindings.map(r => (
                  <a key={r} href={'#'+r} style={{fontFamily:'var(--font-mono)'}}>↳ {r}</a>
                ))}
              </div>
            </div>
          )}

          {(f.references || []).length > 0 && (
            <div className="fdc-card">
              <div className="h">Learn more</div>
              <div className="fdc-related">
                {f.references.map(r => (
                  <a key={r.url} href={r.url} target="_blank" rel="noreferrer noopener">📖 {r.title} ↗</a>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Footer — provenance + raw evidence (forensic depth on demand) */}
      <details className="fdd-prov">
        <summary>
          <span className="prov-summary">
            <span className="prov-key">Source:</span> <code>{ev.evidenceSource}</code>
            <span className="prov-sep">·</span>
            <span className="prov-key">Collected:</span> <code>{ev.evidenceTimestamp ? new Date(ev.evidenceTimestamp).toISOString().slice(0,16).replace('T',' ') + ' UTC' : '—'}</code>
            <span className="prov-sep">·</span>
            <span className="prov-key">Confidence:</span>
            <span className="fdd-conf">
              <span className="fdd-conf-bar"><i style={{width: `${(ev.confidence || 1)*100}%`}}/></span>
              <b>{Math.round((ev.confidence || 1)*100)}%</b>
            </span>
            <span className="prov-sep">·</span>
            <span className="prov-key">Permission:</span> <code>{ev.permissionRequired || '—'}</code>
          </span>
          <span className="prov-toggle">View raw evidence ▾</span>
        </summary>
        <div className="fdd-prov-body">
          <div className="fdd-prov-meta">
            <div><span className="k">Method</span><span className="v">{ev.collectionMethod || '—'}</span></div>
            <div><span className="k">Run ID</span><code>{f.checkId.toLowerCase()}-26e4a31</code></div>
            <div><span className="k">Tenant</span><code>contoso.onmicrosoft.com</code></div>
          </div>
          {ev.limitations && (
            <div className="fdd-limit">
              <b>⚠ Limitations:</b> {ev.limitations}
            </div>
          )}
          <pre>{ev.raw ? (() => { try { return JSON.stringify(JSON.parse(ev.raw), null, 2); } catch { return ev.raw; }})() : JSON.stringify({observed: ev.observedValue, expected: ev.expectedValue}, null, 2)}</pre>
        </div>
      </details>
    </div>
  );
}

window.DirectionD = DirectionD;
