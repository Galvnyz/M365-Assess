BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-AuditRetentionReport - with retention policies' {
    BeforeAll {
        function global:Write-AssessmentLog { param($Message, $Level) }

        function global:Get-AdminAuditLogConfig {
            return [PSCustomObject]@{
                UnifiedAuditLogIngestionEnabled = $true
                AdminAuditLogEnabled            = $true
                AdminAuditLogAgeLimit           = '90.00:00:00'
                AdminAuditLogCmdlets            = @('*')
            }
        }

        function global:Get-UnifiedAuditLogRetentionPolicy {
            return @(
                [PSCustomObject]@{
                    Name              = 'Default 90-Day Retention'
                    Identity          = 'Default 90-Day Retention'
                    RetentionDuration = '90'
                    RecordTypes       = @()
                    Operations        = @()
                    UserIds           = @()
                    Priority          = 1
                    Enabled           = $true
                }
            )
        }

        # Ensure Get-Command returns a result for both cmdlets
        Mock Get-Command {
            param($Name)
            if ($Name -eq 'Get-UnifiedAuditLogRetentionPolicy') {
                return [PSCustomObject]@{ Name = 'Get-UnifiedAuditLogRetentionPolicy' }
            }
            if ($Name -eq 'Get-AdminAuditLogConfig') {
                return [PSCustomObject]@{ Name = 'Get-AdminAuditLogConfig' }
            }
        }

        $script:result = & "$PSScriptRoot/../../src/M365-Assess/Purview/Get-AuditRetentionReport.ps1"
    }

    It 'returns a non-empty result' {
        @($script:result).Count | Should -BeGreaterThan 0
    }

    It 'first record has ItemType AuditConfig' {
        $auditConfigRecord = @($script:result) | Where-Object { $_.ItemType -eq 'AuditConfig' }
        $auditConfigRecord | Should -Not -BeNullOrEmpty
    }

    It 'AuditConfig record has UnifiedAuditLogIngestionEnabled property' {
        $auditConfigRecord = @($script:result) | Where-Object { $_.ItemType -eq 'AuditConfig' }
        $auditConfigRecord.PSObject.Properties.Name | Should -Contain 'UnifiedAuditLogIngestionEnabled'
    }

    It 'AuditConfig record has UnifiedAuditLogIngestionEnabled set to true' {
        $auditConfigRecord = @($script:result) | Where-Object { $_.ItemType -eq 'AuditConfig' }
        $auditConfigRecord.UnifiedAuditLogIngestionEnabled | Should -Be $true
    }

    It 'returns RetentionPolicy records when cmdlet available' {
        $retentionRecords = @($script:result) | Where-Object { $_.ItemType -eq 'RetentionPolicy' }
        $retentionRecords | Should -Not -BeNullOrEmpty
    }

    It 'all records have Name property' {
        foreach ($r in @($script:result)) {
            $r.PSObject.Properties.Name | Should -Contain 'Name'
        }
    }

    AfterAll {
        Remove-Item Function:\Write-AssessmentLog -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-AdminAuditLogConfig -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-UnifiedAuditLogRetentionPolicy -ErrorAction SilentlyContinue
    }
}

Describe 'Get-AuditRetentionReport - retention policy cmdlet unavailable' {
    BeforeAll {
        function global:Write-AssessmentLog { param($Message, $Level) }

        function global:Get-AdminAuditLogConfig {
            return [PSCustomObject]@{
                UnifiedAuditLogIngestionEnabled = $true
                AdminAuditLogEnabled            = $true
                AdminAuditLogAgeLimit           = '90.00:00:00'
                AdminAuditLogCmdlets            = @('*')
            }
        }

        # Do NOT define Get-UnifiedAuditLogRetentionPolicy to simulate it being unavailable
        # Mock Get-Command to return nothing for the retention policy cmdlet
        Mock Get-Command {
            param($Name)
            if ($Name -eq 'Get-UnifiedAuditLogRetentionPolicy') {
                return $null
            }
            if ($Name -eq 'Get-AdminAuditLogConfig') {
                return [PSCustomObject]@{ Name = 'Get-AdminAuditLogConfig' }
            }
        }

        $script:resultNoRetention = & "$PSScriptRoot/../../src/M365-Assess/Purview/Get-AuditRetentionReport.ps1" -WarningAction SilentlyContinue
    }

    It 'still returns the AuditConfig record' {
        $auditConfigRecord = @($script:resultNoRetention) | Where-Object { $_.ItemType -eq 'AuditConfig' }
        $auditConfigRecord | Should -Not -BeNullOrEmpty
    }

    It 'does not throw when retention cmdlet is unavailable' {
        {
            & "$PSScriptRoot/../../src/M365-Assess/Purview/Get-AuditRetentionReport.ps1" -WarningAction SilentlyContinue
        } | Should -Not -Throw
    }

    AfterAll {
        Remove-Item Function:\Write-AssessmentLog -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-AdminAuditLogConfig -ErrorAction SilentlyContinue
    }
}
