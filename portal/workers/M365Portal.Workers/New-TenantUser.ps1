# New-TenantUser.ps1 — EPIC-011 user create worker (SPEC §4.1 US-2, §11.4).
#
# Applies planned user creates live against Graph: single create and bulk
# create with per-row results. A row that fails validation or apply is
# reported per row and never aborts its siblings; an unknown license or a
# missing usage location is a validation failure, never a partial apply.
#
# Gating (EPIC-006 contract, T-0107): user create is not a registry CheckId
# command, so it cannot travel the CheckId-bound executor path. It follows the
# same contract instead — the BFF confirms the plan before dispatch (dryRun
# plans only), -DryRun reports the intended change without writing, every
# applied row captures before (absent) and after (created user), and every
# applied row emits one audit record through -WriteAudit. The Graph session is
# connected by the supervisor after materializing the tenant credential
# in-process; this file never touches secrets.
#
# A generated one-time password is returned in the result transport only
# (stdout JSON from the entrypoint). It is never written to disk, never
# logged, and never persisted.

function Test-TenantUserCreateInput {
    <#
    .SYNOPSIS
        Validates one planned user create against the §11.4 rules.
    .DESCRIPTION
        Mirrors portal/bff/src/domain/users/csv.ts so the worker refuses the
        same rows the BFF would: missing UPN or display name, malformed UPN,
        missing or malformed usage location, and licenses outside the tenant
        catalogue. Returns the error list; an empty list is valid.
    .PARAMETER User
        Planned user object (userPrincipalName, displayName, givenName,
        surname, usageLocation, licenses, groups).
    .PARAMETER KnownLicenses
        Catalogue of assignable license SKU ids. When supplied, an unknown
        license is a validation failure.
    .EXAMPLE
        Test-TenantUserCreateInput -User $user -KnownLicenses @('sku-1')
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)]
        [object]$User,

        [Parameter()]
        [string[]]$KnownLicenses = @()
    )

    $errors = [System.Collections.Generic.List[string]]::new()
    $upn = [string]$User.userPrincipalName
    $displayName = [string]$User.displayName
    $usageLocation = [string]$User.usageLocation
    if ([string]::IsNullOrWhiteSpace($upn)) {
        $errors.Add('userPrincipalName is required')
    }
    elseif ($upn.Trim() -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') {
        $errors.Add("userPrincipalName '$($upn.Trim())' is not a valid UPN")
    }
    if ([string]::IsNullOrWhiteSpace($displayName)) {
        $errors.Add('displayName is required')
    }
    if ([string]::IsNullOrWhiteSpace($usageLocation)) {
        $errors.Add('usageLocation is required (no tenant default applies)')
    }
    elseif ($usageLocation.Trim() -notmatch '^[A-Za-z]{2}$') {
        $errors.Add("usageLocation '$($usageLocation.Trim())' must be a 2-letter country code")
    }
    if ($KnownLicenses.Count -gt 0) {
        $known = @($KnownLicenses | ForEach-Object { ([string]$_).Trim().ToLowerInvariant() })
        foreach ($sku in @($User.licenses)) {
            $token = [string]$sku
            if ($token.Trim().Length -gt 0 -and -not $known.Contains($token.Trim().ToLowerInvariant())) {
                $errors.Add("license '$($token.Trim())' is not in the tenant catalogue")
            }
        }
    }
    return @($errors)
}

function Get-TenantUserMailNickname {
    <#
    .SYNOPSIS
        Derives a Graph mailNickname from a UPN.
    .DESCRIPTION
        Takes the UPN prefix and replaces characters Graph rejects in
        mailNickname with dots so the create body is always well-formed.
    .PARAMETER UserPrincipalName
        The new user's UPN.
    .EXAMPLE
        Get-TenantUserMailNickname -UserPrincipalName 'new.user@example.invalid'
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UserPrincipalName
    )

    $prefix = ([string]$UserPrincipalName).Split('@')[0]
    $nickname = $prefix -replace '[^A-Za-z0-9._-]', '.'
    if ([string]::IsNullOrWhiteSpace($nickname)) {
        return 'user'
    }
    return $nickname
}

function New-TenantUserPassword {
    <#
    .SYNOPSIS
        Generates a one-time password for a create without a caller password.
    .DESCRIPTION
        Uses the platform RNG over an unambiguous alphabet. The value is
        returned to the caller once in the result transport; it is never
        written to disk or logged.
    .EXAMPLE
        New-TenantUserPassword
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param()

    $alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%^&*'.ToCharArray()
    $bytes = New-Object -TypeName 'byte[]' -ArgumentList 16
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    }
    finally {
        $rng.Dispose()
    }
    $chars = foreach ($byte in $bytes) { $alphabet[$byte % $alphabet.Length] }
    return (-join $chars)
}

