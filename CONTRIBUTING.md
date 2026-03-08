# Contributing to M365 Assess

Thanks for your interest in contributing! This project often benefits from community feedback and contributions.

## How to Contribute

### Reporting Issues

- Use [GitHub Issues](https://github.com/Daren9m/M365-Assess/issues) to report bugs or request features
- Include the PowerShell version (`$PSVersionTable.PSVersion`), OS, and relevant module versions
- Paste error messages and steps to reproduce

### Submitting Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-improvement`)
3. Make your changes following the coding standards below
4. Run PSScriptAnalyzer on any modified `.ps1` files
5. Submit a pull request with a clear description of the changes

### Coding Standards

- **`[CmdletBinding()]`** and comment-based help (`.SYNOPSIS`, `.DESCRIPTION`, `.PARAMETER`, `.EXAMPLE`, `.NOTES`) on every script
- **`Verb-Noun.ps1`** file naming with approved PowerShell verbs
- **PascalCase** for parameters, **camelCase** for local variables
- No aliases, no backtick line continuations, no `$global:`, no `Invoke-Expression`
- `Write-Host` for console status messages; `Write-Output` for pipeline data
- `try/catch` around API calls and service connections
- All operations must be **read-only** (`Get-*` cmdlets only) — this tool does not modify tenant configuration

### Adding a New Collector

1. Place your script in the appropriate domain folder (e.g., `Entra/`, `Security/`)
2. Follow the existing pattern: accept `-OutputPath`, return objects to the pipeline
3. Register the collector in `Invoke-M365Assessment.ps1` under the appropriate section

### Custom Branding

To use your own branding in the HTML report, replace the images in `Common/assets/`:

| File | Purpose | Recommended Size |
|------|---------|-----------------|
| `m365-assess-logo.png` | Report cover page logo | 400 x 120 px |
| `m365-assess-logo-white.png` | Light-on-dark variant | 400 x 120 px |
| `m365-assess-bg.png` | Cover page background | 1200 x 800 px |

## Testing

Live tenant testing is the primary validation method. Run collectors against a real or test tenant and verify CSV output and HTML report accuracy. Use `PSScriptAnalyzer` for static analysis:

```powershell
Invoke-ScriptAnalyzer -Path .\Entra\Get-MfaReport.ps1
```

## Code of Conduct

Be respectful and constructive. We're all here to make M365 security assessment easier for everyone.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
