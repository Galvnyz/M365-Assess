# Your first remediation cycle

A worked example. You've run M365-Assess for the first time, you have a Fail finding, and you want to know: what now?

This walkthrough takes one realistic finding — **ENTRA-CA-001 (Block legacy authentication)** — from initial Fail through remediation through re-verification. Follow it once and you'll have the muscle memory for every subsequent finding.

> **Screenshots:** placeholder for now — the panels referenced below render in your own assessment HTML. Open your report in two browser tabs (one for reading along, one for clicking through) to follow.

---

## 0. The setup

You ran:

```powershell
Invoke-M365Assessment -ProfileName <your-profile> -AutoBaseline
```

The assessment took ~3 minutes and dropped artifacts into `M365-Assessment/Assessment_<timestamp>_<tenant>/`. You opened `_Assessment-Report_<tenant>.html` and the report's Posture section shows a Fail finding: **"Enable Conditional Access policies to block legacy authentication."**

Your job: make it Pass.

---

## 1. Read the finding

In the report's **Findings** section, find the row with `ENTRA-CA-001` in the CheckID column. The status pill is red (`Fail`), the Sequence pill is red (`Now` — high-priority lane), the Severity is `Critical`.

Click the row. The detail panel expands. You see:

- **State strip** (top): Status `Fail` · Sequence `Now` · Severity `Critical` · Effort `1 hour` · Affected `tenant-wide`
- **Why it matters**: Legacy auth protocols (POP, IMAP, SMTP AUTH, MAPI, etc.) bypass MFA. An attacker with only a username + password can sign in as any user using these protocols. CA blocking legacy auth is the single highest-leverage Identity hardening.
- **Current**: No CA policy exists that targets `Legacy auth clients` and `Block` access. (No matching policy was found in the tenant.)
- **Recommended**: A CA policy exists, scoped to `All users`, that blocks `Legacy auth clients`. Optionally `Report-only` first to gauge impact.
- **Remediation**: Microsoft Entra admin center > Protection > Conditional Access > Policies > New policy. Target: All users. Cloud apps: All cloud apps. Conditions > Client apps: select `Exchange ActiveSync` and `Other clients`. Grant > Block access. Enable.
- **Frameworks**: This finding maps to **CIS M365 v6 1.1.6**, **CIS Controls v8 6.5**, **NIST 800-53 IA-2(1)**, **CMMC IA.L2-3.5.3**, plus 6 others.

Now you understand: what's broken, why it matters, and what good looks like.

---

## 2. (Optional) Stage the change

For high-impact CA policies, **always start in Report-only mode** for 1–7 days. This lets the policy run against real traffic, log its effect, but not actually block anything. You verify the report-only logs show only the traffic you'd want blocked, then flip to Enabled.

**You skip Report-only when:** the change is mechanical and reversible (e.g., enabling an audit log), OR the finding's Effort label says `<15 min`, OR you have a maintenance window with helpdesk standing by.

For ENTRA-CA-001, Report-only is the safe default. Plan for a 3-day soak.

---

## 3. Apply the fix

Two paths — pick the one that fits your tenant's change-control workflow.

### Path A — Admin center (point-and-click)

Follow the remediation breadcrumb literally:

