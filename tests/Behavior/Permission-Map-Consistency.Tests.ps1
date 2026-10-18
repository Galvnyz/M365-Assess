BeforeAll {
    . (Join-Path $PSScriptRoot '../../src/M365-Assess/Orchestrator/AssessmentMaps.ps1')
    $script:maps = Get-AssessmentMaps
}

Describe 'Permission map consistency (C5 #784)' {

    Context 'SectionScopeMap' {
        It 'should be defined as a hashtable' {
            $script:maps.SectionScopeMap | Should -BeOfType [hashtable]
        }

        It 'should have at least the well-known Graph-using sections' {
            # Email is intentionally absent -- it uses EXO, not Graph delegated scopes.
            foreach ($s in @('Tenant', 'Identity', 'Intune', 'Security', 'Collaboration')) {
                $script:maps.SectionScopeMap.ContainsKey($s) | Should -BeTrue -Because "section '$s' uses Graph and is referenced throughout the codebase"
            }
        }

        It 'should have populated scope arrays for sections that touch Graph' {
            # Sections marked as using Graph in SectionServiceMap should have at least one delegated scope
            foreach ($section in $script:maps.SectionScopeMap.Keys) {
                $services = @($script:maps.SectionServiceMap[$section])
                if ($services -contains 'Graph') {
                    $scopes = @($script:maps.SectionScopeMap[$section])
                    # Section that touches Graph but has zero scopes is a documentation drift; allow only sections explicitly excluded
                    if ($scopes.Count -eq 0 -and $section -notin @('PowerBI', 'ActiveDirectory')) {
                        # PowerBI and ActiveDirectory are exceptions -- PowerBI runs in a child process, AD is local-only
                        throw "Section '$section' is mapped to Graph in SectionServiceMap but has zero entries in SectionScopeMap"
                    }
                }
            }
        }
    }

    Context 'every section in CollectorMap appears in SectionServiceMap' {
        It 'should be mapped to its services' {
            foreach ($section in $script:maps.CollectorMap.Keys) {
                $script:maps.SectionServiceMap.ContainsKey($section) | Should -BeTrue -Because "section '$section' has collectors but no service map entry"
            }
        }
    }

    Context 'Graph-using sections have a SectionScopeMap entry' {
        It 'should have a (possibly empty) scope array for every Graph-using collector section' {
            foreach ($section in $script:maps.CollectorMap.Keys) {
                $services = @($script:maps.SectionServiceMap[$section])
                if ($services -contains 'Graph') {
                    $script:maps.SectionScopeMap.ContainsKey($section) | Should -BeTrue -Because "section '$section' uses Graph but has no scope map entry"
                }
            }
        }
    }
}

Describe 'Intune enrollment delegated scopes (#1031)' {
    It 'Requests read-only service configuration access alongside existing Intune scopes' {
        foreach ($scope in @('DeviceManagementServiceConfig.Read.All', 'DeviceManagementConfiguration.Read.All', 'DeviceManagementManagedDevices.Read.All')) {
            $script:maps.SectionScopeMap.Intune | Should -Contain $scope
        }
    }
}
