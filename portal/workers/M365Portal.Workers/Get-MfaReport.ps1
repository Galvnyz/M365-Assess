# Get-MfaReport.ps1 — EPIC-012 MFA report read (SPEC §3.1, §4.1 US-1).
#
# Live Graph reads only: users are paged from /users, per-user authentication
# methods are read from /users/{id}/authentication/methods, registration state
# comes from the userRegistrationDetails report, and directory-role membership
# comes from roleAssignments. Phishing-resistance is read from the Graph method
# types through ConvertTo-MfaMethodId / Test-MfaPhishingResistant (the worker
# mirror of the T-0227 classifier: FIDO2, passkey incl. platform credentials,
# Windows Hello for Business, and certificate-based authentication; TAP and the
# one-time methods are excluded). Nothing is written to the tenant and no user
# method data is mirrored to disk; filtering and cursor paging happen over the
# single read. The caller (child entrypoint) runs with the Graph session the
# supervisor connected after materializing the tenant credential in-process;
# this file never touches secrets.

function ConvertTo-MfaMethodId {
    <#
    .SYNOPSIS
        Normalises a Graph @odata.type to the canonical MFA method id.
    .DESCRIPTION
        Mirrors the T-0227 classifier mapping so the report classifies the same
        vocabulary the BFF aggregates on. An unlisted type returns null so the
        caller records it as unknown instead of throwing.
    .PARAMETER OdataType
        The @odata.type discriminator from the Graph method record.
    .EXAMPLE
        ConvertTo-MfaMethodId -OdataType '#microsoft.graph.fido2AuthenticationMethod'
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter()]
        [string]$OdataType = ''
    )

    $map = @{
        '#microsoft.graph.fido2authenticationmethod'                    = 'fido2'
        '#microsoft.graph.passkeyauthenticationmethod'                  = 'passkey'
        '#microsoft.graph.platformcredentialauthenticationmethod'       = 'passkey'
        '#microsoft.graph.windowshelloforbusinessauthenticationmethod'  = 'windowsHelloForBusiness'
        '#microsoft.graph.x509certificateauthenticationmethod'          = 'certificateBasedAuthentication'
        '#microsoft.graph.microsoftauthenticatorauthenticationmethod'   = 'microsoftAuthenticator'
        '#microsoft.graph.softwareoathauthenticationmethod'             = 'softwareOath'
        '#microsoft.graph.temporaryaccesspassauthenticationmethod'      = 'temporaryAccessPass'
        '#microsoft.graph.phoneauthenticationmethod'                    = 'phone'
        '#microsoft.graph.emailauthenticationmethod'                    = 'email'
        '#microsoft.graph.passwordauthenticationmethod'                 = 'password'
    }
    $key = $OdataType.Trim().ToLowerInvariant()
    if ($map.ContainsKey($key)) {
        return $map[$key]
    }
    return $null
}

function Test-MfaPhishingResistant {
    <#
    .SYNOPSIS
        Reports whether a canonical method id is phishing-resistant.
    .DESCRIPTION
        SPEC §11.4: FIDO2, passkey, Windows Hello for Business, and
        certificate-based authentication only. TAP and one-time methods are
        excluded even though they are strong.
    .PARAMETER MethodId
        Canonical method id from ConvertTo-MfaMethodId.
    .EXAMPLE
        Test-MfaPhishingResistant -MethodId 'fido2'
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter()]
        [string]$MethodId = ''
    )

    return @('fido2', 'passkey', 'windowsHelloForBusiness', 'certificateBasedAuthentication') -contains $MethodId
}

