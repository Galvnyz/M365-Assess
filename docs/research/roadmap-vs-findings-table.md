# Roadmap section vs. richer findings table

Decision artifact for issue #899. Filed after PR #896 (#863 Phase 2) added the Sequence concept to the finding state strip, and PR #898's planned Sequence column + filter would close the gap between "what the Roadmap section uniquely shows" and "what the findings table can already show after filter+sort."

## Context

The HTML report has historically had two surfaces for the same workflow data:

| Surface | Lives at | What it shows |
|---|---|---|
| **Roadmap section** | Top-of-report panel | Now / Next / Later lane buckets with task cards; drag to reassign |
| **Findings table** | Findings section | Per-finding rows; status / severity / sequence / etc. in detail panel |

Both pull from the same underlying data (`f.lane`, computed by `Get-RemediationLane.ps1` per #715). The Roadmap renders findings as cards in lanes; the table renders them as rows.

PR #896 (#863 Phase 2) surfaced the lane in the per-finding state strip. PR #898 (Sequence column + filter) makes the table self-sufficient for "show me my Now lane."

That raises the question: **does the Roadmap section still earn its real estate?**

## Inventory — what does Roadmap uniquely provide?

Audited against the post-#898 findings table:

| Capability | Roadmap | Findings table (post-#898) | Verdict |
|---|---|---|---|
| Show findings grouped by lane | ✓ 3-column visual layout | ✓ via Sequence filter chips → 1 lane at a time | Both can. Roadmap shows all 3 simultaneously; table shows 1 at a time. |
| Reassign a finding to a different lane | ✓ drag/click menu | ✗ not yet — Phase 5 of #863 may add | **Unique to Roadmap (today).** Could move into the table as an edit-mode action on the Sequence column. |
| Visual urgency cues (red Now / amber Next / blue Later) | ✓ lane-coloured cards | ✓ Sequence pills colour-coded the same way | Both can. |
| At-a-glance lane size proportions | ✓ side-by-side columns | ✗ table is a flat list; user has to filter by each lane to see counts | **Unique to Roadmap.** A small "X Now / Y Next / Z Later" summary banner above the table would close this gap. |
| Customer-facing presentation | ✓ designed for report-handoff visual hierarchy | △ table is more dense; less polished for executive review | **Roadmap wins for presentation; table wins for working surface.** |
| Roadmap CSV export | ✓ dedicated export | ✗ findings export exists but is not lane-organised | **Unique to Roadmap.** Could move into the table's existing export with a Sequence column included. |
| Per-card priority reasoning ("Critical severity — fix immediately") | ✓ tooltip / detail | ✗ partially in detail panel but not lane-prioritised | **Unique to Roadmap.** |

## Decision

**Recommendation: Hybrid (option D from the original issue).**

1. **Keep the Roadmap section as a presentation-mode view** — its visual lane-bucket layout and customer-handoff polish are real value the table can't replicate without becoming a different component.
2. **Migrate the Roadmap's interactive capabilities into the table over time** — drag-to-reassign, lane CSV export, per-card priority reasoning — so the Roadmap's "interactive" use case is fully covered by the table by the end of Phase 5 of #863.
3. **Roadmap becomes view-only at v3.0** — the section continues to render as a customer-facing summary but isn't editable in the report. All edits happen in the table; Roadmap re-derives from the table state on every render.

The hybrid sidesteps the trade-off:
- "Keep both" preserves duplication and the design tension that surfaced this issue
- "Merge" loses the lane-bucket visual that's genuinely useful for executive review
- "Restyle" (Roadmap as a saved view of the table) is appealing but the visual format Roadmap uses is more than a filter — it's a different layout altogether

## Phased migration plan (rough)

The hybrid path in concrete steps. Each step ships independently and degrades gracefully.

**Phase A (this milestone, post-#898):** Add a "X Now / Y Next / Z Later" summary banner above the findings table. Closes the at-a-glance lane-size gap. Doesn't touch the Roadmap section. Small.

**Phase B (next minor):** Move drag-to-reassign into the findings table as an edit-mode action on the Sequence pill. The Roadmap still has its own drag handler in parallel (no breakage). Small-medium.

**Phase C (later minor):** Roadmap CSV export becomes "findings table CSV with Sequence + priority-reason columns." Roadmap's standalone export deprecates. Small.

**Phase D (v3.0 candidate):** Roadmap becomes view-only — the drag handler retires; editing happens only in the findings table. Roadmap re-derives from the same `REPORT_OVERRIDES.roadmapOverrides` state, but doesn't write to it directly. Medium.

Each phase is independently shippable; no big-bang rewrite required.

## Out of scope

- Replacing the Roadmap section entirely with a table view — the lane-bucket visual is good UX for what it is.
- Building a "saved view" abstraction in the table — out of scope for this decision; the Roadmap is the only obvious "saved view" use case and it doesn't justify the abstraction yet.
- Customer-facing customization of Roadmap (e.g., user-renamed lanes) — out of scope; the Now/Next/Later semantic is canonical.

## Sources

- Issue #899 (this spike resolves)
- Issue #863 (finding-detail redesign — Phase 5 will probably absorb Phase B above)
- Issue #898 (Sequence column + filter — prerequisite for the table being self-sufficient on lane filtering)
- `Get-RemediationLane.ps1` (#715) — the canonical lane-bucketing rule
