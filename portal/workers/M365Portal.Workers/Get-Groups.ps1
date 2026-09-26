# Get-Groups.ps1 — EPIC-014 Groups read (SPEC §3.1, §6, §11.1; T-0261).
#
# Live Graph reads only: groups are never mirrored to disk.
# Emits group items with type discrimination (m365, security, mailEnabledSecurity, distribution, dynamic),
# derived membership count, owner count, hiddenFromAddressListsEnabled, deliveryManagementEnabled,
# and dynamic membership rule.
# The worker is read-only: only GET requests are issued.

function Read-GroupsJob {
    <#
    .SYNOPSIS
        Parses a job envelope JSON for Get-Groups.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "job envelope not found at '$Path'"
    }

    $raw = Get-Content -LiteralPath $Path -Raw
    $json = $raw | ConvertFrom-Json
    if (-not $json.tenantId) {
        throw "job envelope '$Path' is missing mandatory 'tenantId'"
    }

    $result = @{
        TenantId       = [string]$json.tenantId
        Type           = if ($json.type) { [string]$json.type } else { '' }
        Hidden         = if ($null -ne $json.hidden) { [string]$json.hidden } else { '' }
        Dynamic        = if ($null -ne $json.dynamic) { [string]$json.dynamic } else { '' }
        MembershipSize = if ($json.membershipSize) { [string]$json.membershipSize } else { '' }
        Search         = if ($json.search) { [string]$json.search } else { '' }
        Top            = if ($json.top) { [int]$json.top } else { 100 }
        Cursor         = if ($json.cursor) { [string]$json.cursor } else { '' }
    }
    return $result
}

function ConvertTo-GroupsCursor {
    param([int]$Offset)
    if ($Offset -le 0) { return '' }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes("offset:$Offset")
    return [System.Convert]::ToBase64String($bytes)
}

function ConvertFrom-GroupsCursor {
    param([string]$Cursor)
    if ([string]::IsNullOrWhiteSpace($Cursor)) { return 0 }
    try {
        $decoded = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Cursor))
        if ($decoded -match '^offset:(\d+)$') {
            return [int]$Matches[1]
        }
        return 0
    }
    catch {
        return 0
    }
}

function Get-DiscriminatedGroupType {
    param(
        [object]$GroupEntry
    )

    $groupTypes = @()
    if ($GroupEntry.groupTypes) {
        $groupTypes = @($GroupEntry.groupTypes)
    }

    $isDynamic = ($groupTypes -contains 'DynamicMembership') -or (-not [string]::IsNullOrWhiteSpace($GroupEntry.membershipRule))
    if ($isDynamic) {
        return 'dynamic'
    }

    if ($groupTypes -contains 'Unified') {
        return 'm365'
    }

    $mailEnabled = [bool]$GroupEntry.mailEnabled
    $securityEnabled = [bool]$GroupEntry.securityEnabled

    if ($mailEnabled -and (-not $securityEnabled)) {
        return 'distribution'
    }
    if ($mailEnabled -and $securityEnabled) {
        return 'mailEnabledSecurity'
    }
    if ($securityEnabled) {
        return 'security'
    }

    return 'security'
}

function ConvertTo-GroupRow {
    param(
        [object]$Entry
    )

    $groupType = Get-DiscriminatedGroupType -GroupEntry $Entry
    $groupTypes = if ($Entry.groupTypes) { @($Entry.groupTypes) } else { @() }
    $isDynamic = ($groupType -eq 'dynamic') -or ($groupTypes -contains 'DynamicMembership') -or (-not [string]::IsNullOrWhiteSpace($Entry.membershipRule))

    $membershipCount = 0
    if ($null -ne $Entry.'members@odata.count') {
        $membershipCount = [int]$Entry.'members@odata.count'
    }
    elseif ($null -ne $Entry.membershipCount) {
        $membershipCount = [int]$Entry.membershipCount
    }
    elseif ($Entry.members -is [System.Collections.IEnumerable] -and $Entry.members -isnot [string]) {
        $membershipCount = @($Entry.members).Count
    }

    $ownerCount = 0
    if ($null -ne $Entry.'owners@odata.count') {
        $ownerCount = [int]$Entry.'owners@odata.count'
    }
    elseif ($null -ne $Entry.ownerCount) {
        $ownerCount = [int]$Entry.ownerCount
    }
    elseif ($Entry.owners -is [System.Collections.IEnumerable] -and $Entry.owners -isnot [string]) {
        $ownerCount = @($Entry.owners).Count
    }

    $hiddenFromGal = $false
    if ($null -ne $Entry.hideFromAddressLists) {
        $hiddenFromGal = [bool]$Entry.hideFromAddressLists
    }
    elseif ($null -ne $Entry.hiddenFromAddressListsEnabled) {
        $hiddenFromGal = [bool]$Entry.hiddenFromAddressListsEnabled
    }

    $deliveryMgmt = $false
    if ($null -ne $Entry.deliveryManagementEnabled) {
        $deliveryMgmt = [bool]$Entry.deliveryManagementEnabled
    }
    elseif ($null -ne $Entry.requireSenderAuthenticationEnabled) {
        $deliveryMgmt = [bool]$Entry.requireSenderAuthenticationEnabled
    }
    elseif ($null -ne $Entry.hasDeliveryManagement) {
        $deliveryMgmt = [bool]$Entry.hasDeliveryManagement
    }

    $displayName = if ($Entry.displayName) { [string]$Entry.displayName } else { '' }
    $id = if ($Entry.id) { [string]$Entry.id } else { '' }
    $mail = if ($Entry.mail) { [string]$Entry.mail } else { '' }
    $description = if ($Entry.description) { [string]$Entry.description } else { '' }
    $dynamicRule = if ($Entry.membershipRule) { [string]$Entry.membershipRule } else { '' }

    return [pscustomobject]@{
        id                            = $id
        name                          = $displayName
        displayName                   = $displayName
        description                   = $description
        type                          = $groupType
        groupType                     = $groupType
        membershipCount               = $membershipCount
        ownerCount                    = $ownerCount
        hiddenFromAddressListsEnabled = $hiddenFromGal
        deliveryManagementEnabled     = $deliveryMgmt
        dynamicRule                   = $dynamicRule
        isDynamic                     = $isDynamic
        mail                          = $mail
    }
}

