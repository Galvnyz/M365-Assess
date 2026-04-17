BeforeAll {
    $mapPath = Join-Path $PSScriptRoot '../../src/M365-Assess/controls/sku-feature-map.json'
    $map = Get-Content $mapPath -Raw | ConvertFrom-Json
    $groups = @($map.featureGroups.PSObject.Properties)
}

Describe 'SKU Feature Map Schema' {
    It 'Should have a version field' {
        $map.version | Should -Match '^\d+\.\d+\.\d+$'
    }

    It 'Should have at least 20 featureGroups' {
        $groups.Count | Should -BeGreaterOrEqual 20
    }

    It 'Should have skuTiers with E3 and E5' {
        $map.skuTiers.PSObject.Properties.Name | Should -Contain 'E3'
        $map.skuTiers.PSObject.Properties.Name | Should -Contain 'E5'
    }

    It 'Should have no duplicate featureGroup keys' {
        $keys = @($groups | ForEach-Object { $_.Name })
        $keys.Count | Should -Be ($keys | Sort-Object -Unique).Count
    }

    It 'Should have valid effortTier values on every featureGroup' {
        $validTiers = @('Quick Win', 'Medium', 'Strategic')
        foreach ($g in $groups) {
            $g.Value.effortTier | Should -BeIn $validTiers -Because "$($g.Name) has invalid effortTier"
        }
    }

    It 'Should have servicePlans as non-empty array on every featureGroup' {
        foreach ($g in $groups) {
            $g.Value.servicePlans | Should -Not -BeNullOrEmpty -Because "$($g.Name) needs servicePlans"
        }
    }

    It 'Should have detectionChecks property on every featureGroup' {
        foreach ($g in $groups) {
            $g.Value.PSObject.Properties.Name | Should -Contain 'detectionChecks' -Because "$($g.Name) needs detectionChecks"
        }
    }

    It 'Should have learnUrl on every featureGroup' {
        foreach ($g in $groups) {
            $g.Value.learnUrl | Should -Match '^https://' -Because "$($g.Name) needs a Learn URL"
        }
    }

    It 'Should not use STANDARD sentinel in servicePlans' {
        foreach ($g in $groups) {
            $g.Value.servicePlans | Should -Not -Contain 'STANDARD' -Because "$($g.Name) should use a real service plan ID"
        }
    }

    It 'Should have prerequisites as an array on every featureGroup' {
        foreach ($g in $groups) {
            $g.Value.PSObject.Properties.Name | Should -Contain 'prerequisites' -Because "$($g.Name) needs prerequisites array"
        }
    }

    It 'Should have prerequisite IDs that reference valid featureGroup keys' {
        $keys = @($groups | ForEach-Object { $_.Name })
        foreach ($g in $groups) {
            foreach ($prereq in $g.Value.prerequisites) {
                $keys | Should -Contain $prereq -Because "$($g.Name) references unknown prerequisite '$prereq'"
            }
        }
    }

    It 'Should reference detectionChecks that exist in registry.json' {
        $registryPath = Join-Path $PSScriptRoot '../../src/M365-Assess/controls/registry.json'
        $registry = Get-Content $registryPath -Raw | ConvertFrom-Json
        $registryIds = @($registry.checks | ForEach-Object { $_.checkId })
        foreach ($g in $groups) {
            foreach ($checkId in $g.Value.detectionChecks) {
                $registryIds | Should -Contain $checkId -Because "$($g.Name) references CheckId '$checkId' which must exist in registry.json"
            }
        }
    }
}
