# Release process

How M365 Assess versions are bumped, gated, tagged, and shipped.

---

## Semver rules

| Bump | When | Examples |
|---|---|---|
| **MAJOR** | Breaking changes to public API, output schema, or required parameters | Removed cmdlet, renamed parameter, restructured `window.REPORT_DATA` |
| **MINOR** | New collectors, new checks, new framework support, new public cmdlets | Added Defender vulnerability scanning, new `-EvidencePackage` switch |
| **PATCH** | Bug fixes, documentation, cosmetic report changes, dependency updates | Fixed denominator math, updated bundled SKU list, README typo |

When in doubt, bump conservatively (lean toward MINOR over PATCH).

---

## The 4 version locations

Bump every one in a single PR. CI's version-consistency gate fails if they drift.

| # | File | Field | Pattern |
|---|------|-------|---------|
| 1 | `src/M365-Assess/M365-Assess.psd1` (~line 6) | `ModuleVersion` | `ModuleVersion = '2.9.0'` |
| 2 | `src/M365-Assess/M365-Assess.psd1` (~line 184) | `ReleaseNotes` | `ReleaseNotes = 'v2.9.0 - ...'` |
| 3 | `README.md` (~line 19) | Version badge | `version-2.9.0-blue` |
| 4 | `CHANGELOG.md` | New version header | `## [2.9.0] - YYYY-MM-DD` |

The `.psd1` `ModuleVersion` is the **single source of truth at runtime**. The HTML report banner, footer, and console output all read it dynamically via `Import-PowerShellDataFile`.

The other three locations are documentation/discovery surfaces that need to match. CI verifies the README badge matches the manifest version on every PR (`Quality Gates -> Version consistency` and on doc-only PRs `Docs Gates -> Version consistency`).

---

## CHANGELOG format