1. Open the **Microsoft Entra admin center** (`entra.microsoft.com`)
2. Navigate to **Protection > Conditional Access > Policies**
3. Click **+ New policy**, name it `BLOCK - Legacy auth (CIS 1.1.6)`
4. **Users**: Include `All users`. Exclude any break-glass accounts (you should have at least 2; see ENTRA-ADMIN-003 if you don't).
5. **Cloud apps**: Include `All cloud apps`
6. **Conditions > Client apps**: Configure → Yes. Select `Exchange ActiveSync clients` and `Other clients`. Leave the modern auth checkboxes unticked.
7. **Grant**: Block access
8. **Enable policy**: `Report-only` (for the soak), or `On` if you're confident
9. **Create**

### Path B — PowerShell (auditable, repeatable)

```powershell
# Connect with the right scope
Connect-MgGraph -Scopes 'Policy.ReadWrite.ConditionalAccess'

# Build the policy object
$policy = @{
    displayName     = 'BLOCK - Legacy auth (CIS 1.1.6)'
    state           = 'enabledForReportingButNotEnforced'   # Report-only
    conditions      = @{
        users        = @{ includeUsers = @('All') }
        applications = @{ includeApplications = @('All') }
        clientAppTypes = @('exchangeActiveSync', 'other')
    }
    grantControls   = @{
        operator        = 'OR'
        builtInControls = @('block')
    }
}

# Create the policy
New-MgIdentityConditionalAccessPolicy -BodyParameter $policy
```

Path B is preferable for tenants where you're applying the same fix at scale (multi-tenant consultants, MSPs).

---

## 4. Verify the soak (Report-only path)

After 24–72 hours in Report-only:

1. Microsoft Entra admin center > Monitoring > **Sign-in logs**
2. Filter: **Conditional Access > Policy = your new policy name**
3. Look at the `Result` column. Anything `reportOnlyFailure` would have been blocked if enforced.

You're checking two things:

- **Are blocks happening to the traffic you expect?** Legacy clients (old Outlook for Mac, abandoned mail relays, scripts using basic auth). If yes, your scope is right.
- **Are blocks happening to traffic you DIDN'T expect?** A line-of-business app, a printer/MFP that scans-to-email, a mobile device on an outdated client. If yes — investigate before flipping to enforce. Either modernise the client, exclude the user from the policy, or pick a phased rollout.

When the soak looks clean, flip the policy from Report-only to Enabled.

---

## 5. Re-run the assessment

```powershell
Invoke-M365Assessment -ProfileName <your-profile> -AutoBaseline
```

The `-AutoBaseline` flag is what makes this a true cycle — the new run is automatically compared against your previous baseline, and the report's **Drift** panel surfaces the deltas.

When the new report opens:

- **Headline KPI**: your Pass% should tick up (one finding flipped from Fail to Pass — the exact movement depends on your denominator)
- **Findings table**: search for `ENTRA-CA-001`. Status pill is now green (`Pass`). Sequence pill is green (`Done`). Severity unchanged (it's still a Critical-importance control — Severity describes *what kind* of finding, not the current status).
- **Drift panel** (top of report): shows `1 newly passing` finding listed with `ENTRA-CA-001`. If anything else flipped — perhaps a related finding — it's surfaced here too. The Drift panel is your audit trail of what the change actually moved.

---

## 6. Document the closure

This step is what separates an audit from "I clicked something."

For each finding you remediate, capture:

- **What was the gap?** (`No CA policy blocked legacy auth`)
- **What did you change?** (`Created policy 'BLOCK - Legacy auth (CIS 1.1.6)'`, in Entra ID, on YYYY-MM-DD, by [you])
- **What was the soak result?** (`3 days Report-only, 47 reportOnlyFailure events all matched legacy clients we expected`)
- **What does Pass look like now?** (`ENTRA-CA-001 status: Pass; Drift panel confirmed`)

The HTML report's **Copy** button on each finding row is designed for this — it serializes the finding to a markdown summary suitable for pasting into a ticket, change record, or audit evidence pack. After the fix lands, hit Copy on the now-Pass finding to capture the closure state.

---

## What you've learned

This loop generalizes:

| Step | What you do | Why |
|---|---|---|
| 1. Read | Open the finding, understand what / why / what good looks like | Context before action |
| 2. Stage | Report-only or maintenance window for high-impact changes | Reversibility |
| 3. Apply | Admin center OR PowerShell, depending on workflow | Both produce the same end state |
| 4. Verify | Check the soak data, look for unexpected blocks | Catch unintended impact before enforce |
| 5. Re-run | `Invoke-M365Assessment -AutoBaseline` | Confirm the change moved the score |
| 6. Document | Copy the finding state into your ticket / change record | Audit evidence |

Every Fail finding in M365-Assess follows the same loop. The remediation specifics differ (some are PowerShell-only, some require both Entra and Defender changes, some need helpdesk coordination) but the rhythm is the same.

---

## Common stumbles

**"My re-run still shows Fail."**
The Microsoft Graph API has a propagation delay — give changes 5–10 minutes to surface. Re-run after a coffee. If still failing, check the assessment log (`_Assessment-Log_*.txt`) for the underlying error; sometimes the collector hit a permission issue and emitted Fail-by-default.

**"The Drift panel is empty after my fix."**
Drift compares against the most recent prior baseline. If `-AutoBaseline` was new to this run (e.g., you ran without it before), there's no prior baseline to compare against. Run twice with `-AutoBaseline`; the second run gets the comparison.

**"My change looks right but Sign-in logs are empty."**
CA Sign-in logs require **Microsoft Entra ID P1 or P2** licensing. On a Free / B2B-only tenant, Report-only mode doesn't produce visible logs — you'd need to enforce and watch helpdesk tickets instead.

**"The remediation breadcrumb path is wrong."**
Microsoft reorganises the admin center periodically. The path in the finding might be stale. Use the Microsoft Learn link in the finding's Frameworks panel as the canonical source, or search the admin center directly for the policy name.

---

## See also

- [`UNDERSTANDING-RESULTS.md`](UNDERSTANDING-RESULTS.md) — what each status means
- [`REPORT-USER-GUIDE.md`](REPORT-USER-GUIDE.md) — interactive features (edit mode, Finalize, Copy button, Drift panel)
- [`SCORING.md`](SCORING.md) — how Pass% is computed (relevant for understanding the score-tick after the fix)
- [`GLOSSARY.md`](GLOSSARY.md) — Lane / Sequence / Baseline / Drift terminology
- [`INDEX.md`](../INDEX.md) — back to the docs index
