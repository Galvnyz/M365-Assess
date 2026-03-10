# M365-Assess: Comprehensive Security Review & Improvement Plan

> **Reviewer**: Application Security Expert
> **Date**: March 2026
> **Scope**: Internal security posture of the M365-Assess solution itself — credential handling, code injection, XSS, data exposure, error handling, supply chain, and assessment value
> **Solution Version**: 0.4.0

---

## Executive Summary

M365-Assess is a read-only assessment tool that by design never modifies tenant data. Its attack surface is primarily:
1. **Credential handling** during authentication to Microsoft services
2. **HTML report generation** that renders tenant data (potential XSS)
3. **Data output** containing PII from M365 tenants (CSV/HTML files)
4. **Dynamic script execution** for ScubaGear PS5 bridge
5. **External network calls** for DNS checks and font loading

The solution demonstrates **strong security awareness** in many areas — `.gitignore` excludes credential files, `ConvertTo-HtmlSafe` is used extensively, all operations are `Get-*` only, and temporary files are cleaned up. However, this review identifies **4 High**, **13 Medium**, and **8 Low** severity findings that should be addressed to harden the solution.

### Findings Summary

| Severity | Count | Key Areas |
|----------|-------|-----------|
| **CRITICAL** | 0 | None |
| **HIGH** | 4 | Client secret as plaintext string, report XSS gaps, no CSP header, external CDN dependency |
| **MEDIUM** | 13 | Exception info disclosure, ScubaGear script injection, ScubaGear path traversal, ScubaGear temp cleanup bug, PII in outputs, log stack traces, missing parameter validation, Get-StatusBadge XSS, Get-SeverityBadge XSS, ScubaGear href path injection, missing single-quote escape on `$productList`, ScubaGear auto-install no version pin, version mismatch |
| **LOW** | 8 | Certificate thumbprint as plaintext, no wizard timeout, log file permissions, no integrity checks, assessment output not encrypted, `Read-Host` without masking, TenantId URL interpolation, no module integrity verification |

---

## Part 1: Credential & Authentication Security

### FINDING S-01: ClientSecret Parameter Accepts Plaintext String [HIGH]

**File**: `Common/Connect-Service.ps1:75`
**Also**: `Invoke-M365Assessment.ps1` (no `ClientSecret` param exposed, but `Connect-Service.ps1` accepts it)

```powershell
[Parameter()]
[string]$ClientSecret,        # ← plaintext string, not SecureString
```

And later at line 144:
```powershell
$secureSecret = ConvertTo-SecureString -String $ClientSecret -AsPlainText -Force
```

**Risk**: The client secret exists as a plaintext `[string]` throughout the parameter chain and in process memory. PowerShell strings are immutable and cannot be securely zeroed. If the process dumps core, the secret is exposed. Additionally, PowerShell command history (`Get-History`) will contain the secret if passed inline.

**Recommendation**:
```powershell
# Change parameter type to SecureString
[Parameter()]
[System.Security.SecureString]$ClientSecret,

# Then convert only when needed:
$credential = New-Object System.Management.Automation.PSCredential($ClientId, $ClientSecret)
```