function Get-MfaRegistrationMap {
    <#
    .SYNOPSIS
        Builds the UPN/id to MFA-registration-state map from the report.
    .DESCRIPTION
        Reads reports/authenticationMethods/userRegistrationDetails once for the
        tenant. Failures (missing report permission) yield an empty map so the
        caller falls back to method presence; nothing is thrown.
    .EXAMPLE
        Get-MfaRegistrationMap
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param()

    $map = @{}
    try {
        $uri = '/v1.0/reports/authenticationMethods/userRegistrationDetails?$select=id,userPrincipalName,isMfaRegistered&$top=999'
        do {
            $response = Invoke-MgGraphRequest -Method GET -Uri $uri
            foreach ($entry in @($response.value)) {
                if ($null -eq $entry) {
                    continue
                }
                $state = 'notRegistered'
                if ($entry.isMfaRegistered -eq $true) {
                    $state = 'registered'
                }
                foreach ($key in @($entry.userPrincipalName, $entry.id)) {
                    $text = [string]$key
                    if ($text.Trim().Length -gt 0) {
                        $map[$text.Trim().ToLowerInvariant()] = $state
                    }
                }
            }
            $uri = $response.'@odata.nextLink'
        } while ($uri)
    }
    catch {
        return @{}
    }
    return $map
}

function Get-MfaAdminIdSet {
    <#
    .SYNOPSIS
        Collects directory-role assignee ids for the admin-role filter.
    .DESCRIPTION
        Reads roleManagement roleAssignments once and returns the principal ids
        as a case-insensitive set. Failures (missing RoleManagement read
        permission) yield an empty set so no user is marked admin; nothing is
        thrown.
    .EXAMPLE
        Get-MfaAdminIdSet
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param()

    $set = @{}
    try {
        $uri = '/v1.0/roleManagement/directory/roleAssignments?$select=principalId&$top=999'
        do {
            $response = Invoke-MgGraphRequest -Method GET -Uri $uri
            foreach ($entry in @($response.value)) {
                $text = [string]$entry.principalId
                if ($text.Trim().Length -gt 0) {
                    $set[$text.Trim().ToLowerInvariant()] = $true
                }
            }
            $uri = $response.'@odata.nextLink'
        } while ($uri)
    }
    catch {
        return @{}
    }
    return $set
}

function Get-MfaUserMethods {
    <#
    .SYNOPSIS
        Reads one user's live authentication methods from Graph.
    .DESCRIPTION
        GETs /users/{id}/authentication/methods, normalises each record to the
        canonical id, and derives the phishing-resistant flag from the T-0227
        vocabulary. The default method is read from signInPreferences where the
        tenant exposes it; otherwise null (never inferred). A failed read
        returns an empty, unknown-state record so one user cannot fail the
        report.
    .PARAMETER UserId
        The user id.
    .EXAMPLE
        Get-MfaUserMethods -UserId 'user-1'
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UserId
    )

    $methods = [System.Collections.Generic.List[string]]::new()
    $unknown = 0
    try {
        $uri = "/v1.0/users/$UserId/authentication/methods?`$top=100"
        do {
            $response = Invoke-MgGraphRequest -Method GET -Uri $uri
            foreach ($entry in @($response.value)) {
                if ($null -eq $entry) {
                    continue
                }
                $id = ConvertTo-MfaMethodId -OdataType ([string]$entry.'@odata.type')
                if ([string]::IsNullOrEmpty($id)) {
                    $unknown += 1
                    continue
                }
                if (-not $methods.Contains($id)) {
                    $methods.Add($id)
                }
            }
            $uri = $response.'@odata.nextLink'
        } while ($uri)
    }
    catch {
        return [pscustomobject]@{
            methods            = @()
            defaultMethod      = $null
            phishingResistant  = 'unknown'
        }
    }

    $defaultMethod = $null
    try {
        $prefs = Invoke-MgGraphRequest -Method GET -Uri "/beta/users/$UserId/authentication/signInPreferences"
        $raw = [string]$prefs.preferredMethod
        if ($raw.Trim().Length -gt 0 -and $methods.Contains($raw.Trim())) {
            $defaultMethod = $raw.Trim()
        }
    }
    catch {
        $defaultMethod = $null
    }

    $flag = 'not-phishing-resistant'
    foreach ($method in $methods) {
        if (Test-MfaPhishingResistant -MethodId $method) {
            $flag = 'phishing-resistant'
            break
        }
    }
    if ($methods.Count -eq 0 -and $unknown -gt 0) {
        $flag = 'unknown'
    }

    return [pscustomobject]@{
        methods           = @($methods)
        defaultMethod     = $defaultMethod
        phishingResistant = $flag
    }
}

