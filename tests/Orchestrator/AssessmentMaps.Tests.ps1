BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-AssessmentMaps' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentMaps.ps1"
        $maps = Get-AssessmentMaps
        function Get-MgContext { }
        function Write-AssessmentLog { param($Level, $Message, $Section) }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/Test-GraphPermissions.ps1"
    }

    It 'should return a hashtable' {
        $maps | Should -BeOfType [hashtable]
    }

    It 'should contain all expected top-level keys' {
        $expectedKeys = @('SectionServiceMap', 'SectionScopeMap', 'SectionModuleMap', 'CollectorMap', 'DnsCollector')
        foreach ($key in $expectedKeys) {
            $maps.ContainsKey($key) | Should -BeTrue -Because "maps should contain key '$key'"
        }
    }

    Context 'SectionServiceMap' {
        It 'should have a defined key for every section' {
            $maps.SectionServiceMap.Keys.Count | Should -BeGreaterOrEqual 10
        }

        It 'should contain known sections' {
            $requiredSections = @('Tenant', 'Identity', 'Email', 'Security', 'Collaboration')
            foreach ($section in $requiredSections) {
                $maps.SectionServiceMap.ContainsKey($section) | Should -BeTrue -Because "'$section' is a core section"
            }
        }

        It 'should use valid service names' {
            $validServices = @('Graph', 'ExchangeOnline', 'Purview', 'PowerBI')
            foreach ($section in $maps.SectionServiceMap.Keys) {
                foreach ($svc in $maps.SectionServiceMap[$section]) {
                    $svc | Should -BeIn $validServices -Because "$section references service '$svc'"
                }
            }
        }
    }

    Context 'SectionScopeMap' {
        It 'reports the two newly required scopes as actual preflight deficits' {
            Mock Get-MgContext {
                $scopeMap = (Get-AssessmentMaps).SectionScopeMap
                $granted = @($scopeMap.Identity + $scopeMap.Security | Where-Object { $_ -notin @('AccessReview.Read.All', 'DeviceManagementApps.Read.All') })
                [PSCustomObject]@{AuthType='Delegated';Scopes=$granted}
            }
            Test-GraphPermissions -RequiredScopes @($maps.SectionScopeMap.Identity + $maps.SectionScopeMap.Security) -SectionScopeMap $maps.SectionScopeMap -ActiveSections @('Identity','Security') -OutputFolder $TestDrive
            $deficits = Get-Content "$TestDrive/_PermissionDeficits.json" -Raw | ConvertFrom-Json
            $deficits.sections.Identity.missing | Should -Contain 'AccessReview.Read.All'
            $deficits.sections.Security.missing | Should -Contain 'DeviceManagementApps.Read.All'
            $deficits.missing.Count | Should -Be 2
        }
        It 'requests the read scopes required by access reviews and Intune security evidence' {
            $maps.SectionScopeMap.Identity | Should -Contain 'AccessReview.Read.All'
            foreach ($scope in @('DeviceManagementApps.Read.All', 'DeviceManagementConfiguration.Read.All', 'DeviceManagementRBAC.Read.All')) {
                $maps.SectionScopeMap.Security | Should -Contain $scope
            }
        }
        It 'should have entries for Graph-using sections' {
            $graphSections = @('Tenant', 'Identity', 'Licensing', 'Intune', 'Security', 'Collaboration', 'SOC2')
            foreach ($section in $graphSections) {
                $maps.SectionScopeMap.ContainsKey($section) | Should -BeTrue -Because "'$section' uses Graph and needs scopes"
            }
        }

        It 'should have arrays of scope strings' {
            foreach ($section in $maps.SectionScopeMap.Keys) {
                $scopes = $maps.SectionScopeMap[$section]
                foreach ($scope in $scopes) {
                    $scope | Should -BeOfType [string]
                }
            }
        }
    }

    Context 'SectionModuleMap' {
        It 'should have entries for non-EXO-only sections' {
            # Email section uses EXO only (no Graph modules) so it is intentionally absent
            $expectedSections = @('Tenant', 'Identity', 'Licensing', 'Intune', 'Security', 'Collaboration', 'PowerBI', 'Hybrid', 'Inventory', 'ActiveDirectory', 'SOC2')
            foreach ($section in $expectedSections) {
                $maps.SectionModuleMap.ContainsKey($section) | Should -BeTrue -Because "'$section' should have a module mapping"
            }
        }
    }

    Context 'CollectorMap' {
        It 'should be an ordered dictionary' {
            $maps.CollectorMap | Should -BeOfType [System.Collections.Specialized.OrderedDictionary]
        }

        It 'should have an entry for every section in the service map' {
            foreach ($section in $maps.SectionServiceMap.Keys) {
                $maps.CollectorMap.Contains($section) | Should -BeTrue -Because "'$section' needs collectors"
            }
        }

        It 'every collector should have Name, Script, and Label' {
            foreach ($section in $maps.CollectorMap.Keys) {
                foreach ($collector in $maps.CollectorMap[$section]) {
                    $collector.Name | Should -Not -BeNullOrEmpty -Because "collector in '$section' needs a Name"
                    $collector.Script | Should -Not -BeNullOrEmpty -Because "collector '$($collector.Name)' needs a Script path"
                    $collector.Label | Should -Not -BeNullOrEmpty -Because "collector '$($collector.Name)' needs a Label"
                }
            }
        }

        It 'every collector script path should reference an existing file' {
            $srcRoot = Join-Path $PSScriptRoot '../../src/M365-Assess'
            foreach ($section in $maps.CollectorMap.Keys) {
                foreach ($collector in $maps.CollectorMap[$section]) {
                    $fullPath = Join-Path $srcRoot $collector.Script
                    Test-Path -Path $fullPath | Should -BeTrue -Because "collector script '$($collector.Script)' should exist"
                }
            }
        }

        It 'collector names should be unique across all sections' {
            $allNames = foreach ($section in $maps.CollectorMap.Keys) {
                $maps.CollectorMap[$section] | ForEach-Object { $_.Name }
            }
            $allNames.Count | Should -Be ($allNames | Select-Object -Unique).Count
        }
    }

    Context 'DnsCollector' {
        It 'should have Name and Label' {
            $maps.DnsCollector.Name | Should -Not -BeNullOrEmpty
            $maps.DnsCollector.Label | Should -Not -BeNullOrEmpty
        }
    }
}
