<#
.SYNOPSIS
    Pester consistency tests that catch metadata drift between project files.

.DESCRIPTION
    Validates relationships BETWEEN files rather than individual file contents.
    Catches stale counts, framework mismatches, section list inconsistencies,
    and version drift across the manifest, registry, report script, and docs.
#>

BeforeAll {
    $projectRoot = Resolve-Path "$PSScriptRoot/../.."
    $moduleRoot  = Join-Path $projectRoot 'src/M365-Assess'
    $manifest    = Import-PowerShellDataFile -Path "$moduleRoot/M365-Assess.psd1"
    $registry    = Get-Content -Path "$moduleRoot/controls/registry.json" -Raw | ConvertFrom-Json
    $reportScript  = Get-Content -Path "$moduleRoot/Common/Export-AssessmentReport.ps1" -Raw
    $orchestrator  = @(
        Get-Content -Path "$moduleRoot/Invoke-M365Assessment.ps1" -Raw
        Get-ChildItem -Path "$moduleRoot/Orchestrator/*.ps1" | ForEach-Object { Get-Content $_.FullName -Raw }
    ) -join "`n"
}

Describe 'Metadata Consistency' {

    Context 'Manifest FileList coverage' {
        It 'Should list all production .ps1 files in FileList' {
            $actualPs1 = Get-ChildItem -Path $moduleRoot -Filter '*.ps1' -Recurse |
                Where-Object {
                    $_.FullName -notmatch '[\\/](tests|docs|\.claude|\.superpowers|M365-Assessment|node_modules|assets|controls)[\\/]' -and
                    $_.Name     -notmatch '^_tmp'
                } |
                ForEach-Object {
                    $_.FullName.Replace("$moduleRoot", '').TrimStart('\', '/').Replace('/', '\')
                } |
                Sort-Object

            $manifestList = @($manifest.FileList | Sort-Object)

            foreach ($file in $actualPs1) {
                $manifestList | Should -Contain $file -Because "'$file' exists on disk but is missing from the manifest FileList"
            }
        }

        It 'Should not list files in FileList that do not exist on disk' {
            foreach ($entry in $manifest.FileList) {
                $fullPath = Join-Path $moduleRoot $entry
                Test-Path -Path $fullPath | Should -Be $true -Because "FileList entry '$entry' does not exist on disk"
            }
        }
    }

    Context 'Framework definitions consistency' {
        It 'Should dot-source Import-FrameworkDefinitions in the report script' {
            $reportScript | Should -Match 'Import-FrameworkDefinitions\.ps1' -Because 'report must load framework definitions dynamically'
        }

        It 'Should load all framework JSONs via Import-FrameworkDefinitions' {
            . "$moduleRoot/Common/Import-FrameworkDefinitions.ps1"
            $fws = Import-FrameworkDefinitions -FrameworksPath "$moduleRoot/controls/frameworks"
            $fws.Count | Should -BeGreaterOrEqual 14 -Because 'all framework JSONs should load successfully'
        }

        It 'Should have every framework JSON specify a frameworkId matching a registry key' {
            . "$moduleRoot/Common/Import-FrameworkDefinitions.ps1"
            $fws = Import-FrameworkDefinitions -FrameworksPath "$moduleRoot/controls/frameworks"
            $regFwKeys = @($registry.checks | ForEach-Object {
                if ($_.frameworks) { $_.frameworks.PSObject.Properties.Name }
            } | Sort-Object -Unique)

            foreach ($fw in $fws) {
                $regFwKeys | Should -Contain $fw.frameworkId -Because "framework '$($fw.frameworkId)' should be referenced in at least one registry entry"
            }
        }
    }

    Context 'Section names consistency' {
        It 'Should define sectionServiceMap in the orchestrator' {
            $orchestrator | Should -Match '\$sectionServiceMap\s*=\s*@\{' -Because 'orchestrator must define $sectionServiceMap'
        }

        It 'Should have sectionServiceMap with at least 10 sections' {
            $sectionMatches = [regex]::Matches($orchestrator, "^\s+'(\w+)'\s*=\s*@\(", [System.Text.RegularExpressions.RegexOptions]::Multiline)
            # Filter to those inside the sectionServiceMap block
            $mapStart  = $orchestrator.IndexOf('$sectionServiceMap = @{')
            $mapEnd    = $orchestrator.IndexOf('}', $mapStart + 20)
            $mapBlock  = $orchestrator.Substring($mapStart, $mapEnd - $mapStart)
            $mapKeys   = [regex]::Matches($mapBlock, "^\s+'(\w+)'\s*=\s*@\(", [System.Text.RegularExpressions.RegexOptions]::Multiline) |
                         ForEach-Object { $_.Groups[1].Value }

            $mapKeys.Count | Should -BeGreaterOrEqual 10 -Because 'sectionServiceMap should cover at least 10 service sections'
        }
    }

    Context 'Registry integrity' {
        It 'Should have all automated checks reference a valid collector' {
            $validCollectors = @('Entra', 'CAEvaluator', 'ExchangeOnline', 'DNS', 'Defender', 'Compliance', 'Intune', 'SharePoint', 'Teams', 'PowerBI', 'Forms', 'PurviewRetention', 'EntApp', 'StrykerReadiness', 'AzAssess')
            $automated = @($registry.checks | Where-Object { $_.hasAutomatedCheck -eq $true })
            $automated.Count | Should -BeGreaterThan 0 -Because 'registry should contain automated checks'

            foreach ($check in $automated) {
                $check.collector | Should -BeIn $validCollectors -Because "$($check.checkId) references collector '$($check.collector)' which is not in the known collector list"
            }
        }

        It 'Should have no duplicate checkIds in the registry' {
            $allIds   = @($registry.checks | Select-Object -ExpandProperty checkId)
            $uniqueIds = @($allIds | Sort-Object -Unique)
            $allIds.Count | Should -Be $uniqueIds.Count -Because 'every checkId must be unique in the registry'
        }

        It 'Should have COMPLIANCE.md mention the current registry check count' {
            $compliancePath = Join-Path $projectRoot.Path 'COMPLIANCE.md'
            if (-not (Test-Path -Path $compliancePath)) {
                Set-ItResult -Skipped -Because 'COMPLIANCE.md does not exist in this repo'
                return
            }
            $complianceMd = Get-Content -Path $compliancePath -Raw
            $regCount     = $registry.checks.Count
            $complianceMd | Should -Match "\b$regCount\b" -Because "COMPLIANCE.md should reference the registry check count ($regCount)"
        }
    }

    Context 'Version consistency' {
        It 'Should have README badge matching manifest version' {
            $readme  = Get-Content -Path "$projectRoot/README.md" -Raw
            $version = $manifest.ModuleVersion
            $readme | Should -Match "version-$([regex]::Escape($version))-blue" -Because "README badge should reflect manifest version $version"
        }

        It 'Should have CHANGELOG entry for current manifest version' {
            $changelog = Get-Content -Path "$projectRoot/CHANGELOG.md" -Raw
            $version   = $manifest.ModuleVersion
            $changelog | Should -Match "\[$([regex]::Escape($version))\]" -Because "CHANGELOG should have a section for version $version"
        }

        It 'Should have manifest ReleaseNotes mention the current version' {
            $version      = $manifest.ModuleVersion
            $releaseNotes = $manifest.PrivateData.PSData.ReleaseNotes
            $releaseNotes | Should -Match "v$([regex]::Escape($version))" -Because "ReleaseNotes should reference the current version v$version"
        }
    }
}