function ConvertTo-MfaReportRow {
    <#
    .SYNOPSIS
        Shapes one user plus method state into the §3.1 report row.
    .DESCRIPTION
        Registration state prefers the registration-details report and falls
        back to method presence when the report is unavailable.
    .PARAMETER User
        The Graph user record.
    .PARAMETER MethodState
        The Get-MfaUserMethods result for the user.
    .PARAMETER RegistrationByUser
        The Get-MfaRegistrationMap lookup.
    .PARAMETER AdminIdSet
        The Get-MfaAdminIdSet lookup.
    .EXAMPLE
        ConvertTo-MfaReportRow -User $user -MethodState $methods -RegistrationByUser @{} -AdminIdSet @{}
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [object]$User,

        [Parameter(Mandatory)]
        [object]$MethodState,

        [Parameter()]
        [hashtable]$RegistrationByUser = @{},


        [Parameter()]
        [hashtable]$AdminIdSet = @{}
    )

    $state = 'notRegistered'
    $found = $false
    foreach ($key in @($User.userPrincipalName, $User.id)) {
        $text = [string]$key
        if ($text.Trim().Length -gt 0 -and $RegistrationByUser.ContainsKey($text.Trim().ToLowerInvariant())) {
            $state = $RegistrationByUser[$text.Trim().ToLowerInvariant()]
            $found = $true
            break
        }
    }
    if (-not $found -and @($MethodState.methods).Count -gt 0) {
        $state = 'registered'
    }

    $skuIds = @()
    foreach ($license in @($User.assignedLicenses)) {
        if ($null -eq $license) {
            continue
        }
        $sku = [string]$license.skuId
        if ($sku.Trim().Length -gt 0) {
            $skuIds += $sku
        }
    }

    $lastAuth = $null
    if ($null -ne $User.signInActivity) {
        $raw = [string]$User.signInActivity.lastSignInDateTime
        if ($raw.Trim().Length -gt 0) {
            $lastAuth = $raw
        }
    }

    $isAdmin = $false
    $userKey = ([string]$User.id).Trim().ToLowerInvariant()
    if ($userKey.Length -gt 0 -and $AdminIdSet.ContainsKey($userKey)) {
        $isAdmin = $true
    }

    $defaultMethod = $null
    if ($null -ne $MethodState.defaultMethod -and ([string]$MethodState.defaultMethod).Trim().Length -gt 0) {
        $defaultMethod = [string]$MethodState.defaultMethod
    }

    return [pscustomobject]@{
        userId            = [string]$User.id
        displayName       = [string]$User.displayName
        userPrincipalName = [string]$User.userPrincipalName
        methods           = @($MethodState.methods)
        defaultMethod     = $defaultMethod
        phishingResistant = [string]$MethodState.phishingResistant
        lastAuthDateTime  = $lastAuth
        state             = $state
        licenses          = $skuIds
        isAdmin           = $isAdmin
    }
}

function Test-MfaReportFilter {
    <#
    .SYNOPSIS
        Applies the §3.1 report filters to one shaped row.
    .PARAMETER Row
        The ConvertTo-MfaReportRow result.
    .PARAMETER Registered
        Keeps registered, notRegistered, or both when empty.
    .PARAMETER Method
        Keeps users holding this canonical method id.
    .PARAMETER PhishingResistant
        Keeps phishing-resistant, not-phishing-resistant, unknown, or all when empty.
    .PARAMETER License
        licensed keeps users with at least one license, unlicensed the rest.
    .PARAMETER AdminRole
        Keeps admin-role holders, non-holders, or both when empty.
    .EXAMPLE
        Test-MfaReportFilter -Row $row -Method 'fido2'
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter(Mandatory)]
        [object]$Row,

        [Parameter()]
        [ValidateSet('', 'registered', 'notRegistered')]
        [string]$Registered = '',

        [Parameter()]
        [string]$Method = '',

        [Parameter()]
        [ValidateSet('', 'phishing-resistant', 'not-phishing-resistant', 'unknown')]
        [string]$PhishingResistant = '',

        [Parameter()]
        [ValidateSet('', 'licensed', 'unlicensed')]
        [string]$License = '',

        [Parameter()]
        [string]$AdminRole = ''
    )

    if ($Registered.Trim().Length -gt 0 -and $Row.state -ne $Registered.Trim()) {
        return $false
    }
    if ($Method.Trim().Length -gt 0 -and -not (@($Row.methods) -contains $Method.Trim())) {
        return $false
    }
    if ($PhishingResistant.Trim().Length -gt 0 -and $Row.phishingResistant -ne $PhishingResistant.Trim()) {
        return $false
    }
    if ($License.Trim().Length -gt 0) {
        $licensed = @($Row.licenses).Count -gt 0
        if ($License.Trim().ToLowerInvariant() -eq 'licensed' -and -not $licensed) {
            return $false
        }
        if ($License.Trim().ToLowerInvariant() -eq 'unlicensed' -and $licensed) {
            return $false
        }
    }
    if ($AdminRole.Trim().Length -gt 0) {
        $want = $AdminRole.Trim().ToLowerInvariant() -eq 'true'
        if ([bool]$Row.isAdmin -ne $want) {
            return $false
        }
    }
    return $true
}

