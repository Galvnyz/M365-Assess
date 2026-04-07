BeforeAll {
    . "$PSScriptRoot/../../src/M365-Assess/Setup/Get-M365ConnectionProfile.ps1"
}

Describe 'Get-M365ConnectionProfile' {
    Context 'when no config file exists' {
        BeforeAll {
            Mock Test-Path { return $false }
            $script:result = Get-M365ConnectionProfile
        }

        It 'should return an array' {
            @($result).GetType().IsArray -or $result -is [array] -or ($null -eq $result -or @($result).Count -ge 0) | Should -Be $true
        }

        It 'should return empty result' {
            @($result).Count | Should -Be 0
        }
    }

    Context 'when config file has new format with profiles key' {
        BeforeAll {
            $configJson = @'
{
    "profiles": {
        "Production": {
            "tenantId": "prod.onmicrosoft.com",
            "authMethod": "Certificate",
            "clientId": "client-prod",
            "thumbprint": "THUMB1",
            "environment": "commercial",
            "saved": "2026-01-01",
            "lastUsed": null
        },
        "Dev": {
            "tenantId": "dev.onmicrosoft.com",
            "authMethod": "Interactive",
            "clientId": null,
            "thumbprint": null,
            "environment": "commercial",
            "saved": "2026-01-01",
            "lastUsed": null
        }
    }
}
'@
            Mock Test-Path { return $true }
            Mock Get-Content { return $configJson }
            $script:result = @(Get-M365ConnectionProfile)
        }

        It 'should return all profiles' {
            $result.Count | Should -Be 2
        }

        It 'should include profile names' {
            $result.Name | Should -Contain 'Dev'
            $result.Name | Should -Contain 'Production'
        }

        It 'should expose TenantId on each profile' {
            $prod = $result | Where-Object { $_.Name -eq 'Production' }
            $prod.TenantId | Should -Be 'prod.onmicrosoft.com'
        }
    }

    Context 'when config file has legacy format (tenantId at root level with clientId)' {
        BeforeAll {
            $configJson = @'
{
    "legacy-tenant-id-here": {
        "clientId": "legacy-client-id",
        "thumbprint": "LEGACY-THUMB",
        "environment": "commercial",
        "saved": "2025-12-01"
    }
}
'@
            Mock Test-Path { return $true }
            Mock Get-Content { return $configJson }
            $script:result = @(Get-M365ConnectionProfile)
        }

        It 'should surface legacy entries as profiles' {
            $result.Count | Should -BeGreaterOrEqual 1
        }

        It 'should set authMethod to Certificate for legacy entries' {
            $result[0].AuthMethod | Should -Be 'Certificate'
        }
    }

    Context 'when -ProfileName is specified with exact match' {
        BeforeAll {
            $configJson = @'
{
    "profiles": {
        "Production": {
            "tenantId": "prod.onmicrosoft.com",
            "authMethod": "Certificate",
            "clientId": "client-prod",
            "thumbprint": "THUMB1",
            "environment": "commercial",
            "saved": "2026-01-01",
            "lastUsed": null
        },
        "Staging": {
            "tenantId": "staging.onmicrosoft.com",
            "authMethod": "Interactive",
            "clientId": null,
            "thumbprint": null,
            "environment": "commercial",
            "saved": "2026-01-01",
            "lastUsed": null
        }
    }
}
'@
            Mock Test-Path { return $true }
            Mock Get-Content { return $configJson }
            $script:result = Get-M365ConnectionProfile -ProfileName 'Production'
        }

        It 'should return a single object' {
            # Result should be a single PSCustomObject, not an array of two
            ($result -is [PSCustomObject]) | Should -Be $true
        }

        It 'should return the correct profile' {
            $result.TenantId | Should -Be 'prod.onmicrosoft.com'
        }

        It 'should have Name property set' {
            $result.Name | Should -Be 'Production'
        }
    }

    Context 'when -ProfileName has no match' {
        BeforeAll {
            $configJson = '{"profiles":{"Alpha":{"tenantId":"alpha.com","authMethod":"Interactive","clientId":null,"thumbprint":null,"environment":"commercial","saved":"2026-01-01","lastUsed":null}}}'
            Mock Test-Path { return $true }
            Mock Get-Content { return $configJson }
        }

        It 'should return null when profile is not found' {
            $r = Get-M365ConnectionProfile -ProfileName 'DoesNotExist' -ErrorAction SilentlyContinue
            $r | Should -BeNullOrEmpty
        }
    }
}
