# Module loader architecture (B4)

**Decision:** Keep the current explicit-named loader. Do not restructure into `Public/Private` folders.

**Status:** Decided. 2026-04-25 (Issue #775, milestone v2.9.0 — Trust Hardening).

---

## Background

The 2026-04-25 external repo review claimed the module loader "dot-sources broad script sets" and recommended a `Public/`, `Private/`, manifest-controlled-list layout. Issue #775 was filed to evaluate that recommendation.

Verification before triage found the claim was inaccurate. The current loader at `src/M365-Assess/M365-Assess.psm1` is already explicit:

- 17 named `. "$PSScriptRoot\<folder>\<name>.ps1"` dot-sources
- One controlled `Get-ChildItem -Path "$PSScriptRoot\Orchestrator\*.ps1"` sweep over a single folder (the orchestrator's helper modules)
- 13 inline collector wrapper functions defined directly in the `.psm1`
- An explicit `Export-ModuleMember -Function @(...)` list naming 20 public cmdlets

There is no recursive wildcard sweep. There are no implicit module loads.

## Why we keep the current layout

### 1. The reviewer's premise was inaccurate

The reviewer's stated benefits — "function name collisions," "accidental public/private leakage," "load-time side effects," "slower imports," "difficult test isolation" — apply to layouts that use recursive `Get-ChildItem -Recurse | Foreach { . $_ }` patterns. This module does not. The risks the reviewer described are already mitigated by the explicit-named approach.

### 2. The proposed restructure is high-cost / low-benefit for this codebase

A `Public/Private` split would:

- Move ~80 `.ps1` files into new folder paths
- Update every relative path reference in the loader, tests, and documentation
- Require a corresponding update to the manifest's `FileList`
- Break any external consumer that imports collector scripts by direct path (consultants who dot-source individual collectors outside `Invoke-M365Assessment`)

The benefit is purely organizational — there is no functional gain. The convention is associated with PowerShell modules that have unstable internal/external boundaries, which this module does not.

### 3. The actual public surface is already enforced

`FunctionsToExport` in `M365-Assess.psd1` is the source of truth for the public API. Any function not in that list is internal regardless of where its file lives. Pester smoke tests validate that `FunctionsToExport` matches `Export-ModuleMember`. Folder structure is not a substitute for an export list.

## What we would reconsider

This decision is reversible. We would revisit if any of the following becomes true:

- Test isolation problems trace back to the loader sweep
- A new collector pattern emerges that needs first-class internal/external separation (e.g., per-collector classes)
- The module surface grows large enough that contributors get confused about what's public vs. internal — at which point a `Public/Private` split becomes a documentation aid

Until then, the existing layout is appropriate.

## Related

- Issue #775 (closed by this doc)
- External review at `M365-Assessment/reviews/2026-04-25_repo-review.md`, §5
- Verification record in `~/.claude/projects/C--git-M365-Assess/memory/project_v29_trust_hardening.md`
