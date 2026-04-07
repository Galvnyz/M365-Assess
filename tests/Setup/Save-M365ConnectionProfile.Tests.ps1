BeforeAll {
    . "$PSScriptRoot/../../src/M365-Assess/Setup/Save-M365ConnectionProfile.ps1"
}

Describe 'Set-M365ConnectionProfile (Save-M365ConnectionProfile alias)' {
    Context 'when creating a new profile where no config exists' {
        BeforeAll {
            $script:writtenContent = $null
            Mock Test-Path { return $false }
            Mock Get-Content { return '{"profiles":{}}' }
            Mock Set-Content {
                param($Path, $Value, $Encoding)
                $script:writtenContent = $Value
            }

            Set-M365ConnectionProfile -ProfileName 'NewProfile' -TenantId 'newco.onmicrosoft.com' -AuthMethod 'Interactive' -M365Environment 'commercial'
        }

        It 'should write content that is non-empty' {
            $writtenContent | Should -Not -BeNullOrEmpty
        }

        It 'should write content that includes the profile name' {
            $writtenContent | Should -Match 'NewProfile'
        }

        It 'should write content that includes the tenant ID' {
            $writtenContent | Should -Match 'newco.onmicrosoft.com'
        }
    }

    Context 'when adding a new profile to an existing config' {
        BeforeAll {
            $existingJson = '{"profiles":{"ExistingProfile":{"tenantId":"existing.com","authMethod":"Interactive","environment":"commercial","saved":"2026-01-01","lastUsed":null}}}'
            $script:writtenContent = $null
            Mock Test-Path { return $true }
            Mock Get-Content { return $existingJson }
            Mock Set-Content {
                param($Path, $Value, $Encoding)
                $script:writtenContent = $Value
            }

            Set-M365ConnectionProfile -ProfileName 'NewProfile2' -TenantId 'newco2.onmicrosoft.com' -AuthMethod 'DeviceCode' -M365Environment 'commercial'
        }

        It 'should preserve existing profile in written content' {
            $writtenContent | Should -Match 'ExistingProfile'
        }

        It 'should include the new profile in written content' {
            $writtenContent | Should -Match 'NewProfile2'
        }

        It 'should include new tenant ID in written content' {
            $writtenContent | Should -Match 'newco2.onmicrosoft.com'
        }
    }

    Context 'when overwriting an existing profile with the same name' {
        BeforeAll {
            $existingJson = '{"profiles":{"Alpha":{"tenantId":"old.com","authMethod":"Interactive","environment":"commercial","saved":"2026-01-01","lastUsed":null}}}'
            $script:writtenContent = $null
            Mock Test-Path { return $true }
            Mock Get-Content { return $existingJson }
            Mock Set-Content {
                param($Path, $Value, $Encoding)
                $script:writtenContent = $Value
            }

            Set-M365ConnectionProfile -ProfileName 'Alpha' -TenantId 'new.com' -AuthMethod 'Interactive' -M365Environment 'commercial'
        }

        It 'should write updated content' {
            $writtenContent | Should -Match 'new.com'
        }

        It 'should not retain the old tenant ID' {
            $writtenContent | Should -Not -Match 'old.com'
        }
    }

    Context 'when Certificate auth is used with required parameters' {
        BeforeAll {
            $script:writtenContent = $null
            Mock Test-Path { return $false }
            Mock Get-Content { return '{"profiles":{}}' }
            Mock Set-Content {
                param($Path, $Value, $Encoding)
                $script:writtenContent = $Value
            }

            Set-M365ConnectionProfile -ProfileName 'CertProfile' -TenantId 'cert.onmicrosoft.com' `
                -AuthMethod 'Certificate' -ClientId 'my-client-id' -CertificateThumbprint 'MYTHUMB123'
        }

        It 'should write clientId into config' {
            $writtenContent | Should -Match 'my-client-id'
        }

        It 'should write thumbprint into config' {
            $writtenContent | Should -Match 'MYTHUMB123'
        }
    }

    Context 'when Certificate auth is used without required parameters' {
        It 'should write an error when ClientId is missing' {
            Mock Test-Path { return $false }
            Mock Get-Content { return '{"profiles":{}}' }
            Mock Set-Content {}

            {
                Set-M365ConnectionProfile -ProfileName 'BadCert' -TenantId 'x.com' `
                    -AuthMethod 'Certificate' -CertificateThumbprint 'THUMB' -ErrorAction Stop
            } | Should -Throw
        }
    }
}

Describe 'Save-M365ConnectionProfile alias' {
    It 'should be an alias for Set-M365ConnectionProfile' {
        $alias = Get-Alias -Name 'Save-M365ConnectionProfile' -ErrorAction SilentlyContinue
        $alias | Should -Not -BeNullOrEmpty
    }
}
