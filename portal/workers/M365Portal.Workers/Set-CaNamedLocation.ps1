# Set-CaNamedLocation.ps1 — EPIC-015 Conditional Access Named Locations CRUD worker (SPEC §3.4, §5, §6, §11.5; T-0288).
#
# Covers create, edit, delete, and list operations for IP-based and country-based named locations.
# Validates CIDR notation for IP locations (IPv4 and IPv6).
# Validates ISO 3166-1 alpha-2 codes for country locations.
# Queries live Conditional Access policies to compute which policies reference a location.
# Enforces confirmation / warnings when deleting a location in use.
# Captures before/after and emits AuditEvent on every write.

function Read-SetCaNamedLocationJob {
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
    if (-not $json.action) {
        throw "job envelope '$Path' is missing mandatory 'action'"
    }

    $ipRanges = @()
    if ($json.ipRanges) {
        $ipRanges = @($json.ipRanges)
    }

    $countries = @()
    if ($json.countriesAndRegions) {
        $countries = @($json.countriesAndRegions)
    }

    return @{
        TenantId                          = [string]$json.tenantId
        Action                            = [string]$json.action
        LocationId                        = if ($json.locationId) { [string]$json.locationId } else { '' }
        DisplayName                       = if ($json.displayName) { [string]$json.displayName } else { '' }
        LocationType                      = if ($json.locationType) { [string]$json.locationType } else { '' }
        IpRanges                          = $ipRanges
        IsTrusted                         = [bool]($json.isTrusted -eq $true)
        CountriesAndRegions               = $countries
        IncludeUnknownCountriesAndRegions = [bool]($json.includeUnknownCountriesAndRegions -eq $true)
        CountryLookupMethod               = if ($json.countryLookupMethod) { [string]$json.countryLookupMethod } else { 'clientIpAddress' }
        ConfirmName                       = if ($json.confirmName) { [string]$json.confirmName } else { '' }
        DryRun                            = [bool]($json.dryRun -eq $true)
    }
}

function Test-CidrFormat {
    param([string]$Cidr)
    if ([string]::IsNullOrWhiteSpace($Cidr)) { return $false }
    $trimmed = $Cidr.Trim()

    # IPv4 CIDR regex
    if ($trimmed -match '^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\/([0-9]|[12][0-9]|3[0-2])$') {
        return $true
    }

    # IPv6 CIDR regex
    if ($trimmed -match '^([0-9a-fA-F:]+)\/([0-9]|[1-9][0-9]|1[01][0-9]|12[0-8])$') {
        $ipPart = $Matches[1]
        $ip = $null
        if ([System.Net.IPAddress]::TryParse($ipPart, [ref]$ip)) {
            if ($ip.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetworkV6) {
                return $true
            }
        }
    }

    return $false
}

function Test-CountryCodeFormat {
    param([string]$Code)
    if ([string]::IsNullOrWhiteSpace($Code)) { return $false }
    return ($Code.Trim() -match '^[A-Za-z]{2}$')
}

function Get-CaReferencingPolicies {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$LocationId
    )

    $referencing = @()
    if ([string]::IsNullOrWhiteSpace($LocationId)) {
        return $referencing
    }

    try {
        $response = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/identity/conditionalAccess/policies' -ErrorAction Stop
        $policies = @()
        if ($response -and $response['value']) {
            $policies = @($response['value'])
        }
        elseif ($response -and $response.value) {
            $policies = @($response.value)
        }

        foreach ($p in $policies) {
            $cond = if ($p['conditions']) { $p['conditions'] } else { $p.conditions }
            if (-not $cond) { continue }
            $loc = if ($cond['locations']) { $cond['locations'] } else { $cond.locations }
            if (-not $loc) { continue }

            $inc = if ($loc['includeLocations']) { @($loc['includeLocations']) } elseif ($loc.includeLocations) { @($loc.includeLocations) } else { @() }
            $exc = if ($loc['excludeLocations']) { @($loc['excludeLocations']) } elseif ($loc.excludeLocations) { @($loc.excludeLocations) } else { @() }

            if ($inc -contains $LocationId -or $exc -contains $LocationId) {
                $policyId = if ($p['id']) { [string]$p['id'] } else { [string]$p.id }
                $pname = if ($p['displayName']) { [string]$p['displayName'] } else { [string]$p.displayName }
                $referencing += [pscustomobject]@{
                    id          = $policyId
                    displayName = $pname
                }
            }
        }
    }
    catch {
        # Graph policy read failure shouldn't completely crash named locations unless fatal
        Write-Warning "Could not query CA policies for location references: $_"
    }

    return $referencing
}

