<#
.SYNOPSIS
    Graph request wrapper with pagination and transient-error retry.
.DESCRIPTION
    Drop-in replacement for Invoke-MgGraphRequest on list endpoints. Follows
    @odata.nextLink until the collection is exhausted (bounded by -MaxPages)
    and retries transient Graph failures (429 throttling, 503/504) with
    exponential backoff, honoring the Retry-After header when present.

    Collection responses return a hashtable whose 'value' key holds the merged
    items from every page (other top-level keys are carried over from the first
    page). Non-collection responses (no 'value' property) pass through
    unchanged, so the helper is safe for single-object GETs too.

    Without this wrapper, raw Invoke-MgGraphRequest calls silently truncate at
    the server page size — a tenant with more apps/policies/users than one page
    yields incomplete assessment results (#952).
.PARAMETER Uri
    Graph URI (relative like '/v1.0/applications?$top=999' or absolute).
.PARAMETER Method
    HTTP method. Pagination only applies to GET; POST is supported for parity
    so call sites can migrate uniformly.
.PARAMETER Body
    Optional request body, passed through to Invoke-MgGraphRequest.
.PARAMETER MaxPages
    Safety cap on pages followed (default 100). A warning is written when the
    cap is hit so truncation is never silent.
.PARAMETER MaxRetries
    Retries per page for transient errors (default 4; ~2/4/8/16s backoff).
.EXAMPLE
    $response = Invoke-SafeGraphRequest -Uri '/v1.0/applications?$select=id,appId&$top=999'
    $apps = $response.value   # complete across all pages
#>
function Invoke-SafeGraphRequest {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Uri,

        [Parameter()]
        [ValidateSet('GET', 'POST')]
        [string]$Method = 'GET',

        [Parameter()]
        [object]$Body,

        [Parameter()]
        [ValidateRange(1, 1000)]
        [int]$MaxPages = 100,

        [Parameter()]
        [ValidateRange(0, 8)]
        [int]$MaxRetries = 4
    )

    $allValues = [System.Collections.Generic.List[object]]::new()
    $firstPage = $null
    $currentUri = $Uri
    $pageCount = 0

    while ($currentUri) {
        $pageCount++
        if ($pageCount -gt $MaxPages) {
            Write-Warning "Invoke-SafeGraphRequest: page cap ($MaxPages) reached for '$Uri' — results may be incomplete. Raise -MaxPages if the tenant legitimately has more data."
            break
        }

        $attempt = 0
        $response = $null
        while ($true) {
            try {
                $requestParams = @{ Uri = $currentUri; Method = $Method; ErrorAction = 'Stop' }
                if ($null -ne $Body) { $requestParams['Body'] = $Body }
                $response = Invoke-MgGraphRequest @requestParams
                break
            } catch {
                $attempt++
                $delay = Get-GraphRetryDelay -ErrorRecord $_ -Attempt $attempt
                if ($null -eq $delay -or $attempt -gt $MaxRetries) { throw }
                Write-Verbose "Invoke-SafeGraphRequest: transient Graph error (attempt $attempt of $MaxRetries), retrying in ${delay}s: $($_.Exception.Message)"
                Start-Sleep -Seconds $delay
            }
        }

        if ($null -eq $firstPage) { $firstPage = $response }

        # Non-collection response: nothing to merge, return as-is.
        $hasValue = if ($response -is [hashtable]) { $response.ContainsKey('value') }
                    else { $null -ne $response.PSObject.Properties['value'] }
        if (-not $hasValue) {
            if ($pageCount -eq 1) { return $response }
            break
        }

        foreach ($item in @($response.value)) { $allValues.Add($item) }

        $currentUri = if ($response -is [hashtable]) { $response['@odata.nextLink'] }
                      else { $response.'@odata.nextLink' }
    }

    # Rebuild the familiar response shape: first page's metadata + merged value.
    $result = @{}
    if ($firstPage -is [hashtable]) {
        foreach ($key in $firstPage.Keys) {
            if ($key -ne 'value' -and $key -ne '@odata.nextLink') { $result[$key] = $firstPage[$key] }
        }
    }
    $result['value'] = $allValues
    return $result
}

<#
.SYNOPSIS
    Computes the retry delay for a transient Graph error, or $null if the
    error is not retryable.
.DESCRIPTION
    Inspects an ErrorRecord from Invoke-MgGraphRequest. Returns a delay in
    seconds for 429/503/504 responses — from the Retry-After header when the
    response exposes one, otherwise exponential backoff (2^attempt, capped at
    60s). Returns $null for non-transient errors so callers rethrow instead of
    retrying permission or request failures.
.PARAMETER ErrorRecord
    The caught ErrorRecord.
.PARAMETER Attempt
    1-based retry attempt number, used for the backoff exponent.
.EXAMPLE
    $delay = Get-GraphRetryDelay -ErrorRecord $_ -Attempt 2
#>
function Get-GraphRetryDelay {
    [CmdletBinding()]
    [OutputType([System.Nullable[int]])]
    param(
        [Parameter(Mandatory)]
        [System.Management.Automation.ErrorRecord]$ErrorRecord,

        [Parameter(Mandatory)]
        [int]$Attempt
    )

    $statusCode = 0
    $exception = $ErrorRecord.Exception
    if ($exception.PSObject.Properties['Response'] -and $exception.Response) {
        try { $statusCode = [int]$exception.Response.StatusCode } catch { $statusCode = 0 }
    }
    if ($statusCode -eq 0 -and $exception.Message -match 'TooManyRequests|throttl|\b429\b') {
        $statusCode = 429
    } elseif ($statusCode -eq 0 -and $exception.Message -match 'ServiceUnavailable|\b503\b') {
        $statusCode = 503
    } elseif ($statusCode -eq 0 -and $exception.Message -match 'GatewayTimeout|\b504\b') {
        $statusCode = 504
    }

    if ($statusCode -notin @(429, 503, 504)) { return $null }

    # Honor Retry-After when the response surfaces it.
    try {
        $retryAfter = $exception.Response.Headers.RetryAfter
        if ($retryAfter -and $retryAfter.Delta) {
            return [int]([math]::Ceiling($retryAfter.Delta.TotalSeconds) + 1)
        }
    } catch {
        Write-Debug 'Get-GraphRetryDelay: no readable Retry-After header; using exponential backoff.'
    }

    return [int][math]::Min([math]::Pow(2, $Attempt), 60)
}