function Test-GroupFilter {
    param(
        [object]$Row,
        [string]$Type = '',
        [string]$Hidden = '',
        [string]$Dynamic = '',
        [string]$MembershipSize = '',
        [string]$Search = ''
    )

    if (-not [string]::IsNullOrWhiteSpace($Type)) {
        if ($Row.type.ToLowerInvariant() -ne $Type.ToLowerInvariant()) {
            return $false
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($Hidden)) {
        $h = $Hidden.ToLowerInvariant()
        if ($h -in @('true', '1', 'hidden')) {
            if (-not $Row.hiddenFromAddressListsEnabled) { return $false }
        }
        elseif ($h -in @('false', '0', 'visible')) {
            if ($Row.hiddenFromAddressListsEnabled) { return $false }
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($Dynamic)) {
        $d = $Dynamic.ToLowerInvariant()
        if ($d -in @('true', '1')) {
            if (-not $Row.isDynamic) { return $false }
        }
        elseif ($d -in @('false', '0')) {
            if ($Row.isDynamic) { return $false }
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($MembershipSize)) {
        $s = $MembershipSize.ToLowerInvariant()
        switch ($s) {
            'empty' {
                if ($Row.membershipCount -ne 0) { return $false }
            }
            'small' {
                if ($Row.membershipCount -lt 1 -or $Row.membershipCount -gt 10) { return $false }
            }
            'medium' {
                if ($Row.membershipCount -lt 11 -or $Row.membershipCount -gt 50) { return $false }
            }
            'large' {
                if ($Row.membershipCount -le 50) { return $false }
            }
            default {
                if ($s -match '^(\d+)$') {
                    if ($Row.membershipCount -ne [int]$Matches[1]) { return $false }
                }
            }
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($Search)) {
        $term = $Search.ToLowerInvariant()
        $matched = ($Row.name -and $Row.name.ToLowerInvariant().Contains($term)) -or
                   ($Row.mail -and $Row.mail.ToLowerInvariant().Contains($term)) -or
                   ($Row.description -and $Row.description.ToLowerInvariant().Contains($term))
        if (-not $matched) { return $false }
    }

    return $true
}

function Get-Groups {
    <#
    .SYNOPSIS
        Lists tenant groups live from Microsoft Graph with type discrimination, counts, and filters.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter()]
        [ValidateSet('', 'm365', 'security', 'mailEnabledSecurity', 'distribution', 'dynamic')]
        [string]$Type = '',

        [Parameter()]
        [string]$Hidden = '',

        [Parameter()]
        [string]$Dynamic = '',

        [Parameter()]
        [string]$MembershipSize = '',

        [Parameter()]
        [string]$Search = '',

        [Parameter()]
        [ValidateRange(1, 1000)]
        [int]$Top = 100,

        [Parameter()]
        [string]$Cursor = ''
    )

    $allRawGroups = [System.Collections.Generic.List[object]]::new()
    $uri = "/v1.0/groups?`$select=id,displayName,description,groupTypes,mailEnabled,securityEnabled,mail,membershipRule,hideFromAddressLists,requireSenderAuthenticationEnabled&`$top=999"

    do {
        $response = Invoke-MgGraphRequest -Method GET -Uri $uri
        if ($null -ne $response -and $null -ne $response.value) {
            foreach ($entry in @($response.value)) {
                if ($null -ne $entry) {
                    $allRawGroups.Add($entry)
                }
            }
        }
        $uri = if ($response.'@odata.nextLink') { $response.'@odata.nextLink' } else { $null }
    } while ($uri)

    $rows = [System.Collections.Generic.List[object]]::new()
    foreach ($entry in $allRawGroups) {
        $row = ConvertTo-GroupRow -Entry $entry
        if (Test-GroupFilter -Row $row -Type $Type -Hidden $Hidden -Dynamic $Dynamic -MembershipSize $MembershipSize -Search $Search) {
            $rows.Add($row)
        }
    }

    $offset = ConvertFrom-GroupsCursor -Cursor $Cursor
    if ($offset -lt 0) { $offset = 0 }

    $paged = [System.Collections.Generic.List[object]]::new()
    $end = [System.Math]::Min($offset + $Top, $rows.Count)
    for ($i = $offset; $i -lt $end; $i++) {
        $paged.Add($rows[$i])
    }

    $nextCursor = $null
    if ($end -lt $rows.Count) {
        $nextCursor = ConvertTo-GroupsCursor -Offset $end
    }

    return [pscustomobject]@{
        tenantId   = $TenantId
        totalCount = $rows.Count
        items      = @($paged)
        nextCursor = $nextCursor
    }
}