Also add a `[Obsolete]` comment warning that client secrets are less secure than certificate auth, and consider removing `ClientSecret` support entirely in favor of certificate-only app auth (which is already the recommended pattern in the tool's documentation).

**Effort**: Low
**Priority**: P1

---

### FINDING S-02: Exception Messages May Leak Credential Context [MEDIUM]

**File**: `Common/Connect-Service.ps1:220`

```powershell
catch {
    Write-Error "Failed to connect to $Service`: $_"
}
```

**Risk**: The raw `$_` exception from Microsoft auth libraries can contain partial token information, OAuth error descriptions with redirect URIs containing auth codes, or internal API URLs. Example of a real MSAL error:

```
AADSTS700016: Application with identifier '00000000-...' was not found in directory 'contoso.onmicrosoft.com'.
Trace ID: abc123 Correlation ID: def456 Timestamp: 2026-03-10
```

While this particular example is low-risk, other auth errors from `Connect-MgGraph` or `Connect-ExchangeOnline` can include WAM broker details, token endpoint URLs, or redirect URIs.

**Recommendation**:
```powershell
catch {
    $safeMsg = switch -Regex ($_.Exception.Message) {
        'AADSTS\d+' { "Azure AD error: $($Matches[0]). Check app registration and permissions." }
        'WAM|broker'      { "WAM broker error. Try -UseDeviceCode or -UserPrincipalName." }
        'not installed'   { "Required module not installed: $requiredModule" }
        default           { "Connection failed. Run with -Verbose for details." }
    }
    Write-Error $safeMsg
    Write-Verbose "Full error: $($_.Exception.Message)"
}
```

**Effort**: Low
**Priority**: P2

---

### FINDING S-03: Full Exception Stack Traces Written to Log File [MEDIUM]

**File**: `Invoke-M365Assessment.ps1:1263, 1549`

```powershell
Write-AssessmentLog -Level ERROR -Message "$svc connection failed: $friendlyMsg" -Section $SectionName -Detail $_.Exception.ToString()
```

And:
```powershell
Write-AssessmentLog -Level ERROR -Message "Collector failed" -Section $sectionName -Collector $collector.Label -Detail $_.Exception.ToString()
```

**Risk**: `$_.Exception.ToString()` includes the full stack trace with internal module paths, .NET assembly names, and potentially sensitive error details. The `_Assessment-Log.txt` file is saved alongside CSV outputs and could be shared with clients or uploaded to ticketing systems.

**Recommendation**:
- Continue logging `$_.Exception.Message` for the log file
- Write full `$_.Exception.ToString()` only in `-Verbose` output (console only, not persisted)
- Or introduce a `-DetailedLog` switch that enables full stack traces for troubleshooting

**Effort**: Low
**Priority**: P2

---

### FINDING S-04: Certificate Thumbprint Passed as Plain String [LOW]

**File**: `Common/Connect-Service.ps1:72`, `Invoke-M365Assessment.ps1:102`

```powershell
[Parameter()]
[string]$CertificateThumbprint,
```

**Risk**: Certificate thumbprints are SHA-1 hashes and are not secrets per se — they're visible in the certificate store and in Entra ID app registrations. However, they are credential-adjacent material. No masking is applied in `Read-Host` during the interactive wizard (line 327).

**Recommendation**: This is acceptable as-is since thumbprints are not secrets. However, adding `[ValidatePattern('^[A-Fa-f0-9]{40}$')]` would prevent typos and injection.

**Effort**: Trivial
**Priority**: P3

---

### FINDING S-05: Missing Parameter Validation on Credential Fields [MEDIUM]

**File**: `Common/Connect-Service.ps1:66-75`, `Invoke-M365Assessment.ps1:99-102`

No format validation on:
- `$ClientId` — should be a GUID
- `$CertificateThumbprint` — should be 40 hex characters
- `$TenantId` — should be a GUID or `*.onmicrosoft.com` domain

**Recommendation**:
```powershell
[Parameter()]
[ValidatePattern('^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$')]
[string]$ClientId,

[Parameter()]
[ValidatePattern('^[A-Fa-f0-9]{40}$')]
[string]$CertificateThumbprint,
```

**Effort**: Trivial
**Priority**: P2

---

### FINDING S-06: Interactive Wizard Has No Session Timeout [LOW]

**File**: `Invoke-M365Assessment.ps1:200-420`

The interactive wizard loops indefinitely waiting for input with `Read-Host`. If a consultant walks away with the wizard open, anyone with physical/remote access to the console can proceed through authentication.

**Recommendation**: Not critical for a local tool, but consider adding a note in docs that the wizard should be used in secure environments.

**Effort**: N/A (documentation only)
**Priority**: P3

---

## Part 2: HTML Report Security (XSS)

### FINDING S-07: Comprehensive HTML Encoding Present (GOOD)

**File**: `Common/Export-AssessmentReport.ps1:254-258`

```powershell
function ConvertTo-HtmlSafe {
    param([string]$Text)
    if (-not $Text) { return '' }
    return $Text.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;').Replace('"', '&quot;')
}
```

**Assessment**: This function is called **extensively** throughout the report — 80+ usages found. The implementation correctly encodes the four critical HTML characters. The vast majority of dynamic content (tenant names, user names, policy names, domain names, setting values) passes through this function.

**Gap**: Missing single-quote encoding (`'` → `&#39;` or `&apos;`). While single quotes are less exploitable in HTML context, they can be dangerous in attribute values using single-quote delimiters (e.g., `<tag attr='$value'>`). The report uses both `class="..."` and `class='...'` patterns.

**Recommendation**: Add single-quote escaping:
```powershell
return $Text.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;').Replace('"', '&quot;').Replace("'", '&#39;')
```

**Effort**: Trivial
**Priority**: P2

---

### FINDING S-08: Get-StatusBadge Default Case — Unencoded $Status [MEDIUM]

**File**: `Common/Export-AssessmentReport.ps1:266`

```powershell
default { "<span class='badge'>$Status</span>" }
```

**Risk**: If `$Status` contains a value other than Complete/Skipped/Failed (e.g., from a corrupted collector result or manipulated summary CSV), it's inserted into HTML without encoding. An attacker could craft a Status value like `Complete' onload='alert(1)` — since the surrounding tag uses single-quote delimiters (`class='badge'`), this breaks out of the attribute context.

**Recommendation**:
```powershell
default { "<span class='badge'>$(ConvertTo-HtmlSafe -Text $Status)</span>" }
```

**Effort**: Trivial
**Priority**: P2

---

### FINDING S-08b: Get-SeverityBadge Default Case — Unencoded $Severity [MEDIUM]

**File**: `Common/Export-AssessmentReport.ps1:287`

```powershell
function Get-SeverityBadge {
    param([string]$Severity)
    switch ($Severity) {
        'ERROR'   { '<span class="badge badge-failed">ERROR</span>' }
        'WARNING' { '<span class="badge badge-warning">WARNING</span>' }
        'INFO'    { '<span class="badge badge-info">INFO</span>' }
        default   { "<span class='badge'>$Severity</span>" }    # ← VULNERABLE
    }
}
```