function New-TenantUser {
    <#
    .SYNOPSIS
        Creates one tenant user live against Graph with before/after capture.
    .DESCRIPTION
        Validates the planned user, then POSTs /users, assigns licenses, and
        adds group memberships. -DryRun returns the intended change with no
        Graph write. Every applied row (created or failed) is reported through
        -WriteAudit with before (absent) and after (created user or null).
        Returns a per-row result; apply failures are returned, not thrown, so
        bulk callers continue with siblings.
    .PARAMETER TenantId
        Tenant the user belongs to. Carried through to the result envelope.
    .PARAMETER User
        Planned user object (userPrincipalName, displayName, givenName,
        surname, usageLocation, licenses, groups, password).
    .PARAMETER DryRun
        Report the intended change without writing to the tenant.
    .PARAMETER KnownLicenses
        Catalogue of assignable license SKU ids for validation.
    .PARAMETER Actor
        Caller identity recorded on the audit event.
    .PARAMETER CorrelationId
        Correlation id recorded on the audit event.
    .PARAMETER WriteAudit
        Seam: scriptblock (event) -> void. Defaults to a no-op.
    .EXAMPLE
        New-TenantUser -TenantId 'tenant-a' -User $user -DryRun
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [object]$User,

        [Parameter()]
        [switch]$DryRun,

        [Parameter()]
        [string[]]$KnownLicenses = @(),

        [Parameter()]
        [string]$Actor = '',

        [Parameter()]
        [string]$CorrelationId = '',

        [Parameter()]
        [scriptblock]$WriteAudit = { param($AuditEvent) }
    )

    $upn = [string]$User.userPrincipalName
    $failures = @(Test-TenantUserCreateInput -User $User -KnownLicenses $KnownLicenses)
    if ($failures.Count -gt 0) {
        return [pscustomobject]@{
            userPrincipalName = $upn.Trim()
            status            = 'failed'
            id                = $null
            password          = $null
            error             = ($failures -join '; ')
            before            = $null
            after             = $null
        }
    }

    $licenses = @(@($User.licenses) | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -ne '' })
    $groups = @(@($User.groups) | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -ne '' })
    $intended = [pscustomobject]@{
        userPrincipalName = $upn.Trim()
        displayName       = ([string]$User.displayName).Trim()
        usageLocation     = ([string]$User.usageLocation).Trim()
        licenses          = $licenses
        groups            = $groups
    }
    if ($DryRun) {
        return [pscustomobject]@{
            userPrincipalName = $intended.userPrincipalName
            status            = 'planned'
            id                = $null
            password          = $null
            error             = $null
            before            = $null
            after             = $intended
        }
    }

    try {
        $password = [string]$User.password
        if ([string]::IsNullOrWhiteSpace($password)) {
            $password = New-TenantUserPassword
        }
        $createBody = @{
            accountEnabled    = $true
            displayName       = $intended.displayName
            mailNickname      = Get-TenantUserMailNickname -UserPrincipalName $intended.userPrincipalName
            userPrincipalName = $intended.userPrincipalName
            usageLocation     = $intended.usageLocation
            passwordProfile   = @{
                forceChangePasswordNextSignIn = $true
                password                      = $password
            }
        }
        $givenName = [string]$User.givenName
        if ($givenName.Trim().Length -gt 0) {
            $createBody['givenName'] = $givenName.Trim()
        }
        $surname = [string]$User.surname
        if ($surname.Trim().Length -gt 0) {
            $createBody['surname'] = $surname.Trim()
        }
        $created = Invoke-MgGraphRequest -Method POST -Uri '/v1.0/users' -Body ($createBody | ConvertTo-Json -Depth 5)
        $userId = [string]$created.id

        if ($licenses.Count -gt 0) {
            $licenseBody = @{
                addLicenses    = @($licenses | ForEach-Object { @{ skuId = $_ } })
                removeLicenses = @()
            }
            $null = Invoke-MgGraphRequest -Method POST -Uri "/v1.0/users/$userId/assignLicense" -Body ($licenseBody | ConvertTo-Json -Depth 5)
        }
        foreach ($groupId in $groups) {
            $memberBody = @{ '@odata.id' = "https://graph.microsoft.com/v1.0/directoryObjects/$userId" }
            $null = Invoke-MgGraphRequest -Method POST -Uri "/v1.0/groups/$groupId/members/`$ref" -Body ($memberBody | ConvertTo-Json -Depth 5)
        }

        $after = [pscustomobject]@{
            id                = $userId
            userPrincipalName = $intended.userPrincipalName
            displayName       = $intended.displayName
            usageLocation     = $intended.usageLocation
            licenses          = $licenses
            groups            = $groups
        }
        $null = & $WriteAudit @{
            tenantId          = $TenantId
            action            = 'users.create'
            userPrincipalName = $intended.userPrincipalName
            result            = 'success'
            error             = $null
            before            = $null
            after             = $after
            actor             = $Actor
            correlationId     = $CorrelationId
        }
        return [pscustomobject]@{
            userPrincipalName = $intended.userPrincipalName
            status            = 'created'
            id                = $userId
            password          = $password
            error             = $null
            before            = $null
            after             = $after
        }
    }
    catch {
        $message = $_.Exception.Message
        $null = & $WriteAudit @{
            tenantId          = $TenantId
            action            = 'users.create'
            userPrincipalName = $intended.userPrincipalName
            result            = 'failure'
            error             = $message
            before            = $null
            after             = $null
            actor             = $Actor
            correlationId     = $CorrelationId
        }
        return [pscustomobject]@{
            userPrincipalName = $intended.userPrincipalName
            status            = 'failed'
            id                = $null
            password          = $null
            error             = $message
            before            = $null
            after             = $null
        }
    }
}

