# 0011 — Framework definitions are auto-discovered per-framework JSON files

- **Status:** Accepted
- **Date:** 2026-05-06

## Context

M365-Assess maps each check to **fifteen** compliance frameworks: CIS Controls v8, CIS M365 v6, CISA SCuBA, CMMC, Essential Eight, FedRAMP, HIPAA, ISO 27001, ISO 27002, MITRE ATT&CK, NIST 800-53 r5, NIST CSF, PCI DSS v4, SOC 2 TSC, STIG. Each framework has its own structure: control IDs, profiles (e.g. CIS L1/L2, CMMC L1/L2/L3), scoring method (control-coverage vs. weighted), display order in the report, filter family for the UI grouping.

We had three reasonable shapes for storing this:

1. **One big monolithic file** with every framework as a sub-object.
2. **One JSON file per framework**, listed explicitly in code or a manifest.
3. **One JSON file per framework**, auto-discovered by scanning a directory.

The data is upstream-owned (CheckID syncs the framework files alongside the registry — see [ADR-0001](0001-checkid-sync-vs-fork.md)). When CheckID adds a new framework, M365-Assess should pick it up without code changes. Conversely, when CheckID retires one, the report should silently stop showing it.

We also wanted contributors who add a *local* framework experiment (e.g. NIS2, a customer-specific compliance overlay) to be able to drop one file in `controls/frameworks/` and have it appear in the report. Anything more ceremonious would discourage experimentation.

## Decision

`controls/frameworks/` contains one JSON file per framework. `Import-FrameworkDefinitions.ps1` scans the directory at report-render time, loads every `*.json`, and returns an ordered array of framework hashtables.

Each framework JSON file has a self-describing shape:

```json
{
  "frameworkId": "cis-m365-v6",
  "label": "CIS Microsoft 365 Foundations v6",
  "description": "...",
  "displayOrder": 10,
  "scoring": {
    "method": "control-coverage",
    "profiles": {
      "L1": { "controlCount": 56, "label": "Level 1", "css": "cis-l1" },
      "L2": { "controlCount": 88, "label": "Level 2", "css": "cis-l2" }
    }
  },
  "controls": [ ... ]
}
```

The loader:

- Skips files missing `frameworkId` or `label` with a `Write-Warning`.
- Skips files that fail JSON parsing with a `Write-Warning` (does not abort).
- Sorts the resulting array by `displayOrder` so the report's framework tabs come out in a deliberate order regardless of filename / load order.
- Derives `filterFamily` from the `frameworkId` prefix using a hardcoded prefix→family map (`cis` → `CIS`, `nist` → `NIST`, etc.). Longest prefix wins so `cisa` matches before `cis`.

No explicit framework list anywhere. Adding a framework = drop a file. Removing one = delete a file. CheckID's sync workflow simply overwrites the framework directory.

See: [`src/M365-Assess/Common/Import-FrameworkDefinitions.ps1`](../../src/M365-Assess/Common/Import-FrameworkDefinitions.ps1) and [`src/M365-Assess/controls/frameworks/`](../../src/M365-Assess/controls/frameworks/).

## Consequences

**Positive**

- CheckID syncs add/remove framework support automatically. The first time a v3.5.0 sync ships an `iso-27002.json`, the report grows an ISO 27002 tab without any code change.
- Contributors can prototype a custom framework overlay by dropping one file. No registration step, no bootstrap code path to update.
- Bad files fail soft: a malformed `essential-eight.json` doesn't crash the report — it just drops that framework and emits a warning.
- The directory is the canonical list. No "the code says we have 14 but the directory has 15" drift.
- Display order is data, not code. Reordering framework tabs is a JSON edit.

**Negative**

- "Auto-discovery" hides which frameworks actually shipped. A reader of the codebase has to look at the directory, not at code, to know what's supported. We mitigate by listing them in CLAUDE.md, but the canonical list is still in the filesystem.
- The prefix-to-family map IS hardcoded in `Import-FrameworkDefinitions.ps1`. A future framework with a novel prefix (`nis2`, `dora`) would land with `filterFamily = ''` and need a code change to get a UI grouping. That partially undermines the "drop a file and it works" promise.
- Failure is silent-to-warning. A `Write-Warning` for a malformed JSON file is easy to miss in a long assessment log; a contributor who edits the JSON wrong sees their framework disappear from the report and has to know to look. We've considered upgrading these warnings to ERRORs but kept them WARN to preserve "report still renders if a framework is broken."
- The `displayOrder` is not validated for collisions. Two frameworks with the same `displayOrder` get a stable-but-arbitrary tie-break. Has not bitten in practice but could.
- `Get-ChildItem -Filter '*.json'` matches anything ending in `.json`. A stray editor swap file (`framework.json~`) would be skipped only because it doesn't match the filter. A `manifest.json` or `index.json` accidentally placed in the directory would be parsed and probably skipped at the `frameworkId` check, but it's a sharp edge.

**Failure modes and mitigations**

- *Sync overwrites a framework file with broken JSON* → sync PR shows the diff, human review catches it (typically a Unicode encoding issue, fixed by the sync workflow's CP1252→UTF-8 normalization). If it lands anyway, the report renders without that framework with a WARN log entry. Loud-enough failure.
- *New CheckID framework lands with an unrecognized prefix* → renders without `filterFamily`, UI groups it under an empty bucket. Mitigation: update the prefix map; effectively a manual step on every new-framework CheckID release. Could be improved by reading `filterFamily` directly from each framework JSON.
- *Two frameworks claim the same `frameworkId`* → second one wins, first is silently shadowed. Mitigation: none currently. Has not happened — CheckID uses unique prefixes by convention.
- *Performance on large framework counts* → not a concern at 15. The scan + parse runs once per assessment and finishes in milliseconds. We'd revisit if frameworks ever grew to 100+.

## Alternatives considered

- **One monolithic `frameworks.json`.** Rejected: every CheckID sync would touch one giant file, and merge conflicts on local edits become unavoidable. Per-file isolation is much friendlier to upstream sync.
- **Explicit framework list in code (`$frameworkFiles = @('cis-m365-v6.json', 'nist-csf.json', ...)`).** Rejected: every CheckID upstream change would require a code edit. Defeats the auto-pickup property.
- **Manifest JSON listing the framework files (`controls/frameworks/index.json`).** Rejected for the same reason: it's an auxiliary file the sync workflow would also have to maintain. The directory listing IS the manifest.
- **Move `filterFamily` derivation into each framework JSON file (declarative).** Worth doing; not done yet. Currently the prefix map is in code because that's where the existing 12 frameworks expected it. A future PR could move this to data without breaking compatibility — readers would just trust the JSON value if present.
- **Hard-fail on a malformed framework JSON.** Rejected: we'd rather render the report without one framework than not render it at all. The conservative posture matches the "skip on unavailable service" decision in [ADR-0007](0007-skip-collector-on-unavailable-service.md).

---

## See also

- [`../../src/M365-Assess/Common/Import-FrameworkDefinitions.ps1`](../../src/M365-Assess/Common/Import-FrameworkDefinitions.ps1) — the auto-discovery loader
- [`../../src/M365-Assess/controls/frameworks/`](../../src/M365-Assess/controls/frameworks/) — the JSON files
- [`0001-checkid-sync-vs-fork.md`](0001-checkid-sync-vs-fork.md) — upstream sync model (frameworks ride on this)
- [`0007-skip-collector-on-unavailable-service.md`](0007-skip-collector-on-unavailable-service.md) — sibling "fail soft" posture
- [`README.md`](README.md) — back to the ADR index
