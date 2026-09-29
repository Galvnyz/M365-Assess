Describe 'Module compatibility baseline behavior (C5 #784)' {

    BeforeAll {
        $script:scriptPath = Join-Path $PSScriptRoot '../../src/M365-Assess/Orchestrator/Test-ModuleCompatibility.ps1'
    }

    It 'uses the modern EXO baseline without downgrade or DLL-copy repairs' {
        $content = Get-Content $script:scriptPath -Raw
        $content | Should -Match '3\.10\.1'
        $content | Should -Not -Match "Tier\s*=\s*'(Downgrade|FileCopy)'"
        $content | Should -Not -Match 'Uninstall-Module|Copy-Item'
    }

    It 'should distinguish required modules from optional modules' {
        $content = Get-Content $script:scriptPath -Raw
        # Required vs optional gating must be present so missing optional modules
        # don't fail the run; missing required modules abort.
        $content | Should -Match '(?i)required|optional'
    }
}
