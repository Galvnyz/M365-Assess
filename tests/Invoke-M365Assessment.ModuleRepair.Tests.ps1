BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Module repair detection' {
    BeforeAll {
        $scriptPath = "$PSScriptRoot/../Invoke-M365Assessment.ps1"
        $src = Get-Content -Path $scriptPath -Raw
    }

    Context 'Repair action structure' {
        It 'Should define repairActions list' {
            $src | Should -Match 'repairActions'
        }

        It 'Should check Graph module conditionally on needsGraph' {
            $src | Should -Match 'needsGraph.*-and.*-not.*graphModule'
        }

        It 'Should check EXO module conditionally on needsExo' {
            $src | Should -Match 'needsExo.*-and.*-not.*exoModule'
        }

        It 'Should check PowerBI module conditionally on needsPowerBI' {
            $src | Should -Match 'needsPowerBI.*-and.*-not.*PowerBI'
        }

        It 'Should include RequiredVersion field in repair actions' {
            $src | Should -Match 'RequiredVersion'
        }

        It 'Should set EXO RequiredVersion to 3.7.1' {
            $src | Should -Match "RequiredVersion.*=.*'3\.7\.1'"
        }
    }

    Context 'NonInteractive parameter' {
        It 'Should have NonInteractive switch parameter' {
            $src | Should -Match '\[switch\]\$NonInteractive'
        }

        It 'Should use NonInteractive to gate headless module repair path' {
            $src | Should -Match '\$NonInteractive\s+-or\s+-not\s+\[Environment\]::UserInteractive'
        }
    }

    Context 'Tier structure' {
        It 'Should define Install tier' {
            $src | Should -Match "Tier\s*=\s*'Install'"
        }

        It 'Should define Downgrade tier' {
            $src | Should -Match "Tier\s*=\s*'Downgrade'"
        }

        It 'Should define FileCopy tier' {
            $src | Should -Match "Tier\s*=\s*'FileCopy'"
        }
    }

    Context 'No Invoke-Expression' {
        It 'Should never use Invoke-Expression for module installation' {
            $src | Should -Not -Match 'Invoke-Expression.*Install-Module'
            $src | Should -Not -Match 'Invoke-Expression.*\$action\.InstallCmd'
        }
    }
}

Describe 'Module repair flow' {
    BeforeAll {
        $scriptPath = "$PSScriptRoot/../Invoke-M365Assessment.ps1"
        $src = Get-Content -Path $scriptPath -Raw
    }

    Context 'Presentation' {
        It 'Should display Module Issues Detected banner' {
            $src | Should -Match 'Module Issues Detected'
        }
    }

    Context 'Interactive repair' {
        It 'Should prompt for Tier 1 installs' {
            $src | Should -Match 'Install missing modules to CurrentUser scope'
        }

        It 'Should prompt separately for EXO downgrade' {
            $src | Should -Match 'Proceed with EXO downgrade'
        }

        It 'Should call Install-Module directly with splatted params' {
            $src | Should -Match 'Install-Module @installParams'
        }

        It 'Should not use Invoke-Expression' {
            $src | Should -Not -Match 'Invoke-Expression.*InstallCmd'
        }
    }

    Context 'Headless mode' {
        It 'Should skip prompts when NonInteractive or no user session' {
            $src | Should -Match '\$NonInteractive\s+-or\s+-not\s+\[Environment\]::UserInteractive'
        }

        It 'Should log errors for required issues in headless mode' {
            $src | Should -Match "Write-AssessmentLog.*-Level ERROR.*Module issue"
        }

        It 'Should skip optional sections in headless mode' {
            $src | Should -Match "Section.*Where-Object.*-ne.*PowerBI"
        }
    }

    Context 'Blocked scripts detection' {
        It 'Should check for Zone.Identifier alternate data streams' {
            $src | Should -Match 'Zone\.Identifier'
        }

        It 'Should display Blocked Scripts Detected banner' {
            $src | Should -Match 'Blocked Scripts Detected'
        }

        It 'Should prompt to Unblock-File in interactive mode' {
            $src | Should -Match 'Unblock-File'
        }

        It 'Should respect NonInteractive for blocked scripts path' {
            $src | Should -Match '\$NonInteractive\s+-or\s+-not\s+\[Environment\]::UserInteractive'
            $src | Should -Match 'Blocked scripts detected'
        }

        It 'Should only check on Windows' {
            $src | Should -Match '\$IsWindows.*-or.*\$null -eq \$IsWindows'
        }
    }

    Context 'Re-validation' {
        It 'Should re-run module detection after repairs' {
            $src | Should -Match 'Re-validat'
        }

        It 'Should show manual steps when repairs fail' {
            $src | Should -Match 'Unable to resolve all module issues'
        }
    }
}
