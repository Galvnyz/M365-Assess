# Report frontend

How the M365-Assess HTML report's React app is sourced, built, and shipped.

---

## What ships in every report

The HTML report is **self-contained** — a single `.html` file that runs in any modern browser with no network dependencies. Every dependency is inlined at report-generation time.

| Asset | Source | License | Rendered at runtime? |
|---|---|---|---|
| React 18 (production build) | [react.production.min.js](https://unpkg.com/react@18.3.1/umd/react.production.min.js) | MIT | ✅ inlined |
| ReactDOM 18 (production build) | [react-dom.production.min.js](https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js) | MIT | ✅ inlined |
| `report-app.js` (compiled) | Babel-transpiled from `report-app.jsx` | MIT (own code) | ✅ inlined |
| `report-shell.css` + `report-themes.css` | Hand-authored | MIT (own code) | ✅ inlined |

Pinned versions live at `src/M365-Assess/assets/react.production.min.js` and `react-dom.production.min.js`. They're committed to the repo so the build is reproducible without npm at report-generation time.

---

## Build pipeline

```
report-app.jsx  ── babel ──>  report-app.js  ── inlined ──>  _Assessment-Report_<tenant>.html
                  (transpile)                 (Get-ReportTemplate.ps1)
```

Babel runs only at developer time:

```powershell
npm install        # installs @babel/cli + @babel/core + @babel/preset-react
npm run build      # transpiles JSX -> ES5-compatible JS
```

`report-app.js` is **committed** to the repo. CI's quality-gates job runs `npm run build` and `git diff` to verify the committed `.js` matches a fresh transpile of the `.jsx`. Any drift fails the PR with an explicit error pointing at the regen command.

### Why React via plain `<script>` and not bundled

`report-app.js` is concatenated into the HTML inside a plain `<script>` tag — no Webpack, no Rollup, no module bundler. Two reasons:

1. **No JSX at runtime.** Babel transpiles JSX → `React.createElement(...)` calls. The browser parser doesn't need a JSX runtime.
2. **Reproducible build minimum.** Adding a bundler would mean reproducible builds depend on bundler config, not just Babel + React versions. Keeping the runtime to "react production min + transpiled JSX" is the smallest defensible footprint.

The cost: every component must use `React.createElement` semantics. JSX edited into `report-app.jsx` survives Babel transpile; raw JSX accidentally pasted into `report-app.js` causes a SyntaxError that blanks the entire report. CI's `node --check` step catches this. See `.claude/rules/` for the project-internal contributor rule.

---

## Pinning + reproducibility

Production React/ReactDOM are committed at known SHA-pinned versions:

```bash
$ shasum -a 256 src/M365-Assess/assets/react.production.min.js
$ shasum -a 256 src/M365-Assess/assets/react-dom.production.min.js
```

Update procedure when bumping React:

1. Download the new pinned version from `unpkg.com/react@<version>/umd/react.production.min.js`
2. Verify the SHA against the [npm package's published shasum](https://www.npmjs.com/package/react)
3. Replace the file in `src/M365-Assess/assets/`
4. Update this doc's table with the new version
5. Test the report renders against `docs/sample-report/` per `.claude/rules/`'s "live test before merging" rule
6. Update `THIRD-PARTY-LICENSES.md`'s React entry if anything material changed

Babel deps (`devDependencies` in `package.json`) are pinned via `package-lock.json`. Update via `npm install <package>@<version> --save-dev` and commit the lock file change.

---

## Supply chain monitoring

CI runs `npm audit --audit-level=high` as an **advisory** step (non-blocking) on every PR that modifies `package.json` or `package-lock.json`. Findings surface in the workflow log; a HIGH-or-above advisory is a signal to investigate but does not auto-fail the build.

Why advisory rather than blocking: Babel devDependencies don't ship to end users. A vulnerability in `@babel/cli` is a developer-machine concern, not a runtime concern for the assessment report. Blocking PRs on advisories that don't affect runtime safety adds friction without commensurate security value.

For genuine runtime concerns (e.g., a CVE in React itself), the bump procedure above applies and the PR description should call out the security driver in CHANGELOG.

### Quarterly cadence

Per the lockfile-hygiene rule (folded in from #678):

- Quarterly: `npm install && npm audit`; review findings; commit any lockfile drift
- Annually: revisit whether Dependabot + manual audit suffices, or whether a dedicated `npm-audit` workflow that opens issues on advisories would add value

---

## License attribution

[`THIRD-PARTY-LICENSES.md`](../THIRD-PARTY-LICENSES.md) at the repo root lists every third-party license shipping in the HTML report or developer build chain. Maintained by hand today (the dep list is small); regenerate from `node_modules/` via `license-checker` if/when the surface grows:

```powershell
npm install -g license-checker
license-checker --production --json | ConvertFrom-Json | Format-Table
```

The licenses doc updates in lockstep with the React/ReactDOM/Babel pinning above. Per `RELEASE-PROCESS.md`, regenerate on every minor or major version bump that changes the dep tree.

---

## Files

| Path | Purpose |
|---|---|
| `src/M365-Assess/assets/react.production.min.js` | Pinned React 18 production build (committed) |
| `src/M365-Assess/assets/react-dom.production.min.js` | Pinned ReactDOM 18 production build (committed) |
| `src/M365-Assess/assets/report-app.jsx` | **Editable source** for the report's React app |
| `src/M365-Assess/assets/report-app.js` | Babel-transpiled output of `.jsx`; committed; CI verifies sync |
| `src/M365-Assess/assets/report-shell.css` | Base CSS (chip styles, layout, status badges) |
| `src/M365-Assess/assets/report-themes.css` | Theme overrides (Neon, Vibe, Console, HighContrast) |
| `src/M365-Assess/Common/Get-ReportTemplate.ps1` | PowerShell function that inlines all assets into the final HTML |
| `package.json` | Babel devDependencies + `npm run build` script |
| `package-lock.json` | Dependency lockfile; committed for reproducible builds |
| `THIRD-PARTY-LICENSES.md` | License attribution (MIT for React/ReactDOM/Babel) |

---

## Related

- [`REPORT-SCHEMA.md`](REPORT-SCHEMA.md) — the data shape the React app consumes
- [`TESTING.md`](TESTING.md) — local report swap-in test pattern
- [`RELEASE-PROCESS.md`](RELEASE-PROCESS.md) — when to regenerate THIRD-PARTY-LICENSES.md
- `.claude/rules/` (internal) — JSX→JS sync rule, live-test-before-merge rule
