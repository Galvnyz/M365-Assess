# Third-party licenses

This document lists every third-party package shipped in the M365-Assess HTML report or used in the developer build chain. All current dependencies are MIT-licensed. Regenerate this file whenever the dep tree changes (see [`docs/REPORT-FRONTEND.md`](docs/REPORT-FRONTEND.md) and [`docs/RELEASE-PROCESS.md`](docs/RELEASE-PROCESS.md)).

Last updated: 2026-04-26 for M365-Assess v2.9.0.

---

## Runtime — shipped in every HTML report

These are inlined into the self-contained HTML report and execute in the end user's browser when the report is opened.

### React

- **Version:** 18.3.1
- **Source:** https://unpkg.com/react@18.3.1/umd/react.production.min.js
- **License:** MIT
- **Copyright:** © Meta Platforms, Inc. and affiliates.
- **License text:** [https://github.com/facebook/react/blob/main/LICENSE](https://github.com/facebook/react/blob/main/LICENSE)

### ReactDOM

- **Version:** 18.3.1
- **Source:** https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js
- **License:** MIT
- **Copyright:** © Meta Platforms, Inc. and affiliates.
- **License text:** [https://github.com/facebook/react/blob/main/LICENSE](https://github.com/facebook/react/blob/main/LICENSE)

---

## Developer tooling — not shipped to end users

These run only at developer / CI time to transpile `report-app.jsx` → `report-app.js`. They never reach an end user's machine via the HTML report.

### @babel/cli

- **License:** MIT
- **Repository:** https://github.com/babel/babel
- **Used for:** running the transpile step (`npm run build`)

### @babel/core

- **License:** MIT
- **Repository:** https://github.com/babel/babel
- **Used for:** the Babel transpiler itself

### @babel/preset-react

- **License:** MIT
- **Repository:** https://github.com/babel/babel
- **Used for:** transforming JSX → `React.createElement(...)` calls

Transitive dependencies of the Babel packages are also MIT or compatible (BSD-2-Clause / Apache-2.0). The full transitive tree is captured in `package-lock.json`; run `license-checker --production --json` against `node_modules/` for an exhaustive list.

---

## Microsoft licensing-service-plan reference data

The bundled SKU friendly-names CSV (`src/M365-Assess/assets/sku-friendly-names.csv`) is a snapshot of Microsoft's published [Product names and service plan identifiers for licensing](https://learn.microsoft.com/en-us/entra/identity/users/licensing-service-plan-reference) reference. Microsoft publishes this under permissive use for licensing tooling. The runtime tries the live download first; the bundled copy is a fallback for offline / restricted environments.

To refresh the bundled snapshot:

```powershell
pwsh -NoProfile -File ./src/M365-Assess/assets/Update-SkuCsv.ps1
```

---

## License compliance summary

| Component | License | Distributed to end users? |
|---|---|---|
| M365-Assess (this project) | MIT | ✅ |
| React 18 | MIT | ✅ (inlined in HTML report) |
| ReactDOM 18 | MIT | ✅ (inlined in HTML report) |
| @babel/cli | MIT | ❌ (developer-only) |
| @babel/core | MIT | ❌ (developer-only) |
| @babel/preset-react | MIT | ❌ (developer-only) |
| Microsoft SKU reference CSV | Permissive (Microsoft Learn) | ✅ (bundled snapshot, used as fallback) |

All distributed components are MIT-licensed. M365-Assess itself ships under MIT — no copyleft obligations propagate.