function Get-MfaReport {
    <#
    .SYNOPSIS
        Builds the tenant MFA report live from Graph.
    .DESCRIPTION
        Pages /users (falling back without signInActivity where AuditLog read
        is missing), reads each user's authentication methods, shapes the §3.1
        rows, applies the requested filters, and returns one cursor page. Only
        GET requests are issued; nothing is written to the tenant.
    .PARAMETER TenantId
        Tenant the users belong to. Carried through to the result envelope.
    .PARAMETER Registered
        Filter by registration: registered or notRegistered.
    .PARAMETER Method
        Filter by canonical method id.
    .PARAMETER PhishingResistant
        Filter by phishing-resistant, not-phishing-resistant, or unknown.
    .PARAMETER License
        licensed keeps users with at least one license, unlicensed the rest.
    .PARAMETER AdminRole
        'true' keeps admin-role holders, 'false' the rest, empty both.
    .PARAMETER Top
        Page size.
    .PARAMETER Cursor
        Opaque page cursor from a previous result. Empty starts at the first page.
    .EXAMPLE
        Get-MfaReport -TenantId 'tenant-a' -Method 'fido2' -Top 50
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter()]
        [ValidateSet('', 'registered', 'notRegistered')]
        [string]$Registered = '',

        [Parameter()]
        [string]$Method = '',

        [Parameter()]
        [ValidateSet('', 'phishing-resistant', 'not-phishing-resistant', 'unknown')]
        [string]$PhishingResistant = '',

        [Parameter()]
        [ValidateSet('', 'licensed', 'unlicensed')]
        [string]$License = '',

        [Parameter()]
        [string]$AdminRole = '',

        [Parameter()]
        [ValidateRange(1, 999)]
        [int]$Top = 100,

        [Parameter()]
        [string]$Cursor = ''
    )

    $selectFields = 'id,displayName,userPrincipalName,assignedLicenses,signInActivity'
    $uri = "/v1.0/users?`$select=$selectFields&`$top=999"

    $allUsers = [System.Collections.Generic.List[object]]::new()
    $withoutSignInActivity = $false
    do {
        try {
            $response = Invoke-MgGraphRequest -Method GET -Uri $uri
        }
        catch {
            if (-not $withoutSignInActivity -and $_.ToString() -match 'signInActivity|AuditLog|Authorization_RequestDenied') {
                $withoutSignInActivity = $true
                $selectFields = 'id,displayName,userPrincipalName,assignedLicenses'
                $uri = "/v1.0/users?`$select=$selectFields&`$top=999"
                $allUsers.Clear()
                continue
            }
            throw
        }
        foreach ($entry in @($response.value)) {
            if ($null -ne $entry) {
                $allUsers.Add($entry)
            }
        }
        $uri = $response.'@odata.nextLink'
    } while ($uri)

    $registrationByUser = Get-MfaRegistrationMap
    $adminIdSet = Get-MfaAdminIdSet

    $rows = [System.Collections.Generic.List[object]]::new()
    foreach ($user in $allUsers) {
        $methods = Get-MfaUserMethods -UserId ([string]$user.id)
        $row = ConvertTo-MfaReportRow -User $user -MethodState $methods -RegistrationByUser $registrationByUser -AdminIdSet $adminIdSet
        if (Test-MfaReportFilter -Row $row -Registered $Registered -Method $Method -PhishingResistant $PhishingResistant -License $License -AdminRole $AdminRole) {
            $rows.Add($row)
        }
    }

    $ordered = @($rows)
    $offset = ConvertFrom-MfaReportCursor -Cursor $Cursor
    $page = @($ordered | Select-Object -Skip $offset -First $Top)
    $nextOffset = $offset + $page.Count
    $nextCursor = ''
    if ($nextOffset -lt $ordered.Count) {
        $nextCursor = ConvertTo-MfaReportCursor -Offset $nextOffset
    }

    return [pscustomobject]@{
        tenantId    = $TenantId
        rows        = $page
        nextCursor  = $nextCursor
        totalCount  = $ordered.Count
        retrievedAt = (Get-Date -Format 'o')
    }
}

