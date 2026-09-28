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

// =====================================================================
// Issue #863 Phase 2 — Finding-detail Direction D shell components
// =====================================================================
// State strip (Row 1), Risk narrative (Row 2), Provenance footer.
// Phase 2 ships the structural shell; later phases add typed observed/
// expected (Phase 3), side rail (Phase 4), owner/ticket assignment
// (Phase 5). Empty / null-data fields render as muted placeholders so
// the shell degrades gracefully — see docs/design/finding-detail/.

// Phase 2 sequence column: matches the XLSX matrix's "Sequence" terminology
// from #840. Pass-status findings show "Done" (consistent with the matrix's
// green Done cell). Findings without a lane AND not Pass render as muted
// plain text — no pill — since the chip-style rendering reads as
// "actionable item with a state" which is wrong for non-remediable rows.
const LANE_LABELS = { now: 'Do Now', soon: 'Do Next', later: 'Later' };
const LANE_CSS    = { now: 'now', soon: 'next', later: 'later' };

function FindingStateStrip({ f }) {
  const isPass = f.status === 'Pass';
  // Sequence cell content + chip-vs-text decision:
  //  - lane present (now/soon/later) → coloured pill
  //  - status === Pass               → "Done" success pill
  //  - everything else               → muted plain text (no pill)
  let sequenceNode;
  if (f.lane && LANE_LABELS[f.lane]) {
    sequenceNode = <span className={'fdc-pill ' + LANE_CSS[f.lane]}>{LANE_LABELS[f.lane]}</span>;
  } else if (isPass) {
    sequenceNode = <span className="fdc-pill done">Done</span>;
  } else {
    sequenceNode = <span className="val muted">—</span>;
  }
  const effort = f.effort ? f.effort[0].toUpperCase() + f.effort.slice(1) : '—';

  // Phase 2 affected count: derive from evidence.observedValue if it has a
  // numeric prefix (e.g. "3 admins without MFA"), otherwise fall back to a
  // muted dash. Real per-collector affectedObjects field arrives in Phase 3.
  let affectedText = null;
  let affectedClass = '';
  const observed = f.evidence?.observedValue || f.current || '';
  const numMatch = String(observed).match(/^(\d+)\s+([a-z][\w\s\-]*?)(?:[.,;]|$)/i);
  if (numMatch) {
    affectedText = numMatch[1] + ' ' + numMatch[2].trim();
    affectedClass = f.severity === 'critical' ? 'danger' : (f.severity === 'high' ? 'warn' : '');
  }

  return (
    <div className="fdd-strip">
      <div className="fdd-strip-cell">
        <span className="label">Sequence</span>
        {sequenceNode}
      </div>
      <div className="fdd-strip-cell">
        <span className="label">Effort</span>
        <span className={'val' + (f.effort ? '' : ' muted')}>{effort}</span>
      </div>
      <div className="fdd-strip-cell">
        <span className="label">Affected</span>
        {affectedText
          ? <span className={'val ' + affectedClass}>{affectedText}</span>
          : <span className="val muted">—</span>}
      </div>
      <div className="fdd-strip-cell">
        <span className="label">Owner</span>
        <span className="val muted">Unassigned</span>
      </div>
      <div className="fdd-strip-cell">
        <span className="label">Ticket</span>
        <span className="val muted">—</span>
      </div>
    </div>
  );
}

function FindingRiskNarrative({ f }) {
  // Phase 2: use existing whyItMatters() output as the Risk paragraph.
  // The "Why it matters" subsection is intentionally empty until per-check
  // narrative authoring lands (Option C from the v2.11.0 plan).
  const risk = whyItMatters(f);
  const mitre = Array.isArray(f.mitre) ? f.mitre : [];
  return (
    <div className="fdd-risk">
      <div className="fdd-risk-icon" aria-hidden="true">!</div>
      <div className="fdd-risk-body">
        <div className="fdd-risk-section">
          <div className="fdd-risk-head danger">Risk</div>
          <p>{risk}</p>
        </div>
      </div>
      {mitre.length > 0 && (
        <div className="fdd-risk-meta">
          <span className="fdd-risk-meta-label">MITRE ATT&amp;CK</span>
          <div className="fdd-mitre">
            {mitre.map(m => <code key={m} title={m}>{String(m).split(' — ')[0]}</code>)}
          </div>
        </div>
      )}
    </div>
  );
}