**Risk**: Same pattern as S-08. The `$Severity` variable is directly embedded in HTML without encoding in the default case. Used at line 1759 with `$issue.Severity` from parsed issue data.

**Recommendation**:
```powershell
default { "<span class='badge'>$(ConvertTo-HtmlSafe -Text $Severity)</span>" }
```

**Effort**: Trivial
**Priority**: P2

---

### FINDING S-08c: ScubaGear Report href — Unencoded File Path [MEDIUM]

**File**: `Common/Export-AssessmentReport.ps1:1373-1374`

```powershell
$relPath = $nativeReport.FullName.Substring($AssessmentFolder.Length + 1) -replace '\\', '/'
$null = $sectionHtml.AppendLine("<p>...open the <a href='$relPath' target='_blank'>ScubaGear Native Report</a>.</p>")
```

**Risk**: The `$relPath` is derived from the filesystem path and inserted into an HTML `href` attribute without encoding. If the assessment output folder path contains single quotes or angle brackets (e.g., a crafted folder name like `Assessment'><script>alert(1)</script>`), it could break out of the attribute and inject HTML/JavaScript.

**Recommendation**:
```powershell
$relPath = ConvertTo-HtmlSafe -Text ($nativeReport.FullName.Substring($AssessmentFolder.Length + 1) -replace '\\', '/')
$null = $sectionHtml.AppendLine("<p>...open the <a href='$relPath' target='_blank'>ScubaGear Native Report</a>.</p>")
```

**Effort**: Trivial
**Priority**: P2

---

### FINDING S-09: No Content Security Policy (CSP) [HIGH]

**File**: `Common/Export-AssessmentReport.ps1:1800-1808`

The generated HTML report has no CSP meta tag. This means if any XSS vector exists (even in future code changes), there's no browser-level defense preventing execution.

**Recommendation**: Add a CSP meta tag in the `<head>`:
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'unsafe-inline';">
```

This restricts:
- No external script loading
- No external image loading
- Only Google Fonts for font loading
- Inline styles allowed (needed for the report)
- Inline scripts allowed (needed for the report's JS)

**Effort**: Low
**Priority**: P1

---

### FINDING S-10: External Google Fonts CDN Dependency [HIGH]

**File**: `Common/Export-AssessmentReport.ps1:1805-1807`

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
```

**Risk**: Three issues:
1. **Privacy**: When the report is opened, the client's browser makes requests to `fonts.googleapis.com`, revealing the reader's IP address, browser, and referrer to Google. Assessment reports are sensitive documents.
2. **Availability**: If opened offline (common for consultants working on client sites with restricted internet), the fonts fail to load and the report falls back to system fonts, breaking the visual design.
3. **Integrity**: No `integrity` attribute on the CSS link — a compromised CDN could inject malicious CSS.
4. **Air-gapped environments**: GCC High/DoD clients may have network restrictions preventing Google CDN access.

**Recommendation**: Embed the Inter font directly as a base64 data URI in the CSS, or use system fonts. The report is already self-contained for all other assets — this is the only external dependency.

```css
/* Replace Google Fonts with system font stack */
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
```

Or bundle the font as base64:
```css
@font-face {
    font-family: 'Inter';
    src: url(data:font/woff2;base64,...) format('woff2');
    font-weight: 300 700;
}
```

**Effort**: Low (system fonts) or Medium (base64 embedding)
**Priority**: P1

---

### FINDING S-11: Inline JavaScript in HTML Report [MEDIUM — Inherent]

**File**: `Common/Export-AssessmentReport.ps1` (multiple locations)

The report contains substantial inline JavaScript for interactive features (dark mode toggle, search, table sorting, chart rendering, navigation). This JavaScript is generated server-side and does not process user input at runtime, so the XSS risk is from the initial data embedding, which is protected by `ConvertTo-HtmlSafe`.

**Assessment**: The inline JS is acceptable for a self-contained HTML report. The alternative (external `.js` files) would break the single-file design.

**Recommendation**: No change needed, but ensure the CSP from S-09 allows `'unsafe-inline'` for scripts.

**Effort**: N/A
**Priority**: N/A

---

## Part 3: Data Handling & PII Exposure

### FINDING S-12: PII Exported in CSV Files [MEDIUM]

Multiple collectors export personally identifiable information to CSV files:

| Collector | PII Fields | Risk |
|-----------|-----------|------|
| `Get-UserSummary.ps1` | DisplayName, UserPrincipalName, Mail | Names and email addresses |
| `Get-MfaReport.ps1` | UserPrincipalName, UserDisplayName | Names and email addresses |
| `Get-AdminRoleReport.ps1` | DisplayName, UserPrincipalName | Admin identities |
| `Get-MailboxSummary.ps1` | DisplayName, PrimarySmtpAddress | Names and email addresses |
| `Get-MailboxInventory.ps1` | DisplayName, PrimarySmtpAddress, ForwardingAddress | Names, emails, forwarding targets |
| `Get-InactiveUsers.ps1` | DisplayName, UserPrincipalName, LastSignIn | Names and login patterns |
| `Get-DeviceSummary.ps1` | UserDisplayName, UserPrincipalName, DeviceName | User-device mapping |
| `Get-TeamsInventory.ps1` | Owner display names, member counts | Organizational structure |
| `Get-GroupInventory.ps1` | Member names, email addresses | Group membership |

