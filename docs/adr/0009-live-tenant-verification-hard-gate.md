# 0009 — Live tenant verification is a hard precondition for every release

- **Status:** Accepted
- **Date:** 2026-05-06

## Context

M365-Assess publishes to PSGallery. A bad release reaches every consumer of the module on `Update-Module`. Unlike a SaaS, we can't hot-fix a regression in production — once a version is on the gallery, anyone who installed it is stuck with it until they explicitly upgrade. Yanking a version is technically possible but practically catastrophic for users mid-engagement.

We had a healthy CI pipeline: PSScriptAnalyzer lint, Pester tests at 65% coverage, fixture-based collector tests, schema validation on registry/framework JSON. CI was green. Releases looked safe.

**v2.9.0 broke the assumption that green CI = ready to ship.** Two distinct bugs shipped to PSGallery, both of which destroyed the HTML report:

1. A PowerShell parser-binding bug in `Get-BaselineTrend` that silently dropped the HTML when `-AutoBaseline` was supplied. The `[System.Collections.Generic.Dictionary[string, System.IO.DirectoryInfo]]` type literal was being parsed as an array argument to `New-Object -TypeName`, throwing `Cannot convert Object[] to System.String`. Caught only when running `-AutoBaseline` end-to-end.
2. A `ConvertTo-Json` array-shape mismatch in the `PermissionsPanel` data path. PowerShell's `ConvertTo-Json` unwraps single-element arrays into objects, breaking the React component that expected `[{...}]` and got `{...}`. This manifested as a black screen — the entire React app unmounted on render error, leaving an empty body.

Neither was caught by CI because:

- CI runs against synthetic fixtures, not real Microsoft Graph / EXO / SharePoint responses. The PermissionsPanel bug fired only when the deficit-detection upstream emitted a one-element array, which happened reliably against real tenants and ~never against the test fixtures.
- The `-AutoBaseline` code path was tested in isolation; the orchestrator's `try/catch` around HTML generation swallowed the parser bug and logged at WARN. The assessment "succeeded" — just without the HTML, which the test harness didn't notice.
- Both failures were in code paths that were structurally hard to fixture-test (real tenant data shapes, real downstream-component error boundaries).

The lesson: **CI is necessary but not sufficient for this product.** The class of bugs we care about — runtime React errors, PowerShell parser ambiguity against real type literals, downstream component failures triggered by real data shapes — only fires against a real tenant.

## Decision

Every release, regardless of size, requires an end-to-end live tenant verification by a human before tagging or publishing. No exceptions.

The full process (codified in [`.claude/rules/releases.md`](../../.claude/rules/releases.md)):

1. The version-bump PR is opened.
2. CI runs and must be green.
3. **The user (not the agent) runs `Invoke-M365Assessment -TenantId <tenant>` against a real tenant**, with the parameter set that exercises the new feature. For releases that touch baseline / drift / report code, `-AutoBaseline` is mandatory — that's the path that hides the v2.9.0 class of bugs.
4. The user opens the HTML report in a browser, clicks through changed sections, watches for black/blank screens (= runtime React error).
5. The user inspects the `_Assessment-Log_*.txt` for WARN-level entries (silent failures hide there because the orchestrator catches and logs rather than aborts).
6. The user explicitly confirms the live test passed. "Looks good after running it" / "live test passed" / equivalent.
7. **Only then** does the version-bump PR get merged.
8. **Only then** does `gh release create vX.Y.Z` run, which triggers the PSGallery publish workflow.

The agent does not have credentials for a live tenant. The agent waits.

A "looks good" on the version-bump PR alone does **not** authorize release — only the live-test confirmation does. This distinction is preserved in the rule because users (reasonably) sometimes review code without running it; the agent must not interpret a code-review approval as a tested-in-anger approval.

## Consequences

**Positive**

