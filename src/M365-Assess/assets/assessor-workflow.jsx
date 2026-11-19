// Assessor claims are intentionally separate from collected status and scores.
let assessmentDecisionDocument = D.assessmentDecisions || { schemaVersion: '1.0', tenantId: TENANT.TenantId || '', decisions: [] };
const decisionKey = f => `${f.checkId.replace(/\.\d+$/, '')}\n${f.setting}`;
function decisionState(d, f, now = Date.now()) {
  if (Date.parse(d.expiresAt) <= now) return 'Expired';
  if (Date.parse(d.approvedAt) > now) return 'Future';
  if (FINDINGS.filter(x => decisionKey(x) === decisionKey(f)).length !== 1) return 'Ambiguous';
  if (d.type === 'ManualAttestation' && f.status !== 'Review') return 'Ineligible';
  if (d.type === 'AcceptedRisk' && (!['Fail', 'Warning'].includes(f.status) || String(f.current ?? '') !== d.observedValue)) return 'EvidenceChanged';
  return 'Active';
}
function isActionableFinding(f) {
  const d = assessmentDecisionDocument.decisions.find(d => `${d.checkId}\n${d.setting}` === decisionKey(f));
  return ['Fail','Warning','Review'].includes(f.status) && !(d && decisionState(d,f) === 'Active');
}
function validateDecision(d) {
  for (const k of ['checkId', 'setting', 'justification', 'approvedBy', 'evidence']) {
    if (typeof d[k] !== 'string' || !d[k].trim()) throw new Error(`${k} is required.`);
  }
  if (!['AcceptedRisk', 'ManualAttestation'].includes(d.type) || typeof d.observedValue !== 'string') throw new Error('Invalid decision type or observation.');
  if (!Number.isFinite(Date.parse(d.approvedAt)) || !Number.isFinite(Date.parse(d.expiresAt)) || Date.parse(d.expiresAt) <= Date.parse(d.approvedAt)) throw new Error('Expiry must be after approval.');
}
function downloadDecisions() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(assessmentDecisionDocument, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = '_Assessment-Decisions.json'; a.click(); URL.revokeObjectURL(url);
}
// #1065: one collapsed line at the top of the report. Expanding it shows the
// explanation and every collector, incomplete ones first.
function CollectionStatus() {
  const c = D.collection;
  const state = c?.state || 'Unspecified';
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const parts = [];
  if (c?.incompleteCollectors) parts.push(plural(c.incompleteCollectors, 'collector incomplete', 'collectors incomplete'));
  if (c?.unavailableFindings) parts.push(plural(c.unavailableFindings, 'finding unavailable', 'findings unavailable'));
  const clean = x => x.Status === 'Complete' && !x.Error;
  const partial = (c?.collectors || []).filter(x => !clean(x));
  const complete = (c?.collectors || []).filter(clean);
  return <details className={'collection-status cs-' + state.toLowerCase()} aria-label="Collection completeness">
    <summary>
      <span className="cs-dot" aria-hidden="true"/>
      <strong>Collection: {state}</strong>
      {parts.length > 0 && <span className="cs-detail">{' · ' + parts.join(' · ')}</span>}
    </summary>
    <div className="cs-body">
      <p>Scores describe observed findings only. Missing data and unverified reviews do not establish compliance.{c?.scope ? ' ' + c.scope : ''}</p>
      {partial.length > 0 && <ul className="cs-list">{partial.map((x, i) => (
        <li key={i} className="cs-row-partial">
          <span className="cs-collector">{x.Section ? x.Section + ' · ' : ''}{x.Collector}</span>
          <span className="cs-state">{x.Status}</span>
          {x.Error && <span className="cs-error">{x.Error}</span>}
        </li>
      ))}</ul>}
      {complete.length > 0 && <>
        <div className="cs-complete-label">{complete.length} complete</div>
        <ul className="cs-complete-list">{complete.map((x, i) => <li key={i}>{x.Collector}</li>)}</ul>
      </>}
    </div>
  </details>;
}
function AssessorWorkflow({ editMode }) {
  const [document, setDocument] = useState(assessmentDecisionDocument);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({type:'AcceptedRisk', justification:'', approvedBy:'', evidence:'', expiresAt:''});
  const candidates = FINDINGS.filter(f => ['Fail','Warning','Review'].includes(f.status));
  const update = next => { assessmentDecisionDocument = next; setDocument(next); window.dispatchEvent(new Event('assessment-decisions-changed')); };
  const save = e => {
    e.preventDefault(); setError('');
    try {
      if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(document.tenantId)) throw new Error('A collected tenant GUID is required.');
      const f = candidates.find(f => decisionKey(f) === selected);
      if (!f) throw new Error('Select a finding.');
      const d = {checkId:f.checkId.replace(/\.\d+$/, ''), setting:f.setting, ...form, observedValue:String(f.current ?? ''), approvedAt:new Date().toISOString(), expiresAt:new Date(form.expiresAt).toISOString()};
      validateDecision(d);
      if (decisionState(d,f) !== 'Active') throw new Error('This decision does not apply to the selected finding.');
      update({...document, decisions:[...document.decisions.filter(x => `${x.checkId}\n${x.setting}` !== selected), d]});
    } catch (err) { setError(err.message); }
  };
  const active = document.decisions.filter(d => FINDINGS.some(f => decisionKey(f) === `${d.checkId}\n${d.setting}` && decisionState(d,f) === 'Active'));
  const actionable = candidates.filter(f => !active.some(d => decisionKey(f) === `${d.checkId}\n${d.setting}`));
  // #1066: an assessor tool, not reader content. Shown while editing, or when
  // the report carries decisions (they are not badged on findings yet, so this
  // is the only place a reader sees them). A default run shows nothing.
  if (!editMode && document.decisions.length === 0) return null;
  return <section className="card" aria-label="Assessor decisions" style={{margin:'20px 0',padding:20}}>
    <h2>Assessor decisions</h2><p>{actionable.length} actionable findings · {active.filter(d=>d.type==='AcceptedRisk').length} accepted risks · {active.filter(d=>d.type==='ManualAttestation').length} manual attestations.</p>
    <p>Observations and scores remain unchanged. Export decisions and pass the file with <code>-AssessmentDecisionsPath</code> on the next run or report regeneration to update HTML, XLSX and JSON together.</p>
    <ul>{document.decisions.map((d,i)=>{ const f=FINDINGS.find(f=>decisionKey(f)===`${d.checkId}\n${d.setting}`); return <li key={i}>
      <strong>{d.checkId} — {d.setting}: {d.type} ({f ? decisionState(d,f) : 'Unmatched'})</strong>
      <p>{d.justification} — {d.approvedBy}; approved {d.approvedAt}; expires {d.expiresAt}. Evidence: {d.evidence}</p>
      {editMode && <button onClick={()=>update({...document,decisions:document.decisions.filter((_,n)=>n!==i)})}>Remove decision</button>}
    </li>;})}</ul>
    {editMode && <form onSubmit={save}>
      <label>Finding <select value={selected} onChange={e=>{setSelected(e.target.value); const f=candidates.find(x=>decisionKey(x)===e.target.value); setForm({...form,type:f?.status==='Review'?'ManualAttestation':'AcceptedRisk'});}}><option value="">Select a finding</option>{candidates.map(f=><option key={f.checkId} value={decisionKey(f)}>{f.checkId} — {f.setting}</option>)}</select></label>
      <p>{form.type === 'ManualAttestation' ? 'Manual review attestation' : 'Accepted risk'}</p>
      {['justification','approvedBy','evidence'].map(k=><label key={k} style={{display:'block'}}>{k} <input required value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})}/></label>)}
      <label>Expires <input type="datetime-local" required value={form.expiresAt} onChange={e=>setForm({...form,expiresAt:e.target.value})}/></label>
      <button type="submit">Save decision in report</button>
      {error && <p role="alert">{error}</p>}
    </form>}
    <button onClick={downloadDecisions}>Export decisions JSON</button>
  </section>;
}