function New-TenantUserBulk {
    <#
    .SYNOPSIS
        Creates planned users one by one with per-row results.
    .DESCRIPTION
        Calls New-TenantUser per row inside its own trap so a row that fails
        validation or apply is reported per row without aborting siblings. A
        partial failure never rolls back successful rows.
    .PARAMETER TenantId
        Tenant the users belong to.
    .PARAMETER Users
        Planned user objects.
    .PARAMETER DryRun
        Report each intended change without writing to the tenant.
    .PARAMETER KnownLicenses
        Catalogue of assignable license SKU ids for validation.
    .PARAMETER Actor
        Caller identity recorded on each audit event.
    .PARAMETER CorrelationId
        Correlation id recorded on each audit event.
    .PARAMETER WriteAudit
        Seam: scriptblock (event) -> void. Defaults to a no-op.
    .EXAMPLE
        New-TenantUserBulk -TenantId 'tenant-a' -Users $users
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject[]])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$Users,

        [Parameter()]
        [switch]$DryRun,

        [Parameter()]
        [string[]]$KnownLicenses = @(),

        [Parameter()]
        [string]$Actor = '',

        [Parameter()]
        [string]$CorrelationId = '',

        [Parameter()]
        [scriptblock]$WriteAudit = { param($AuditEvent) }
    )

    $results = [System.Collections.Generic.List[object]]::new()
    $row = 0
    foreach ($user in $Users) {
        $row += 1
        try {
            $result = New-TenantUser -TenantId $TenantId -User $user -DryRun:$DryRun -KnownLicenses $KnownLicenses -Actor $Actor -CorrelationId $CorrelationId -WriteAudit $WriteAudit
            $result | Add-Member -NotePropertyName 'row' -NotePropertyValue $row -Force
            $results.Add($result)
        }
        catch {
            $upn = ''
            if ($null -ne $user) {
                $upn = [string]$user.userPrincipalName
            }
            $results.Add([pscustomobject]@{
                row               = $row
                userPrincipalName = $upn.Trim()
                status            = 'failed'
                id                = $null
                password          = $null
                error             = $_.Exception.Message
                before            = $null
                after             = $null
            })
        }
    }
    return @($results)
}

function Read-TenantUserCreateJob {
    <#
    .SYNOPSIS
        Reads a T-0007 job envelope file into New-TenantUserBulk parameters.
    .DESCRIPTION
        Validates the envelope schema version and tenant, then returns the
        planned user (payload.user) or users (payload.users) with the dry-run
        flag and tenant defaults. The envelope carries references and planned
        values only; secrets are never present and never needed here.
    .PARAMETER Path
        Path to the job envelope JSON the supervisor wrote for this run.
    .EXAMPLE
        Read-TenantUserCreateJob -Path './run/user-create-job.json'
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Tenant user create job file not found: $Path"
    }
    $job = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
    if ($job['schemaVersion'] -ne 'v1') {
        throw "Tenant user create job has unsupported schemaVersion: $($job['schemaVersion'])"
    }
    $tenantId = [string]$job['tenantId']
    if ([string]::IsNullOrWhiteSpace($tenantId)) {
        throw 'Tenant user create job is missing required field: tenantId'
    }

    $payload = $job['payload']
    if ($payload -isnot [System.Collections.IDictionary]) {
        $payload = @{}
    }
    $users = [System.Collections.Generic.List[object]]::new()
    foreach ($entry in @($payload['users'])) {
        if ($null -ne $entry) {
            $users.Add($entry)
        }
    }
    if ($users.Count -eq 0 -and $null -ne $payload['user']) {
        $users.Add($payload['user'])
    }
    $dryRun = $payload['dryRun'] -eq $true
    $defaultUsageLocation = [string]$payload['defaultUsageLocation']
    $knownLicenses = @()
    foreach ($sku in @($payload['knownLicenses'])) {
        if ([string]$sku -ne '') {
            $knownLicenses += [string]$sku
        }
    }

    return @{
        TenantId             = $tenantId
        Users                = @($users)
        DryRun               = $dryRun
        DefaultUsageLocation = $defaultUsageLocation
        KnownLicenses        = $knownLicenses
    }
}