function Read-MfaReportJob {
    <#
    .SYNOPSIS
        Reads a T-0007 job envelope file into Get-MfaReport parameters.
    .DESCRIPTION
        Validates the envelope schema version and tenant, then merges the
        optional payload filters with explicit overrides. The envelope carries
        references only; secrets are never present and never needed here.
    .PARAMETER Path
        Path to the job envelope JSON the supervisor wrote for this run.
    .EXAMPLE
        Read-MfaReportJob -Path './run/mfa-report-job.json'
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "MFA report job file not found: $Path"
    }
    $job = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
    if ($job['schemaVersion'] -ne 'v1') {
        throw "MFA report job has unsupported schemaVersion: $($job['schemaVersion'])"
    }
    $tenantId = [string]$job['tenantId']
    if ([string]::IsNullOrWhiteSpace($tenantId)) {
        throw 'MFA report job is missing required field: tenantId'
    }

    $filters = $job['payload']
    if ($filters -is [System.Collections.IDictionary]) {
        $nested = $filters['filters']
        if ($nested -is [System.Collections.IDictionary]) {
            $filters = $nested
        }
    }
    else {
        $filters = @{}
    }

    return @{
        TenantId           = $tenantId
        Registered         = [string]$filters['registered']
        Method             = [string]$filters['method']
        PhishingResistant  = [string]$filters['phishingResistant']
        License            = [string]$filters['license']
        AdminRole          = [string]$filters['adminRole']
        Top                = Get-MfaReportJobInt -Value $filters['top'] -Default 100
        Cursor             = [string]$filters['cursor']
    }
}

function Get-MfaReportJobInt {
    [CmdletBinding()]
    [OutputType([int])]
    param(
        [Parameter()]
        [object]$Value,

        [Parameter()]
        [int]$Default = 0
    )

    if ($null -eq $Value -or ([string]$Value).Trim().Length -eq 0) {
        return $Default
    }
    $parsed = 0
    if ([int]::TryParse([string]$Value, [ref]$parsed)) {
        return $parsed
    }
    return $Default
}

function ConvertTo-MfaReportCursor {
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [int]$Offset
    )

    $bytes = [System.Text.Encoding]::UTF8.GetBytes("$Offset")
    return ([Convert]::ToBase64String($bytes)).Replace('+', '-').Replace('/', '_').TrimEnd('=')
}

function ConvertFrom-MfaReportCursor {
    [CmdletBinding()]
    [OutputType([int])]
    param(
        [Parameter()]
        [string]$Cursor = ''
    )

    if ([string]::IsNullOrWhiteSpace($Cursor)) {
        return 0
    }
    try {
        $text = $Cursor.Trim().Replace('-', '+').Replace('_', '/')
        $pad = (4 - ($text.Length % 4)) % 4
        $text += ('=' * $pad)
        $decoded = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($text))
        $offset = 0
        if ([int]::TryParse($decoded, [ref]$offset) -and $offset -ge 0) {
            return $offset
        }
    }
    catch {
        Write-Verbose "Ignoring undecodable MFA report cursor and starting at the first page."
    }
    return 0
}
