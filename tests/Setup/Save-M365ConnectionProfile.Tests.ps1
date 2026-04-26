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

Describe 'Profile path resolution (B1 #772)' {
    Context 'Get-ProfileConfigPath' {
        It 'should return a path under the per-user app-data root' {
            $path = Get-ProfileConfigPath
            $path | Should -Not -BeNullOrEmpty
            $appDataRoot = [Environment]::GetFolderPath('ApplicationData')
            $path | Should -BeLike "$appDataRoot*"
        }

        It 'should end with M365-Assess/profiles.json' {
            $path = Get-ProfileConfigPath
            # Use Split-Path to be path-separator-agnostic across platforms
            (Split-Path $path -Leaf) | Should -Be 'profiles.json'
            (Split-Path (Split-Path $path -Parent) -Leaf) | Should -Be 'M365-Assess'
        }

        It 'should NOT point at the module root anymore' {
            $newPath = Get-ProfileConfigPath
            $legacyPath = Get-LegacyProfileConfigPath
            $newPath | Should -Not -Be $legacyPath
        }
    }

    Context 'Get-LegacyProfileConfigPath' {
        It 'should return the module-root .m365assess.json path' {
            $path = Get-LegacyProfileConfigPath
            (Split-Path $path -Leaf) | Should -Be '.m365assess.json'
        }
    }

    Context 'Resolve-ProfileConfigPath' {
        It 'should prefer the new app-data path when it exists' {
            $newPath = Get-ProfileConfigPath
            Mock Test-Path -ParameterFilter { $LiteralPath -eq $newPath } { return $true }
            $resolved = Resolve-ProfileConfigPath
            $resolved | Should -Be $newPath
        }

        It 'should fall back to the legacy path when only legacy exists' {
            $newPath = Get-ProfileConfigPath
            $legacyPath = Get-LegacyProfileConfigPath
            Mock Test-Path -ParameterFilter { $LiteralPath -eq $newPath }    { return $false }
            Mock Test-Path -ParameterFilter { $LiteralPath -eq $legacyPath } { return $true }
            $resolved = Resolve-ProfileConfigPath
            $resolved | Should -Be $legacyPath
        }

        It 'should return the new path when neither file exists (so writes go there)' {
            $newPath = Get-ProfileConfigPath
            Mock Test-Path { return $false }
            $resolved = Resolve-ProfileConfigPath
            $resolved | Should -Be $newPath
        }
    }
}
