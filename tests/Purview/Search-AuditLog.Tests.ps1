BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Search-AuditLog' {
    BeforeAll {
        function global:Write-AssessmentLog { param($Message, $Level) }

        $script:callCount = 0

        # Define Search-UnifiedAuditLog as a global stub so the script can call it
        # and so Pester can override it with a Mock
        function global:Search-UnifiedAuditLog {
            param($StartDate, $EndDate, $ResultSize, $UserIds, $Operations, $RecordType, $SessionId, $SessionCommand)
        }

        Mock Get-Command {
            param($Name, $ErrorAction)
            if ($Name -eq 'Search-UnifiedAuditLog') {
                return [PSCustomObject]@{ Name = 'Search-UnifiedAuditLog' }
            }
        }

        Mock Search-UnifiedAuditLog {
            $script:callCount++
            if ($script:callCount -eq 1) {
                # First page — return 2 records with ResultCount = 2
                $auditDataJson = '{"ClientIP":"1.2.3.4","ObjectId":"file.txt","ItemType":"File","SiteUrl":"https://contoso.sharepoint.com","SourceFileName":"file.txt"}'
                return @(
                    [PSCustomObject]@{
                        CreationDate = [datetime]'2026-03-01 10:00:00'
                        UserIds      = 'alice@contoso.com'
                        Operations   = 'FileAccessed'
                        RecordType   = 'SharePointFileOperation'
                        ResultIndex  = 1
                        ResultCount  = 2
                        AuditData    = $auditDataJson
                    }
                    [PSCustomObject]@{
                        CreationDate = [datetime]'2026-03-01 11:00:00'
                        UserIds      = 'bob@contoso.com'
                        Operations   = 'FileDownloaded'
                        RecordType   = 'SharePointFileOperation'
                        ResultIndex  = 2
                        ResultCount  = 2
                        AuditData    = $auditDataJson
                    }
                )
            }
            else {
                # Subsequent pages — return nothing to stop pagination
                return @()
            }
        }

        $script:result = & "$PSScriptRoot/../../src/M365-Assess/Purview/Search-AuditLog.ps1" -StartDate ([datetime]'2026-03-01')
    }

    It 'returns parsed audit records' {
        @($script:result).Count | Should -BeGreaterThan 0
    }

    It 'result has CreationDate property' {
        $script:result[0].PSObject.Properties.Name | Should -Contain 'CreationDate'
    }

    It 'result has UserIds property' {
        $script:result[0].PSObject.Properties.Name | Should -Contain 'UserIds'
    }

    It 'result has Operations property' {
        $script:result[0].PSObject.Properties.Name | Should -Contain 'Operations'
    }

    It 'returns 2 records matching the mock ResultCount' {
        @($script:result).Count | Should -Be 2
    }

    It 'pagination returns correct total count without duplicates' {
        # 2 records returned with ResultCount=2; pagination should stop and not duplicate
        @($script:result).Count | Should -Be 2
    }

    AfterAll {
        Remove-Item Function:\Write-AssessmentLog -ErrorAction SilentlyContinue
        Remove-Item Function:\Search-UnifiedAuditLog -ErrorAction SilentlyContinue
    }
}

Describe 'Search-AuditLog - cmdlet unavailable' {
    BeforeAll {
        function global:Write-AssessmentLog { param($Message, $Level) }

        # Do NOT define Search-UnifiedAuditLog — simulates it not being available
        # The script uses: Get-Command -Name Search-UnifiedAuditLog -ErrorAction Stop
        # which will throw a CommandNotFoundException when the function does not exist
        # We mock Get-Command to throw, simulating the cmdlet not being available

        Mock Get-Command {
            param($Name, $ErrorAction)
            throw [System.Management.Automation.CommandNotFoundException]::new(
                "The term 'Search-UnifiedAuditLog' is not recognized."
            )
        }

        $script:unavailableResult = $null
        try {
            $script:unavailableResult = & "$PSScriptRoot/../../src/M365-Assess/Purview/Search-AuditLog.ps1" -StartDate ([datetime]'2026-03-01') -ErrorAction SilentlyContinue 2>$null
        }
        catch {
            # Script uses Write-Error and return — may not throw to caller
        }
    }

    It 'returns nothing when cmdlet is unavailable' {
        $script:unavailableResult | Should -BeNullOrEmpty
    }

    AfterAll {
        Remove-Item Function:\Write-AssessmentLog -ErrorAction SilentlyContinue
    }
}
