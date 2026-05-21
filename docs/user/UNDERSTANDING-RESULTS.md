# Understanding your results

A user-facing answer to "I'm reading this report — what do these statuses mean and what should I do?"

For the implementation rules (when collectors emit each status, denominator math, schema versioning), see [`reference/CHECK-STATUS-MODEL.md`](../reference/CHECK-STATUS-MODEL.md).

---

## The 9 statuses, in priority order

### 🔴 Fail

**The control is not in place. Action required.**

The check observed your tenant data and the configuration is insecure or the recommended setting is missing entirely. Open the finding's detail panel and follow the remediation steps.

Counts toward your Pass% score (drags it down).

### 🟠 Warning

**The control is partially in place. Review whether to harden.**

The check is configured but in a way that's contextually concerning — e.g., MFA is enabled but only for some users, or DLP rules exist but are in audit-only mode. Often the right call is to harden; sometimes it's an intentional design decision worth documenting.

Counts toward your Pass% score (drags it down).

### 🔵 Review

**Manual interpretation needed.**

The check pulled data but a human has to decide whether it's good or bad — e.g., a list of admin accounts where you need to know which ones are intentional vs. legacy. Open the finding, read the **Current value**, and decide based on your tenant's context.

**Doesn't count** toward your Pass% score. The score reflects only checks where M365-Assess can give a clear Pass / Fail / Warning verdict.

### 🟢 Pass

**The control is in place. Nothing to do.**

The check observed your tenant data and the configuration matches the recommended setting.

Counts toward your Pass% score (lifts it up).

### ⚪ Info

**Informational. No action implied.**

A signal worth showing in the report but not a posture verdict — e.g., "this tenant has X licensed users", "P2 features are available". Useful context; not something you fix or ignore.

**Doesn't count** toward your Pass% score.

### ⚫ Skipped

**The check didn't run.**

Three reasons this happens, and the right response depends on which:

| Sub-reason | What it means | Should you worry? |
|---|---|---|
| **License-gated** | The control requires a license tier you don't have (e.g., a P2-only feature on a P1 tenant) | No — it's correctly skipped |
| **Permission-gated** | The assessment didn't have the Graph scope or RBAC role needed | Maybe — re-run with the right permissions if the check matters to you. See [`AUTHENTICATION.md`](AUTHENTICATION.md) |
| **Environment-not-applicable** | The control doesn't apply to this tenant (e.g., a Hybrid check on a cloud-only tenant) | No |

**Doesn't count** toward your Pass% score.

### 🟡 Unknown

**The assessment tried but couldn't get the data.**

Different from Skipped — this is "the API returned an error or unexpected shape." Check the assessment log (`_Assessment-Log_*.txt`) for the underlying error. Common causes: transient API failure (re-run usually fixes), a Graph endpoint returning new shape (file an issue), or a tenant with non-standard config that confuses the collector.

**Doesn't count** toward your Pass% score.

### ⚪ NotApplicable

**The control isn't relevant to this tenant.**

E.g., an Azure AD B2B check on a tenant that doesn't use B2B. The check is correctly inert; there's nothing to fix.

**Doesn't count** toward your Pass% score.

### ⚫ NotLicensed

**The tenant lacks the license tier this control requires.**

E.g., a Defender for Identity check on a tenant without Defender for Identity. The right response is usually no action — this is just M365-Assess being honest that it can't verify a control you don't pay for. If the control matters to your security posture, the action is "buy the license"; otherwise ignore.

**Doesn't count** toward your Pass% score.

---

## What counts toward the score?

Only **Pass / Fail / Warning** count. Everything else is "we couldn't or shouldn't decide" and is excluded from the denominator.

Practical example: a tenant with 200 checks where 150 Pass, 20 Fail, 10 Warning, 15 Review, and 5 Skipped scores **(150) / (150 + 20 + 10) = 83%**. The 20 unscored checks (Review + Skipped) don't pull the score up or down — they're set aside.

For the math detail and how the report breaks the score across views, see [`SCORING.md`](SCORING.md).

---

## Common questions

**Why did my Secure Score drop after I fixed something?**

You're looking at a different score. The Microsoft Secure Score panel reflects Microsoft's value (delayed up to 24 hours; see the disclaimer in that panel). The Pass% in the M365-Assess KPIs is computed from this assessment's findings and updates immediately when you re-run.

**A finding shows Review — do I have to do something?**

Only if the **Current value** in the finding detail tells you something needs attention. Review means "M365-Assess pulled the data but can't decide for you." Read the value, decide, move on. If it's truly Pass-worthy, leave it. If it's a Fail in disguise, treat it as a Fail and remediate.

**My tenant has lots of Skipped checks — is the assessment broken?**

Probably not. Most Skipped checks are license-gated — your tenant doesn't pay for the feature being checked. Open the assessment log (`_Assessment-Log_*.txt`) and look for "Skipping" entries to see why each section was skipped. If you see permission errors instead of license messages, re-run with the right permissions per [`AUTHENTICATION.md`](AUTHENTICATION.md).

**Why is my score lower than my client's despite our tenants looking similar?**

Pass% denominators differ. Two tenants with identical configurations can score differently if they have different licenses (more licensed features = more checks counted), different sections selected, or different permission scopes (fewer permissions = more Skipped, smaller denominator).

---

## See also

- [`SCORING.md`](SCORING.md) — how the score is computed across the 6 scoring views
- [`reference/CHECK-STATUS-MODEL.md`](../reference/CHECK-STATUS-MODEL.md) — implementer-oriented status reference (when collectors emit each)
- [`GLOSSARY.md`](GLOSSARY.md) — terminology used in the report
- [`REPORT-USER-GUIDE.md`](REPORT-USER-GUIDE.md) — using the HTML report
- [`INDEX.md`](../INDEX.md) — back to the docs index
