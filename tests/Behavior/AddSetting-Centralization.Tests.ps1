BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
    $script:collectorRoot = Join-Path $repoRoot 'src/M365-Assess'
    $script:localWrapperPattern = '^\s*function\s+Add-Setting\b'

    # Collectors that may still define a local Add-Setting, with the reason. These are
    # NOT thin-wrapper duplicates of the shared helper, so #958's mechanical migration
    # does not apply as-is:
    #   Get-StrykerIncidentReadiness.ps1 - a custom wrapper with its own row shape that
    #   does not forward to Add-SecuritySetting and lacks the evidence schema; migrating
    #   it changes output and is tracked separately.
    $script:wrapperExceptions = @('Get-StrykerIncidentReadiness.ps1')

    $script:collectorFiles = Get-ChildItem -Path $script:collectorRoot -Recurse -Filter '*.ps1' |
        Where-Object { $_.Directory.Name -ne 'Common' }
}

Describe 'Add-Setting centralization (#958)' {

    It 'exports a single canonical Add-Setting from SecurityConfigHelper.ps1' {
        $helper = Join-Path $script:collectorRoot 'Common/SecurityConfigHelper.ps1'
        $defs = @(Select-String -Path $helper -Pattern $script:localWrapperPattern)
        $defs.Count | Should -Be 1 -Because 'the shared Add-Setting must be defined exactly once in the helper'
    }

    It 'has zero local Add-Setting wrappers in collectors (except documented exceptions)' {
        $locals = @($script:collectorFiles |
            Where-Object { $_.Name -notin $script:wrapperExceptions } |
            Select-String -Pattern $script:localWrapperPattern)
        $locals.Count | Should -Be 0 `
            -Because 'collectors must use the shared Add-Setting from SecurityConfigHelper.ps1, not a local wrapper'
    }

    It 'every file that still defines a local wrapper is a documented exception' {
        $remaining = @($script:collectorFiles |
            Where-Object { (Get-Content $_.FullName -Raw) -match $script:localWrapperPattern } |
            ForEach-Object { $_.Name })
        foreach ($name in $remaining) {
            $name | Should -BeIn $script:wrapperExceptions `
                -Because "$name still has a local Add-Setting wrapper but is not listed as an intentional exception"
        }
    }
}
