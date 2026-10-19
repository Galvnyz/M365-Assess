// Validate the delivered HTML, including its inline assets, without network I/O.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM, VirtualConsole} from 'jsdom';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const [htmlPath, expectedCount, expectedSnapshots] = process.argv.slice(2);
const errors = [];
const console = new VirtualConsole();
console.on('jsdomError', error => errors.push(error.message));
console.on('error', (...args) => errors.push(args.join(' ')));
const dom = new JSDOM(fs.readFileSync(htmlPath, 'utf8'), {
  runScripts: 'outside-only', url: 'https://example.test', pretendToBeVisual: true,
  virtualConsole: console,
});
try {
  const w = dom.window;
  w.addEventListener('error', event => errors.push(String(event.error)));
  w.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}});
  w.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
  w.ResizeObserver = class { observe() {} disconnect() {} };
  w.HTMLElement.prototype.scrollIntoView = () => {};
  assert.equal(w.document.querySelectorAll('script[src],link[rel="stylesheet"][href]').length, 0, 'Report must contain its own JS and CSS');
  for (const script of w.document.querySelectorAll('script')) {
    if (!script.type || /javascript/.test(script.type)) w.eval(script.textContent);
  }
  const ajv = new Ajv({allErrors: true});
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(fs.readFileSync(new URL('../src/M365-Assess/schemas/report-data.schema.json', import.meta.url))));
  assert.ok(validate(w.REPORT_DATA), JSON.stringify(validate.errors));
  assert.equal(w.REPORT_DATA.findings.length, Number(expectedCount));
  assert.equal(w.REPORT_DATA.xlsxFileName, '_Compliance-Matrix_contoso.xlsx');
  assert.equal(w.REPORT_DATA.tenant[0].TenantId, '11111111-1111-1111-1111-111111111111');
  assert.equal(w.REPORT_DATA.trendOptIn, true);
  const snapshots = Number(expectedSnapshots);
  assert.equal(w.REPORT_DATA.trendData?.length ?? 0, snapshots > 1 ? snapshots : 0);
  const changed = w.REPORT_DATA.findings.find(finding => finding.checkId === 'ENTRA-SECDEFAULT-001.1');
  assert.equal(changed.status, snapshots === 1 ? 'Pass' : 'Fail');
  const deadline = Date.now() + 5000;
  while (!w.document.querySelector('.domain-card') && errors.length === 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.deepEqual(errors, [], 'Generated report runtime errors');
  assert.ok(w.document.querySelector('.domain-card'), 'React report failed to mount');
  assert.match(w.document.body.textContent, /Contoso/);
  process.stdout.write(`Rendered and validated ${htmlPath}\n`);
} finally {
  dom.window.close();
}
