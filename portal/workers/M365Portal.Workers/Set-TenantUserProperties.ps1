# Set-TenantUserProperties.ps1 — EPIC-011 bulk patch wizard worker (SPEC §3.3, §4.2 US-3).
#
# Applies planned property patches live against Graph with a per-user
# before/after diff: only properties that would actually change are written,
# and only changed rows appear in the result. A row that is invalid or fails
# at apply time is reported per row without aborting siblings; an invalid row
# is never written. -DryRun (preview) returns the diff with no tenant write.
#
# Gating (EPIC-006 contract, T-0107): property patches are not registry
# CheckId commands, so they follow the executor contract instead of its
# CheckId-bound path — the BFF previews before confirming (preview plans
# only), -DryRun reports the intended change without writing, every applied
# row captures before and after, and every applied row emits one audit record
# through -WriteAudit. The Graph session is connected by the supervisor after
# materializing the tenant credential in-process; this file never touches
# secrets.

function Get-PatchableUserProperty {
    <#
    .SYNOPSIS
        Returns the property catalogue the patch worker accepts.
    .DESCRIPTION
        Mirrors portal/bff/src/domain/users/patch.ts. A property outside this
        catalogue is a validation failure, never a silent skip.
    .EXAMPLE
        Get-PatchableUserProperty
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param()

    return @('displayName', 'givenName', 'surname', 'department', 'jobTitle', 'officeLocation', 'mobilePhone', 'usageLocation')
}

function Test-TenantUserPatchInput {
    <#
    .SYNOPSIS
        Validates one row of desired properties against the catalogue.
    .DESCRIPTION
        Rejects unknown properties, non-string values, and malformed usage
        locations. Returns the error list; an empty list is valid.
    .PARAMETER Properties
        Desired property values (string or null; blank clears to null).
    .EXAMPLE
        Test-TenantUserPatchInput -Properties @{ department = 'Finance' }
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)]
        [object]$Properties
    )

    $errors = [System.Collections.Generic.List[string]]::new()
    if ($Properties -isnot [System.Collections.IDictionary]) {
        $errors.Add('properties must be an object')
        return @($errors)
    }
    $allowed = Get-PatchableUserProperty
    foreach ($key in @($Properties.Keys)) {
        $name = [string]$key
        if (-not $allowed.Contains($name)) {
            $errors.Add("property '$name' cannot be patched; patchable: $($allowed -join ', ')")
            continue
        }
        $value = $Properties[$key]
        if ($null -ne $value -and $value -isnot [string]) {
            $errors.Add("property '$name' must be a string or null")
            continue
        }
        if ($name -eq 'usageLocation' -and [string]$value -ne '' -and ([string]$value).Trim() -notmatch '^[A-Za-z]{2}$') {
            $errors.Add("usageLocation '$(([string]$value).Trim())' must be a 2-letter country code")
        }
    }
    if ($Properties.Count -eq 0 -and $errors.Count -eq 0) {
        $errors.Add('properties must include at least one patchable property')
    }
    return @($errors)
}