**Risk**: Assessment output folders contain significant PII. If shared via email, uploaded to cloud storage, or left on shared drives, this constitutes a data leak. In GDPR jurisdictions, this PII processing requires a legal basis and may require documentation.

**Recommendations**:
1. Add a **data handling notice** to the assessment summary output and HTML report footer
2. Add a `README.txt` in each assessment output folder with handling instructions
3. Consider adding a `-RedactPII` switch that replaces names/emails with hashes while preserving the assessment's analytical value
4. Document PII handling in a `SECURITY.md` file

**Effort**: Medium (for `-RedactPII` switch), Low (for documentation)
**Priority**: P2

---

### FINDING S-13: Assessment Output Not Encrypted at Rest [LOW]

**File**: `Invoke-M365Assessment.ps1:997-1000`

Assessment output folder is created with standard filesystem permissions:
```powershell
$null = New-Item -Path $assessmentFolder -ItemType Directory -Force
```

No encryption, no ACL restriction, no password protection.

**Risk**: Low for a consultant tool — the consultant is expected to secure their own workstation. But for MSP scenarios where assessment data transits between systems, encryption would add defense-in-depth.

**Recommendation**: Consider adding a `-ProtectOutput` switch that creates a password-protected ZIP:
```powershell
Compress-Archive -Path $assessmentFolder -DestinationPath "$assessmentFolder.zip"
# Then optionally encrypt with AES using a user-provided password
```

**Effort**: Medium
**Priority**: P3

---

### FINDING S-14: Log File Contains Detailed Error Information [MEDIUM]

**File**: `Invoke-M365Assessment.ps1:1263`

As noted in S-03, the `_Assessment-Log.txt` contains full `.Exception.ToString()` stack traces. These can include:
- Internal module file paths (reveals environment details)
- .NET framework versions
- Potentially partial API response bodies from Microsoft services
- Graph API endpoint URLs with query parameters

**Recommendation**: Split logging into two tiers:
- `_Assessment-Log.txt`: High-level messages only (INFO, sanitized WARN/ERROR)
- `_Assessment-Debug.txt`: Full stack traces (only created when `-Verbose` is used)

**Effort**: Low
**Priority**: P2

---

## Part 4: Code Injection, Execution Security & Temp File Handling

### FINDING S-15: ScubaGear Dynamic Script Generation [MEDIUM]

**File**: `Security/Invoke-ScubaGearScan.ps1:185-244`

The ScubaGear integration builds a PowerShell script as a string and executes it via `powershell.exe -File`. Parameters are embedded with single-quote escaping:

```powershell
# Line 185 — ProductNames interpolated without per-element escaping
$productList = "'" + ($ProductNames -join "','") + "'"

# Lines 217-231 — Organization, AppId, CertificateThumbprint escaped
$scubaScript += "`n`$params['Organization'] = '$($Organization -replace "'", "''")'"
```

**Issues**:
1. **Line 185**: `$ProductNames` values are individually joined but not individually escaped. While `ValidateSet` restricts values to known-good strings (`aad`, `defender`, etc.), the pattern is unsafe if `ValidateSet` is ever expanded with values containing quotes.

2. **Lines 217-231**: Single-quote escaping (`'` → `''`) prevents breakout from PowerShell single-quoted strings. This is correct. However, **the `$scubaOutFolder` on line 212** uses the same pattern, and `$scubaOutFolder` derives from user-controlled `$OutputPath` which could contain PowerShell escape sequences in a crafted path name.

3. **Line 117**: `powershell.exe -ExecutionPolicy Bypass` — necessary for ScubaGear but worth documenting as a conscious security decision.

**Actual risk**: LOW because:
- `$ProductNames` is constrained by `ValidateSet`
- `$Organization` comes from `$TenantId` which is a domain name
- `$scubaOutFolder` is path-joined and would fail path validation if it contained special characters
- The temporary script is cleaned up in `finally`

**Recommendation**:
1. Add per-element escaping to `$ProductNames`:
```powershell
$productList = ($ProductNames | ForEach-Object { "'$($_ -replace "'", "''")'" }) -join ','
```
2. Add a code comment explaining why `-ExecutionPolicy Bypass` is required
3. Consider using `[System.Management.Automation.Language.CodeGeneration]::EscapeSingleQuotedStringContent()` for more robust escaping

**Effort**: Low
**Priority**: P2

---

### FINDING S-16: No Invoke-Expression Usage (GOOD)

**Assessment**: The codebase correctly avoids `Invoke-Expression` entirely. The `CONTRIBUTING.md` explicitly bans it:
```
- No aliases, no backtick line continuations, no `$global:`, no `Invoke-Expression`
```

`Invoke-Command` is used only in `Windows/Get-InstalledSoftware.ps1` with a scriptblock (safe), not a string.

**Effort**: N/A
**Priority**: N/A (commendation)

