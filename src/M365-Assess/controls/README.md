# Control Registry

The control registry maps security checks to compliance frameworks. It is a **committed data artifact** consumed from the upstream [CheckID](https://github.com/Galvnyz/CheckID) project.

## Data Flow

```
CheckID repo (source of truth)
  └─ data/registry.json
  └─ data/frameworks/*.json
       │
       ▼  CI fetches from pinned CheckID release tag
M365-Assess repo
  └─ controls/registry.json        ← committed for offline use
  └─ controls/frameworks/*.json    ← committed for offline use
       │
       ▼  loaded at runtime
  Common/Import-ControlRegistry.ps1
```

**Key points:**
- `registry.json` and framework JSONs are committed so `git clone` works offline
- CI compares against the pinned CheckID release and warns if updates are available
- To add or modify controls, make changes in the [CheckID](https://github.com/Galvnyz/CheckID) repo and cut a new release

## Files

| File | Purpose |
|------|---------|
| `registry.json` | M365-scoped security checks with inline framework mappings (counts below) |
| `sync-scope.json` | Collector allowlist applied when syncing the registry from CheckID |
| `frameworks/cis-controls-v8.json` | CIS Controls v8 mappings |
| `frameworks/cis-m365-v6.json` | CIS M365 v6 profile definitions (E3/E5, L1/L2) |
| `frameworks/cisa-scuba.json` | CISA SCuBA baseline definitions |
| `frameworks/cmmc.json` | CMMC 2.0 practice/domain definitions |
| `frameworks/essential-eight.json` | Australian Essential Eight maturity model |
| `frameworks/fedramp.json` | FedRAMP control baselines |
| `frameworks/hipaa.json` | HIPAA Security Rule safeguards |
| `frameworks/iso-27001.json` | ISO 27001:2022 Annex A controls |
| `frameworks/mitre-attack.json` | MITRE ATT&CK technique mappings |
| `frameworks/nist-800-53-r5.json` | NIST 800-53 Rev 5 with Low/Moderate/High/Privacy baselines |
| `frameworks/nist-csf.json` | NIST CSF 2.0 function/category mappings |
| `frameworks/pci-dss-v4.json` | PCI DSS v4.0.1 requirement definitions |
| `frameworks/soc2-tsc.json` | SOC 2 Trust Services Criteria |
| `frameworks/stig.json` | DISA STIG M365 rules |

<!-- registry-stats:files:begin -->
`registry.json` currently contains **292 checks** across **15 collector families**, including **5 local extension checks**. Mappings span **20 framework keys**, 15 of which have report-view definitions in `frameworks/`.
<!-- registry-stats:files:end -->

## Updating Registry Data

1. Update controls in the [CheckID](https://github.com/Galvnyz/CheckID) repo
2. Cut a new CheckID release (e.g., `v1.3.0`)
3. Update the `TAG` variable in `.github/workflows/ci.yml` to the new tag
4. CI will detect the diff and flag it; copy the updated files into a PR

## Runtime Usage

```powershell
# Import-ControlRegistry loads registry.json and framework definitions
. ./Common/Import-ControlRegistry.ps1
$lookup = Import-ControlRegistry -ControlsPath ./controls
$lookup['ENTRA-MFA-001']  # Returns check metadata with framework mappings
```

## Severity Rating Rubric

`risk-severity.json` is the local (non-upstream) severity overlay consumed by `-QuickScan`
selection, Now/Next/Later lane bucketing, and report/XLSX severity badges. Two provenance
tiers:

- **Curated** — M365-context judgment calls that deliberately override the upstream
  CheckID `impactRating.severity` where tenant blast radius differs (example: admin MFA
  escalated High → Critical; an unauthenticated-attacker path to Global Admin is always
  Critical regardless of upstream weighting).
- **Seeded (#956)** — entries adopted verbatim from upstream `impactRating.severity`
  (`Informational` maps to `Info`). Seeded values are honest defaults, not final word —
  re-curate when a check's M365 blast radius diverges from the generic upstream rating,
  and prefer escalation over demotion when in doubt.

Every check in `registry.json` must have an entry here — `Import-ControlRegistry` exposes
`severityRated` and the generated `docs/reference/COVERAGE.md` publishes the count, so a
new check without a rating shows up immediately in the stats gate.
