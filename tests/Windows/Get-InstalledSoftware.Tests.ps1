BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-InstalledSoftware - local computer' {
    BeforeAll {
        function global:Write-AssessmentLog { param($Message, $Level) }

        Mock Get-ItemProperty {
            return @(
                [PSCustomObject]@{
                    DisplayName     = 'Microsoft 365 Apps for enterprise'
                    DisplayVersion  = '16.0.17628.20164'
                    Publisher       = 'Microsoft Corporation'
                    InstallDate     = '20260101'
                    InstallLocation = 'C:\Program Files\Microsoft Office'
                    UninstallString = 'C:\Program Files\Common Files\Microsoft Shared\ClickToRun\OfficeClickToRun.exe scenario=install scenariosubtype=ARP'
                }
                [PSCustomObject]@{
                    DisplayName     = 'Google Chrome'
                    DisplayVersion  = '123.0.6312.87'
                    Publisher       = 'Google LLC'
                    InstallDate     = '20260201'
                    InstallLocation = 'C:\Program Files\Google\Chrome\Application'
                    UninstallString = 'C:\Program Files\Google\Chrome\Application\123.0.6312.87\Installer\setup.exe --uninstall'
                }
            )
        }

        $script:result = & "$PSScriptRoot/../../src/M365-Assess/Windows/Get-InstalledSoftware.ps1" -ComputerName $env:COMPUTERNAME
    }

    It 'returns an array of software objects' {
        @($script:result).Count | Should -BeGreaterThan 0
    }

    It 'all results have DisplayName property' {
        foreach ($s in @($script:result)) {
            $s.PSObject.Properties.Name | Should -Contain 'DisplayName'
        }
    }

    It 'all results have DisplayVersion property' {
        foreach ($s in @($script:result)) {
            $s.PSObject.Properties.Name | Should -Contain 'DisplayVersion'
        }
    }

    It 'all results have Publisher property' {
        foreach ($s in @($script:result)) {
            $s.PSObject.Properties.Name | Should -Contain 'Publisher'
        }
    }

    It 'all results have ComputerName property' {
        foreach ($s in @($script:result)) {
            $s.PSObject.Properties.Name | Should -Contain 'ComputerName'
        }
    }

    It 'all results have Architecture property' {
        foreach ($s in @($script:result)) {
            $s.PSObject.Properties.Name | Should -Contain 'Architecture'
        }
    }

    It 'DisplayName values are non-empty strings' {
        foreach ($s in @($script:result)) {
            $s.DisplayName | Should -Not -BeNullOrEmpty
        }
    }

    AfterAll {
        Remove-Item Function:\Write-AssessmentLog -ErrorAction SilentlyContinue
    }
}

Describe 'Get-InstalledSoftware - empty registry' {
    BeforeAll {
        function global:Write-AssessmentLog { param($Message, $Level) }

        # Return objects with no DisplayName so they get filtered out by the source script
        # Source filter: Where-Object { $_.DisplayName -and $_.DisplayName.Trim() -ne '' }
        Mock Get-ItemProperty {
            return @(
                [PSCustomObject]@{
                    DisplayName     = ''
                    DisplayVersion  = $null
                    Publisher       = $null
                    InstallDate     = $null
                    InstallLocation = $null
                    UninstallString = $null
                }
            )
        }

        $script:emptyResult = & "$PSScriptRoot/../../src/M365-Assess/Windows/Get-InstalledSoftware.ps1" -ComputerName $env:COMPUTERNAME
    }

    It 'returns no entries with valid DisplayName when registry has no named entries' {
        # Even if the internal filtering produces some entries, none should have a valid DisplayName
        $namedEntries = @($script:emptyResult) | Where-Object { $_.DisplayName -and $_.DisplayName.Trim() -ne '' -and $_.DisplayName -notlike 'ERROR:*' }
        $namedEntries | Should -BeNullOrEmpty
    }

    AfterAll {
        Remove-Item Function:\Write-AssessmentLog -ErrorAction SilentlyContinue
    }
}

Describe 'Get-InstalledSoftware - unreachable remote computer' {
    BeforeAll {
        function global:Write-AssessmentLog { param($Message, $Level) }

        Mock Invoke-Command {
            throw [System.Exception]::new('Cannot connect to REMOTEPC')
        }

        $script:remoteErrorResult = & "$PSScriptRoot/../../src/M365-Assess/Windows/Get-InstalledSoftware.ps1" -ComputerName 'REMOTEPC' -WarningAction SilentlyContinue
    }

    It 'does not throw for unreachable remote computers' {
        {
            & "$PSScriptRoot/../../src/M365-Assess/Windows/Get-InstalledSoftware.ps1" -ComputerName 'REMOTEPC' -WarningAction SilentlyContinue
        } | Should -Not -Throw
    }

    It 'returns an error entry for the unreachable computer' {
        $errorEntry = @($script:remoteErrorResult) | Where-Object { $_.DisplayName -like 'ERROR:*' }
        $errorEntry | Should -Not -BeNullOrEmpty
    }

    AfterAll {
        Remove-Item Function:\Write-AssessmentLog -ErrorAction SilentlyContinue
    }
}
