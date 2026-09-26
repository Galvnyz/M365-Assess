BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Set-CaNamedLocation.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/set-ca-named-location.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker
}

Describe 'Set-CaNamedLocation worker (T-0288)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Invoke-SetCaNamedLocation -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-SetCaNamedLocationJob -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Test-CidrFormat -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Test-CountryCodeFormat -CommandType Function) | Should -Not -BeNullOrEmpty
        }
    }

    Context 'CIDR validation' {
        It 'validates IPv4 CIDR formats correctly' {
            Test-CidrFormat -Cidr '192.168.1.0/24' | Should -BeTrue
            Test-CidrFormat -Cidr '10.0.0.0/8' | Should -BeTrue
            Test-CidrFormat -Cidr '172.16.0.0/12' | Should -BeTrue
            Test-CidrFormat -Cidr '0.0.0.0/0' | Should -BeTrue
            Test-CidrFormat -Cidr '192.168.1.1/32' | Should -BeTrue

            Test-CidrFormat -Cidr 'invalid' | Should -BeFalse
            Test-CidrFormat -Cidr '192.168.1.1' | Should -BeFalse
            Test-CidrFormat -Cidr '999.999.999.999/24' | Should -BeFalse
            Test-CidrFormat -Cidr '192.168.1.0/33' | Should -BeFalse
            Test-CidrFormat -Cidr '' | Should -BeFalse
        }

        It 'validates IPv6 CIDR formats correctly' {
            Test-CidrFormat -Cidr '2001:db8::/32' | Should -BeTrue
            Test-CidrFormat -Cidr '::1/128' | Should -BeTrue
            Test-CidrFormat -Cidr 'fe80::/10' | Should -BeTrue

            Test-CidrFormat -Cidr '2001:db8::/129' | Should -BeFalse
            Test-CidrFormat -Cidr '2001:xyz::/32' | Should -BeFalse
        }
    }

    Context 'Country code validation' {
        It 'validates ISO 3166-1 alpha-2 codes' {
            Test-CountryCodeFormat -Code 'US' | Should -BeTrue
            Test-CountryCodeFormat -Code 'GB' | Should -BeTrue
            Test-CountryCodeFormat -Code 'ca' | Should -BeTrue

            Test-CountryCodeFormat -Code 'USA' | Should -BeFalse
            Test-CountryCodeFormat -Code '12' | Should -BeFalse
            Test-CountryCodeFormat -Code 'U' | Should -BeFalse
            Test-CountryCodeFormat -Code '' | Should -BeFalse
        }
    }

    Context 'List operation with policy references' {
        It 'queries named locations and correlates referencing policies' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Uri -eq '/v1.0/identity/conditionalAccess/namedLocations') {
                    return [pscustomobject]@{
                        value = @(
                            [pscustomobject]@{
                                '@odata.type' = '#microsoft.graph.ipNamedLocation'
                                id            = 'loc-1'
                                displayName   = 'HQ Office'
                                isTrusted     = $true
                                ipRanges      = @(
                                    [pscustomobject]@{ '@odata.type' = '#microsoft.graph.iPv4CidrRange'; cidrAddress = '10.0.0.0/8' }
                                )
                            },
                            [pscustomobject]@{
                                '@odata.type'        = '#microsoft.graph.countryNamedLocation'
                                id                   = 'loc-2'
                                displayName          = 'Allowed Regions'
                                countriesAndRegions  = @('US', 'CA')
                            }
                        )
                    }
                }
                if ($Uri -eq '/v1.0/identity/conditionalAccess/policies') {
                    return [pscustomobject]@{
                        value = @(
                            [pscustomobject]@{
                                id          = 'pol-100'
                                displayName = 'Require MFA from Outside'
                                conditions  = [pscustomobject]@{
                                    locations = [pscustomobject]@{
                                        includeLocations = @('All')
                                        excludeLocations = @('loc-1')
                                    }
                                }
                            }
                        )
                    }
                }
                return $null
            }

            $res = Invoke-SetCaNamedLocation -TenantId 'tenant-test' -Action 'list'
            $res.totalCount | Should -Be 2
            $hq = $res.items | Where-Object { $_.id -eq 'loc-1' }
            $hq.displayName | Should -Be 'HQ Office'
            $hq.inUse | Should -BeTrue
            $hq.referencingPolicies.Count | Should -Be 1
            $hq.referencingPolicies[0].displayName | Should -Be 'Require MFA from Outside'

            $regions = $res.items | Where-Object { $_.id -eq 'loc-2' }
            $regions.displayName | Should -Be 'Allowed Regions'
            $regions.inUse | Should -BeFalse
            $regions.referencingPolicies.Count | Should -Be 0
        }
    }

    Context 'Create operation' {
        It 'DryRun returns a plan preview without mutating' {
            $postCalled = $false
            Mock Invoke-MgGraphRequest {
                $postCalled = $true
            }

            $res = Invoke-SetCaNamedLocation -TenantId 'tenant-test' -Action 'create' -DisplayName 'Branch Office' -LocationType 'ip' -IpRanges @('192.168.1.0/24') -IsTrusted $true -DryRun $true
            $res.success | Should -BeTrue
            $res.plan.action | Should -Be 'create'
            $res.plan.targetName | Should -Be 'Branch Office'
            $res.plan.dryRun | Should -BeTrue
            $postCalled | Should -BeFalse
        }

        It 'creates an IP named location and emits an audit event' {
            $script:capturedBody = $null
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'POST') {
                    $script:capturedBody = $Body | ConvertFrom-Json -AsHashtable
                    return [pscustomobject]@{ id = 'new-loc-id'; displayName = 'Branch Office' }
                }
                return $null
            }

            $res = Invoke-SetCaNamedLocation -TenantId 'tenant-test' -Action 'create' -DisplayName 'Branch Office' -LocationType 'ip' -IpRanges @('192.168.1.0/24') -IsTrusted $true
            $res.success | Should -BeTrue
            $res.plan.locationId | Should -Be 'new-loc-id'
            $script:capturedBody['@odata.type'] | Should -Be '#microsoft.graph.ipNamedLocation'
            $script:capturedBody['isTrusted'] | Should -BeTrue
            $script:capturedBody['ipRanges'].Count | Should -Be 1
            $script:capturedBody['ipRanges'][0]['cidrAddress'] | Should -Be '192.168.1.0/24'

            $res.auditEvent | Should -Not -BeNullOrEmpty
            $res.auditEvent.action | Should -Be 'ca.namedLocation.create'
            $res.auditEvent.targetName | Should -Be 'Branch Office'
            $res.auditEvent.before | Should -BeNullOrEmpty
            $res.auditEvent.after | Should -Not -BeNullOrEmpty
        }

        It 'creates a country named location and normalizes codes to uppercase' {
            $script:capturedBody = $null
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'POST') {
                    $script:capturedBody = $Body | ConvertFrom-Json -AsHashtable
                    return [pscustomobject]@{ id = 'country-loc-id'; displayName = 'Allowed Countries' }
                }
                return $null
            }

            $res = Invoke-SetCaNamedLocation -TenantId 'tenant-test' -Action 'create' -DisplayName 'Allowed Countries' -LocationType 'country' -CountriesAndRegions @('us', 'ca')
            $res.success | Should -BeTrue
            $script:capturedBody['@odata.type'] | Should -Be '#microsoft.graph.countryNamedLocation'
            ($script:capturedBody['countriesAndRegions'] -contains 'US') | Should -BeTrue
            ($script:capturedBody['countriesAndRegions'] -contains 'CA') | Should -BeTrue
        }

        It 'rejects invalid CIDR when creating an IP named location' {
            { Invoke-SetCaNamedLocation -TenantId 'tenant-test' -Action 'create' -DisplayName 'Bad IP' -LocationType 'ip' -IpRanges @('999.999.999.999/24') } | Should -Throw "*Invalid CIDR range*"
        }

        It 'rejects invalid country code when creating a country named location' {
            { Invoke-SetCaNamedLocation -TenantId 'tenant-test' -Action 'create' -DisplayName 'Bad Country' -LocationType 'country' -CountriesAndRegions @('USA') } | Should -Throw "*Invalid country code*"
        }
    }

    Context 'Edit and Delete operations' {
        It 'edits an existing location and generates diff' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'GET' -and $Uri -eq '/v1.0/identity/conditionalAccess/namedLocations/loc-1') {
                    return [pscustomobject]@{
                        '@odata.type' = '#microsoft.graph.ipNamedLocation'
                        id            = 'loc-1'
                        displayName   = 'HQ Office'
                        isTrusted     = $false
                        ipRanges      = @([pscustomobject]@{ '@odata.type' = '#microsoft.graph.iPv4CidrRange'; cidrAddress = '10.0.0.0/8' })
                    }
                }
                if ($Method -eq 'GET' -and $Uri -eq '/v1.0/identity/conditionalAccess/policies') {
                    return [pscustomobject]@{ value = @() }
                }
                if ($Method -eq 'PATCH') {
                    return [pscustomobject]@{ id = 'loc-1' }
                }
                return $null
            }

            $res = Invoke-SetCaNamedLocation -TenantId 'tenant-test' -Action 'edit' -LocationId 'loc-1' -DisplayName 'HQ Office Updated' -IsTrusted $true
            $res.success | Should -BeTrue
            $res.plan.action | Should -Be 'edit'
            $res.auditEvent.action | Should -Be 'ca.namedLocation.edit'
            $res.auditEvent.before.displayName | Should -Be 'HQ Office'
            $res.auditEvent.after.displayName | Should -Be 'HQ Office Updated'
            ($res.plan.diff -join "`n") | Should -Match "DisplayName"
        }

        It 'blocks deleting an in-use location without confirmName' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'GET' -and $Uri -eq '/v1.0/identity/conditionalAccess/namedLocations/loc-1') {
                    return [pscustomobject]@{
                        '@odata.type' = '#microsoft.graph.ipNamedLocation'
                        id            = 'loc-1'
                        displayName   = 'HQ Office'
                    }
                }
                if ($Method -eq 'GET' -and $Uri -eq '/v1.0/identity/conditionalAccess/policies') {
                    return [pscustomobject]@{
                        value = @(
                            [pscustomobject]@{
                                id          = 'pol-1'
                                displayName = 'Policy 1'
                                conditions  = [pscustomobject]@{
                                    locations = [pscustomobject]@{
                                        includeLocations = @('loc-1')
                                    }
                                }
                            }
                        )
                    }
                }
                return $null
            }

            { Invoke-SetCaNamedLocation -TenantId 'tenant-test' -Action 'delete' -LocationId 'loc-1' } | Should -Throw "*Named location is referenced by 1 policies*"
        }

        It 'deletes an in-use location when confirmName matches' {
            $script:deleteCalled = $false
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'GET' -and $Uri -eq '/v1.0/identity/conditionalAccess/namedLocations/loc-1') {
                    return [pscustomobject]@{
                        '@odata.type' = '#microsoft.graph.ipNamedLocation'
                        id            = 'loc-1'
                        displayName   = 'HQ Office'
                    }
                }
                if ($Method -eq 'GET' -and $Uri -eq '/v1.0/identity/conditionalAccess/policies') {
                    return [pscustomobject]@{
                        value = @(
                            [pscustomobject]@{
                                id          = 'pol-1'
                                displayName = 'Policy 1'
                                conditions  = [pscustomobject]@{
                                    locations = [pscustomobject]@{
                                        includeLocations = @('loc-1')
                                    }
                                }
                            }
                        )
                    }
                }
                if ($Method -eq 'DELETE') {
                    $script:deleteCalled = $true
                    return $null
                }
                return $null
            }

            $res = Invoke-SetCaNamedLocation -TenantId 'tenant-test' -Action 'delete' -LocationId 'loc-1' -ConfirmName 'HQ Office'
            $res.success | Should -BeTrue
            $script:deleteCalled | Should -BeTrue
            $res.auditEvent.action | Should -Be 'ca.namedLocation.delete'
        }
    }
}
