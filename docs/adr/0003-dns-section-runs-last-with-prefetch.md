# 0003 — DNS section runs last, fed by a connect-time prefetch

- **Status:** Accepted
- **Date:** 2026-05-06

## Context

DNS Authentication checks (SPF, DKIM, DMARC, MTA-STS, the DNS Security Config collector) need two inputs that don't come from DNS:

1. The list of accepted/verified domains for the tenant — produced by Microsoft Graph (`/organization`) or EXO `Get-AcceptedDomain`.
2. DKIM signing configurations — produced by EXO `Get-DkimSigningConfig`.

Both come from sections that run earlier in the assessment pipeline. EXO sessions, though, are not reliable across the full assessment lifetime — long-running runs hit token expiry / session timeout, and EXO cmdlets after that point throw cryptic errors. We've been bitten by this multiple times when DNS used to run inline with the Email section: the EXO session that produced `AcceptedDomain` 5 minutes earlier was already gone by the time DNS resolution finished its serial round-trips.

The DNS section is also the slowest section by wall-clock — DNS resolution is network-bound and serialized per-domain. Running it inline with other sections wastes the elapsed time of every section that follows.

## Decision

Defer the entire DNS section to **after all other sections complete**, and feed it from caches populated earlier:

1. **At Graph connect time** (in `Connect-RequiredService.ps1`), if `Email` is in the requested sections, kick off `Start-ThreadJob`-based DNS prefetch for every verified domain in parallel. This runs *concurrently with* the rest of the assessment.
2. **During the Email section**, snapshot `Get-AcceptedDomain` and `Get-DkimSigningConfig` into `$script:cachedAcceptedDomains` and `$script:cachedDkimConfigs` while the EXO session is known to be valid.
3. **At the end of the orchestrator**, after all other sections have run, `Invoke-DnsAuthentication` consumes the cached domains, the cached DKIM data, and the now-completed prefetch job results.
4. **Filter `.onmicrosoft.com` domains at source** before any DNS resolution — Microsoft-managed domains can't have customer-published records by design.

See: [`src/M365-Assess/Orchestrator/Invoke-DnsAuthentication.ps1`](../../src/M365-Assess/Orchestrator/Invoke-DnsAuthentication.ps1) and the prefetch in [`src/M365-Assess/Orchestrator/Connect-RequiredService.ps1`](../../src/M365-Assess/Orchestrator/Connect-RequiredService.ps1) (around the `dnsPrefetchJobs` setup).

## Consequences

**Positive**

- DNS resolution happens concurrently with the slow EXO/SharePoint/Defender sections — no idle wall-clock time.
- EXO-derived inputs are captured while the session is still alive, then handed to DNS as plain data; the DNS phase never re-touches EXO.
- `.onmicrosoft.com` filter at source means we don't waste resolution attempts on domains where the result is mathematically impossible.
- DNS failures are isolated: a network blip during DNS doesn't taint Email/Defender/SPO findings, since those have already completed.

**Negative**

- DNS findings appear at the bottom of the report and get the latest assessment timestamp, which can confuse users into thinking DNS was "checked latest" when in fact the prefetch ran much earlier. The evidence-timestamp field per finding is the source of truth, not section order.
- The cache is held in `$script:` scope, which couples the DNS phase to the orchestrator's specific module load. If the orchestrator ever moves to a separate runspace per section, this contract breaks.
- If the user runs `-Section DNS` alone (without Email), there's no cached domain list. The current code falls back to a fresh `Get-AcceptedDomain` call, which means a fresh EXO connection is required for that path.
- Prefetch runs before the user has explicitly opted into DNS — if `Email` is in the section list, we're querying public DNS for every verified domain regardless of whether the DNS section ultimately runs. Today this is fine (DNS queries to public resolvers are not sensitive), but it's worth flagging if we ever add internal-resolver checks.

**Failure modes and mitigations**

- *EXO session times out before Email section captures domain list* → the cache is empty and `Invoke-DnsAuthentication` re-tries `Get-AcceptedDomain`, logging WARN and skipping if that also fails.
- *Prefetch jobs fail mid-run (DNS resolver flake)* → individual domain results come back with empty record sets; the per-finding evidence shows "no record found" rather than crashing the section.
- *Section order changes (e.g. user runs `-Section DNS,Email`)* → defer logic still triggers because it's keyed on `$script:runDnsAuthentication`, not on requested section order.

## Alternatives considered

- **Run DNS inline at the end of the Email section.** Rejected (this is what we used to do): EXO session timeout caused intermittent failures on large tenants where Email finished early but the assessment kept running for another 20 minutes.
- **Run DNS as the first section, before EXO.** Rejected: no domain list available until Graph or EXO has been queried, so DNS would need its own copy of that lookup logic — duplicating the connect-side code.
- **Lazy DNS: resolve per-domain only when the report renders.** Rejected: pushes network calls into report generation, which is supposed to be a pure transformation. Also breaks the offline-report-rebuild use case.
- **Spawn a separate runspace per DNS check, fan-out at end.** Considered, deferred. The current `Start-ThreadJob` prefetch already gives us the parallelism we need; full per-check runspacing adds complexity without a clear win.

---

## See also

- [`../../src/M365-Assess/Orchestrator/Invoke-DnsAuthentication.ps1`](../../src/M365-Assess/Orchestrator/Invoke-DnsAuthentication.ps1) — the deferred DNS phase
- [`../../src/M365-Assess/Orchestrator/Connect-RequiredService.ps1`](../../src/M365-Assess/Orchestrator/Connect-RequiredService.ps1) — connect-time DNS prefetch via `Start-ThreadJob`
- [`../../src/M365-Assess/Exchange-Online/Get-DnsSecurityConfig.ps1`](../../src/M365-Assess/Exchange-Online/Get-DnsSecurityConfig.ps1) — DNS Security Config collector that consumes `-AcceptedDomains`
- [`README.md`](README.md) — back to the ADR index
