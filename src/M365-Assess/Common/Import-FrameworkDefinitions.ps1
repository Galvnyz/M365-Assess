function Import-FrameworkDefinitions {
    <#
    .SYNOPSIS
        Loads all framework definition JSON files and returns an ordered array.
    .DESCRIPTION
        Scans the specified directory for *.json files, parses each as a framework
        definition, applies defaults for missing fields, and returns an array of
        hashtables sorted by displayOrder. Invalid JSON files are skipped with a
        warning.
    .PARAMETER FrameworksPath
        Directory containing framework JSON files (e.g., controls/frameworks/).
    .OUTPUTS
        System.Collections.Hashtable[]
        Each hashtable contains: frameworkId, label, description, css, totalControls,
        displayOrder, scoringMethod, profiles, filterFamily.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$FrameworksPath
    )

    if (-not (Test-Path -Path $FrameworksPath -PathType Container)) {
        Write-Warning "Framework definitions directory not found: $FrameworksPath"
        return @()
    }

    $jsonFiles = Get-ChildItem -Path $FrameworksPath -Filter '*.json' -File -ErrorAction SilentlyContinue
    if (-not $jsonFiles -or @($jsonFiles).Count -eq 0) {
        Write-Warning "No framework JSON files found in: $FrameworksPath"
        return @()
    }

    # Prefix-to-filter-family mapping
    $prefixMap = @{
        'cis'       = 'CIS'
        'nist'      = 'NIST'
        'iso'       = 'ISO'
        'stig'      = 'STIG'
        'pci'       = 'PCI'
        'cmmc'      = 'CMMC'
        'hipaa'     = 'HIPAA'
        'cisa'      = 'CISA'
        'soc'       = 'SOC2'
        'fedramp'   = 'FedRAMP'
        'essential' = 'Essential8'
        'mitre'     = 'MITRE'
    }

    $frameworks = [System.Collections.Generic.List[hashtable]]::new()

    foreach ($file in $jsonFiles) {
        try {
            $raw = Get-Content -Path $file.FullName -Raw -ErrorAction Stop
            $def = $raw | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            Write-Warning "Skipping invalid framework JSON: $($file.Name) - $_"
            continue
        }

        if (-not $def.frameworkId -or -not $def.label) {
            Write-Warning "Skipping framework JSON missing frameworkId or label: $($file.Name)"
            continue
        }

        # Extract scoring method and profiles from the scoring object
        $scoringMethod = 'control-coverage'
        $profiles = $null
        if ($def.scoring -and $def.scoring.method) {
            $scoringMethod = $def.scoring.method
        }
        if ($def.scoring -and $def.scoring.profiles) {
            $profiles = @{}
            foreach ($prop in $def.scoring.profiles.PSObject.Properties) {
                $profileData = @{}
                if ($prop.Value.controlCount) {
                    $profileData['controlCount'] = [int]$prop.Value.controlCount
                }
                if ($prop.Value.label) {
                    $profileData['label'] = $prop.Value.label
                }
                if ($prop.Value.css) {
                    $profileData['css'] = $prop.Value.css
                }
                $profiles[$prop.Name] = $profileData
            }
        }

        # Derive filterFamily from frameworkId prefix (longest prefix first to avoid
        # 'cis' matching before 'cisa')
        $fwId = $def.frameworkId
        $filterFamily = ''
        foreach ($prefix in ($prefixMap.Keys | Sort-Object -Property Length -Descending)) {
            if ($fwId.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                $filterFamily = $prefixMap[$prefix]
                break
            }
        }
        if (-not $filterFamily) {
            # Fallback: uppercase the first segment before the first hyphen
            $filterFamily = ($fwId -split '-')[0].ToUpper()
        }

        # Preserve raw scoring sub-structures for catalog rendering
        $scoringData = @{}
        if ($def.scoring) {
            foreach ($prop in $def.scoring.PSObject.Properties) {
                $scoringData[$prop.Name] = $prop.Value
            }
        }

        # Preserve top-level structural keys outside scoring (strategies, controls, etc.)
        # Convert PSCustomObjects to hashtables so callers can use .Keys
        $extraKeys = @('strategies', 'controls', 'sections', 'nonAutomatableCriteria', 'licensingProfiles', 'groupBy')
        $extraData = @{}
        foreach ($key in $extraKeys) {
            if ($def.PSObject.Properties.Name -contains $key) {
                $val = $def.$key
                if ($val -is [System.Management.Automation.PSCustomObject]) {
                    $ht = @{}
                    foreach ($p in $val.PSObject.Properties) { $ht[$p.Name] = $p.Value }
                    $extraData[$key] = $ht
                }
                else {
                    $extraData[$key] = $val
                }
            }
        }

        $frameworks.Add(@{
            frameworkId   = $fwId
            label         = [string]$def.label
            description   = if ($def.description) { [string]$def.description } else { '' }
            homepageUrl   = if ($def.homepageUrl)  { [string]$def.homepageUrl  } else { '' }
            css           = if ($def.css) { [string]$def.css } else { 'fw-default' }
            totalControls = if ($def.totalControls) { [int]$def.totalControls } else { 0 }
            displayOrder  = if ($null -ne $def.displayOrder) { [int]$def.displayOrder } else { 999 }
            scoringMethod = $scoringMethod
            profiles      = $profiles
            filterFamily  = $filterFamily
            scoringData   = $scoringData
            extraData     = $extraData
        })
    }

    # Sort by displayOrder, then by frameworkId for stable ordering
    $sorted = @($frameworks | Sort-Object -Property { $_.displayOrder }, { $_.frameworkId })
    # Comma operator prevents PowerShell from unwrapping single-element arrays
    return , $sorted
}
