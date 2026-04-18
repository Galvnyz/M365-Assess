function ConvertTo-FrameworkFilter {
    <#
    .SYNOPSIS
        Parses framework sub-level notation into structured filter objects.
    .DESCRIPTION
        Accepts strings like 'CIS:E5:L2' or 'CMMC:L3' and returns objects
        describing which profiles/levels to include (cumulative/inclusive).
    .EXAMPLE
        ConvertTo-FrameworkFilter @('CIS:E5:L2', 'CMMC:L3')
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject[]])]
    param(
        [Parameter(Mandatory)][string[]]$Frameworks
    )

    # CIS cumulative profile sets — each level includes all lower tiers
    $cisCumulativeProfiles = @{
        'E3:L1' = @('E3-L1')
        'E3:L2' = @('E3-L1', 'E3-L2')
        'E5:L1' = @('E3-L1', 'E5-L1')
        'E5:L2' = @('E3-L1', 'E3-L2', 'E5-L1', 'E5-L2')
    }

    $cisDisplayLabels = @{
        'E3:L1' = 'CIS E3 Level 1'
        'E3:L2' = 'CIS E3 Level 2'
        'E5:L1' = 'CIS E5 Level 1'
        'E5:L2' = 'CIS E5 Level 2'
    }

    # CMMC cumulative level sets
    $cmmcCumulativeLevels = @{
        'L1' = @('L1')
        'L2' = @('L1', 'L2')
        'L3' = @('L1', 'L2', 'L3')
    }

    $cmmcDisplayLabels = @{
        'L1' = 'CMMC Level 1'
        'L2' = 'CMMC Level 2'
        'L3' = 'CMMC Level 3'
    }

    foreach ($entry in $Frameworks) {
        $parts = $entry -split ':'
        $family = $parts[0].ToUpper()

        switch ($family) {
            'CIS' {
                if ($parts.Count -ge 3) {
                    $qualifier = "$($parts[1].ToUpper()):$($parts[2].ToUpper())"
                    if ($cisCumulativeProfiles.ContainsKey($qualifier)) {
                        [pscustomobject]@{
                            Family       = 'CIS'
                            FilterFamily = 'CIS'
                            Profiles     = $cisCumulativeProfiles[$qualifier]
                            Levels       = $null
                            DisplayLabel = $cisDisplayLabels[$qualifier]
                            HasSubLevel  = $true
                        }
                    } else {
                        Write-Warning "ConvertTo-FrameworkFilter: Unknown CIS qualifier '$qualifier'. Valid: E3:L1, E3:L2, E5:L1, E5:L2"
                        [pscustomobject]@{ Family = 'CIS'; FilterFamily = 'CIS'; Profiles = $null; Levels = $null; DisplayLabel = 'CIS'; HasSubLevel = $false }
                    }
                } else {
                    [pscustomobject]@{ Family = 'CIS'; FilterFamily = 'CIS'; Profiles = $null; Levels = $null; DisplayLabel = 'CIS'; HasSubLevel = $false }
                }
            }
            'CMMC' {
                if ($parts.Count -ge 2) {
                    $level = $parts[1].ToUpper()
                    if ($cmmcCumulativeLevels.ContainsKey($level)) {
                        [pscustomobject]@{
                            Family       = 'CMMC'
                            FilterFamily = 'CMMC'
                            Levels       = $cmmcCumulativeLevels[$level]
                            Profiles     = $null
                            DisplayLabel = $cmmcDisplayLabels[$level]
                            HasSubLevel  = $true
                        }
                    } else {
                        Write-Warning "ConvertTo-FrameworkFilter: Unknown CMMC level '$level'. Valid: L1, L2, L3"
                        [pscustomobject]@{ Family = 'CMMC'; FilterFamily = 'CMMC'; Profiles = $null; Levels = $null; DisplayLabel = 'CMMC'; HasSubLevel = $false }
                    }
                } else {
                    [pscustomobject]@{ Family = 'CMMC'; FilterFamily = 'CMMC'; Profiles = $null; Levels = $null; DisplayLabel = 'CMMC 2.0'; HasSubLevel = $false }
                }
            }
            default {
                # Non-tiered frameworks (NIST, ISO, HIPAA, etc.) — pass through as-is
                [pscustomobject]@{
                    Family       = $family
                    FilterFamily = $family
                    Profiles     = $null
                    Levels       = $null
                    DisplayLabel = $parts[0]
                    HasSubLevel  = $false
                }
            }
        }
    }
}