function Build-CaNamedLocationDiff {
    param(
        [hashtable]$Before,
        [hashtable]$After
    )

    $diff = @()
    if ($null -eq $Before -and $null -ne $After) {
        $diff += "+ Named Location: $($After['displayName']) ($($After['locationType']))"
        if ($After['locationType'] -eq 'ip') {
            $diff += "+ Trusted: $($After['isTrusted'])"
            if ($After['ipRanges']) {
                foreach ($r in $After['ipRanges']) {
                    $diff += "+ IP Range: $r"
                }
            }
        }
        elseif ($After['locationType'] -eq 'country') {
            if ($After['countriesAndRegions']) {
                $diff += "+ Countries: $($After['countriesAndRegions'] -join ', ')"
            }
            $diff += "+ Include Unknown: $($After['includeUnknownCountriesAndRegions'])"
        }
    }
    elseif ($null -ne $Before -and $null -eq $After) {
        $diff += "- Named Location: $($Before['displayName']) ($($Before['locationType']))"
    }
    elseif ($null -ne $Before -and $null -ne $After) {
        if ($Before['displayName'] -ne $After['displayName']) {
            $diff += "~ DisplayName: '$($Before['displayName'])' -> '$($After['displayName'])'"
        }
        if ($Before['locationType'] -eq 'ip') {
            if ($Before['isTrusted'] -ne $After['isTrusted']) {
                $diff += "~ IsTrusted: $($Before['isTrusted']) -> $($After['isTrusted'])"
            }
            $beforeRanges = if ($Before['ipRanges']) { @($Before['ipRanges']) } else { @() }
            $afterRanges = if ($After['ipRanges']) { @($After['ipRanges']) } else { @() }
            foreach ($r in $afterRanges) {
                if ($beforeRanges -notcontains $r) { $diff += "+ IP Range: $r" }
            }
            foreach ($r in $beforeRanges) {
                if ($afterRanges -notcontains $r) { $diff += "- IP Range: $r" }
            }
        }
        elseif ($Before['locationType'] -eq 'country') {
            $beforeCountries = if ($Before['countriesAndRegions']) { @($Before['countriesAndRegions']) } else { @() }
            $afterCountries = if ($After['countriesAndRegions']) { @($After['countriesAndRegions']) } else { @() }
            if (($beforeCountries -join ',') -ne ($afterCountries -join ',')) {
                $diff += "~ Countries: $($beforeCountries -join ', ') -> $($afterCountries -join ', ')"
            }
            if ($Before['includeUnknownCountriesAndRegions'] -ne $After['includeUnknownCountriesAndRegions']) {
                $diff += "~ Include Unknown: $($Before['includeUnknownCountriesAndRegions']) -> $($After['includeUnknownCountriesAndRegions'])"
            }
        }
    }

    if ($diff.Count -eq 0) {
        $diff += "No changes detected."
    }

    return $diff
}

