# Evidence Package

## What this is

A self-contained ZIP that bundles a complete M365-Assess assessment in a form suitable for handoff to an auditor, MSP partner, or third-party reviewer. Optional `-Redact` flag scrubs PII (UPNs, IPs, GUIDs, tenant display name) deterministically -- the same UPN always becomes the same hash token across the package, so cross-finding correlation still works without exposing identities.

The package is a **post-processing artifact**, not a separate run. It reads the HTML report and XLSX matrix that `Invoke-M365Assessment` already wrote to disk and bundles them with structured findings, run metadata, and a SHA-256 manifest.

---

## Generating a package

```powershell
# Plain (no redaction) -- contents identical to the assessment folder
Invoke-M365Assessment -TenantId contoso.onmicrosoft.com -EvidencePackage

# Redacted -- safe to send to a third party
Invoke-M365Assessment -TenantId contoso.onmicrosoft.com -EvidencePackage -Redact
```

The package is written next to the assessment folder as `<TenantName>_EvidencePackage_<UTCStamp>.zip`.

---

## Layout

```
<package>.zip
├── README.md                  # Auditor-facing top-level guide
├── manifest.json              # SHA-256 hash + byte count per file
├── executive-report.html      # Full M365-Assess HTML report (NOT redacted; bundle as-is)
├── compliance-matrix.xlsx     # Framework crosswalk + Evidence Details sheet (NOT redacted)
├── findings.json              # Aggregated findings with structured evidence schema
├── permissions-summary.json   # Per-section app-role / scope deficits (B2)
├── run-metadata.json          # Run identifier, version, redaction state
└── known-limitations.md       # Generic caveats (finding-specific limitations live in findings.json)
```

`manifest.json` is intentionally **not** a self-entry -- it's the verification source for everything else. An auditor recomputes hashes locally and compares.

---

## Verifying the manifest

```powershell
$manifest = Get-Content manifest.json -Raw | ConvertFrom-Json
foreach ($entry in $manifest.files) {
    $actual = (Get-FileHash -Path $entry.path -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $entry.sha256) {
        Write-Error "Hash mismatch on $($entry.path)"
    }
}
```

If any file has been modified post-extraction, the comparison fails. The manifest also records each file's size in bytes so truncation is detectable separately from content tampering.

---

## Redaction model (when `-Redact` is set)

| Category | Pattern | Replaced with |
|---|---|---|
| UPNs / email addresses | `[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}` | `<user-{8-hex}>` |
| IPv4 addresses | Standard 4-octet form | `<ip-{8-hex}>` |
| IPv6 addresses | Full and `::`-compact forms | `<ip-{8-hex}>` |
| GUIDs | `8-4-4-4-12` format | `<guid-{8-hex}>` |
| Tenant display name | Literal match (case-insensitive) | `<tenant>` |

Hash tokens are deterministic: `SHA-256(value).ToLowerInvariant()` truncated to 8 hex characters. The same plaintext always produces the same token within a package, which preserves join keys for cross-finding correlation:

> "user-a3f81b29 fails MFA on CA-001, *and* has admin role on ROLE-001."

The auditor can reason about the user's posture without knowing the underlying UPN.

### What is NOT redacted

- **executive-report.html** -- bundled as-is. The HTML is a Microsoft-rendered assessment artifact. To produce a redacted HTML, run the assessment in a context that produces redacted findings *upstream* (out of scope for v2.9).
- **compliance-matrix.xlsx** -- bundled as-is for the same reason.
- **CheckId values** -- these are public registry identifiers, not tenant-specific.
- **Setting names, framework controlIds, remediation guidance** -- all from the public control registry.

In short: redaction targets *tenant-derived strings*, not *registry-derived strings*.

### Redaction-order subtlety

Email/UPN redaction runs **before** tenant-name redaction. If the order were reversed, a tenant name appearing in an email's domain (`admin@contoso.com` with tenant name `Contoso`) would be partially redacted to `admin@<tenant>.com`, which the email regex can no longer detect. By replacing the whole address first with a hash token, the tenant pass only sees bare mentions in narrative text. See `tests/Common/Get-RedactionRules.Tests.ps1` for the regression coverage of this case.

---

## What the auditor gets

- **executive-report.html** -- visual review (themed, interactive React app)
- **compliance-matrix.xlsx** -- per-framework view; "Evidence Details" sheet shows the structured evidence schema (D1 #785) per finding
- **findings.json** -- programmatic ingest. Schema: `[ { CheckId, Setting, Status, Category, ObservedValue, ExpectedValue, EvidenceSource, EvidenceTimestamp, CollectionMethod, PermissionRequired, Confidence, Limitations, ... } ]`
- **permissions-summary.json** -- coverage of required vs granted permissions per section (best-effort; populated by `Test-GraphAppRolePermissions` when run with sufficient scopes)
- **run-metadata.json** -- traceability: who ran what when, which registry version, whether redaction was applied
- **known-limitations.md** -- generic preface; finding-specific caveats override it

---

## See also

- [`EVIDENCE-MODEL.md`](../dev/EVIDENCE-MODEL.md) -- the structured evidence schema that drives `findings.json`
- [`REPORT-SCHEMA.md`](../dev/REPORT-INTERNALS.md) -- shape of the HTML report's `window.REPORT_DATA` (analogous to `findings.json` but JS-side)
- [`PERMISSIONS.md`](../reference/PERMISSIONS.md) -- minimum scopes per section (referenced from the package's permissions-summary.json)
