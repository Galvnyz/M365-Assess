import fs from 'node:fs';
import path from 'node:path';
import { transformSync } from '@babel/core';
const assets = path.resolve('src/M365-Assess/assets');
const files = JSON.parse(fs.readFileSync(path.join(assets, 'report-sources.json'), 'utf8'));
const source = files.map(file => {
  const source = fs.readFileSync(path.join(assets, file), 'utf8');
  if (source.split('\n').length > 1000) throw new Error(`${file} exceeds 1,000 lines; split at a component boundary.`);
  return source;
}).join('\n');
const { code } = transformSync(source, { filename: path.join(assets, 'report-app.jsx') });
fs.writeFileSync(path.join(assets, 'report-app.js'), code + '\n');
const runtimeSize = ['report-app.js','react.production.min.js','react-dom.production.min.js'].reduce((n,f)=>n+fs.statSync(path.join(assets,f)).size,0);
if (runtimeSize > 2_500_000) console.warn('Report runtime exceeds 2.5 MB; review the generated HTML budget.');
if (runtimeSize > 3_000_000) throw new Error('Report runtime exceeds 3 MB.');
