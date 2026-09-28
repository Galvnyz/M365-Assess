# Resolution update after v2.13.0

Updated 28 September 2026 (UTC), through main commit `ce23222`.
This supplements the original review rather than rewriting historical evidence.

## Delivered

| Review area | Outcome | Evidence |
|---|---|---|
| Scoring and Conditional Access | Corrected unverified readiness, misleading framework verdicts, and Security Defaults gap analysis. | [#1019](https://github.com/Galvnyz/M365-Assess/pull/1019) |
| Unified audit ingestion | Capture authoritative Exchange evidence before the Purview transition; preserve unavailable evidence. Issue #1015 closed. | [#1021](https://github.com/Galvnyz/M365-Assess/pull/1021) |
| Collection integrity | Shared pagination/retry, partial-collection reporting, diagnostics, corrected queries and permissions. Batching remains separate work. | [#1019](https://github.com/Galvnyz/M365-Assess/pull/1019), [#1022](https://github.com/Galvnyz/M365-Assess/pull/1022) |
| Frontend and decisions | Modular report source, executable JS tests, structural JSON handling, schemas, and persistent decisions. Issues #959, #953, and #1008 closed. | [#1019](https://github.com/Galvnyz/M365-Assess/pull/1019), [workflow](../../user/ASSESSOR-DECISIONS.md) |
| CI and distribution | Corrected schedule/path gates; released 2.13.0 to GitHub and PSGallery; added hosted-runner repository bootstrap. | [#1023](https://github.com/Galvnyz/M365-Assess/pull/1023), [#1024](https://github.com/Galvnyz/M365-Assess/pull/1024), [release](https://github.com/Galvnyz/M365-Assess/releases/tag/v2.13.0) |

Validation included CI, a live assessment with all collectors reporting Complete,
and maintainer HTML/XLSX review. This does not claim every tenant, authentication
mode, or cloud combination was independently retested. Unavailable/manual-review
findings remain distinct from collector completion.

Accepted risks and attestations preserve observed status and pass rates. They
affect actionable work; they do not turn observations into automated passes. Use
the shipped schemas and workflow docs, not earlier proposed sidecar examples.

## Remaining work

- [#952](https://github.com/Galvnyz/M365-Assess/issues/952): batch/bulk resolution and scale acceptance criteria.
- [#875](https://github.com/Galvnyz/M365-Assess/issues/875): candidate-control catalogue, coverage estimates, and attestation scope research.
- [#960](https://github.com/Galvnyz/M365-Assess/issues/960): OSCAL research/export and remaining schema-evolution criteria.
- Portal integration, authority/coverage freshness, and other proposals require
  current review. The portal branch has advanced beyond the inspected hashes;
  historical findings are not a review of its latest head.

GitHub issues are the active work queue. Microsoft timelines and competitor
comparisons in the original review must be refreshed before use as current claims.

## Historical evidence

The six synthetic reproductions were rerun during documentation review and matched
the recorded results at the pinned old commit. They intentionally reproduce old
defects; current regression tests live under `tests/`. The superseded July planning
package is not part of the maintained documentation set.

## See also

- [Original review](README.md)
- [Original backlog triage](backlog-triage.md)
- [Documentation index](../../INDEX.md)
