<#
.SYNOPSIS
    Deterministic PII redaction rules for the sanitized evidence package (D4 #788).
.DESCRIPTION
    Pure function module. Provides Invoke-RedactionRules for stripping
    user-identifiable information from arbitrary text content while preserving
    join keys via SHA-256-truncated tokens.

    Replacements use stable hashes: the same UPN always produces the same
    <user-xxxxxxxx> token across all artifacts in the package. This lets an
    auditor still see correlations ("user-a3f81b29 fails MFA on CA-001 and has
    admin role on ROLE-001") without ever seeing the underlying UPN.

    Categories redacted:
      - UPNs / email addresses        -> <user-{hash}>
      - IPv4 / IPv6 addresses         -> <ip-{hash}>
      - Application/Tenant GUIDs      -> <guid-{hash}>  (preserves GUID structure)

    Tenant display name is redacted via -TenantDisplayName param when the
    caller knows it; we don't try to discover it from text alone since
    "Contoso" inside a control description shouldn't be touched.
.NOTES
    Without -Salt the token is SHA-256(value) truncated to 8 hex chars. That
    form is deterministic across packages, which also means anyone who can
    guess a UPN (the tenant domain is usually known) can confirm the guess by
    hashing it. Callers that produce shareable output should pass -Salt (see
    New-RedactionSalt): the token then becomes HMAC-SHA-256(salt, value)
    truncated to 16 hex chars. Tokens stay stable within one package, so join
    keys survive, but cannot be reversed or correlated across packages
    because the salt is never written anywhere.
#>

function New-RedactionSalt {
    <#
    .SYNOPSIS
        Returns 32 random bytes for use as a per-package redaction salt.
    .EXAMPLE
        $salt = New-RedactionSalt
    #>
    [CmdletBinding()]
    [OutputType([byte[]])]
    param()
    $bytes = [byte[]]::new(32)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return , $bytes
}

function Get-RedactionToken {
    <#
    .SYNOPSIS
        Returns a deterministic redaction token for a single value.
    .PARAMETER Value
        The plaintext value to redact.
    .PARAMETER Prefix
        Token prefix (e.g. 'user', 'ip', 'guid').
    .PARAMETER Salt
        Optional key. When supplied the token is an HMAC-SHA-256 truncated to
        16 hex chars instead of a plain SHA-256 truncated to 8.
    .OUTPUTS
        String of the form '<{prefix}-{hex chars}>'.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$Value,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Prefix,

        [Parameter()]
        [byte[]]$Salt
    )
    if ([string]::IsNullOrEmpty($Value)) { return "<$Prefix-empty>" }
    if ($Salt -and $Salt.Length -gt 0) {
        $hmac = [System.Security.Cryptography.HMACSHA256]::new($Salt)
        try {
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value.ToLowerInvariant())
            $hash  = $hmac.ComputeHash($bytes)
            $hex   = -join ($hash[0..7] | ForEach-Object { $_.ToString('x2') })
            return "<$Prefix-$hex>"
        }
        finally {
            $hmac.Dispose()
        }
    }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value.ToLowerInvariant())
        $hash  = $sha.ComputeHash($bytes)
        $hex   = -join ($hash[0..3] | ForEach-Object { $_.ToString('x2') })
        return "<$Prefix-$hex>"
    }
    finally {
        $sha.Dispose()
    }
}

