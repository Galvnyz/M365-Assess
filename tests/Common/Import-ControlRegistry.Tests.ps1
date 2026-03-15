Describe 'Import-ControlRegistry' {
    BeforeAll {
        . "$PSScriptRoot/../../Common/Import-ControlRegistry.ps1"
        $testRoot = "$PSScriptRoot/../../controls"
    }

    It 'Returns a hashtable keyed by CheckId' {
        $registry = Import-ControlRegistry -ControlsPath $testRoot
        $registry | Should -BeOfType [hashtable]
        $registry.Keys | Should -Contain 'ENTRA-ADMIN-001'
    }

    It 'Each entry contains frameworks object' {
        $registry = Import-ControlRegistry -ControlsPath $testRoot
        $entry = $registry['ENTRA-ADMIN-001']
        $entry.frameworks | Should -Not -BeNullOrEmpty
        $entry.frameworks.'cis-m365-v6'.controlId | Should -Not -BeNullOrEmpty
    }

    It 'Builds a reverse lookup from CIS control ID to CheckId' {
        $registry = Import-ControlRegistry -ControlsPath $testRoot
        $reverseLookup = $registry['__cisReverseLookup']
        $reverseLookup['1.1.3'] | Should -Not -BeNullOrEmpty
        $reverseLookup['1.1.3'] | Should -Match '^[A-Z]+-[A-Z]+-\d{3}$'
    }

    It 'Returns empty hashtable when registry not found' {
        $result = Import-ControlRegistry -ControlsPath (Join-Path $TestDrive 'nonexistent') -WarningAction SilentlyContinue
        $result.Count | Should -Be 0
    }
}
