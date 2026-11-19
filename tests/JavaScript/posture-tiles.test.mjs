// Posture tiles (#1060): state rules and rendered behaviour.
// Spec: docs/specs/2026-11-19-posture-tiles-design.md
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {JSDOM} from 'jsdom';

const assets = 'src/M365-Assess/assets/';
const fixtureRun = spawnSync('pwsh', ['-NoProfile', '-File', 'tests/JavaScript/report-fixture.ps1'], {encoding: 'utf8'});
assert.equal(fixtureRun.status, 0, fixtureRun.stderr || String(fixtureRun.error));
const fixture = JSON.parse(fixtureRun.stdout);
const bundle = fs.readFileSync(assets + 'report-app.js', 'utf8');

// Evaluate the real bundle with React stubbed out, so the pure tile functions
// can be called directly.
function sandbox() {
  const context = vm.createContext({window: {REPORT_DATA: structuredClone(fixture)},
    React: {createContext: () => ({}), createElement: () => ({})}, ReactDOM: {createRoot: () => ({render() {}})},
    document: {getElementById: () => ({})}, Date});
  vm.runInContext(bundle, context);
  return context;
}
const ctx = sandbox();
const tile = (id, data) => vm.runInContext('ptDeriveTile', ctx)(vm.runInContext('PT_TILE_DEFS', ctx).find(d => d.id === id), data);
const row = data => vm.runInContext('ptDeriveRow', ctx)(data);
const has = (id, checkId) => vm.runInContext('ptTileHasCheck', ctx)(id, checkId);

const col = (Section, Status = 'Complete') => ({Section, Collector: Section + ' collector', Status});
const fnd = (checkId, status, severity = 'medium') => ({checkId, status, severity, setting: checkId + ' setting'});
const bothRan = {collectors: [col('Identity'), col('Collaboration')]};

test('tile membership uses the base check id and never includes indicators', () => {
  assert.equal(has('external', 'ENTRA-GUEST-001.2'), true);
  assert.equal(has('external', 'SPO-SHARING-004'), true);
  assert.equal(has('admin', 'ENTRA-GUEST-001.1'), false);
  assert.equal(has('nope', 'ENTRA-GUEST-001.1'), false);
  for (const id of ['admin', 'signin', 'apps', 'email', 'external', 'devices', 'audit']) {
    assert.equal(has(id, 'IOC-CONSENT-001.1'), false, id);
  }
});

test('missing data is labelled as missing, never as a result', () => {
  const t = tile('external', {findings: [], collection: {collectors: []}});
  assert.equal(t.state, 'missing');
  assert.equal(t.verdict, 'Not collected');
  assert.match(t.reason, /Identity or Collaboration section not run/);
  assert.equal(tile('external', {findings: []}).state, 'missing', 'no collection block at all');

  const ran = tile('external', {findings: [], collection: bothRan});
  assert.equal(ran.state, 'na');
  assert.equal(ran.verdict, 'Nothing to check');
  // One dependent section ran and found nothing, the other never ran: that is
  // not "nothing to check", it is uncollected.
  const half = tile('external', {findings: [], collection: {collectors: [col('Identity')]}});
  assert.equal(half.state, 'missing');
  assert.equal(half.reason, 'Collaboration section not run.');

  const unlicensed = tile('devices', {findings: [fnd('INTUNE-COMPLIANCE-001.1', 'NotLicensed')], collection: {collectors: [col('Intune'), col('Identity')]}});
  assert.equal(unlicensed.state, 'na');
  assert.equal(unlicensed.verdict, 'Not licensed');

  const skipped = tile('external', {findings: [fnd('ENTRA-GUEST-001.1', 'Skipped'), fnd('SPO-SHARING-001.1', 'Unknown')], collection: bothRan});
  assert.equal(skipped.state, 'missing');
  assert.equal(skipped.verdict, 'Not measured');

  const person = tile('external', {findings: [fnd('ENTRA-GUEST-001.1', 'Review')], collection: bothRan});
  assert.equal(person.state, 'missing');
  assert.match(person.reason, /1 check need a person/);
});

