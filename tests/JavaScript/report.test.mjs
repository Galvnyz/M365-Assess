import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {JSDOM} from 'jsdom';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
const assets='src/M365-Assess/assets/';
const fixtureRun=spawnSync('pwsh',['-NoProfile','-File','tests/JavaScript/report-fixture.ps1'],{encoding:'utf8'});
assert.equal(fixtureRun.status,0,fixtureRun.stderr || String(fixtureRun.error));
const fixture=JSON.parse(fixtureRun.stdout);
const bundle=fs.readFileSync(assets+'report-app.js','utf8');
const ajv=new Ajv({allErrors:true});addFormats(ajv);
const validate=ajv.compile(JSON.parse(fs.readFileSync('src/M365-Assess/schemas/report-data.schema.json')));
function sandbox(data=structuredClone(fixture)) {
 const context=vm.createContext({window:{REPORT_DATA:data},React:{createContext:()=>({}),createElement:()=>({})},ReactDOM:{createRoot:()=>({render(){}})},document:{getElementById:()=>({})},Date});
 vm.runInContext(bundle,context);
 return expression=>vm.runInContext(expression,context);
}
test('PowerShell report producer satisfies versioned array contract',()=>{
 assert.ok(validate(fixture),JSON.stringify(validate.errors));
 const bad=structuredClone(fixture);bad.findings[0].frameworks='cis-m365-v6';assert.equal(validate(bad),false);
});
test('Review never increases readiness and missing results never become passes',()=>{
 const run=sandbox();
 assert.equal(run("computeComplianceReadinessScore([{status:'Review'}])"),0);
 assert.equal(run("computeComplianceReadinessScore([{status:'Review'},{status:'Pass'}])"),50);
 assert.equal(run("computeSecurityRiskScore([{status:'Unknown'},{status:'NotLicensed'}])"),null);
 assert.equal(run('fwCoveragePct({pass:1,fail:1,warn:0,info:10,total:12})'),50);
 assert.equal(run('fwReadinessLabel(100)').label.includes('Audit'),false);
});
test('domain not-assessed counts explain reasons and preserve older data',()=>{
 const run=sandbox();
 const result=JSON.parse(run('JSON.stringify(domainNotAssessed(DOMAIN_STATS["Exchange Online"]))'));
 assert.equal(result.count,5);
 assert.equal(result.tip,'1 skipped, 1 could not be collected, 1 not applicable, 2 not licensed. Never counted in any score.');
 const legacy={pass:1,warn:1,fail:1,review:1,info:1,total:8};
 assert.equal(run(`domainNotAssessed(${JSON.stringify(legacy)}).count`),3);
 assert.equal(run(`domainNotAssessed(${JSON.stringify(legacy)}).tip`),run('NOT_ASSESSED_TIP'));
 for(const partial of [{skipped:3},{skipped:0,unknown:0,notApplicable:0,notLicensed:2}]) {
  assert.equal(run(`domainNotAssessed(${JSON.stringify({...legacy,...partial})}).tip`),run('NOT_ASSESSED_TIP'));
 }
 assert.equal(run('domainNotAssessed({pass:1,warn:0,fail:0,review:0,info:0,total:1,skipped:0,unknown:0,notApplicable:0,notLicensed:0}).count'),0);
 const licensedOnly={pass:0,warn:0,fail:0,review:0,info:0,total:2,skipped:0,unknown:0,notApplicable:0,notLicensed:2};
 assert.equal(run(`domainNotAssessed(${JSON.stringify(licensedOnly)}).tip`),'2 not licensed. Never counted in any score.');
});

test('domain counters validate as optional nonnegative integers',()=>{
 const legacy=structuredClone(fixture);
 for(const stats of Object.values(legacy.domainStats)) {
  for(const key of ['skipped','unknown','notApplicable','notLicensed']) delete stats[key];
 }
 assert.equal(validate(legacy),true,JSON.stringify(validate.errors));
 for(const value of [-1,0.5,'2']) {
  const bad=structuredClone(fixture);bad.domainStats['Exchange Online'].skipped=value;
  assert.equal(validate(bad),false);
 }
});

