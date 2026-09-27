# Assessment trust maintenance validation

This change prepares recommendations 1–3 from the September project review:
correct conclusions, finish shared Graph collection behavior, and support
assessor decisions with versioned report contracts and executable UI tests.
It does not change the module version or publish a release.

## Offline validation

- Pester: collector fixtures, graph paging/retry/error cases, conservative CA
  matching, authoritative EXO audit source, sidecar tenant/scope/expiry checks,
  zero/one/multiple array contracts, and generated HTML/XLSX/bridge/baseline flows.
- `npm run build && npm test`: PowerShell-produced schema fixture, scoring and
  decision behavior, actual vendored React mounting, and source size limit.
- PSScriptAnalyzer with the repository settings; `git diff --check`.
- Runtime schemas are packaged via the module manifest. Schema versions are
  independent of the module version. Bridge 1.1 retains existing fields and adds
  evidence, decisions, actionable state, and collection completion information.

## Required live validation before release

Use the existing release process and a human-reviewed tenant run. Verify:

1. Exchange-only and combined Exchange/Purview sessions resolve the Exchange
   audit cmdlet, including prefixes. Purview-only and ambiguous sessions show
   Unknown. Compare the value with the Exchange Online command directly.
2. A tenant with multi-page users, applications, policies, and Intune lists
   returns full counts. Permission denial, unavailable licensing and transient
   errors remain visible; partial collections never produce a normal response.
3. Repeat a tenant assessment with an accepted risk and a manual attestation,
   then change evidence or expire a decision. Inspect all three report outputs
   and AutoBaseline comparison. Raw observations must not be rewritten.
4. Open and finalize the self-contained HTML in a supported browser, then reopen
   it and regenerate the companion XLSX/JSON from the exported sidecar.

Configuration lists use the shared pager. Explicit `FirstPageOnly` calls are
bounded evidence samples or access probes, including the SOC2 sample and recent
Secure Score history; these do not claim full historical coverage. Sovereign
Graph endpoints remain SDK/environment controlled; the pager follows next links
without substituting the commercial hostname.

CA policy matching is supporting evidence, not a proof of Security Defaults
equivalence. It requires all users/apps, mandatory MFA rather than an alternative
OR grant, no exclusions or additional targeting, and enforced policies. Effective
sign-in behavior still requires review. See [Microsoft's authentication strength
evaluation](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-strength-how-it-works).