function ConvertTo-CaNamedLocationHashtable {
    param($RawLocation)

    if ($null -eq $RawLocation) { return $null }

    $odataType = if ($RawLocation['@odata.type']) { [string]$RawLocation['@odata.type'] } elseif ($RawLocation.'@odata.type') { [string]$RawLocation.'@odata.type' } else { '' }
    $isIp = ($odataType -like '*ipNamedLocation*')
    $locType = if ($isIp) { 'ip' } else { 'country' }

    $id = if ($RawLocation['id']) { [string]$RawLocation['id'] } else { [string]$RawLocation.id }
    $displayName = if ($RawLocation['displayName']) { [string]$RawLocation['displayName'] } else { [string]$RawLocation.displayName }
    $isTrusted = if ($RawLocation['isTrusted']) { [bool]$RawLocation['isTrusted'] } elseif ($null -ne $RawLocation.isTrusted) { [bool]$RawLocation.isTrusted } else { $false }

    $ipRanges = @()
    $rawRanges = if ($RawLocation['ipRanges']) { @($RawLocation['ipRanges']) } elseif ($RawLocation.ipRanges) { @($RawLocation.ipRanges) } else { @() }
    foreach ($r in $rawRanges) {
        $cidr = if ($r['cidrAddress']) { [string]$r['cidrAddress'] } elseif ($r.cidrAddress) { [string]$r.cidrAddress } else { [string]$r }
        if (-not [string]::IsNullOrWhiteSpace($cidr)) { $ipRanges += $cidr }
    }

    $countries = if ($RawLocation['countriesAndRegions']) { @($RawLocation['countriesAndRegions']) } elseif ($RawLocation.countriesAndRegions) { @($RawLocation.countriesAndRegions) } else { @() }
    $includeUnknown = if ($RawLocation['includeUnknownCountriesAndRegions']) { [bool]$RawLocation['includeUnknownCountriesAndRegions'] } elseif ($null -ne $RawLocation.includeUnknownCountriesAndRegions) { [bool]$RawLocation.includeUnknownCountriesAndRegions } else { $false }
    $lookupMethod = if ($RawLocation['countryLookupMethod']) { [string]$RawLocation['countryLookupMethod'] } elseif ($RawLocation.countryLookupMethod) { [string]$RawLocation.countryLookupMethod } else { 'clientIpAddress' }

    return @{
        id                                = $id
        displayName                       = $displayName
        locationType                      = $locType
        isTrusted                         = $isTrusted
        ipRanges                          = $ipRanges
        countriesAndRegions               = $countries
        includeUnknownCountriesAndRegions = $includeUnknown
        countryLookupMethod               = $lookupMethod
    }
}

