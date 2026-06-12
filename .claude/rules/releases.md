---
description: Version bump and release workflow rules
globs: ["*.ps1", "*.psd1", "README.md", "CHANGELOG.md"]
---

# Version Bump and Release Rules

## Version Increments Require Explicit Permission

**NEVER bump the assessment version without asking the user first.** Even if the work clearly warrants a version bump, always ask:

> "This work warrants a version bump to X.Y.Z. Should I increment the version?"

Wait for explicit approval before touching any version location listed in `.claude/rules/versions.md`.

## Every Version Bump Gets a GitHub Release

When the user approves a version bump, follow this sequence:

1. **Update all version locations** listed in `.claude/rules/versions.md` (all 4 locations in a single pass)
2. **Update CHANGELOG.md** with a new section for the version, documenting all changes since the last release
3. **Commit** the version bump and changelog update; open a PR
4. **WAIT for live tenant verification** (see next section) — do not merge yet
5. **After the user reports the live test passed**, merge the version-bump PR
6. **Then** create the GitHub release tag:
   ```bash
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-file - <<< "$(changelog excerpt)"
   ```
7. The tag triggers `release.yml`, which runs validate + create-release + PSGallery publish

## Live Tenant Verification Is a Hard Precondition

**Before tagging, releasing, or publishing — a human MUST run an end-to-end live tenant assessment and physically validate the output. No exceptions, regardless of release size.**

CI green is necessary but not sufficient. CI runs against synthetic fixtures; real Microsoft Graph / EXO / SharePoint behavior is a separate verification surface. v2.9.0 shipped to PSGallery with two distinct bugs that broke HTML report generation — neither caught by CI, both caught immediately by the first live tenant test:

1. A PowerShell parser-binding bug in `Get-BaselineTrend` that silently dropped the HTML when `-AutoBaseline` was supplied
2. A `ConvertTo-Json` array-shape mismatch in `PermissionsPanel` that threw at render time and unmounted the entire React app, leaving a black screen

Both shipped because no human ran the assessment against a real tenant before tagging.

### The verification checklist

The user runs each step. The agent does NOT have credentials for a live tenant — the agent waits.

1. **Run** `Invoke-M365Assessment -TenantId <tenant>` with the parameter set that exercises the new feature(s) being released. For releases with baseline / drift / report changes, **always include `-AutoBaseline`** — that path historically hides bugs that fixture tests miss
2. **Open the HTML report** in a browser. Click through the sections that changed. Confirm new components render and old ones still work. **A black or blank screen is a runtime React error** — open dev tools console to see the stack
3. **Validate the XLSX** if matrix changes shipped: open it, look at the new sheets, confirm framework-mapping columns still display and counts make sense
4. **Inspect the assessment folder** for unexpected absence of files. The v2.9.0 baseline bug manifested as "no HTML, only CSVs" — only visible by listing the folder
5. **Read the `_Assessment-Log_*.txt`** for any WARN-level entries that indicate something silently failed. The orchestrator catches and logs rather than aborts; silent failures hide in the log

### When the live test fails

File a bug-fix PR, push to the version-bump branch, restart the verification cycle. The version-bump PR does not merge until live verification passes.

### What counts as approval

Only an explicit "live test passed" / "looks good after running it" / equivalent message from the user authorizes the merge + tag step. A "looks good" on the version-bump PR alone is approval to **discuss merging**, not to tag and publish — the agent must still wait for the live-test confirmation.

If the user has not yet run the live test, the agent does not tag or publish, even if every other gate is green.

## Changelog Format

Follow [Keep a Changelog](https://keepachangelog.com/) conventions:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
### Changed
### Fixed
### Removed
```

## Semver Rules

- **MAJOR** (1.0.0): Breaking changes to output format, removed collectors, or changed parameters
- **MINOR** (0.X.0): New collectors, new checks, new report sections, new parameters
- **PATCH** (0.0.X): Bug fixes, documentation, cosmetic report changes, dependency updates
