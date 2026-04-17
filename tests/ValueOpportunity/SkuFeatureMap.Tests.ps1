Describe 'sku-feature-map v2.1.0 schema' {
    BeforeAll {
        $mapPath = "$PSScriptRoot/../../src/M365-Assess/controls/sku-feature-map.json"
        $map = Get-Content $mapPath -Raw | ConvertFrom-Json
    }

    It 'Has featureGroups key at top level' {
        $map.PSObject.Properties.Name | Should -Contain 'featureGroups'
    }

    It 'First featureGroup entry has effortTier' {
        $first = $map.featureGroups.PSObject.Properties | Select-Object -First 1
        $first.Value.effortTier | Should -Not -BeNullOrEmpty
    }

    It 'First featureGroup entry has learnUrl' {
        $first = $map.featureGroups.PSObject.Properties | Select-Object -First 1
        $first.Value.learnUrl | Should -Not -BeNullOrEmpty
    }

    It 'First featureGroup entry has prerequisites field' {
        $first = $map.featureGroups.PSObject.Properties | Select-Object -First 1
        $first.Value.PSObject.Properties.Name | Should -Contain 'prerequisites'
    }
}