function Invoke-RedactionRules {
    <#
    .SYNOPSIS
        Applies the full PII redaction ruleset to a string of text.
    .PARAMETER Text
        Input text. Returned unchanged if empty or null.
    .PARAMETER TenantDisplayName
        Optional. When provided, all case-insensitive occurrences of the
        tenant display name are replaced with <tenant>.
    .PARAMETER Salt
        Optional per-package salt from New-RedactionSalt. See Get-RedactionToken.
    .OUTPUTS
        Redacted string.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [AllowNull()]
        [string]$Text,

        [Parameter()]
        [string]$TenantDisplayName,

        [Parameter()]
        [byte[]]$Salt
    )
    if ([string]::IsNullOrEmpty($Text)) { return $Text }
    $result = $Text

    # Email / UPN pass FIRST. Running tenant-name first would eat the domain
    # portion of any email containing the tenant name (admin@contoso.com ->
    # admin@<tenant>.com), leaving the address half-redacted and undetectable
    # by later regexes. Replacing the whole address with <user-{hash}> first
    # neutralises that risk.
    $emailPattern = '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
    $result = [regex]::Replace($result, $emailPattern, {
        param($m) Get-RedactionToken -Value $m.Value -Prefix 'user' -Salt $Salt
    })

    # Tenant display name pass -- runs after email so only bare mentions in
    # narrative text are caught. Case-insensitive.
    if (-not [string]::IsNullOrWhiteSpace($TenantDisplayName)) {
        $escaped = [regex]::Escape($TenantDisplayName)
        $result = [regex]::Replace($result, $escaped, '<tenant>', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    }

    # IPv4 (4 octets 0-255). Anchored to word boundaries to avoid matching
    # version strings like 1.2.3.4 inside paths.
    $ipv4Pattern = '\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|\d{1,2})\b'
    $result = [regex]::Replace($result, $ipv4Pattern, {
        param($m) Get-RedactionToken -Value $m.Value -Prefix 'ip' -Salt $Salt
    })

    # IPv6: full form (8 colon-separated segments) OR compact form (any
    # segments + :: + any segments). Loose -- catches common shapes without
    # enforcing full RFC 4291 validity.
    $ipv6Full    = '(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}'
    $ipv6Compact = '(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*)?::(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*)?'
    $ipv6Pattern = "(?:$ipv6Full|$ipv6Compact)"
    $result = [regex]::Replace($result, $ipv6Pattern, {
        param($m)
        # Skip false positives: pure '::', single-token, or no hex digits.
        $v = $m.Value
        if ($v -eq '::' -or $v.Length -lt 3) { return $v }
        if ($v -notmatch '[0-9a-fA-F]')      { return $v }
        Get-RedactionToken -Value $v -Prefix 'ip' -Salt $Salt
    })

    # GUIDs (8-4-4-4-12). Preserve the structural shape so consumers can still
    # spot "this is a GUID" while not seeing the value. Token is shorter than
    # a real GUID, so it's visually distinct.
    $guidPattern = '\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b'
    $result = [regex]::Replace($result, $guidPattern, {
        param($m) Get-RedactionToken -Value $m.Value -Prefix 'guid' -Salt $Salt
    })

    return $result
}

