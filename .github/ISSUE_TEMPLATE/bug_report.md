---
name: Bug Report
about: Report a bug or unexpected behavior
title: "fix: "
labels: bug
---

## Description

A clear description of the bug.

## Steps to Reproduce

1. Run `.\Invoke-M365Assessment.ps1 ...`
2. ...
3. ...

## Expected Behavior

What you expected to happen.

## Actual Behavior

What actually happened. Include error messages if any.

## Environment

- **OS**: (e.g., Windows 11 24H2, macOS 15.3, Ubuntu 24.04)
- **PowerShell**: (run `$PSVersionTable.PSVersion`)
- **Microsoft.Graph**: (run `Get-Module Microsoft.Graph -ListAvailable | Select-Object Version`)
- **ExchangeOnlineManagement**: (run `Get-Module ExchangeOnlineManagement -ListAvailable | Select-Object Version`)
- **M365 Assess version**: (shown in console banner or report footer)

## Assessment Log

<details>
<summary>Relevant log excerpt</summary>

```
Paste relevant lines from _Assessment-Log.txt here
```

</details>

## Additional Context

Any other context, screenshots, or config details.
