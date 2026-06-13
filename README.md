# M365 Assess

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="src/M365-Assess/assets/m365-assess-logo-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="src/M365-Assess/assets/m365-assess-logo-light.png" />
  <img src="src/M365-Assess/assets/m365-assess-logo-light.png" alt="M365 Assess" width="500" />
</picture>

### Comprehensive M365 Security Assessment Tool

**Read-only Microsoft 365 security assessment for IT consultants and administrators**

[![CI](https://github.com/Galvnyz/M365-Assess/actions/workflows/ci.yml/badge.svg)](https://github.com/Galvnyz/M365-Assess/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/badge/coverage-check%20CI-informational)](https://github.com/Galvnyz/M365-Assess/actions/workflows/ci.yml)
[![PowerShell 7.x](https://img.shields.io/badge/PowerShell-7.x-blue?logo=powershell&logoColor=white)](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows)
[![Read-Only](https://img.shields.io/badge/Operations-Read--Only-brightgreen)](.)
[![Version](https://img.shields.io/badge/version-2.12.0-blue)](.)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## What is this?

M365 Assess runs a single read-only command against a Microsoft 365 tenant and produces CSV data, a self-contained branded HTML report, and an XLSX compliance matrix covering identity, email, security, devices, collaboration, and compliance baselines.

<!-- registry-stats:summary:begin -->
**292 automated security checks** mapped across **15 compliance frameworks** — counts generated from [`controls/registry.json`](src/M365-Assess/controls/registry.json); per-framework coverage in [docs/reference/COVERAGE.md](docs/reference/COVERAGE.md).
<!-- registry-stats:summary:end -->

It is built for security administrators, compliance officers, IT consultants / vCISOs, auditors, and CI pipelines - anyone who needs a fast, evidence-backed posture snapshot mapped to CIS, NIST, SOC 2, HIPAA, ISO 27001, and more.

## Install

```powershell
Install-Module M365-Assess -Scope CurrentUser
```

Graph and EXO dependencies are declared in the manifest and installed automatically. For install from source, the ZIP-unblock step, and full prerequisites, see the [Quickstart guide](docs/user/QUICKSTART.md).

## Run it

```powershell
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com'
```

Results land in a timestamped folder with CSV data, an HTML report, and an XLSX compliance matrix. Run with no parameters to launch an interactive wizard that walks you through section selection, tenant, authentication, and output folder.

<div align="center">
<img src="docs/images/console-progress.png" alt="M365 Assess console showing real-time security check progress" width="700" />
</div>

For section selection, the full parameter reference, connection profiles, cloud environments, and standalone collector usage, see the [Execution guide](docs/user/RUN.md). Running against GCC High? See the [GCC High setup guide](docs/user/GCC-HIGH-SETUP.md).

## Sections

Thirteen assessment sections cover Tenant, Identity, Licensing, Email, Intune, Security, Collaboration, Hybrid, and PowerBI by default, plus opt-in Inventory, ActiveDirectory, SOC2, and ValueOpportunity. The full collector catalogue and per-section detail live in the [Execution guide](docs/user/RUN.md#available-sections).

```powershell
# Run specific sections
Invoke-M365Assessment -Section Identity,Email -TenantId 'contoso.onmicrosoft.com'
```

## Report preview

The self-contained HTML report opens in any browser with no dependencies. Click through from the executive overview to individual security domains, drill into findings, and review compliance posture across 15 frameworks - all in a single offline file.

<div align="center">

<img src="docs/images/cover-page.png" alt="Executive overview - Microsoft Secure Score, critical/fail/warning summary cards, MFA distribution, and domain posture breakdown" width="700" />

<br /><br />

<img src="docs/images/compliance-overview.png" alt="Framework coverage view showing CMMC controls mapped to automated findings with severity and check ID columns" width="700" />

</div>

> See [docs/sample-report/_Example-Report.html](docs/sample-report/_Example-Report.html) for a full PII-scrubbed example report, and the [Report user guide](docs/user/REPORT-USER-GUIDE.md) for the interactive walkthrough.

> **Handling sensitive output:** assessment files contain UPNs, mailbox metadata, admin role assignments, and policy bodies - treat them as confidential. See [`docs/reference/DATA-HANDLING.md`](docs/reference/DATA-HANDLING.md).

## Recent releases

See the [Changelog](CHANGELOG.md) for the full release history and version notes.

## Documentation

| Guide | Description |
|-------|-------------|
| [Quickstart](docs/user/QUICKSTART.md) | Step-by-step setup on a fresh Windows machine (PowerShell 7, install paths, prerequisites) |
| [Execution guide](docs/user/RUN.md) | Sections, full parameter reference, connection profiles, environments, standalone scripts |
| [Authentication](docs/user/AUTHENTICATION.md) | Interactive, certificate, device code, managed identity, and pre-existing connection methods |
| [GCC High setup](docs/user/GCC-HIGH-SETUP.md) | Sovereign-cloud setup: app reg, consent, Power BI, known gaps |
| [Permissions](docs/reference/PERMISSIONS.md) | Generated per-section matrix: delegated Graph scopes, app permissions, EXO RBAC groups, Purview directory roles |
| [HTML Report](docs/user/REPORT-USER-GUIDE.md) | Report features, interactive walkthrough, standalone generation, white-label |
| [Compliance](docs/user/COMPLIANCE.md) | 15 frameworks, XLSX export, CheckId system, control registry |
| [Compatibility](docs/reference/COMPATIBILITY.md) | Module versions, dependency matrix, known incompatibilities |
| [Troubleshooting](docs/user/TROUBLESHOOTING.md) | Common errors, module conflicts, permission issues |
| [Changelog](CHANGELOG.md) | Release history and version notes |
| [Security](SECURITY.md) | Vulnerability reporting and security policy |

The [docs index](docs/INDEX.md) is the canonical wayfinding entry for all guides.

## Getting help

```powershell
Import-Module ./src/M365-Assess
Get-Help Invoke-M365Assessment -Full
```

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

<div align="center">
<sub>Built by <a href="https://github.com/Daren9m">Daren9m</a> and contributors &nbsp;·&nbsp; Developed with <a href="https://claude.ai/code">Claude Code</a> (Anthropic)</sub>
</div>