function Get-TenantUserPatchState {
    <#
    .SYNOPSIS
        Reads the current patchable property values for diffing.
    .DESCRIPTION
        GETs the live user and shapes the catalogue fields. A missing user
        returns null so the caller can fail the row with a clear error.
    .PARAMETER UserId
        The target user id.
    .EXAMPLE
        Get-TenantUserPatchState -UserId 'user-1'
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UserId
    )

    try {
        $select = 'id,displayName,givenName,surname,department,jobTitle,officeLocation,mobilePhone,usageLocation'
        $user = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/users/$UserId?`$select=$select"
        if ($null -eq $user) {
            return $null
        }
        $state = [ordered]@{ id = [string]$user.id }
        foreach ($name in (Get-PatchableUserProperty)) {
            $raw = [string]$user.$name
            if ($raw.Trim().Length -gt 0) {
                $state[$name] = $raw
            }
            else {
                $state[$name] = $null
            }
        }
        return [pscustomobject]$state
    }
    catch {
        return $null
    }
}

function Compare-TenantUserPatch {
    <#
    .SYNOPSIS
        Diffs desired properties against current state.
    .DESCRIPTION
        Mirrors computeUserPatchDiff in patch.ts: only properties whose
        normalized value would change are returned. Blank desired values clear
        to null.
    .PARAMETER Before
        Current state from Get-TenantUserPatchState.
    .PARAMETER Properties
        Desired property values.
    .EXAMPLE
        Compare-TenantUserPatch -Before $before -Properties @{ department = 'Finance' }
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject[]])]
    param(
        [Parameter(Mandatory)]
        [object]$Before,

        [Parameter(Mandatory)]
        [object]$Properties
    )

    $diffs = [System.Collections.Generic.List[object]]::new()
    foreach ($name in (Get-PatchableUserProperty)) {
        if ($Properties -is [System.Collections.IDictionary] -and $Properties.Contains($name)) {
            $raw = $Properties[$name]
            $wanted = $null
            if ($null -ne $raw -and ([string]$raw).Trim().Length -gt 0) {
                $wanted = ([string]$raw).Trim()
            }
            $current = $null
            if ($null -ne $Before.$name -and ([string]$Before.$name).Trim().Length -gt 0) {
                $current = ([string]$Before.$name).Trim()
            }
            if ($current -ne $wanted) {
                $diffs.Add([pscustomobject]@{ property = $name; before = $current; after = $wanted })
            }
        }
    }
    return @($diffs)
}

function Set-TenantUserProperties {
    <#
    .SYNOPSIS
        Patches one user's properties live against Graph with diff capture.
    .DESCRIPTION
        Validates the desired properties, reads current state, and PATCHes
        only the properties that would change. -DryRun (preview) returns the
        diff with no Graph write. Returns a per-row result with the diff plus
        before/after snapshots; apply failures are returned, not thrown.
    .PARAMETER TenantId
        Tenant the user belongs to. Carried through to the result envelope.
    .PARAMETER UserId
        The target user id.
    .PARAMETER Properties
        Desired property values (string or null; blank clears to null).
    .PARAMETER DryRun
        Report the diff without writing to the tenant.
    .PARAMETER Actor
        Caller identity recorded on the audit event.
    .PARAMETER CorrelationId
        Correlation id recorded on the audit event.
    .PARAMETER WriteAudit
        Seam: scriptblock (event) -> void. Defaults to a no-op.
    .EXAMPLE
        Set-TenantUserProperties -TenantId 'tenant-a' -UserId 'user-1' -Properties @{ department = 'Finance' } -DryRun
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UserId,

        [Parameter(Mandatory)]
        [object]$Properties,

        [Parameter()]
        [switch]$DryRun,

        [Parameter()]
        [string]$Actor = '',

        [Parameter()]
        [string]$CorrelationId = '',

        [Parameter()]
        [scriptblock]$WriteAudit = { param($AuditEvent) }
    )

    $failures = @(Test-TenantUserPatchInput -Properties $Properties)
    if ($failures.Count -gt 0) {
        return [pscustomobject]@{
            userId = $UserId
            status = 'failed'
            diffs  = @()
            before = $null
            after  = $null
            error  = ($failures -join '; ')
        }
    }

    $before = Get-TenantUserPatchState -UserId $UserId
    if ($null -eq $before) {
        return [pscustomobject]@{
            userId = $UserId
            status = 'failed'
            diffs  = @()
            before = $null
            after  = $null
            error  = "user '$UserId' was not found"
        }
    }

    $diffs = @(Compare-TenantUserPatch -Before $before -Properties $Properties)
    if ($DryRun) {
        return [pscustomobject]@{
            userId = $UserId
            status = 'previewed'
            diffs  = $diffs
            before = $before
            after  = $before
            error  = $null
        }
    }

    try {
        $patchBody = @{}
        foreach ($diff in $diffs) {
            $patchBody[$diff.property] = $diff.after
        }
        if ($patchBody.Count -gt 0) {
            $null = Invoke-MgGraphRequest -Method PATCH -Uri "/v1.0/users/$UserId" -Body ($patchBody | ConvertTo-Json -Depth 5)
            $after = Get-TenantUserPatchState -UserId $UserId
            if ($null -eq $after) {
                $after = $before
            }
        }
        else {
            $after = $before
        }
        $null = & $WriteAudit @{
            tenantId      = $TenantId
            action        = 'users.patch'
            userId        = $UserId
            result        = 'success'
            error         = $null
            before        = $before
            after         = $after
            actor         = $Actor
            correlationId = $CorrelationId
        }
        return [pscustomobject]@{
            userId = $UserId
            status = 'patched'
            diffs  = $diffs
            before = $before
            after  = $after
            error  = $null
        }
    }
    catch {
        $message = $_.Exception.Message
        $null = & $WriteAudit @{
            tenantId      = $TenantId
            action        = 'users.patch'
            userId        = $UserId
            result        = 'failure'
            error         = $message
            before        = $before
            after         = $null
            actor         = $Actor
            correlationId = $CorrelationId
        }
        return [pscustomobject]@{
            userId = $UserId
            status = 'failed'
            diffs  = $diffs
            before = $before
            after  = $null
            error  = $message
        }
    }
}

function Set-TenantUserBulkProperties {
    <#
    .SYNOPSIS
        Patches planned users one by one with per-row results.
    .DESCRIPTION
        Calls Set-TenantUserProperties per row inside its own trap so a row
        that is invalid or fails at apply time is reported per row without
        aborting siblings.
    .PARAMETER TenantId
        Tenant the users belong to.
    .PARAMETER Patches
        Planned rows exposing userId and properties.
    .PARAMETER DryRun
        Report each diff without writing to the tenant.
    .PARAMETER Actor
        Caller identity recorded on each audit event.
    .PARAMETER CorrelationId
        Correlation id recorded on each audit event.
    .PARAMETER WriteAudit
        Seam: scriptblock (event) -> void. Defaults to a no-op.
    .EXAMPLE
        Set-TenantUserBulkProperties -TenantId 'tenant-a' -Patches $patches
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject[]])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$Patches,

        [Parameter()]
        [switch]$DryRun,

        [Parameter()]
        [string]$Actor = '',

        [Parameter()]
        [string]$CorrelationId = '',

        [Parameter()]
        [scriptblock]$WriteAudit = { param($AuditEvent) }
    )

    $results = [System.Collections.Generic.List[object]]::new()
    foreach ($patch in $Patches) {
        $userId = ''
        $properties = $null
        if ($null -ne $patch) {
            $userId = [string]$patch.userId
            $properties = $patch.properties
        }
        try {
            if ([string]::IsNullOrWhiteSpace($userId)) {
                throw 'patch row is missing required field: userId'
            }
            $results.Add((Set-TenantUserProperties -TenantId $TenantId -UserId $userId -Properties $properties -DryRun:$DryRun -Actor $Actor -CorrelationId $CorrelationId -WriteAudit $WriteAudit))
        }
        catch {
            $results.Add([pscustomobject]@{
                userId = $userId
                status = 'failed'
                diffs  = @()
                before = $null
                after  = $null
                error  = $_.Exception.Message
            })
        }
    }
    return @($results)
}

function Read-TenantUserPatchJob {
    <#
    .SYNOPSIS
        Reads a T-0007 job envelope file into Set-TenantUserBulkProperties parameters.
    .DESCRIPTION
        Validates the envelope schema version and tenant, then returns the
        planned rows (payload.users with userId and properties) and the
        preview flag. The envelope carries references and planned values only;
        secrets are never present and never needed here.
    .PARAMETER Path
        Path to the job envelope JSON the supervisor wrote for this run.
    .EXAMPLE
        Read-TenantUserPatchJob -Path './run/user-patch-job.json'
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Tenant user patch job file not found: $Path"
    }
    $job = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
    if ($job['schemaVersion'] -ne 'v1') {
        throw "Tenant user patch job has unsupported schemaVersion: $($job['schemaVersion'])"
    }
    $tenantId = [string]$job['tenantId']
    if ([string]::IsNullOrWhiteSpace($tenantId)) {
        throw 'Tenant user patch job is missing required field: tenantId'
    }

    $payload = $job['payload']
    if ($payload -isnot [System.Collections.IDictionary]) {
        $payload = @{}
    }
    $patches = [System.Collections.Generic.List[object]]::new()
    foreach ($entry in @($payload['users'])) {
        if ($null -ne $entry) {
            $patches.Add($entry)
        }
    }

    return @{
        TenantId = $tenantId
        Patches  = @($patches)
        Preview  = $payload['preview'] -eq $true
        Actor    = [string]$payload['actor']
    }
}