Follow [Keep a Changelog](https://keepachangelog.com/) conventions:

```markdown
## [2.9.0] - 2026-MM-DD

### Added
- Read-only CI guardrail (#771)
- Generated permissions matrix (#778)
- ...

### Changed
- Pass% denominator now strict-rule per CHECK-STATUS-MODEL.md (#802)
- ...

### Fixed
- ...

### Removed
- 13 deprecated `Get-M365*SecurityConfig` wrappers (warn in v2.9.x, full removal v3.0.0)
```

Reference each PR by number; group changes under the four headers (Added / Changed / Fixed / Removed). Skip empty headers.

---

## Step-by-step release

After all milestone PRs have merged to `main`:

### 1. Pre-flight check

```powershell
# Confirm main is green and matches origin
git checkout main && git pull --ff-only

# All milestone issues closed
gh api repos/Galvnyz/M365-Assess/milestones/<num> --jq '{open_issues, closed_issues}'

# CHANGELOG has a [Unreleased] section to promote (or you'll write one)
grep -n '^## \[Unreleased\]' CHANGELOG.md
```

### 2. Bump version (single PR)

```powershell
git checkout -b chore/release-vX.Y.Z

# Edit the 4 locations listed above:
#   src/M365-Assess/M365-Assess.psd1: ModuleVersion + ReleaseNotes
#   README.md: version badge
#   CHANGELOG.md: rename [Unreleased] -> [X.Y.Z] - YYYY-MM-DD, add new [Unreleased] block above

git add -A
git commit -m "chore(release): bump to vX.Y.Z"
git push -u origin chore/release-vX.Y.Z
gh pr create --title "chore(release): bump to vX.Y.Z" --label chore
```

CI must pass — version-consistency gate confirms all 4 locations match.

### 3. Merge to main

Squash-merge. The PR title becomes the commit message; the version-bump commit on main is the canonical "this is vX.Y.Z" reference.

### 4. Tag + GitHub release (after merge)

```powershell
# Create the annotated tag from the merge commit
git checkout main && git pull --ff-only
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z

# Create the GitHub release pulling notes from CHANGELOG
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file - <<EOF
$(awk '/^## \[X.Y.Z\]/,/^## \[/' CHANGELOG.md | sed '$d')
EOF
```

Or manually paste the CHANGELOG section into `gh release create`'s editor.

### 5. Close the milestone

```powershell
gh api -X PATCH repos/Galvnyz/M365-Assess/milestones/<num> -f state=closed
```

### 6. Regenerate doc-as-code artifacts (when source changed)

If the release added or removed Graph permissions / collectors / scope mappings:

```powershell
pwsh -NoProfile -File ./scripts/Build-PermissionsMatrix.ps1
git add docs/PERMISSIONS.md
git commit -m "docs: regenerate PERMISSIONS.md for vX.Y.Z"
```

If npm dependencies changed (rare):

```powershell
npm install
# Regenerate THIRD-PARTY-LICENSES.md per docs/REPORT-FRONTEND.md (post-C4)
```

These are separate small PRs that follow the version-bump merge.

### 7. PSGallery publish (separate workflow)

Publishing to PSGallery is currently manual; the maintainer pushes via `Publish-Module` after tag creation. Future improvement: GH Actions workflow on tag push.

---

## Release candidates (#722)

For changes you want to soak before tagging stable:

```bash
# Cut an RC branch from main
git checkout main && git pull --ff-only
git checkout -b release-candidate
git push -u origin release-candidate
```

Pushing to `release-candidate` triggers `.github/workflows/release-candidate.yml`, which:

1. Reads the manifest version (e.g. `2.9.0`)
2. Counts existing `v2.9.0-rc.*` tags
3. Creates the next RC tag (e.g. `v2.9.0-rc.1`)
4. Pushes the tag

Pushing the tag triggers `.github/workflows/release.yml`, which:

- Marks the GitHub release as `prerelease: true` (because the tag contains `-`)
- **Skips PSGallery publish** (release.yml gates `!contains(github.ref, '-')`)

So RCs land as **GitHub-only pre-releases**, safely visible to early testers without touching PSGallery.

### Iterating on an RC

Subsequent pushes to `release-candidate` produce `v2.9.0-rc.2`, `rc.3`, etc. The workflow auto-increments by listing existing tags, so you don't have to track the counter.

### Promoting an RC to stable

Once an RC has soaked enough:

1. Open a PR from `release-candidate` -> `main`
2. Merge as usual
3. Follow the standard release flow above (version bump if needed, tag, GH release, PSGallery publish)

The stable tag (`v2.9.0`) and the RC tags (`v2.9.0-rc.1`, etc.) coexist; they all show in `git tag --list`.

### Dry-run

Use the `workflow_dispatch` trigger with `dry_run: true` to compute what RC number would be assigned without actually creating the tag. Useful when you're unsure whether a previous run already produced an RC.

---

## Branch protection

`main` requires:

- The `CI` job to pass (aggregates Quality Gates + Pester matrix + CodeQL)
- At least one PR (no direct pushes)

Doc-only PRs route to a lighter `Docs Gates` job (~30 seconds) instead of the full Pester matrix (~4 minutes), so quick text fixes don't block the maintainer queue.

---

## Hotfix procedure

For urgent post-release fixes (e.g., a regression discovered after vX.Y.Z is tagged):

1. Branch from the tag: `git checkout -b hotfix/X.Y.Z+1 vX.Y.Z`
2. Make the minimal fix; commit; push
3. Open a PR targeting `main`. Same CI gates apply.
4. Once merged, bump to `X.Y.Z+1` (PATCH) and follow steps 4-6 above.

Hotfixes never skip the version-consistency gate — every release tag has a matching CHANGELOG entry and badge update.

---

## Pre-release / RC channel (planned, #722)

`#722` tracks adding a release-candidate workflow:

- New `release-candidate` branch with branch protection
- Automatic GH pre-release tag (`vX.Y.Z-rc.1`) on push
- Soak window before promoting to a full tag

Out of scope for v2.9.0 closure but tracked for v2.10.0 or v3.0.0.

---

## When to regenerate generated docs

Generated docs are part of the source code surface. Bump the regenerator output anytime the source map changes. CI catches drift on every PR.

| Generated doc | Regen command | Source-of-truth |
|---|---|---|
| `docs/PERMISSIONS.md` | `pwsh -File ./scripts/Build-PermissionsMatrix.ps1` | `Orchestrator/AssessmentMaps.ps1` + `Setup/PermissionDefinitions.ps1` |
| `docs/SOVEREIGN-CLOUDS.md` (post-C2) | (TBD) | `controls/sovereign-cloud-support.json` |
| `THIRD-PARTY-LICENSES.md` (post-C4) | `npm run licenses` (or equivalent) | `node_modules/` license-checker output |

CI's `-Check` mode for each generator fails the PR if the doc is out of sync. Action is always: run the generator locally, commit the updated doc, push.

---

## Related

- [`TESTING.md`](TESTING.md) — local + CI testing guide
- [`PERMISSIONS.md`](../reference/PERMISSIONS.md) — generated; covered above
- `.claude/rules/releases.md` — internal release rules for AI-assisted contributors
- `.claude/rules/versions.md` — version-bump checklist (mirrors §"The 4 version locations" above)