- Catches the runtime-React-error class of bugs that CI structurally cannot.
- Catches the parser-binding-against-real-types class of bugs that CI structurally cannot.
- Catches silent-failure-with-WARN-log bugs because the human is told to read the log.
- Forces the release process to slow down to "wait for a human" — which has caught dependency upgrades that pass CI but break against real Graph responses.
- The version-bump PR sitting visibly unmerged is a readable status: "we're between code-complete and verified".

**Negative**

- Releases are slow. Bumping a patch version takes an hour minimum (run the assessment, inspect the artifacts, eyeball the log). Several hours if the live test surfaces something that needs a follow-up bug-fix PR.
- Cannot fully automate publish. PSGallery deploys are tag-triggered, but the tag itself is gated on a human signal. We accept this — the alternative is more v2.9.0s.
- The user is doing real work in the verification step, which means they have to *want to release* enough to spend that time. Some patches sit unreleased for weeks because no one wants to do the verification.
- Verification quality is variable — a hurried user may click through fewer sections than a careful one. The checklist mitigates but doesn't eliminate.
- Agent flow is awkward: agent does the work, opens the PR, then has to *wait* for an offline human action. The "agent doesn't have tenant credentials" rule is structural, not preferential — granting credentials would create a new liability surface.

**Failure modes and mitigations**

- *Agent interprets a code-review approval as live-test approval and tags prematurely* → catastrophic (yank from gallery, hot-fix). Mitigation: explicit rule in `releases.md` that "looks good" on the PR alone is approval to **discuss** merging, not to tag. Repeated phrasing makes the boundary clear.
- *User runs the assessment but skips the log inspection* → silent failures (the v2.9.0-A class) slip through. Mitigation: the verification checklist explicitly names "Read the `_Assessment-Log_*.txt` for any WARN-level entries". No further enforcement; relies on user discipline.
- *Live test passes against the user's primary tenant but fails on tenant types we don't test* (gov cloud, complex licensing, lots of CA policies) → mitigation: at-times we ask multiple users to run on different tenants for major releases. Not codified.
- *User reports "live test passed" prematurely (e.g. opened the HTML, didn't notice the section that broke)* → no mitigation. The decision accepts that the human is in the loop and that humans miss things. Acceptable because the previous baseline (no human in the loop) was demonstrably worse.

## Alternatives considered

- **Trust CI fully — let `gh release create` run automatically on version-bump PR merge.** Rejected: this is exactly what shipped v2.9.0. CI structurally can't catch the bug classes we care about.
- **Add CI tests against a real tenant.** Rejected (for now): requires committing tenant credentials to GitHub Actions, which is a security disaster. Even with OIDC federation, the tenant becomes a CI dependency that flakes destroy releases. We've discussed running CI against a low-stakes lab tenant; nothing has shipped yet.
- **Canary release: tag, publish to PSGallery as `-preview`, wait for a real user to install it, then promote.** Considered. The PSGallery preview channel is real and we use it for major changes. But it doesn't eliminate the human-runs-it step, and the preview-vs-stable promotion adds its own gate. Net: the live-test gate is simpler.
- **More fixture coverage to catch the v2.9.0 bug classes.** Tried (we added fixtures specifically modelling the array-shape bug). Helps for the *exact* bug; doesn't generalize. The bug class is "the thing CI can't reach" — adding fixtures expands what CI can reach but doesn't change the structural ceiling.
- **Skip the live test for "trivial" releases (docs, comments, etc).** Rejected for now. The cost of the rule's universality is occasional friction on tiny releases; the cost of carving out exceptions is that "trivial" creep until we ship another v2.9.0.

---

## See also

- [`../../.claude/rules/releases.md`](../../.claude/rules/releases.md) — the codified rule (this ADR explains the *why*; the rule is the *how*)
- [`../../src/M365-Assess/Common/Get-BaselineTrend.ps1`](../../src/M365-Assess/Common/Get-BaselineTrend.ps1) — the v2.9.0-A bug location (line ~71, the `::new()` fix)
- [`../dev/RELEASE-PROCESS.md`](../dev/RELEASE-PROCESS.md) — the user-facing release walkthrough
- [`README.md`](README.md) — back to the ADR index
