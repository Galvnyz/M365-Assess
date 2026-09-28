function Invoke-GraphReadBatch {
    <#
    .SYNOPSIS
        Resolves independent single-object Graph GETs in batches of at most 20.
    .DESCRIPTION
        Returns responses keyed by request ID, irrespective of response order.
        Retries only throttled/transient subrequests. Permanent failures remain
        explicit HTTP responses so callers can retain unresolved values. Rejects
        missing/duplicate responses and paginated bodies rather than losing data.
    .PARAMETER Requests
        Objects with unique id and relative url (without /v1.0); GET only.
    .PARAMETER MaxRetries
        Maximum retries for each transient subresponse, in addition to retries
        handled by Invoke-SafeGraphRequest for the outer batch request.
    .EXAMPLE
        Invoke-GraphReadBatch -Requests @(@{ id='user1'; url='/users/user1?$select=id' })
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Requests,
        [ValidateRange(0, 8)][int]$MaxRetries = 4
    )
    $result = @{}
    $ids = @{}
    foreach ($request in $Requests) {
        if (-not $request.id -or $ids.ContainsKey([string]$request.id)) {
            throw 'Graph batch request IDs must be nonempty and unique.'
        }
        if ($request.url -notmatch '^/[^/]' -or $request.url -match '^/(v1\.0|beta)/' -or
            ($request.method -and $request.method -ne 'GET')) {
            throw 'Graph read batches accept only GETs with relative unversioned URLs.'
        }
        $ids[[string]$request.id] = $true
    }
    for ($offset = 0; $offset -lt $Requests.Count; $offset += 20) {
        $last = [Math]::Min($offset + 19, $Requests.Count - 1)
        $pending = @($Requests[$offset..$last] | ForEach-Object {
            @{ id = [string]$_.id; method = 'GET'; url = $_.url }
        })
        $attempt = 0
        while ($pending.Count -gt 0) {
            $payload = @{ requests = @($pending) } | ConvertTo-Json -Depth 8 -Compress
            $batch = Invoke-SafeGraphRequest -Uri '/v1.0/$batch' -Method POST -Body $payload -Headers @{ 'Content-Type' = 'application/json' }
            $responses = @{}
            foreach ($response in $batch.responses) {
                $id = [string]$response.id
                if (-not $id -or $responses.ContainsKey($id) -or $id -notin $pending.id -or
                    -not $response.status -or [int]$response.status -lt 100 -or [int]$response.status -gt 599) {
                    throw 'GraphBatchIncomplete: invalid or duplicate subresponse.'
                }
                $responses[$id] = $response
            }
            if ($responses.Count -ne $pending.Count) { throw 'GraphBatchIncomplete: missing subresponse.' }
            $retry = [System.Collections.Generic.List[object]]::new()
            $delay = [Math]::Pow(2, $attempt + 1)
            foreach ($request in $pending) {
                $response = $responses[$request.id]
                if ([int]$response.status -in @(429, 503, 504) -and $attempt -lt $MaxRetries) {
                    $retry.Add($request)
                    $seconds = 0
                    $retryAfter = [string]$response.headers.'Retry-After'
                    if ([int]::TryParse($retryAfter, [ref]$seconds) -and $seconds -ge 0) {
                        $delay = [Math]::Max($delay, $seconds)
                    } elseif ($retryAfter) {
                        $retryDate = [datetimeoffset]::MinValue
                        if ([datetimeoffset]::TryParse($retryAfter, [ref]$retryDate)) {
                            $delay = [Math]::Max($delay, [Math]::Ceiling(($retryDate - [datetimeoffset]::UtcNow).TotalSeconds))
                        }
                    }
                } else {
                    if ([int]$response.status -ge 200 -and [int]$response.status -lt 300 -and
                        ($null -eq $response.body -or $response.body.'@odata.nextLink')) {
                        throw 'GraphBatchIncomplete: expected a complete single-object response.'
                    }
                    $result[$request.id] = $response
                }
            }
            $pending = @($retry.ToArray())
            if ($pending.Count -gt 0) { Start-Sleep -Seconds $delay }
            $attempt++
        }
    }
    return $result
}
