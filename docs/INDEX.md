# M365-Assess documentation index

Canonical wayfinding entry. Docs are grouped by audience.

> Looking for a specific doc that used to live at `docs/<NAME>.md`? It moved into one of the subdirs below. Stub redirects at the old paths point at the new location and will be deleted in a future cleanup (~6 months from 2026-04-30).

---

## End-user / consultant audience

For consultants running assessments and consuming the report.

| Doc | What's in it |
|---|---|
| [`user/SCOPE.md`](user/SCOPE.md) | One-page answer to "what does this tool actually do?" — in scope, opt-in, out of scope |
| [`user/QUICKSTART.md`](user/QUICKSTART.md) | Step-by-step setup on a fresh Windows machine — install module, prereqs, first run |
| [`user/RUN.md`](user/RUN.md) | Orchestration details — section selection, auth methods, output folders |
| [`user/AUTHENTICATION.md`](user/AUTHENTICATION.md) | Interactive, certificate, device code, managed identity, and pre-existing connection methods |
| [`user/REPORT-USER-GUIDE.md`](user/REPORT-USER-GUIDE.md) | Interactive features in the HTML report — edit mode, finalize, themes, sortable/resizable columns |
| [`user/UNDERSTANDING-RESULTS.md`](user/UNDERSTANDING-RESULTS.md) | What each status (Pass / Fail / Review / Warning / Skipped / etc.) means and what to do |
| [`user/FIRST-REMEDIATION.md`](user/FIRST-REMEDIATION.md) | Worked example: take one Fail finding from initial state through remediation through re-verification |
| [`user/SCORING.md`](user/SCORING.md) | How the headline score is computed; the 6 scoring views; per-audience rationale |
| [`user/COMPLIANCE.md`](user/COMPLIANCE.md) | 15 frameworks, XLSX export, CheckId system, control registry |
| [`user/EVIDENCE-PACKAGE.md`](user/EVIDENCE-PACKAGE.md) | Sanitized evidence bundle for auditor handoff (`-EvidencePackage` switch) |
| [`user/TROUBLESHOOTING.md`](user/TROUBLESHOOTING.md) | Common errors and resolutions |
| [`user/GLOSSARY.md`](user/GLOSSARY.md) | Glossary — Lane / Sequence / Section / Collector / Check / Control / Framework / Profile / Level / Status |

## Implementer / developer audience

For contributors writing collectors, modifying the report, or shipping releases.

| Doc | What's in it |
|---|---|
| [`dev/REPORT-INTERNALS.md`](dev/REPORT-INTERNALS.md) | Frontend build (React/Babel pipeline) + data schema (`window.REPORT_DATA` shape). Merged from former REPORT-FRONTEND + REPORT-SCHEMA. |
| [`dev/EVIDENCE-MODEL.md`](dev/EVIDENCE-MODEL.md) | Per-finding evidence schema; the contract collectors emit |
| [`dev/TESTING.md`](dev/TESTING.md) | Pester patterns + fixture conventions |
| [`dev/RELEASE-PROCESS.md`](dev/RELEASE-PROCESS.md) | Cut a release: bump → tag → publish to PSGallery |
| [`dev/cmdlet-reference.md`](dev/cmdlet-reference.md) | Public cmdlet API surface |
| [`dev/CheckId-Guide.md`](dev/CheckId-Guide.md) | CheckID naming + numbering conventions |

## Reference / canonical docs

Authoritative references for specific topics. Read these when you need to know the exact rules.

| Doc | What's in it |
|---|---|
| [`reference/CHECK-STATUS-MODEL.md`](reference/CHECK-STATUS-MODEL.md) | The 9-status taxonomy (Pass / Fail / Warning / Review / Info / Skipped / Unknown / NotApplicable / NotLicensed) and what each means |
| [`reference/LEVELS.md`](reference/LEVELS.md) | CIS / framework profile + level semantics |
| [`reference/PERMISSIONS.md`](reference/PERMISSIONS.md) | Per-section Graph scopes / EXO RBAC roles / Purview permissions |
| [`reference/COMPATIBILITY.md`](reference/COMPATIBILITY.md) | Module version pins and known-incompatible combinations |
| [`reference/SOVEREIGN-CLOUDS.md`](reference/SOVEREIGN-CLOUDS.md) | Government / China / national cloud support matrix |
| [`reference/DATA-HANDLING.md`](reference/DATA-HANDLING.md) | What's collected, retention recommendations, GDPR/HIPAA/CMMC alignment |

## Other subdirectories

| Path | Purpose |
|---|---|
| [`adr/`](adr/) | Architecture Decision Records — short notes on load-bearing decisions and the tradeoffs we accepted |
| [`research/`](research/) | Decision artifacts from research spikes (audit findings, framework taxonomy investigations, etc.) |
| [`design/`](design/) | Frozen design handoff packages from claude.ai/design (framework redesign, finding-detail redesign) |
| [`architecture/`](architecture/) | High-level architecture diagrams (placeholder; mostly empty) |
| [`diagrams/`](diagrams/) | Mermaid diagrams (data flow, integration topology) |

---

## Cross-link footer template

Every doc in this tree includes a "See also" footer linking to the most-relevant siblings. If you're adding a new doc, follow the same pattern. The template:

```markdown
---

## See also

- [`<sibling-1>`](path) — one-line description
- [`<sibling-2>`](path) — one-line description
- [`INDEX.md`](../INDEX.md) — back to the docs index
```

## Convention

- **Audience first** — pick `user/`, `dev/`, or `reference/` based on who reads the doc, not what it's about.
- **Cross-link, don't duplicate** — if a concept is documented in another file, link to it rather than restating.
- **No issue-number suffixes in titles** — implementation history lives in commit messages and PR descriptions, not file titles.
- **Subdir READMEs only when the subdir has multiple docs** — `research/` and `design/` may not need a README each unless they grow large.