function Invoke-SetCaNamedLocation {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateSet('list', 'create', 'edit', 'delete')]
        [string]$Action,

        [Parameter()]
        [string]$LocationId = '',

        [Parameter()]
        [string]$DisplayName = '',

        [Parameter()]
        [string]$LocationType = '',

        [Parameter()]
        [string[]]$IpRanges = @(),

        [Parameter()]
        [bool]$IsTrusted = $false,

        [Parameter()]
        [string[]]$CountriesAndRegions = @(),

        [Parameter()]
        [bool]$IncludeUnknownCountriesAndRegions = $false,

        [Parameter()]
        [string]$CountryLookupMethod = 'clientIpAddress',

        [Parameter()]
        [string]$ConfirmName = '',

        [Parameter()]
        [bool]$DryRun = $false
    )

    if ($Action -eq 'list') {
        $response = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/identity/conditionalAccess/namedLocations' -ErrorAction Stop
        $rawItems = @()
        if ($response -and $response['value']) {
            $rawItems = @($response['value'])
        }
        elseif ($response -and $response.value) {
            $rawItems = @($response.value)
        }

        # Fetch policies to compute referencing policies
        $policiesResp = $null
        try {
            $policiesResp = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/identity/conditionalAccess/policies' -ErrorAction SilentlyContinue
        }
        catch {}

        $policyList = @()
        if ($policiesResp -and $policiesResp['value']) {
            $policyList = @($policiesResp['value'])
        }
        elseif ($policiesResp -and $policiesResp.value) {
            $policyList = @($policiesResp.value)
        }

        $items = @()
        foreach ($raw in $rawItems) {
            $itemHash = ConvertTo-CaNamedLocationHashtable -RawLocation $raw
            $locId = $itemHash['id']

            $refPolicies = @()
            foreach ($p in $policyList) {
                $cond = if ($p['conditions']) { $p['conditions'] } else { $p.conditions }
                if (-not $cond) { continue }
                $loc = if ($cond['locations']) { $cond['locations'] } else { $cond.locations }
                if (-not $loc) { continue }
                $inc = if ($loc['includeLocations']) { @($loc['includeLocations']) } elseif ($loc.includeLocations) { @($loc.includeLocations) } else { @() }
                $exc = if ($loc['excludeLocations']) { @($loc['excludeLocations']) } elseif ($loc.excludeLocations) { @($loc.excludeLocations) } else { @() }
                if ($inc -contains $locId -or $exc -contains $locId) {
                    $refPolicies += [pscustomobject]@{
                        id          = if ($p['id']) { [string]$p['id'] } else { [string]$p.id }
                        displayName = if ($p['displayName']) { [string]$p['displayName'] } else { [string]$p.displayName }
                    }
                }
            }

            $items += [pscustomobject]@{
                id                                = $itemHash['id']
                displayName                       = $itemHash['displayName']
                locationType                      = $itemHash['locationType']
                isTrusted                         = $itemHash['isTrusted']
                ipRanges                          = $itemHash['ipRanges']
                countriesAndRegions               = $itemHash['countriesAndRegions']
                includeUnknownCountriesAndRegions = $itemHash['includeUnknownCountriesAndRegions']
                countryLookupMethod               = $itemHash['countryLookupMethod']
                referencingPolicies               = $refPolicies
                inUse                             = ($refPolicies.Count -gt 0)
            }
        }

        return [pscustomobject]@{
            tenantId   = $TenantId
            totalCount = $items.Count
            items      = $items
        }
    }

    # Mutations (create, edit, delete)
    $before = $null
    $after = $null
    $targetName = $DisplayName
    $referencingPolicies = @()

    if ($Action -eq 'create') {
        if ([string]::IsNullOrWhiteSpace($DisplayName)) {
            throw "ValidationFailed: displayName is required"
        }
        if ([string]::IsNullOrWhiteSpace($LocationType)) {
            throw "ValidationFailed: locationType ('ip' or 'country') is required"
        }
        $targetName = $DisplayName

        $normCountries = @()
        if ($LocationType -eq 'country') {
            if ($CountriesAndRegions.Count -eq 0) {
                throw "ValidationFailed: At least one country code is required for country named location"
            }
            foreach ($c in $CountriesAndRegions) {
                if (-not (Test-CountryCodeFormat -Code $c)) {
                    throw "ValidationFailed: Invalid country code '$c'. Must be a 2-letter ISO 3166-1 alpha-2 code."
                }
                $normCountries += $c.Trim().ToUpperInvariant()
            }
        }
        elseif ($LocationType -eq 'ip') {
            if ($IpRanges.Count -eq 0) {
                throw "ValidationFailed: At least one CIDR IP range is required for IP named location"
            }
            foreach ($r in $IpRanges) {
                if (-not (Test-CidrFormat -Cidr $r)) {
                    throw "ValidationFailed: Invalid CIDR range '$r'. Must be valid IPv4 or IPv6 CIDR."
                }
            }
        }
        else {
            throw "ValidationFailed: Unsupported locationType '$LocationType'. Must be 'ip' or 'country'."
        }

        $after = @{
            displayName                       = $DisplayName
            locationType                      = $LocationType
            isTrusted                         = $IsTrusted
            ipRanges                          = @($IpRanges)
            countriesAndRegions               = $normCountries
            includeUnknownCountriesAndRegions = $IncludeUnknownCountriesAndRegions
            countryLookupMethod               = $CountryLookupMethod
        }
    }
    else {
        # edit or delete requires existing LocationId
        if ([string]::IsNullOrWhiteSpace($LocationId)) {
            throw "ValidationFailed: locationId is required for $Action"
        }

        $existingRaw = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/identity/conditionalAccess/namedLocations/$LocationId" -ErrorAction Stop
        $before = ConvertTo-CaNamedLocationHashtable -RawLocation $existingRaw
        $targetName = $before['displayName']
        $referencingPolicies = Get-CaReferencingPolicies -LocationId $LocationId

        if ($Action -eq 'edit') {
            $newDisplayName = if (-not [string]::IsNullOrWhiteSpace($DisplayName)) { $DisplayName } else { $before['displayName'] }
            $newType = $before['locationType']
            $targetName = $newDisplayName

            $newIpRanges = $before['ipRanges']
            $newCountries = $before['countriesAndRegions']
            $newTrusted = if ($PSBoundParameters.ContainsKey('IsTrusted')) { $IsTrusted } else { $before['isTrusted'] }
            $newIncludeUnknown = if ($PSBoundParameters.ContainsKey('IncludeUnknownCountriesAndRegions')) { $IncludeUnknownCountriesAndRegions } else { $before['includeUnknownCountriesAndRegions'] }

            if ($newType -eq 'ip') {
                if ($IpRanges.Count -gt 0) {
                    foreach ($r in $IpRanges) {
                        if (-not (Test-CidrFormat -Cidr $r)) {
                            throw "ValidationFailed: Invalid CIDR range '$r'. Must be valid IPv4 or IPv6 CIDR."
                        }
                    }
                    $newIpRanges = @($IpRanges)
                }
            }
            elseif ($newType -eq 'country') {
                if ($CountriesAndRegions.Count -gt 0) {
                    $normC = @()
                    foreach ($c in $CountriesAndRegions) {
                        if (-not (Test-CountryCodeFormat -Code $c)) {
                            throw "ValidationFailed: Invalid country code '$c'. Must be a 2-letter ISO 3166-1 alpha-2 code."
                        }
                        $normC += $c.Trim().ToUpperInvariant()
                    }
                    $newCountries = $normC
                }
            }

            $after = @{
                id                                = $LocationId
                displayName                       = $newDisplayName
                locationType                      = $newType
                isTrusted                         = $newTrusted
                ipRanges                          = $newIpRanges
                countriesAndRegions               = $newCountries
                includeUnknownCountriesAndRegions = $newIncludeUnknown
                countryLookupMethod               = $CountryLookupMethod
            }
        }
        elseif ($Action -eq 'delete') {
            if ($referencingPolicies.Count -gt 0) {
                # In-use location: check ConfirmName
                if ([string]::IsNullOrWhiteSpace($ConfirmName) -or ($ConfirmName.Trim() -ne $before['displayName'].Trim())) {
                    throw "ValidationFailed: Named location is referenced by $($referencingPolicies.Count) policies ($(($referencingPolicies | ForEach-Object { $_.displayName }) -join ', ')). Confirmation required: confirmName must match '$($before['displayName'])'."
                }
            }
            $after = $null
        }
    }

    $diff = Build-CaNamedLocationDiff -Before $before -After $after
    $inUse = ($referencingPolicies.Count -gt 0)

    $plan = [pscustomobject]@{
        action               = $Action
        locationId           = if ($LocationId) { $LocationId } else { $null }
        targetName           = $targetName
        before               = $before
        after                = $after
        diff                 = $diff
        valid                = $true
        dryRun               = $DryRun
        referencingPolicies  = $referencingPolicies
        inUse                = $inUse
        requiresConfirmation = ($Action -eq 'delete' -and $inUse)
        warning              = if ($inUse) { "Named location is currently referenced by $($referencingPolicies.Count) policy/policies." } else { $null }
    }

    if ($DryRun) {
        return [pscustomobject]@{
            success = $true
            plan    = $plan
        }
    }

    # Execute graph mutation
    $result = $null
    if ($Action -eq 'create') {
        $bodyHash = @{
            displayName = $after['displayName']
        }
        if ($after['locationType'] -eq 'ip') {
            $bodyHash['@odata.type'] = '#microsoft.graph.ipNamedLocation'
            $bodyHash['isTrusted'] = [bool]$after['isTrusted']
            $ranges = @()
            foreach ($r in $after['ipRanges']) {
                $rangeType = if ($r -match ':') { '#microsoft.graph.iPv6CidrRange' } else { '#microsoft.graph.iPv4CidrRange' }
                $ranges += @{
                    '@odata.type' = $rangeType
                    cidrAddress   = $r
                }
            }
            $bodyHash['ipRanges'] = $ranges
        }
        else {
            $bodyHash['@odata.type'] = '#microsoft.graph.countryNamedLocation'
            $bodyHash['countriesAndRegions'] = @($after['countriesAndRegions'])
            $bodyHash['includeUnknownCountriesAndRegions'] = [bool]$after['includeUnknownCountriesAndRegions']
            $bodyHash['countryLookupMethod'] = $after['countryLookupMethod']
        }

        $body = $bodyHash | ConvertTo-Json -Depth 10 -Compress
        $res = Invoke-MgGraphRequest -Method POST -Uri '/v1.0/identity/conditionalAccess/namedLocations' -Body $body -ErrorAction Stop
        $LocationId = if ($res -and $res.id) { [string]$res.id } else { [Guid]::NewGuid().ToString() }
        $plan.locationId = $LocationId
        $result = $res
    }
    elseif ($Action -eq 'edit') {
        $bodyHash = @{
            displayName = $after['displayName']
        }
        if ($after['locationType'] -eq 'ip') {
            $bodyHash['@odata.type'] = '#microsoft.graph.ipNamedLocation'
            $bodyHash['isTrusted'] = [bool]$after['isTrusted']
            $ranges = @()
            foreach ($r in $after['ipRanges']) {
                $rangeType = if ($r -match ':') { '#microsoft.graph.iPv6CidrRange' } else { '#microsoft.graph.iPv4CidrRange' }
                $ranges += @{
                    '@odata.type' = $rangeType
                    cidrAddress   = $r
                }
            }
            $bodyHash['ipRanges'] = $ranges
        }
        else {
            $bodyHash['@odata.type'] = '#microsoft.graph.countryNamedLocation'
            $bodyHash['countriesAndRegions'] = @($after['countriesAndRegions'])
            $bodyHash['includeUnknownCountriesAndRegions'] = [bool]$after['includeUnknownCountriesAndRegions']
            $bodyHash['countryLookupMethod'] = $after['countryLookupMethod']
        }

        $body = $bodyHash | ConvertTo-Json -Depth 10 -Compress
        $res = Invoke-MgGraphRequest -Method PATCH -Uri "/v1.0/identity/conditionalAccess/namedLocations/$LocationId" -Body $body -ErrorAction Stop
        $result = $res
    }
    elseif ($Action -eq 'delete') {
        Invoke-MgGraphRequest -Method DELETE -Uri "/v1.0/identity/conditionalAccess/namedLocations/$LocationId" -ErrorAction Stop
        $result = @{ deleted = $true }
    }

    $auditEvent = [pscustomobject]@{
        id         = [Guid]::NewGuid().ToString()
        tenantId   = $TenantId
        action     = "ca.namedLocation.$Action"
        targetId   = $LocationId
        targetName = $targetName
        timestamp  = (Get-Date).ToUniversalTime().ToString('o')
        before     = $before
        after      = $after
    }

    return [pscustomobject]@{
        success    = $true
        plan       = $plan
        result     = $result
        auditEvent = $auditEvent
    }
}