test('decisions expire and cannot override automated failures with attestations',()=>{
 const run=sandbox();
 assert.equal(run("decisionState({type:'ManualAttestation',approvedAt:'2020-01-01',expiresAt:'2099-01-01'},FINDINGS[1])"),'Ineligible');
 assert.equal(run("decisionState({type:'AcceptedRisk',observedValue:'False',approvedAt:'2020-01-01',expiresAt:'2021-01-01'},FINDINGS[1])"),'Expired');
 assert.equal(run("decisionState({type:'AcceptedRisk',observedValue:'Changed',approvedAt:'2020-01-01',expiresAt:'2099-01-01'},FINDINGS[1])"),'EvidenceChanged');
});
test('actual offline React bundle mounts and edit workflow renders',async()=>{
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{runScripts:'outside-only',url:'https://example.test',pretendToBeVisual:true});
 const w=dom.window;const errors=[];w.addEventListener('error',e=>errors.push(e.error));
 w.REPORT_DATA=structuredClone(fixture);
 w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 w.IntersectionObserver=class{observe(){} disconnect(){} unobserve(){}};
 w.ResizeObserver=class{observe(){} disconnect(){}};
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 for(const f of ['react.production.min.js','react-dom.production.min.js','report-app.js']) w.eval(fs.readFileSync(assets+f,'utf8'));
 await new Promise(r=>setTimeout(r,150));
 assert.equal(errors.length,0,String(errors));
 assert.match(w.document.body.textContent,/Collection: Unspecified/);
 assert.match(w.document.body.textContent,/Assessor decisions/);
 const card=[...w.document.querySelectorAll('.domain-card')].find(c=>c.querySelector('.dc-name').textContent==='Exchange Online');
 assert.ok(card);
 assert.equal(card.querySelector('.dc-skipped').textContent,'5 not assessed');
 assert.match(card.querySelector('.dc-skipped').title,/1 skipped, 1 could not be collected, 1 not applicable, 2 not licensed/);
 assert.equal(card.querySelector('.skipped-seg').title,card.querySelector('.dc-skipped').title);
 assert.equal(card.querySelector('.dc-score').textContent,'50%');
 w.document.querySelector('.edit-mode-toggle').click();
 await new Promise(r=>setTimeout(r,100));
 assert.match(w.document.body.textContent,/Save decision in report/);
 assert.equal(errors.length,0,String(errors));dom.window.close();
});

test('finalization preserves tenant decisions and escapes embedded script markup',async()=>{
 const data=structuredClone(fixture);
 data.assessmentDecisions={schemaVersion:'1.0',tenantId:data.tenant[0].TenantId,decisions:[{
  checkId:'CA-TEST-002',setting:'Automated failure',type:'AcceptedRisk',observedValue:'False',
  approvedAt:'2026-01-01T00:00:00Z',expiresAt:'2099-01-01T00:00:00Z',approvedBy:'Assessor',
  justification:'Migration',evidence:'</ScRiPt><script>untrusted()</script> </script ><img id="injected-space"> </script/><img id="injected-slash"> <!--<script></script>'
 }]};
 const dom=new JSDOM('<!doctype html><div id="root"></div><script id="report-overrides"></script><script>window.REPORT_DATA = {};</script>',{runScripts:'outside-only',url:'https://example.test'});
 const w=dom.window;w.REPORT_DATA=data;
 w.React={createContext:()=>({}),createElement:()=>({})};w.ReactDOM={createRoot:()=>({render(){}})};
 w.Blob=Blob;let saved;w.URL.createObjectURL=blob=>{saved=blob;return 'blob:fixture';};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=()=>{};
 w.eval(bundle);w.finalizeReport({hiddenFindings:new Set(),hiddenElements:new Set(),roadmapOverrides:{}});
 const html=await saved.text();
 assert.equal(html.includes('</ScRiPt>'),false);
 const reopened=new JSDOM(html,{runScripts:'outside-only'});
 assert.equal(reopened.window.document.querySelector('[id^="injected-"]'),null);
 assert.ok(reopened.window.document.querySelector('#root'));
 const script=[...reopened.window.document.querySelectorAll('script')].find(s=>s.textContent.startsWith('window.REPORT_DATA ='));
 reopened.window.eval(script.textContent);
 assert.deepEqual(JSON.parse(JSON.stringify(reopened.window.REPORT_DATA.assessmentDecisions)),data.assessmentDecisions);
 dom.window.close();reopened.window.close();
});
