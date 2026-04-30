# Issue #845: every framework JSON in controls/frameworks/ must declare either
# a native taxonomy (groupBy + groups) OR an explicit fallback decision
# (taxonomyDecision: "domain-fallback" + taxonomyReason). This regression
# guards against a maintainer silently dropping a taxonomy without an
# explicit decision — the React FrameworkQuilt panel falls back to a domain
# breakdown when groupBy is missing, but that fallback should be deliberate
# and documented, not accidental.

BeforeAll {
    $script:frameworksDir = "$PSScriptRoot/../../src/M365-Assess/controls/frameworks"
    # Aliases for the "groups" map — kept in sync with Import-FrameworkDefinitions.ps1
    # (issue #751: frameworks express their group taxonomy under a domain-natural
    # key like 'sections' for CIS, 'controls' for CIS Controls v8, 'families' for
    # CMMC, 'requirements' for PCI-DSS, etc. — all alias to 'groups' at load time).
    $script:groupsAliases = @('groups', 'sections', 'controls', 'families', 'requirements', 'clauses', 'functions')
    $script:frameworks = @()
    foreach ($f in Get-ChildItem -Path $script:frameworksDir -Filter '*.json') {
        $j = Get-Content -Raw -Path $f.FullName | ConvertFrom-Json
        $hasGroupsMap = $false
        foreach ($alias in $script:groupsAliases) {
            if ($j.PSObject.Properties[$alias]) { $hasGroupsMap = $true; break }
        }
        $script:frameworks += [pscustomobject]@{
            File             = $f.Name
            FrameworkId      = $j.frameworkId
            HasGroupBy       = [bool]$j.PSObject.Properties['groupBy']
            HasGroups        = $hasGroupsMap
            HasFallbackFlag  = ($j.PSObject.Properties['taxonomyDecision'] -and $j.taxonomyDecision -eq 'domain-fallback')
            HasFallbackReason = ($j.PSObject.Properties['taxonomyReason'] -and -not [string]::IsNullOrWhiteSpace($j.taxonomyReason))
        }
    }
}

Describe 'Framework taxonomy declarations (#845)' {
    It 'every framework declares either native taxonomy OR an explicit fallback' {
        foreach ($fw in $script:frameworks) {
            $hasNative   = $fw.HasGroupBy -and $fw.HasGroups
            $hasFallback = $fw.HasFallbackFlag -and $fw.HasFallbackReason
            ($hasNative -or $hasFallback) |
                Should -BeTrue -Because "$($fw.File) ($($fw.FrameworkId)) must declare either groupBy + groups OR taxonomyDecision: 'domain-fallback' + taxonomyReason — see docs/SCORING.md"
        }
    }

    It 'fallback frameworks include a non-empty taxonomyReason' {
        $fallbacks = $script:frameworks | Where-Object { $_.HasFallbackFlag }
        foreach ($fw in $fallbacks) {
            $fw.HasFallbackReason |
                Should -BeTrue -Because "$($fw.File) declares taxonomyDecision: 'domain-fallback' but is missing taxonomyReason — explain WHY native taxonomy was rejected"
        }
    }

    It 'frameworks with groupBy include a non-empty groups map' {
        $native = $script:frameworks | Where-Object { $_.HasGroupBy }
        foreach ($fw in $native) {
            $fw.HasGroups |
                Should -BeTrue -Because "$($fw.File) declares groupBy but no groups (or sections) map — the React panel renders empty rows"
        }
    }

    It 'reports current taxonomy coverage (informational)' {
        $total    = $script:frameworks.Count
        $native   = ($script:frameworks | Where-Object { $_.HasGroupBy -and $_.HasGroups }).Count
        $fallback = ($script:frameworks | Where-Object { $_.HasFallbackFlag }).Count
        Write-Host ("    [INFO] Total frameworks:   $total")
        Write-Host ("    [INFO] Native taxonomy:    $native")
        Write-Host ("    [INFO] Domain fallback:    $fallback")
        ($native + $fallback) | Should -Be $total
    }
}
