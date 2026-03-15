# Control Registry

The control registry maps security checks to compliance frameworks. It is a **generated artifact** - do not edit `registry.json` directly.

## Source of Truth

Two CSV files drive the registry:

| File | Purpose |
|------|---------|
| `Common/framework-mappings.csv` | Maps CIS controls to framework columns (NIST, ISO, STIG, PCI, CMMC, HIPAA, CISA SCuBA) |
| `controls/check-id-mapping.csv` | Maps CIS controls to CheckIds, collectors, categories, and automation status |

## Build Process

Run `Build-Registry.ps1` to regenerate `registry.json` from the CSV sources:

```powershell
.\controls\Build-Registry.ps1
```

The script:
1. Reads both CSVs and merges on the `CisControl` key
2. Derives SOC 2 Trust Services Criteria from NIST 800-53 control families (e.g., AC-* maps to CC6, AU-* maps to CC7)
3. Outputs `registry.json` with complete framework mappings per check

## Adding a New Control

1. Add a row to `Common/framework-mappings.csv` with the CIS control number and framework mappings
2. Add a row to `controls/check-id-mapping.csv` with the CheckId, collector, category, and automation status
3. Run `.\controls\Build-Registry.ps1`
4. Commit both CSVs AND the regenerated `registry.json`

## Supplemental Framework Files

```
controls/frameworks/
  cis-m365-v6.json    # CIS profile definitions (E3/E5, L1/L2 groupings)
  soc2-tsc.json       # SOC 2 Trust Services Criteria mappings
```

These files provide additional metadata for frameworks that need license/level profiles or audit evidence mappings beyond what the registry contains.
