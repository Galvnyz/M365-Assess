Describe 'Invoke-SafeGraphRequest' {
    BeforeAll {
        # Stub so Pester can mock it without the Graph SDK installed (CI convention)
        function Invoke-MgGraphRequest { param($Uri, $Method, $Body, $Headers, $OutputFilePath, $ErrorAction) }

        . "$PSScriptRoot/../../src/M365-Assess/Common/Invoke-SafeGraphRequest.ps1"
    }

    Context 'pagination' {
        It 'logs diagnostic context without query values, identifiers or raw error messages' {
            Mock Invoke-MgGraphRequest {
                $exception = [System.Exception]::new('sensitive raw response')
                $exception | Add-Member -NotePropertyName ResponseStatusCode -NotePropertyValue 403
                $record = [System.Management.Automation.ErrorRecord]::new($exception, 'GraphFailure', 'InvalidOperation', $null)
                $record.ErrorDetails = [System.Management.Automation.ErrorDetails]::new('{"error":{"code":"Authorization_RequestDenied","message":"private response"}}')
                throw $record
            }
            $warnings = @()
            try {
                Invoke-SafeGraphRequest -Uri '/v1.0/users/11111111-1111-1111-1111-111111111111/licenseDetails?$filter=secret' -WarningVariable warnings -WarningAction SilentlyContinue
            } catch { }
            $warnings.Count | Should -Be 1
            [string]$warnings[0] | Should -Match 'GET /v1.0/users/\{id\}/licenseDetails; page=1; HTTP=403; code=Authorization_RequestDenied'
            [string]$warnings[0] | Should -Not -Match 'secret|11111111|sensitive|private'
        }
        It 'merges value arrays across all pages and drops the nextLink' {
            Mock Invoke-MgGraphRequest {
                switch -Wildcard ($Uri) {
                    '*start*' { return @{ '@odata.context' = 'ctx'; value = @(1, 2); '@odata.nextLink' = 'https://graph.test/page2' } }
                    '*page2*' { return @{ value = @(3); '@odata.nextLink' = 'https://graph.test/page3' } }
                    default   { return @{ value = @(4, 5) } }
                }
            }

            $result = Invoke-SafeGraphRequest -Uri 'https://graph.test/start'

            @($result.value).Count | Should -Be 5
            $result['@odata.context'] | Should -Be 'ctx' -Because 'first-page metadata should carry over'
            $result.ContainsKey('@odata.nextLink') | Should -BeFalse -Because 'a merged result has no next page'
            Should -Invoke Invoke-MgGraphRequest -Times 3 -Exactly
        }

        It 'returns single-object (non-collection) responses unchanged' {
            Mock Invoke-MgGraphRequest { return @{ id = 'org-1'; displayName = 'Contoso' } }

            $result = Invoke-SafeGraphRequest -Uri 'https://graph.test/v1.0/organization/org-1'

            $result.displayName | Should -Be 'Contoso'
            $result.ContainsKey('value') | Should -BeFalse
        }

        It 'throws at the page cap and never returns partial observations' {
            Mock Invoke-MgGraphRequest { return @{ value = @(9); '@odata.nextLink' = 'https://graph.test/again' } }
            { Invoke-SafeGraphRequest -Uri '/v1.0/start' -MaxPages 3 -WarningAction SilentlyContinue } | Should -Throw '*GraphCollectionIncomplete*'
            Should -Invoke Invoke-MgGraphRequest -Times 3 -Exactly
        }
        It 'rejects malformed and null collections' -ForEach @(@{Value=$null}, @{Value='bad'}, @{Value=@{id='bad'}}) {
            Mock Invoke-MgGraphRequest { return @{ value = $Value } }
            { Invoke-SafeGraphRequest -Uri '/v1.0/start' -WarningAction SilentlyContinue } | Should -Throw '*GraphCollectionIncomplete*'
        }
        It 'does not return page one after a later permission failure' {
            Mock Invoke-MgGraphRequest { if ($Uri -eq '/v1.0/start') { return @{value=@(1); '@odata.nextLink'='/v1.0/next'} }; throw '403 Forbidden' }
            { Invoke-SafeGraphRequest -Uri '/v1.0/start' -WarningAction SilentlyContinue } | Should -Throw '*403*'
        }

        It 'handles an empty collection' {
            Mock Invoke-MgGraphRequest { return @{ value = @() } }

            $result = Invoke-SafeGraphRequest -Uri 'https://graph.test/empty'

            @($result.value).Count | Should -Be 0
        }

        It 'rejects a missing value array on an expected collection' {
            Mock Invoke-MgGraphRequest { @{ unexpected = 'shape' } }
            { Invoke-SafeGraphRequest -Uri '/v1.0/users' -ExpectCollection -WarningAction SilentlyContinue } | Should -Throw '*GraphCollectionIncomplete*'
        }

        It 'preserves explicit evidence sampling without following the next page' {
            Mock Invoke-MgGraphRequest { @{value=@(1); '@odata.nextLink'='/v1.0/next'} }
            $result=Invoke-SafeGraphRequest -Uri '/v1.0/auditLogs/signIns' -FirstPageOnly -ExpectCollection
            $result.value.Count | Should -Be 1
            Should -Invoke Invoke-MgGraphRequest -Times 1 -Exactly
        }

        It 'preserves SDK file downloads with null response bodies' {
            Mock Invoke-MgGraphRequest { Set-Content -LiteralPath $OutputFilePath -Value 'csv'; return $null }
            $path=Join-Path $TestDrive 'report.csv'
            { Invoke-SafeGraphRequest -Uri '/v1.0/reports/sample' -OutputFilePath $path } | Should -Not -Throw
            Get-Content $path | Should -Be 'csv'
        }

        It 'follows sovereign next links and retains headers' {
            Mock Invoke-MgGraphRequest {
                if ($Uri -eq '/v1.0/groups') { return @{value=@(1); '@odata.nextLink'='https://graph.microsoft.us/v1.0/groups?skip=2'} }
                return @{value=@(2)}
            }
            $result=Invoke-SafeGraphRequest -Uri '/v1.0/groups' -Headers @{ConsistencyLevel='eventual'}
            $result.value.Count | Should -Be 2
            Should -Invoke Invoke-MgGraphRequest -Times 1 -Exactly -ParameterFilter { $Uri -like 'https://graph.microsoft.us/*' -and $Headers.ConsistencyLevel -eq 'eventual' }
        }
    }

    Context 'transient-error retry' {
        It 'retries throttled requests and succeeds' {
            $script:flakyCalls = 0
            Mock Invoke-MgGraphRequest {
                $script:flakyCalls++
                if ($script:flakyCalls -eq 1) { throw 'Response status code does not indicate success: TooManyRequests' }
                return @{ value = @('recovered') }
            }
            Mock Start-Sleep { }

            $result = Invoke-SafeGraphRequest -Uri 'https://graph.test/flaky'

            @($result.value)[0] | Should -Be 'recovered'
            Should -Invoke Invoke-MgGraphRequest -Times 2 -Exactly
            Should -Invoke Start-Sleep -Times 1 -Exactly -Because 'backoff applies between attempts'
        }

        It 'rethrows after exhausting retries' {
            Mock Invoke-MgGraphRequest { throw 'Response status code does not indicate success: TooManyRequests' }
            Mock Start-Sleep { }

            { Invoke-SafeGraphRequest -Uri 'https://graph.test/alwaysflaky' -MaxRetries 2 } | Should -Throw
            Should -Invoke Invoke-MgGraphRequest -Times 3 -Exactly -Because 'initial attempt + 2 retries'
        }

        It 'does not retry non-transient errors' {
            Mock Invoke-MgGraphRequest { throw 'Response status code does not indicate success: Forbidden (403)' }
            Mock Start-Sleep { }

            { Invoke-SafeGraphRequest -Uri 'https://graph.test/forbidden' } | Should -Throw
            Should -Invoke Invoke-MgGraphRequest -Times 1 -Exactly -Because 'permission errors must surface immediately'
            Should -Invoke Start-Sleep -Times 0 -Exactly
        }
    }

    Context 'Get-GraphRetryDelay' {
        It 'returns $null for non-transient errors' {
            $errorRecord = $null
            try { throw 'Forbidden (403)' } catch { $errorRecord = $_ }
            Get-GraphRetryDelay -ErrorRecord $errorRecord -Attempt 1 | Should -BeNullOrEmpty
        }

        It 'returns exponential backoff for throttling without a Retry-After header' {
            $errorRecord = $null
            try { throw 'TooManyRequests' } catch { $errorRecord = $_ }
            Get-GraphRetryDelay -ErrorRecord $errorRecord -Attempt 1 | Should -Be 2
            Get-GraphRetryDelay -ErrorRecord $errorRecord -Attempt 3 | Should -Be 8
        }

        It 'caps the backoff at 60 seconds' {
            $errorRecord = $null
            try { throw 'ServiceUnavailable (503)' } catch { $errorRecord = $_ }
            Get-GraphRetryDelay -ErrorRecord $errorRecord -Attempt 8 | Should -Be 60
        }
    }
}