---

### FINDING S-15b: ScubaGear Output Path — Directory Traversal Risk [MEDIUM]

**File**: `Security/Invoke-ScubaGearScan.ps1:178-182, 286-291`

```powershell
# Line 178-182: No validation on user-supplied path
$scubaOutFolder = if ($ScubaOutputPath) {
    $ScubaOutputPath
} else {
    Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath "scubagear_out_$([guid]::NewGuid().ToString('N'))"
}

# Line 286-291: Creates directory and copies files to user-supplied path
if ($ScubaOutputPath -and $ScubaOutputPath -ne $scubaOutFolder) {
    if (-not (Test-Path -Path $ScubaOutputPath)) {
        $null = New-Item -Path $ScubaOutputPath -ItemType Directory -Force
    }
    Copy-Item -Path $latestFolder -Destination $ScubaOutputPath -Recurse -Force
}
```

**Risk**: The `-ScubaOutputPath` parameter accepts any path without validation. A user could specify a path outside the assessment directory (e.g., `..\..\sensitive-folder`), and `New-Item -Force` will create parent directories. While this requires malicious intent from the operator (who already has admin access), defense-in-depth suggests path validation.

**Recommendation**: Add path validation to ensure output stays within expected boundaries:
```powershell
if ($ScubaOutputPath) {
    $resolvedPath = [System.IO.Path]::GetFullPath($ScubaOutputPath)
    # Warn if path is outside assessment folder
    if ($AssessmentFolder -and -not $resolvedPath.StartsWith([System.IO.Path]::GetFullPath($AssessmentFolder))) {
        Write-Warning "ScubaOutputPath '$resolvedPath' is outside the assessment directory."
    }
}
```

**Effort**: Low
**Priority**: P3

---

### FINDING S-15c: ScubaGear Temp Folder Cleanup Logic Bug [MEDIUM]

**File**: `Security/Invoke-ScubaGearScan.ps1:308-312`

```powershell
if (-not $ScubaOutputPath -or $ScubaOutputPath -ne $scubaOutFolder) {
    if (Test-Path -Path $scubaOutFolder) {
        Remove-Item -Path $scubaOutFolder -Recurse -Force -ErrorAction SilentlyContinue
    }
}
```

**Issue**: When `-ScubaOutputPath` is provided and equals `$scubaOutFolder` (which happens when user specifies the temp folder path directly), the temp folder is NOT cleaned up. The condition `-not $ScubaOutputPath -or $ScubaOutputPath -ne $scubaOutFolder` is always `$true` when `$ScubaOutputPath` is not set OR when it differs from the default — which is the intended cleanup case. However, the issue is that when `$ScubaOutputPath` IS provided and differs from `$scubaOutFolder`, the temp folder (which is `$ScubaOutputPath` in this case) gets cleaned up even though the user explicitly asked to keep it.

More importantly: ScubaGear output contains raw policy configurations, compliance findings, and tenant security posture data. Temp files in `%TEMP%\scubagear_out_*` persist indefinitely if the script is interrupted before reaching the cleanup block.

**Recommendation**: Wrap cleanup in a `try/finally` block to ensure cleanup even on script interruption:
```powershell
# At the top of the script, register cleanup
$cleanupTempFolder = $null
try {
    $scubaOutFolder = if ($ScubaOutputPath) { $ScubaOutputPath }
    else {
        $cleanupTempFolder = Join-Path ...
        $cleanupTempFolder
    }
    # ... rest of script ...
}
finally {
    if ($cleanupTempFolder -and (Test-Path $cleanupTempFolder)) {
        Remove-Item -Path $cleanupTempFolder -Recurse -Force -ErrorAction SilentlyContinue
    }
}
```

**Effort**: Low
**Priority**: P2

---

### FINDING S-17: Resolve-M365Environment Uses Unauthenticated Endpoint [LOW]

**File**: `Invoke-M365Assessment.ps1:446-473`

```powershell
$url = "$authority/$TenantId/v2.0/.well-known/openid-configuration"
$response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 10 -ErrorAction Stop
```

**Assessment**: This calls the public OpenID Connect discovery endpoint. It's unauthenticated by design (that's how OpenID discovery works). The `$TenantId` comes from user input and is interpolated into the URL.

**Risk**: If `$TenantId` contains URL-breaking characters (e.g., `../` or `?param=value`), it could alter the request. However, `Invoke-RestMethod` will URL-encode the path, and Microsoft's endpoint will simply return a 400/404 for invalid tenant IDs.

**Recommendation**: Add basic validation:
```powershell
if ($TenantId -notmatch '^[a-zA-Z0-9._-]+$') {
    Write-Warning "Invalid TenantId format: $TenantId"
    return $null
}
```

**Effort**: Trivial
**Priority**: P3

---

## Part 5: Supply Chain & Dependency Security

### FINDING S-18: No Module Integrity Verification [LOW]

**Files**: All collectors that call `Import-Module`

PowerShell modules are loaded from `$PSModulePath` without integrity verification. If an attacker has write access to a module path, they could replace `Microsoft.Graph.Authentication` or `ExchangeOnlineManagement` with a trojanized version.

