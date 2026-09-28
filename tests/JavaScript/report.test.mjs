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
