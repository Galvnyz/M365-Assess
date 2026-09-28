import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {JSDOM} from 'jsdom';

test('generated HTML preserves script boundaries and losslessly restores untrusted text',()=>{
 const run=spawnSync('pwsh',['-NoProfile','-File','tests/JavaScript/report-embedding-fixture.ps1'],{encoding:'utf8',maxBuffer:16*1024*1024});
 assert.equal(run.status,0,run.stderr || String(run.error));
 const fixture=JSON.parse(run.stdout);
 const dom=new JSDOM(fixture.html,{runScripts:'outside-only'});
 try {
  const document=dom.window.document;
  assert.equal(document.querySelector('[id^="injected-"]'),null);
  assert.ok(document.querySelector('#root'),'report shell remains outside the data script');
  const scripts=[...document.querySelectorAll('script')];
  const dataScripts=scripts.filter(s=>s.textContent.trimStart().startsWith('window.REPORT_DATA ='));
  assert.equal(dataScripts.length,1);
  assert.equal(scripts.some(s=>s.textContent==='window.injected = true'),false);
  assert.equal(dataScripts[0].textContent.includes('<'),false);
  dom.window.eval(dataScripts[0].textContent);
  assert.equal(dom.window.injected,undefined);
  assert.deepEqual(Array.from(dom.window.REPORT_DATA.findings,f=>f.current),fixture.values);
 } finally { dom.window.close(); }
});

test('parser control demonstrates why replacing only exact closing tags is insufficient',()=>{
 for(const value of ['</script ><img id=probe>','</ScRiPt/><img id=probe>']) {
  const legacy=JSON.stringify({value}).replace(/<\/script>/gi,'<\\/script>');
  const dom=new JSDOM('<script>window.data='+legacy+';</script>',{runScripts:'outside-only'});
  try { assert.ok(dom.window.document.querySelector('#probe')); }
  finally { dom.window.close(); }
 }
});