function ConvertTo-RedactedJson {
    <#
    .SYNOPSIS
        Applies the redaction ruleset to every string value in a JSON document.
    .DESCRIPTION
        Parses the JSON, redacts each string value individually and serialises
        the result. Working on parsed values (not on the raw text) means an
        escape sequence next to an address cannot be half-consumed by a regex,
        and the output is always valid JSON. Property names are left as they
        are. The serialiser escapes '<', '>', '&' and quotes as \uXXXX, so the
        output is safe to embed in an HTML script element.
    .PARAMETER Json
        A JSON document (object or array).
    .PARAMETER TenantDisplayName
        Optional tenant display name to replace with <tenant>.
    .PARAMETER Salt
        Optional per-package salt from New-RedactionSalt.
    .PARAMETER ForFile
        Write indented JSON with readable '<' and '>' for a standalone .json
        file. Do NOT use for JSON that will be embedded in HTML.
    .OUTPUTS
        Redacted JSON string.
    .EXAMPLE
        ConvertTo-RedactedJson -Json $json -TenantDisplayName 'Contoso' -Salt $salt
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Json,

        [Parameter()]
        [string]$TenantDisplayName,

        [Parameter()]
        [byte[]]$Salt,

        [Parameter()]
        [switch]$ForFile
    )

    $root = [System.Text.Json.Nodes.JsonNode]::Parse($Json)
    $stringKind = [System.Text.Json.JsonValueKind]::String

    # Iterative walk: report data can be deep and wide, so avoid recursion.
    $stack = [System.Collections.Generic.Stack[object]]::new()
    $stack.Push($root)
    while ($stack.Count -gt 0) {
        $node = $stack.Pop()
        $keys = if ($node -is [System.Text.Json.Nodes.JsonObject]) {
            @(foreach ($pair in $node) { $pair.Key })
        }
        elseif ($node -is [System.Text.Json.Nodes.JsonArray]) {
            @(0..($node.Count - 1) | Where-Object { $node.Count -gt 0 })
        }
        else {
            @()
        }

        foreach ($key in $keys) {
            $child = $node[$key]
            if ($null -eq $child) { continue }
            if ($child -isnot [System.Text.Json.Nodes.JsonValue]) {
                $stack.Push($child)
                continue
            }
            if ($child.GetValueKind() -ne $stringKind) { continue }

            $original = $child.ToString()
            $redacted = Invoke-RedactionRules -Text $original -TenantDisplayName $TenantDisplayName -Salt $Salt
            if ($redacted -cne $original) {
                $node[$key] = [System.Text.Json.Nodes.JsonValue]::Create([string]$redacted)
            }
        }
    }

    if ($ForFile) {
        $options = [System.Text.Json.JsonSerializerOptions]::new()
        $options.WriteIndented = $true
        $options.Encoder = [System.Text.Encodings.Web.JavaScriptEncoder]::UnsafeRelaxedJsonEscaping
        return $root.ToJsonString($options)
    }
    return $root.ToJsonString()
}

function ConvertTo-RedactedReportHtml {
    <#
    .SYNOPSIS
        Redacts the embedded data of an M365-Assess HTML report.
    .DESCRIPTION
        The report is a single file: a JSON data island
        ('window.REPORT_DATA = {...};') followed by the inlined React bundle
        and CSS. Only the data island carries tenant data, and only it is
        rewritten. Running the text rules over the whole file would corrupt
        the bundle (the IPv6 pattern matches CSS such as 'a::before').

        Returns $null when the data island cannot be located or parsed. The
        caller must then leave the report out; an unredacted report is never
        returned.
    .PARAMETER Html
        Full text of the HTML report.
    .PARAMETER TenantDisplayName
        Optional tenant display name to replace with <tenant>.
    .PARAMETER Salt
        Optional per-package salt from New-RedactionSalt.
    .OUTPUTS
        Redacted HTML string, or $null when redaction was not possible.
    .EXAMPLE
        ConvertTo-RedactedReportHtml -Html $html -Salt $salt
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$Html,

        [Parameter()]
        [string]$TenantDisplayName,

        [Parameter()]
        [byte[]]$Salt
    )

    # '<' is always escaped inside the island, so the first ';</script>' after
    # the assignment is the real end of the data.
    $pattern = '(?s)(<script[^>]*>\s*window\.REPORT_DATA\s*=\s*)(.*?)(;\s*</script>)'
    $match = [regex]::Match($Html, $pattern)
    if (-not $match.Success) { return $null }

    $island = $match.Groups[2]
    try {
        $redactedJson = ConvertTo-RedactedJson -Json $island.Value -TenantDisplayName $TenantDisplayName -Salt $Salt
    }
    catch {
        Write-Verbose "Report data island could not be parsed for redaction: $_"
        return $null
    }

    $result = $Html.Substring(0, $island.Index) + $redactedJson + $Html.Substring($island.Index + $island.Length)

    # The page title is the only other place tenant text is written.
    $titleMatch = [regex]::Match($result, '(?s)(?<=<title>)(.*?)(?=</title>)')
    if ($titleMatch.Success -and $titleMatch.Length -gt 0) {
        $safeTitle = Invoke-RedactionRules -Text $titleMatch.Value -TenantDisplayName $TenantDisplayName -Salt $Salt
        $result = $result.Substring(0, $titleMatch.Index) + $safeTitle + $result.Substring($titleMatch.Index + $titleMatch.Length)
    }
    return $result
}
