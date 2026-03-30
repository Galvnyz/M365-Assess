BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-DefenderPolicyReport' {
    BeforeAll {
        # Stub EXO/Defender cmdlets so Mock can find them
        function Get-OrganizationConfig { }
        function Get-SafeLinksPolicy { }
        function Get-SafeAttachmentPolicy { }

        # Mock connection guard — tenant is connected
        Mock Get-OrganizationConfig {
            return [PSCustomObject]@{ DisplayName = 'Contoso' }
        }

        # Mock Get-Command to indicate both Defender P1 cmdlets are available
        Mock Get-Command {
            param($Name, $ErrorAction)
            switch ($Name) {
                'Get-SafeLinksPolicy'      { return [PSCustomObject]@{ Name = 'Get-SafeLinksPolicy' } }
                'Get-SafeAttachmentPolicy' { return [PSCustomObject]@{ Name = 'Get-SafeAttachmentPolicy' } }
                default                    { return $null }
            }
        }

        # Safe Links policies
        Mock Get-SafeLinksPolicy {
            return @(
                [PSCustomObject]@{
                    Name                     = 'Built-In Protection Policy'
                    IsEnabled                = $true
                    DoNotTrackUserClicks     = $false
                    ScanUrls                 = $true
                    EnableForInternalSenders = $true
                    Priority                 = 0
                }
                [PSCustomObject]@{
                    Name                     = 'Custom Safe Links Policy'
                    IsEnabled                = $true
                    DoNotTrackUserClicks     = $true
                    ScanUrls                 = $false
                    EnableForInternalSenders = $false
                    Priority                 = 1
                }
            )
        }

        # Safe Attachments policies
        Mock Get-SafeAttachmentPolicy {
            return @(
                [PSCustomObject]@{
                    Name            = 'Built-In Protection Policy'
                    Enable          = $true
                    Action          = 'Block'
                    Redirect        = $false
                    RedirectAddress = ''
                    Priority        = 0
                }
            )
        }

        # Run the script by dot-sourcing it; capture output
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $script:results = . "$PSScriptRoot/../../src/M365-Assess/Security/Get-DefenderPolicyReport.ps1"
    }

    It 'Returns a non-empty results list' {
        $script:results.Count | Should -BeGreaterThan 0
    }

    It 'All results have required properties' {
        foreach ($r in $script:results) {
            $r.PSObject.Properties.Name | Should -Contain 'PolicyType'
            $r.PSObject.Properties.Name | Should -Contain 'Name'
            $r.PSObject.Properties.Name | Should -Contain 'Enabled'
            $r.PSObject.Properties.Name | Should -Contain 'Priority'
            $r.PSObject.Properties.Name | Should -Contain 'KeySettings'
        }
    }

    It 'PolicyType values are only SafeLinks or SafeAttachments' {
        $validTypes = @('SafeLinks', 'SafeAttachments')
        foreach ($r in $script:results) {
            $r.PolicyType | Should -BeIn $validTypes `
                -Because "PolicyType '$($r.PolicyType)' is not a recognised type"
        }
    }

    It 'Returns Safe Links policies' {
        $safeLinks = $script:results | Where-Object { $_.PolicyType -eq 'SafeLinks' }
        $safeLinks.Count | Should -BeGreaterThan 0
    }

    It 'Returns Safe Attachments policies' {
        $safeAttachments = $script:results | Where-Object { $_.PolicyType -eq 'SafeAttachments' }
        $safeAttachments.Count | Should -BeGreaterThan 0
    }

    It 'Safe Links entry has correct name from mock' {
        $entry = $script:results | Where-Object { $_.PolicyType -eq 'SafeLinks' -and $_.Name -eq 'Built-In Protection Policy' }
        $entry | Should -Not -BeNullOrEmpty
    }

    It 'Safe Links Enabled reflects IsEnabled from policy object' {
        $entry = $script:results | Where-Object { $_.PolicyType -eq 'SafeLinks' -and $_.Name -eq 'Built-In Protection Policy' }
        $entry.Enabled | Should -Be $true
    }

    It 'Safe Attachments Enabled reflects Enable from policy object' {
        $entry = $script:results | Where-Object { $_.PolicyType -eq 'SafeAttachments' -and $_.Name -eq 'Built-In Protection Policy' }
        $entry.Enabled | Should -Be $true
    }

    It 'KeySettings string includes expected fields for Safe Links' {
        $entry = $script:results | Where-Object { $_.PolicyType -eq 'SafeLinks' -and $_.Name -eq 'Built-In Protection Policy' }
        $entry.KeySettings | Should -Match 'IsEnabled='
        $entry.KeySettings | Should -Match 'ScanUrls='
        $entry.KeySettings | Should -Match 'DoNotTrackUserClicks='
    }

    It 'KeySettings string includes expected fields for Safe Attachments' {
        $entry = $script:results | Where-Object { $_.PolicyType -eq 'SafeAttachments' }
        $entry.KeySettings | Should -Match 'Enable='
        $entry.KeySettings | Should -Match 'Action='
        $entry.KeySettings | Should -Match 'Redirect='
    }

    It 'Priority is populated for policies that have it' {
        $withPriority = $script:results | Where-Object { $null -ne $_.Priority -and $_.Priority -ne 'N/A' }
        $withPriority.Count | Should -BeGreaterThan 0
    }

    It 'Returns 3 total policies (2 Safe Links + 1 Safe Attachments)' {
        $script:results.Count | Should -Be 3
    }
}

Describe 'Get-DefenderPolicyReport - Not Connected' {
    BeforeAll {
        function Get-OrganizationConfig { }
        function Get-SafeLinksPolicy { }
        function Get-SafeAttachmentPolicy { }

        # Mock connection guard to simulate not connected
        Mock Get-OrganizationConfig {
            throw 'The remote server returned an error: (401) Unauthorized.'
        }
    }

    It 'Writes an error and returns nothing when not connected' {
        # The script calls Write-Error with $ErrorActionPreference = 'Stop', so it throws.
        # Wrap in try/catch to absorb the terminating error; verify no PSCustomObject was emitted.
        $captured = @()
        try {
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            $captured = @(. "$PSScriptRoot/../../src/M365-Assess/Security/Get-DefenderPolicyReport.ps1")
        }
        catch {
            # Expected — Write-Error throws when ErrorActionPreference is Stop
        }
        $objects = @($captured | Where-Object { $_ -is [PSCustomObject] })
        $objects.Count | Should -Be 0
    }
}

Describe 'Get-DefenderPolicyReport - No Defender License' {
    BeforeAll {
        function Get-OrganizationConfig { }
        function Get-SafeLinksPolicy { }
        function Get-SafeAttachmentPolicy { }

        # Connection guard succeeds
        Mock Get-OrganizationConfig {
            return [PSCustomObject]@{ DisplayName = 'Contoso' }
        }

        # Get-Command returns null — neither Defender cmdlet is available
        Mock Get-Command {
            param($Name, $ErrorAction)
            return $null
        }
    }

    It 'Writes a warning and returns nothing when no Defender license' {
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $output = . "$PSScriptRoot/../../src/M365-Assess/Security/Get-DefenderPolicyReport.ps1" -WarningAction SilentlyContinue 3>&1
        $objects = @($output | Where-Object { $_ -is [PSCustomObject] })
        $objects.Count | Should -Be 0
    }
}

Describe 'Get-DefenderPolicyReport - OutputPath' {
    BeforeAll {
        function Get-OrganizationConfig { }
        function Get-SafeLinksPolicy { }
        function Get-SafeAttachmentPolicy { }

        Mock Get-OrganizationConfig {
            return [PSCustomObject]@{ DisplayName = 'Contoso' }
        }

        Mock Get-Command {
            param($Name, $ErrorAction)
            switch ($Name) {
                'Get-SafeLinksPolicy'      { return [PSCustomObject]@{ Name = 'Get-SafeLinksPolicy' } }
                'Get-SafeAttachmentPolicy' { return [PSCustomObject]@{ Name = 'Get-SafeAttachmentPolicy' } }
                default                    { return $null }
            }
        }

        Mock Get-SafeLinksPolicy {
            return @([PSCustomObject]@{
                Name                     = 'Built-In Protection Policy'
                IsEnabled                = $true
                DoNotTrackUserClicks     = $false
                ScanUrls                 = $true
                EnableForInternalSenders = $true
                Priority                 = 0
            })
        }

        Mock Get-SafeAttachmentPolicy {
            return @([PSCustomObject]@{
                Name            = 'Built-In Protection Policy'
                Enable          = $true
                Action          = 'Block'
                Redirect        = $false
                RedirectAddress = ''
                Priority        = 0
            })
        }

        $script:csvPath = [System.IO.Path]::GetTempFileName() -replace '\.tmp$', '.csv'
    }

    It 'Exports CSV when OutputPath is specified and writes confirmation message' {
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $msg = . "$PSScriptRoot/../../src/M365-Assess/Security/Get-DefenderPolicyReport.ps1" -OutputPath $script:csvPath
        $msg | Should -Match 'Exported'
        Test-Path $script:csvPath | Should -Be $true
        $imported = Import-Csv -Path $script:csvPath
        $imported.Count | Should -BeGreaterThan 0
    }

    AfterAll {
        if (Test-Path $script:csvPath) {
            Remove-Item -Path $script:csvPath -Force
        }
    }
}