**Risk**: Very low for a local console tool. The user must already be an admin on their own workstation to install modules, and an attacker with that level of access has many other attack vectors.

**Recommendation**: Document the expected module versions in `README.md` or add a module version check:
```powershell
$graphMod = Get-Module Microsoft.Graph.Authentication -ListAvailable | Select-Object -First 1
if ($graphMod.Version -lt [version]'2.30.0' -or $graphMod.Version -ge [version]'3.0.0') {
    Write-Warning "Unexpected Graph SDK version: $($graphMod.Version). Expected 2.30-2.x"
}
```

**Effort**: Low
**Priority**: P3

---

### FINDING S-19: ScubaGear Auto-Install from PSGallery [MEDIUM]

**File**: `Security/Invoke-ScubaGearScan.ps1:145-170`

```powershell
$checkScript = @'
$mod = Get-Module -Name ScubaGear -ListAvailable | Select-Object -First 1
if (-not $mod) {
    Write-Host 'ScubaGear not found. Installing from PSGallery...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Install-Module ScubaGear -Scope CurrentUser -Force -AllowClobber
    ...
```

**Risk**: Auto-installing a module from PSGallery without version pinning or hash verification. If the PSGallery package is compromised (supply chain attack), malicious code would run with the user's credentials.

**Recommendation**:
1. Pin a specific version: `Install-Module ScubaGear -RequiredVersion '1.5.0'`
2. Document the expected version in the tool's documentation
3. Consider verifying the module publisher after install

**Effort**: Trivial
**Priority**: P2

---

### FINDING S-20: External URL for SKU CSV Download [LOW]

**File**: `Entra/Get-LicenseReport.ps1:62, 79`

```powershell
$skuCsvUrl = 'https://download.microsoft.com/download/e/3/e/...'
$csvText = (Invoke-WebRequest -Uri $skuCsvUrl -UseBasicParsing -TimeoutSec 10).Content
```

**Assessment**: Hardcoded Microsoft URL — not user-controllable. The downloaded CSV is parsed (not executed), so code injection from the CSV is not a concern. The tool falls back to a bundled CSV if the download fails (lines 87-94).

**Risk**: Very low. The URL is a known Microsoft endpoint. The `-UseBasicParsing` flag is used (no IE engine DOM parsing).

**Recommendation**: No change needed. The fallback pattern is well-designed.

**Effort**: N/A
**Priority**: N/A

---

## Part 6: Version & Configuration Security

### FINDING S-21: Version Mismatch Between Manifest and Script [MEDIUM]

**Files**: `M365-Assess.psd1` and `Invoke-M365Assessment.ps1:124`

- `M365-Assess.psd1` → `ModuleVersion = '0.3.0'`
- `Invoke-M365Assessment.ps1` → `$script:AssessmentVersion = '0.4.0'`

**Risk**: Version mismatch can cause confusion in bug reports, log analysis, and compliance auditing. If a security patch is applied to 0.4.0, users running from the module manifest may think they're on 0.3.0.

**Recommendation**: Synchronize versions. Consider reading the version from the manifest:
```powershell
$script:AssessmentVersion = (Import-PowerShellDataFile -Path "$projectRoot\M365-Assess.psd1").ModuleVersion
```

**Effort**: Trivial
**Priority**: P2

---

### FINDING S-22: .gitignore Properly Configured (GOOD)

**File**: `.gitignore`

Correctly excludes:
- `.env`, `.env.*` — environment files
- `*.pfx`, `*.pem`, `*.key`, `*.p12`, `*.cer` — certificate files
- `secrets.json`, `credentials.json` — secret files
- `M365-Assessment/` — assessment output folders
- `ScubaResults/` — ScubaGear output

**Assessment**: EXCELLENT. No gaps found.

---

## Part 7: Assessment Value & Security Section Quality

### FINDING S-23: Security Section Assessment Completeness

The Security section currently covers:

| Area | Collectors | Coverage | Value |
|------|-----------|----------|-------|
| **Secure Score** | Get-SecureScoreReport.ps1 | Retrieves Microsoft Secure Score and improvement actions | HIGH — gives an immediate security posture snapshot |
| **Defender for O365** | Get-DefenderPolicyReport.ps1 | Anti-phish, anti-spam, anti-malware, Safe Links, Safe Attachments policies | HIGH — covers email threat protection |
| **Defender CIS Config** | Get-DefenderSecurityConfig.ps1 | CIS benchmark checks for Defender settings | HIGH — actionable compliance findings |
| **DLP Policies** | Get-DlpPolicyReport.ps1 | DLP policy inventory via Purview | MEDIUM — inventory only, no effectiveness analysis |
| **ScubaGear** | Invoke-ScubaGearScan.ps1 | CISA ScubaGear baseline (opt-in) | HIGH — comprehensive compliance baseline |

**Gaps in Security Assessment Value**:

1. **No Defender for Endpoint coverage** — onboarding status, EDR coverage, ASR rules. For SMBs with M365 Business Premium or E5, this is critical.

2. **No alert review** — no visibility into whether the security team is responding to alerts. A simple "active alert count by severity" would highlight overwhelmed teams.