test('gaps colour the tile by Fail severity', () => {
  const pass = fnd('ENTRA-GUEST-002.1', 'Pass');
  const bad = tile('external', {findings: [pass, fnd('ENTRA-GUEST-001.1', 'Fail', 'high')], collection: bothRan});
  assert.equal(bad.state, 'bad');
  assert.equal(bad.verdict, 'At risk');
  const medium = tile('external', {findings: [pass, fnd('ENTRA-GUEST-001.1', 'Fail', 'medium')], collection: bothRan});
  assert.equal(medium.state, 'warn');
  const warning = tile('external', {findings: [pass, fnd('ENTRA-GUEST-001.1', 'Warning', 'critical')], collection: bothRan});
  assert.equal(warning.state, 'warn', 'a Warning alone is never At risk');
  // Weakest item: Fails before Warnings, then by severity.
  const mixed = tile('external', {findings: [fnd('SPO-SHARING-001.1', 'Warning', 'critical'), fnd('SPO-SHARING-002.1', 'Fail', 'low'), fnd('ENTRA-GUEST-001.1', 'Fail', 'high')], collection: bothRan});
  assert.deepEqual([...mixed.gaps].map(f => f.checkId), ['ENTRA-GUEST-001.1', 'SPO-SHARING-002.1', 'SPO-SHARING-001.1']);
});

test('green only when fully measured, every section ran and every collector completed', () => {
  const passes = [fnd('ENTRA-GUEST-001.1', 'Pass'), fnd('SPO-SHARING-001.1', 'Pass')];
  const good = tile('external', {findings: passes, collection: bothRan});
  assert.equal(good.state, 'good');
  assert.equal(good.verdict, 'No gaps found');

  // The overclaim the mockup caught: one guest check, Collaboration never ran.
  const oneSection = tile('external', {findings: [fnd('ENTRA-GUEST-001.1', 'Pass')], collection: {collectors: [col('Identity')]}});
  assert.equal(oneSection.state, 'partial');
  assert.deepEqual([...oneSection.missingSections], ['Collaboration']);

  const partialCollector = tile('external', {findings: passes, collection: {collectors: [col('Identity'), col('Collaboration', 'Partial')]}});
  assert.equal(partialCollector.state, 'partial');
  assert.deepEqual([...partialCollector.incomplete], ['Collaboration collector: Partial']);

  const unmeasured = tile('external', {findings: [...passes, fnd('TEAMS-EXTACCESS-001.1', 'Skipped')], collection: bothRan});
  assert.equal(unmeasured.state, 'partial');
  const awaiting = tile('external', {findings: [...passes, fnd('TEAMS-EXTACCESS-001.1', 'Review')], collection: bothRan});
  assert.equal(awaiting.state, 'partial');
  assert.equal(awaiting.verdict, 'Partly measured');
});

test('supporting figures appear only when their data was collected', () => {
  assert.equal(tile('external', {findings: [], users: [{}]}).metric, null);
  assert.equal(tile('external', {findings: [], users: [{GuestUsers: ''}]}).metric, null);
  assert.equal(tile('external', {findings: [], users: [{GuestUsers: 0}]}).metric.value, 0);
  assert.equal(tile('admin', {findings: [], mfaStats: {total: 0, adminsWithoutMfa: 0}}).metric, null);
  assert.equal(tile('admin', {findings: [], mfaStats: {total: 4, adminsWithoutMfa: 2}}).metric.bad, true);
  assert.equal(tile('email', {findings: [], dns: [{DMARCPolicy: 'reject'}, {DMARCPolicy: 'none'}]}).metric.value, '1/2');
  assert.equal(tile('devices', {findings: [], deviceStats: null}).metric, null);
});

test('the row collapses when no configuration section ran', () => {
  const hunt = row({findings: [], collection: {collectors: [col('Compromise')]}, indicators: [{checkId: 'IOC-INBOXRULE-001.1', status: 'Fail'}]});
  assert.equal(hunt.collapsed, true);
  assert.equal(hunt.tiles.length, 0);
  assert.equal(hunt.huntRan, true);
  assert.equal(row({findings: []}).huntRan, false);
  const partial = row({findings: [fnd('EXO-AUDIT-001.1', 'Pass')], collection: {collectors: [col('Email'), col('Security')]}});
  assert.equal(partial.collapsed, false);
  assert.equal(partial.tiles.length, 7);
});