// Direction D collapsible provenance footer. Reuses the evidence schema
// from D1 #785; visually re-frames the existing EvidenceBlock as a footer
// at the bottom of the expanded row with an inline summary of the most
// useful provenance keys.
function FindingProvenanceFooter({ evidence }) {
  if (!evidence) return null;
  let ev = evidence;
  if (typeof ev === 'string') {
    try { ev = { raw: ev }; } catch { return null; }
  }
  const fields = [
    ['evidenceSource',     'Source'],
    ['evidenceTimestamp',  'Collected'],
    ['collectionMethod',   'Method'],
    ['permissionRequired', 'Permission'],
    ['confidence',         'Confidence'],
    ['observedValue',      'Observed'],
    ['expectedValue',      'Expected'],
    ['limitations',        'Limitations'],
  ];
  const present = fields.filter(([k]) => ev[k] !== undefined && ev[k] !== null && ev[k] !== '');
  let rawPretty = null;
  if (ev.raw) {
    try { rawPretty = JSON.stringify(JSON.parse(ev.raw), null, 2); }
    catch { rawPretty = String(ev.raw); }
  }
  if (present.length === 0 && !rawPretty) return null;

  // Inline summary pulls 2-3 most-useful keys (source + collected + confidence).
  const summaryKeys = ['evidenceSource', 'evidenceTimestamp', 'confidence'];
  const summaryEntries = summaryKeys
    .map(k => [k, ev[k]])
    .filter(([, v]) => v !== undefined && v !== null && v !== '');

  return (
    <details className="fdd-prov">
      <summary>
        <span className="prov-summary">
          <span className="prov-key">Provenance</span>
          {summaryEntries.length === 0 && <span className="prov-sep">·</span>}
          {summaryEntries.map(([k, v], i) => (
            <React.Fragment key={k}>
              {i > 0 && <span className="prov-sep">·</span>}
              <code>{k === 'confidence' ? `${Math.round(v * 100)}%` : String(v)}</code>
            </React.Fragment>
          ))}
        </span>
        <span className="prov-toggle">View details</span>
      </summary>
      <div className="fdd-prov-body">
        {ev.limitations && (
          <p className="fdd-limit"><b>Limitations:</b> {ev.limitations}</p>
        )}
        {present.length > 0 && (
          <div className="fdd-prov-meta">
            {present.filter(([k]) => k !== 'limitations').map(([k, label]) => (
              <div key={k}>
                <span className="k">{label}</span>
                <span className="v">{k === 'confidence' ? `${Math.round(ev[k] * 100)}%` : String(ev[k])}</span>
              </div>
            ))}
          </div>
        )}
        {rawPretty && (
          <details className="finding-evidence-raw" style={{marginTop: 10}}>
            <summary>Raw evidence</summary>
            <pre>{rawPretty}</pre>
          </details>
        )}
      </div>
    </details>
  );
}

