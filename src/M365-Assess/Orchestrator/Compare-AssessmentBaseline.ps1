function Compare-AssessmentBaseline {
    <#
    .SYNOPSIS
        Compares the current assessment results against a saved baseline.
    .DESCRIPTION
        Loads baseline JSON files from the given baseline folder and compares
        them row-by-row with the security-config CSVs in the current assessment
        folder. Each check is classified as:

          Regressed  - Status changed from Pass to Fail or Warning
          Improved   - Status changed from Fail/Warning to Pass
          Modified   - CurrentValue changed, Status unchanged
          New        - Check exists in current run but not in baseline
          Removed    - Check exists in baseline but not in current run

        Unchanged checks are excluded from the returned list but counted.
    .PARAMETER AssessmentFolder
        Path to the current assessment output folder (with live CSVs).
    .PARAMETER BaselineFolder
        Path to the named baseline folder created by Export-AssessmentBaseline.
    .PARAMETER RegistryVersion
        Registry data version of the current run (from controls/registry.json).
        Compared against the baseline manifest's RegistryVersion to decide
        whether to do a full or intersect-only comparison.
    .OUTPUTS
        [PSCustomObject[]] One entry per changed check with fields:
          CheckId, Setting, Category, Section, ChangeType,
          PreviousStatus, CurrentStatus, PreviousValue, CurrentValue
    .EXAMPLE
        $drift = Compare-AssessmentBaseline `
            -AssessmentFolder $assessmentFolder `
            -BaselineFolder '.\M365-Assessment\Baselines\Q1-2026_contoso.com'
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject[]])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$AssessmentFolder,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$BaselineFolder,

        [Parameter()]
        [string]$RegistryVersion = ''
    )

    if (-not (Test-Path -Path $BaselineFolder -PathType Container)) {
        Write-Error "Baseline folder not found: '$BaselineFolder'"
        return @()
    }

    # Read baseline manifest for version metadata
    $baselineRegistryVersion = ''
    $manifestPath = Join-Path -Path $BaselineFolder -ChildPath 'manifest.json'
    if (Test-Path -Path $manifestPath) {
        try {
            $manifestData = Get-Content -Path $manifestPath -Raw -ErrorAction Stop | ConvertFrom-Json
            $baselineRegistryVersion = $manifestData.RegistryVersion
        }
        catch { Write-Verbose "Drift: could not read manifest: $_" }
    }

    $crossVersionCompare = $RegistryVersion -and $baselineRegistryVersion -and ($RegistryVersion -ne $baselineRegistryVersion)

    # Build a lookup of all baseline checks: CheckId -> row object
    $baselineMap = @{}
    $baselineJsonFiles = Get-ChildItem -Path $BaselineFolder -Filter '*.json' -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne 'manifest.json' -and $_.Name -notlike '_*' }

    foreach ($jsonFile in $baselineJsonFiles) {
        try {
            $rows = Get-Content -Path $jsonFile.FullName -Raw -ErrorAction Stop | ConvertFrom-Json
            foreach ($row in $rows) {
                if ($row.CheckId) {
                    $baselineMap[$row.CheckId] = $row
                }
            }
        }
        catch {
            Write-Warning "Drift: could not load baseline file '$($jsonFile.Name)': $_"
        }
    }

    # Build a lookup of all current checks: CheckId -> row object + Section label
    $currentMap = @{}
    $csvFiles = Get-ChildItem -Path $AssessmentFolder -Filter '*.csv' -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notlike '_*' }

    foreach ($csvFile in $csvFiles) {
        try {
            $rows = Import-Csv -Path $csvFile.FullName -ErrorAction Stop
            if (-not $rows) { continue }
            $firstRow = $rows | Select-Object -First 1
            $props = $firstRow.PSObject.Properties.Name
            if ('CheckId' -notin $props -or 'Status' -notin $props) { continue }

            # Derive a section label from the filename (e.g. '18b-Defender-Security-Config' -> 'Defender')
            $sectionLabel = $csvFile.BaseName -replace '^\d+[a-z]*-', '' -replace '-Security-Config$', '' -replace '-', ' '

            foreach ($row in $rows) {
                if ($row.CheckId) {
                    $row | Add-Member -MemberType NoteProperty -Name '_Section' -Value $sectionLabel -Force
                    $currentMap[$row.CheckId] = $row
                }
            }
        }
        catch {
            Write-Warning "Drift: could not read '$($csvFile.Name)': $_"
        }
    }

    # In cross-version mode: only compare CheckIDs present in both snapshots.
    # New/removed CheckIDs are schema changes, not policy drift.
    $sharedIds = if ($crossVersionCompare) {
        $currentMap.Keys | Where-Object { $baselineMap.ContainsKey($_) }
    } else {
        $currentMap.Keys
    }

    $passStatuses = @('Pass')
    $failStatuses = @('Fail', 'Warning')

    $driftResults = [System.Collections.Generic.List[PSCustomObject]]::new()

    $previousDecisions = @{}
    $currentDecisions = @{}
    foreach ($pair in @(@{ Folder = $BaselineFolder; Map = $previousDecisions }, @{ Folder = $AssessmentFolder; Map = $currentDecisions })) {
        $sidecar = Join-Path -Path $pair.Folder -ChildPath '_Assessment-Decisions.json'
        if (Test-Path -LiteralPath $sidecar) {
            $document = Get-Content -LiteralPath $sidecar -Raw | ConvertFrom-Json
            foreach ($decision in $document.decisions) {
                $pair.Map["$($decision.checkId)`n$($decision.setting)"] = $decision
            }
        }
    }
    foreach ($key in @(@($previousDecisions.Keys) + @($currentDecisions.Keys) | Sort-Object -Unique)) {
        $previous = ConvertTo-Json -InputObject $previousDecisions[$key] -Depth 8 -Compress
        $current = ConvertTo-Json -InputObject $currentDecisions[$key] -Depth 8 -Compress
        if ($previous -ceq $current) { continue }
        $scope = $key -split "`n", 2
        $driftResults.Add([PSCustomObject]@{
            CheckId = $scope[0]; Setting = $scope[1]; Category = 'Assessor decision'; Section = 'Assessor decisions'
            ChangeType = 'Modified'; PreviousStatus = ''; CurrentStatus = ''
            PreviousValue = $previous; CurrentValue = $current
        })
    }
    # Check shared (or all) current items against baseline
    foreach ($checkId in $sharedIds) {
        $current  = $currentMap[$checkId]
        $baseline = $baselineMap[$checkId]

        if (-not $baseline) {
            # New check — only reported in same-version mode
            $driftResults.Add([PSCustomObject]@{
                CheckId        = $checkId
                Setting        = $current.Setting
                Category       = $current.Category
                Section        = $current._Section
                ChangeType     = 'New'
                PreviousStatus = ''
                CurrentStatus  = $current.Status
                PreviousValue  = ''
                CurrentValue   = $current.CurrentValue
            })
            continue
        }

        $prevStatus = $baseline.Status
        $currStatus = $current.Status
        $prevValue  = $baseline.CurrentValue
        $currValue  = $current.CurrentValue

        if ($prevStatus -eq $currStatus -and $prevValue -eq $currValue) {
            continue  # Unchanged — skip
        }

        $changeType = if ($prevStatus -in $failStatuses -and $currStatus -in $passStatuses) {
            'Improved'
        } elseif ($prevStatus -in $passStatuses -and $currStatus -in $failStatuses) {
            'Regressed'
        } else {
            'Modified'
        }

        $driftResults.Add([PSCustomObject]@{
            CheckId        = $checkId
            Setting        = $current.Setting
            Category       = $current.Category
            Section        = $current._Section
            ChangeType     = $changeType
            PreviousStatus = $prevStatus
            CurrentStatus  = $currStatus
            PreviousValue  = $prevValue
            CurrentValue   = $currValue
        })
    }

    if ($crossVersionCompare) {
        # Schema additions: in current but not in baseline registry
        foreach ($checkId in $currentMap.Keys) {
            if (-not $baselineMap.ContainsKey($checkId)) {
                $current = $currentMap[$checkId]
                $driftResults.Add([PSCustomObject]@{
                    CheckId        = $checkId
                    Setting        = $current.Setting
                    Category       = $current.Category
                    Section        = $current._Section
                    ChangeType     = 'SchemaNew'
                    PreviousStatus = ''
                    CurrentStatus  = $current.Status
                    PreviousValue  = ''
                    CurrentValue   = $current.CurrentValue
                })
            }
        }
        # Schema removals: in baseline but not in current registry
        foreach ($checkId in $baselineMap.Keys) {
            if (-not $currentMap.ContainsKey($checkId)) {
                $baseline = $baselineMap[$checkId]
                $driftResults.Add([PSCustomObject]@{
                    CheckId        = $checkId
                    Setting        = $baseline.Setting
                    Category       = $baseline.Category
                    Section        = ''
                    ChangeType     = 'SchemaRemoved'
                    PreviousStatus = $baseline.Status
                    CurrentStatus  = ''
                    PreviousValue  = $baseline.CurrentValue
                    CurrentValue   = ''
                })
            }
        }
    }
    else {
        # Same-version mode: removed checks are policy drift
        foreach ($checkId in $baselineMap.Keys) {
            if (-not $currentMap.ContainsKey($checkId)) {
                $baseline = $baselineMap[$checkId]
                $driftResults.Add([PSCustomObject]@{
                    CheckId        = $checkId
                    Setting        = $baseline.Setting
                    Category       = $baseline.Category
                    Section        = ''
                    ChangeType     = 'Removed'
                    PreviousStatus = $baseline.Status
                    CurrentStatus  = ''
                    PreviousValue  = $baseline.CurrentValue
                    CurrentValue   = ''
                })
            }
        }
    }

    return @($driftResults)
}