// ---------------------------------------------------------------- rendered

async function mount(data) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {runScripts: 'outside-only', url: 'https://example.test', pretendToBeVisual: true});
  const w = dom.window; const errors = []; w.addEventListener('error', e => errors.push(e.error));
  w.REPORT_DATA = data;
  w.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}});
  w.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
  w.ResizeObserver = class { observe() {} disconnect() {} };
  w.HTMLElement.prototype.scrollIntoView = () => {};
  for (const f of ['react.production.min.js', 'react-dom.production.min.js', 'report-app.js']) w.eval(fs.readFileSync(assets + f, 'utf8'));
  await new Promise(r => setTimeout(r, 150));
  return {dom, w, errors};
}

// Reuse a real producer finding so every other component still gets the
// fields it expects, then retarget it at a tile.
function withTileFindings() {
  const data = structuredClone(fixture);
  const template = data.findings.find(f => f.status === 'Pass');
  const mk = (checkId, status, severity) => ({...structuredClone(template), checkId, status, severity, setting: checkId + ' setting'});
  data.findings.push(
    mk('ENTRA-GUEST-001.1', 'Pass', 'medium'), mk('SPO-SHARING-001.1', 'Fail', 'high'), mk('TEAMS-EXTACCESS-001.1', 'Pass', 'low'),
    mk('EXO-AUDIT-001.1', 'Pass', 'medium'), mk('EXO-AUDIT-002.1', 'Pass', 'medium'));
  data.collection = {state: 'Complete', scope: 'fixture', unavailableFindings: 0, incompleteCollectors: 0,
    collectors: ['Identity', 'Email', 'Security', 'Collaboration'].map(s => ({Section: s, Collector: s + ' collector', Status: 'Complete', Items: 1, Error: null}))};
  return data;
}

test('a run with no tile checks shows one sentence, not a green tile', async () => {
  const {dom, w, errors} = await mount(structuredClone(fixture));
  assert.equal(errors.length, 0, String(errors));
  assert.equal(w.document.querySelectorAll('.pt-tile').length, 0);
  assert.match(w.document.querySelector('.pt-collapsed').textContent, /No configuration areas were collected/);
  assert.equal(w.document.querySelectorAll('.exec-tile').length, 0, 'old tiles are gone');
  dom.window.close();
});

test('tiles render from findings and a click narrows All findings to that area', async () => {
  const {dom, w, errors} = await mount(withTileFindings());
  assert.equal(errors.length, 0, String(errors));
  const tiles = [...w.document.querySelectorAll('.pt-tile')];
  assert.equal(tiles.length, 7);
  const byName = name => tiles.find(t => t.querySelector('.pt-name').textContent === name);
  const external = byName('External access');
  assert.ok(external.classList.contains('bad'));
  assert.match(external.textContent, /2 of 3 scored checks pass/);
  assert.match(external.textContent, /SPO-SHARING-001\.1 setting/);
  assert.ok(byName('Audit and investigation').classList.contains('good'));
  const devices = byName('Devices');
  assert.equal(devices.tagName, 'DIV', 'a tile with no checks is not a button');
  assert.ok(devices.classList.contains('missing'));
  assert.match(devices.textContent, /Not collected/);
  assert.match(devices.textContent, /Intune section not run/);

  external.click();
  await new Promise(r => setTimeout(r, 100));
  assert.match(w.document.querySelector('#findings h2').textContent, /Showing 3 of /);
  const rows = [...w.document.querySelectorAll('.finding-row')].map(r => r.id);
  assert.deepEqual(rows.sort(), ['finding-row-ENTRA-GUEST-001-1', 'finding-row-SPO-SHARING-001-1', 'finding-row-TEAMS-EXTACCESS-001-1']);
  const chip = [...w.document.querySelectorAll('.filter-group')].find(g => g.querySelector('.filter-group-label')?.textContent === 'Area');
  assert.ok(chip, 'Area chip is shown');
  assert.match(chip.textContent, /External access/);
  chip.querySelector('button').click();
  await new Promise(r => setTimeout(r, 100));
  assert.doesNotMatch(w.document.querySelector('#findings h2').textContent, /Showing/);
  assert.equal(errors.length, 0, String(errors));
  dom.window.close();
});