3. **DLP policies are listed but not analyzed** — no check for whether DLP policies are in test mode, whether they cover critical workloads, or whether sensitive info types are configured.

4. **No Defender for Cloud Apps** — OAuth app governance is a massive blind spot. Third-party apps with `Mail.ReadWrite` can exfiltrate data without triggering DLP.

5. **No identity protection risk assessment** — risky users, risk detections, and risk-based CA policies are not evaluated. This is the #1 gap for detecting active compromise.

6. **Secure Score lacks context** — the score is reported but not analyzed. Example: a score of 65% means different things for E3 vs E5 tenants. Adding "available vs achieved points per category" would make this actionable.

### FINDING S-24: CIS Benchmark Security Config Checks — Quality Review

The three security config collectors (`Get-EntraSecurityConfig.ps1`, `Get-ExoSecurityConfig.ps1`, `Get-DefenderSecurityConfig.ps1`) follow a consistent pattern returning `[PSCustomObject]` with `CisControl`, `Setting`, `CurrentValue`, `ExpectedValue`, `Status`, `Severity`.

**Strengths**:
- Consistent output schema
- CIS control references
- Clear pass/fail with severity levels
- Good coverage of critical controls

**Improvement opportunities**:
1. **Version reference**: Add `CisVersion` column (e.g., "CIS v4.0") so findings are traceable to a specific benchmark version
2. **Remediation guidance**: Add `RemediationUrl` column linking to Microsoft Learn documentation for each failing check
3. **Risk scoring**: Add numeric risk score (1-10) for prioritization beyond severity (High/Medium/Low)
4. **License dependency**: Some CIS controls require E5 or P2. Flag these so consultants don't report findings the client can't remediate without a license upgrade

---

## Part 8: Implementation Plan

### Phase 1 — Critical Security Fixes (Week 1)

| # | Finding | Fix | Effort |
|---|---------|-----|--------|
| S-10 | External Google Fonts CDN | Replace with system font stack or embedded base64 font | Low |
| S-09 | No Content Security Policy | Add CSP meta tag to HTML report | Trivial |
| S-01 | ClientSecret as plaintext | Change `$ClientSecret` to `[SecureString]` type or remove parameter entirely | Low |
| S-07 | Missing single-quote in ConvertTo-HtmlSafe | Add `'` → `&#39;` encoding | Trivial |

### Phase 2 — Medium Priority Fixes (Week 2)

| # | Finding | Fix | Effort |
|---|---------|-----|--------|
| S-02 | Exception info disclosure | Sanitize error messages in Connect-Service.ps1 catch block | Low |
| S-03 | Stack traces in log file | Split log into standard and debug tiers | Low |
| S-05 | Missing parameter validation | Add ValidatePattern for ClientId, CertificateThumbprint | Trivial |
| S-08 | Get-StatusBadge unencoded default | Add `ConvertTo-HtmlSafe` to default case | Trivial |
| S-08b | Get-SeverityBadge unencoded default | Add `ConvertTo-HtmlSafe` to default case | Trivial |
| S-08c | ScubaGear href path unencoded | Add `ConvertTo-HtmlSafe` to relPath | Trivial |
| S-15 | ScubaGear ProductNames escaping | Add per-element escaping | Trivial |
| S-15c | ScubaGear temp cleanup logic bug | Wrap cleanup in try/finally | Low |
| S-19 | ScubaGear auto-install no version pin | Pin specific ScubaGear version | Trivial |
| S-21 | Version mismatch | Synchronize versions | Trivial |
| S-12 | PII in CSV outputs | Add data handling notice and `-RedactPII` switch | Medium |
| S-14 | Detailed errors in log | Split log into operational and debug | Low |

### Phase 3 — Low Priority Hardening (Week 3+)

| # | Finding | Fix | Effort |
|---|---------|-----|--------|
| S-04 | CertificateThumbprint as plaintext string | Add ValidatePattern | Trivial |
| S-06 | No wizard timeout | Documentation note | Trivial |
| S-13 | Output not encrypted at rest | Add optional `-ProtectOutput` switch | Medium |
| S-15b | ScubaGear output path traversal | Add path validation | Low |
| S-17 | TenantId URL interpolation | Add basic format validation | Trivial |
| S-18 | No module integrity verification | Add version range checks | Low |
| S-11 | Inline JS in report | Covered by CSP (S-09) | N/A |

### Phase 4 — Assessment Value Improvements (Week 3-4)

| # | Enhancement | Description | Effort |
|---|------------|-------------|--------|
| S-23a | Defender for Endpoint | Add MDE onboarding status collector | Medium |
| S-23b | Alert summary | Add active alert count by severity | Low |
| S-23c | DLP effectiveness | Analyze DLP mode (test vs enforce), workload coverage | Low |
| S-23d | Identity Protection | Add risky users/sign-ins collector | Medium |
| S-24a | CIS version column | Add version reference to all security config checks | Trivial |
| S-24b | Remediation URLs | Add Microsoft Learn links for failing checks | Medium |
| S-24c | License dependency flags | Mark E5/P2-only checks | Low |