// Issue #901: per-finding Copy button. Emits a markdown summary that's
// paste-friendly into ticketing systems / Slack / email when triaging.
// Visual feedback: button text flips to "Copied ✓" for 2 seconds after
// successful clipboard write.
function FindingCopyButton({ f }) {
  const [copied, setCopied] = React.useState(false);
  const onClick = (e) => {
    e.stopPropagation();
    const sev = f.severity ? f.severity[0].toUpperCase() + f.severity.slice(1) : '—';
    const seq = f.lane ? (LANE_LABELS[f.lane] || f.lane)
              : (f.status === 'Pass' ? 'Done' : '—');
    const fwLines = (f.frameworks || []).map(fw => {
      const meta = f.fwMeta?.[fw];
      const cid = meta?.controlId ? ` ${meta.controlId}` : '';
      return `${fw}${cid}`;
    }).join(' · ');
    const refUrl = f.references?.[0]?.url ? `\nReference: ${f.references[0].url}` : '';
    const md = [
      `**[${f.status}]** ${f.setting} (${f.checkId})`,
      `${f.domain || '—'} · ${sev} · ${seq}`,
      fwLines ? `Frameworks: ${fwLines}` : null,
      '',
      `Risk: ${whyItMatters(f)}`,
      '',
      `Current: ${f.current || '—'}`,
      `Recommended: ${f.recommended || '—'}`,
      '',
      `Remediation: ${f.remediation || '—'}` + refUrl,
    ].filter(x => x !== null).join('\n');
    const writeFn = navigator.clipboard?.writeText
      ? navigator.clipboard.writeText.bind(navigator.clipboard)
      : (text) => {
          // Fallback for older browsers: temporary textarea + execCommand
          const ta = document.createElement('textarea');
          ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
          return Promise.resolve();
        };
    writeFn(md).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button className="fdd-copy-btn" onClick={onClick}
            title={copied ? 'Copied to clipboard' : 'Copy finding as markdown'}>
      {copied ? '✓ Copied' : '⧉ Copy'}
    </button>
  );
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

  const tasks = FINDINGS.filter(f => isActionableFinding(f) && !hiddenFindings?.has(f.checkId)).map(f => ({ ...f }));
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
            <span className={'status-badge ' + STATUS_COLORS[t.status]} title={STATUS_TIP[t.status]}><span className="dot"/>{statusLabel(t.status)}</span>
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
// #968: curated attack-path checks flagged by REPORT_DATA (criticalExposure).
// These checks also appear under their natural domains (Entra ID, Conditional
// Access, Intune); this section is a cross-cutting prioritized view, distinct
// from the severity-based "critical findings" briefing tile.
function CriticalExposureBlock() {
  const { open, headProps } = useCollapsibleSection();
  const items = FINDINGS.filter(f => f.criticalExposure);
  if (!items.length) return null;
  const fail = items.filter(f => f.status==='Fail').length;
  const pass = items.filter(f => f.status==='Pass').length;
  return (
    <section className="block" id="critical-exposure">
      <div {...headProps}>
        <span className="eyebrow">01b · Critical exposure</span>
        <h2>Critical exposure analysis</h2>
        <span className="section-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <div className="hr"/>
      </div>
      {open && <><div className="card" style={{marginBottom:12, display:'flex', gap:24, alignItems:'center', flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:12, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.1em', fontWeight:600}}>Coverage</div>
          <div style={{fontSize:34, fontWeight:700, fontFamily:'var(--font-display)', letterSpacing:'-.02em'}}>
            {pct(pass, scoreDenom(items))}<span style={{fontSize:18, color:'var(--muted)'}}>%</span>
          </div>
        </div>
        <div style={{flex:1, minWidth:200, fontSize:13, color:'var(--text-soft)', lineHeight:1.55}}>
          Mapped to MITRE ATT&amp;CK Enterprise techniques and CISA Known Exploited Vulnerabilities (KEV). Prioritized by CIS Critical Security Controls v8 — covers privileged account exposure, CA exclusions, dangerous Graph permissions, and audit trail gaps.
        </div>
        <div style={{display:'flex', gap:18, fontVariantNumeric:'tabular-nums'}}>
          <div><div style={{fontSize:12,color:'var(--muted)'}}>Pass</div><div style={{fontWeight:700, color:'var(--success-text)'}}>{pass}</div></div>
          <div><div style={{fontSize:12,color:'var(--muted)'}}>Fail</div><div style={{fontWeight:700, color:'var(--danger-text)'}}>{fail}</div></div>
          <div><div style={{fontSize:12,color:'var(--muted)'}}>Total</div><div style={{fontWeight:700}}>{items.length}</div></div>
        </div>
      </div>
      <div className="findings ce-findings">
        <div className="findings-head">
          <div>Status</div><div>Check</div><div>Check ID</div><div>Severity</div><div/>
        </div>
        {items.map((f,i) => (
          <div key={i} className="finding-row" style={{cursor:'default'}}>
            <div><span className={'status-badge '+STATUS_COLORS[f.status]} title={STATUS_TIP[f.status]}><span className="dot"/>{statusLabel(f.status)}</span></div>
            <div className="finding-title"><div className="t">{f.setting}</div><div className="sub">{f.section}</div></div>
            <div className="check-id">{f.checkId}</div>
            <div><span className={'sev-badge '+f.severity}><span className="bar"><i/><i/><i/><i/></span><span>{SEV_LABEL[f.severity]}</span></span></div>
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
