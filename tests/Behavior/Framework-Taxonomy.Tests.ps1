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

# Issue #948: a groups map can exist yet still be incomplete — cis-m365-v6.json
# shipped without keys "4" (Intune) and "9" (Fabric) while the registry mapped
# checks into both sections, so the React FrameworkQuilt rendered the bare
# numeric code ("4") as the group name (report-app.jsx: groupNames[code] || code).
# This cross-checks every group key derivable from registry controlIds against
# the framework's groups map, so a registry sync can never reintroduce an
# unlabeled group silently.
Describe 'Framework group maps cover all registry-mapped groups (#948)' {
    BeforeAll {
        $script:registry = Get-Content -Raw -Path "$PSScriptRoot/../../src/M365-Assess/controls/registry.json" | ConvertFrom-Json

        # Mirror of GROUP_EXTRACTORS in assets/report-app.jsx — kept in sync by hand.
        # If a strategy is added there, add it here or the new framework is skipped.
        $script:groupExtractors = @{
            'section-prefix'           = { param($cid) if ($cid -match '^(\d+)')        { $Matches[1] } }
            'family-letter-prefix'     = { param($cid) if ($cid -match '^([A-Z]{2,3})') { $Matches[1] } }
            'dot-prefix'               = { param($cid) if ($cid -match '^([A-Z]+)\.')   { $Matches[1] } }
            'iso-clause-prefix'        = { param($cid) if ($cid -match '^(A\.\d+)')     { $Matches[1] } }
            'hipaa-section'            = { param($cid) if ($cid -match '^164\.(\d+)')   { $Matches[1] } }
            'essential-eight-practice' = { param($cid) if ($cid -match '-P(\d+)')       { $Matches[1] } }
            'scuba-service'            = { param($cid) if ($cid -match '^(MS\.[A-Z]+)') { $Matches[1] } }
            'soc2-tsc-prefix'          = { param($cid)
                if ($cid.StartsWith('CC')) { 'CC' }
                elseif ($cid.StartsWith('PI')) { 'PI' }
                elseif ($cid -match '^([ACP])\d') { $Matches[1] }
            }
        }

        # No exceptions: when this fails on a registry sync, add the missing
        # label to the framework JSON rather than weakening the assertion.
        # Note: iso-27002.json labels groups 9/10 ("Performance Evaluation",
        # "Improvement") even though ISO 27002:2022 has no clauses 9/10 — the
        # registry currently maps iso-27001 and iso-27002 identically (#858 /
        # #871), so ISO 27001 management-clause ids leak into iso-27002 until
        # the upstream CheckID/SCF divergence lands. Drop those two labels
        # when #871 closes.
    }

    It 'every group key extracted from registry controlIds has a display name' {
        foreach ($f in Get-ChildItem -Path $script:frameworksDir -Filter '*.json') {
            $fw = Get-Content -Raw -Path $f.FullName | ConvertFrom-Json
            if (-not $fw.PSObject.Properties['groupBy']) { continue }
            $extract = $script:groupExtractors[[string]$fw.groupBy]
            if (-not $extract) { continue }

            $groupsMap = $null
            foreach ($alias in $script:groupsAliases) {
                if ($fw.PSObject.Properties[$alias]) { $groupsMap = $fw.$alias; break }
            }
            if (-not $groupsMap) { continue }
            $known = @($groupsMap.PSObject.Properties.Name)

            $registryKey = if ($fw.registryKey) { [string]$fw.registryKey } else { [string]$fw.frameworkId }

            $missing = [System.Collections.Generic.SortedSet[string]]::new()
            foreach ($check in $script:registry.checks) {
                $mapping = $check.frameworks.PSObject.Properties[$registryKey]
                if (-not $mapping -or -not $mapping.Value.controlId) { continue }
                foreach ($cid in ([string]$mapping.Value.controlId -split '[;,]')) {
                    $cid = $cid.Trim()
                    if (-not $cid) { continue }
                    $key = & $extract $cid
                    if ($key -and $known -notcontains $key) {
                        $null = $missing.Add($key)
                    }
                }
            }

            @($missing) | Should -BeNullOrEmpty -Because "$($f.Name) groups map is missing keys [$($missing -join ', ')] referenced by registry '$registryKey' controlIds — these render as raw codes in the report's framework breakdown (issue #948)"
        }
    }
}
