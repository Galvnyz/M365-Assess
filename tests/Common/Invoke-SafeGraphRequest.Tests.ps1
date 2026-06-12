Describe 'Invoke-SafeGraphRequest' {
    BeforeAll {
        # Stub so Pester can mock it without the Graph SDK installed (CI convention)
        function Invoke-MgGraphRequest { param($Uri, $Method, $Body, $ErrorAction) }

        . "$PSScriptRoot/../../src/M365-Assess/Common/Invoke-SafeGraphRequest.ps1"
    }

    Context 'pagination' {
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

        It 'stops at the page cap with a warning instead of looping forever' {
            Mock Invoke-MgGraphRequest { return @{ value = @(9); '@odata.nextLink' = 'https://graph.test/again' } }

            $warnings = @()
            $result = Invoke-SafeGraphRequest -Uri 'https://graph.test/infinite' -MaxPages 3 -WarningVariable warnings -WarningAction SilentlyContinue

            @($result.value).Count | Should -Be 3
            @($warnings).Count | Should -BeGreaterThan 0 -Because 'truncation must never be silent'
        }

        It 'handles an empty collection' {
            Mock Invoke-MgGraphRequest { return @{ value = @() } }

            $result = Invoke-SafeGraphRequest -Uri 'https://graph.test/empty'

            @($result.value).Count | Should -Be 0
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