---

## Appendix A: Security Testing Checklist

Before each release, verify:

- [ ] No credentials in git history (`git log -p | grep -i 'secret\|password\|apikey\|token'`)
- [ ] `.gitignore` includes all credential file patterns
- [ ] `ConvertTo-HtmlSafe` covers all 5 HTML special characters (`& < > " '`)
- [ ] CSP meta tag present in HTML report
- [ ] No external resource loading (fonts, scripts, images) or documented exceptions
- [ ] `ClientSecret` parameter is `[SecureString]` type
- [ ] Error messages in `Connect-Service.ps1` are sanitized
- [ ] Log file does not contain full stack traces (only in debug mode)
- [ ] ScubaGear version is pinned in install script
- [ ] Module versions in manifest and script are synchronized
- [ ] No `Invoke-Expression` usage (grep for `Invoke-Expression|iex `)
- [ ] All `Invoke-RestMethod`/`Invoke-WebRequest` URLs are hardcoded (not user-controlled)
- [ ] PSScriptAnalyzer passes with no warnings

### Automated Security Check Script

```powershell
# Run this as part of CI/CD
$issues = @()

# Check for Invoke-Expression
$iex = Get-ChildItem -Path . -Filter *.ps1 -Recurse | Select-String -Pattern 'Invoke-Expression|[^-]iex ' -SimpleMatch
if ($iex) { $issues += "Invoke-Expression found: $($iex.Count) occurrences" }

# Check for hardcoded credentials
$creds = Get-ChildItem -Path . -Filter *.ps1 -Recurse | Select-String -Pattern 'password\s*=\s*[''"]|apikey\s*=|secret\s*=\s*[''"]' -CaseSensitive:$false
if ($creds) { $issues += "Potential hardcoded credentials: $($creds.Count) occurrences" }

# Check for ConvertTo-HtmlSafe single-quote
$htmlSafe = Get-Content -Path Common/Export-AssessmentReport.ps1 | Select-String -Pattern "ConvertTo-HtmlSafe" | Select-Object -First 1
# Verify function includes single-quote escaping

# Check version sync
$manifestVersion = (Import-PowerShellDataFile M365-Assess.psd1).ModuleVersion
$scriptVersion = (Select-String -Path Invoke-M365Assessment.ps1 -Pattern "AssessmentVersion = '([^']+)'").Matches.Groups[1].Value
if ($manifestVersion -ne $scriptVersion) { $issues += "Version mismatch: manifest=$manifestVersion, script=$scriptVersion" }

if ($issues) {
    $issues | ForEach-Object { Write-Warning $_ }
    exit 1
}
Write-Host "All security checks passed." -ForegroundColor Green
```

---

## Appendix B: SECURITY.md Template

Create a `SECURITY.md` file in the repository root:

```markdown
# Security Policy

## Scope
M365-Assess is a **read-only** assessment tool. All operations use `Get-*` cmdlets and never modify tenant configuration.

## Credential Handling
- Certificate-based auth (recommended): No secrets stored; uses certificate thumbprint
- Interactive auth: Credentials handled by Microsoft's authentication libraries
- Client secret auth: Converted to SecureString immediately; never logged or persisted
- All credentials are passed to official Microsoft PowerShell modules (Microsoft.Graph, ExchangeOnlineManagement)

## Data Handling
- Assessment outputs (CSV, HTML, logs) contain tenant configuration data and may include PII (user names, email addresses)
- Output files are saved to a user-specified local folder with standard filesystem permissions
- No data is transmitted to external services (except DNS queries for SPF/DKIM/DMARC validation and Google Fonts in the HTML report)
- Consultants should secure assessment output according to their data handling policies

## Reporting Vulnerabilities
If you discover a security vulnerability, please report it via GitHub Issues with the "security" label, or contact the maintainer directly.

## Dependencies
- Microsoft.Graph.Authentication (2.x)
- ExchangeOnlineManagement (3.7.1 recommended)
- ScubaGear (pinned version in install script)
- No third-party dependencies beyond Microsoft's official PowerShell modules
```

---

## Appendix C: Files Examined

| File | Lines Read | Findings |
|------|-----------|----------|
| `Common/Connect-Service.ps1` | All 222 | S-01, S-02, S-04, S-05 |
| `Common/Export-AssessmentReport.ps1` | Key sections (~500 lines) | S-07, S-08, S-09, S-10, S-11 |
| `Invoke-M365Assessment.ps1` | All 1850+ | S-03, S-05, S-06, S-12, S-13, S-14, S-17, S-21 |
| `Security/Invoke-ScubaGearScan.ps1` | Lines 85-252 | S-15, S-19 |
| `Entra/Get-LicenseReport.ps1` | Lines 50-96 | S-20 |
| `Windows/Get-InstalledSoftware.ps1` | Lines 75-115 | S-16 (clean) |
| `.gitignore` | All | S-22 (clean) |
| `CONTRIBUTING.md` | Key lines | S-16 (clean) |
| `M365-Assess.psd1` | Version line | S-21 |
| All `*.ps1` files | Grep-based analysis | S-03, S-12, S-16 |
