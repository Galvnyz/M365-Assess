BeforeDiscovery {
    # Domain folders migrated to the shared Add-Setting (#958). This list grows one
    # folder per PR; when every collector folder is listed and the repo-wide count
    # hits zero, the local-wrapper pattern is fully retired. Defined at discovery
    # time so the per-folder -ForEach below can enumerate it.
    $migratedFolders = @(
        'Collaboration'
    )
}

BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
    $script:collectorRoot = Join-Path $repoRoot 'src/M365-Assess'
    $script:localWrapperPattern = '^\s*function\s+Add-Setting\b'
}

Describe 'Add-Setting centralization (#958)' {

    It 'exports a single canonical Add-Setting from SecurityConfigHelper.ps1' {
        $helper = Join-Path $collectorRoot 'Common/SecurityConfigHelper.ps1'
        $defs = @(Select-String -Path $helper -Pattern $script:localWrapperPattern)
        $defs.Count | Should -Be 1 -Because 'the shared Add-Setting must be defined exactly once in the helper'
    }

    It 'has zero local Add-Setting wrappers in migrated folder <_>' -ForEach $migratedFolders {
        $path = Join-Path $script:collectorRoot $_
        $locals = @(Get-ChildItem -Path $path -Recurse -Filter '*.ps1' |
            Select-String -Pattern $script:localWrapperPattern)
        $locals.Count | Should -Be 0 -Because "collectors in $_ should use the shared Add-Setting, not a local wrapper"
    }

    It 'reports how many local wrappers remain across not-yet-migrated folders (informational)' {
        $allLocals = @(Get-ChildItem -Path $script:collectorRoot -Recurse -Filter '*.ps1' |
            Where-Object { $_.Directory.Name -ne 'Common' } |
            Select-String -Pattern $script:localWrapperPattern)
        Write-Host ("    [INFO] Local Add-Setting wrappers still to migrate: " + $allLocals.Count)
        $allLocals.Count | Should -BeGreaterOrEqual 0
    }
}
