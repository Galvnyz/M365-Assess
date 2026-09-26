BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Invoke-BecCheck.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/invoke-bec-check.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker

    $script:recentStamp = (Get-Date).ToUniversalTime().AddDays(-1).ToString('yyyy-MM-ddTHH:mm:ssZ')
    $script:oldStamp = (Get-Date).ToUniversalTime().AddDays(-60).ToString('yyyy-MM-ddTHH:mm:ssZ')

    function script:New-ClearMock {
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri, $Body)
            if ($Uri -like '*messageRules*') {
                return @{ value = @(@{ id = 'rule-9'; displayName = 'Archive newsletters'; actions = @{ moveToFolder = 'archive' } }) }
            }
            if ($Uri -like '*createdDateTime ge*') {
                return @{ value = @() }
            }
            if ($Uri -like '*oauth2PermissionGrants*') {
                return @{ value = @() }
            }
            if ($Uri -like '*sentitems*') {
                return @{ value = @(@{ subject = 'Weekly notes'; createdDateTime = $script:oldStamp }) }
            }
            if ($Uri -like '*authentication/methods*') {
                return @{ value = @(@{ '@odata.type' = '#microsoft.graph.phoneAuthenticationMethod'; createdDateTime = $script:oldStamp }) }
            }
            if ($Uri -like '*lastPasswordChangeDateTime*') {
                return @{ lastPasswordChangeDateTime = $script:oldStamp }
            }
            if ($Uri -like '*managedDevices*') {
                return @{ value = @(@{ deviceName = 'LT-01'; complianceState = 'compliant'; managedDeviceOwnerType = 'company'; enrolledDateTime = $script:oldStamp }) }
            }
            if ($Uri -like '*auditLogs/signIns*') {
                return @{ value = @(@{ createdDateTime = $script:recentStamp; ipAddress = '10.0.0.1'; location = @{ countryOrRegion = 'US' } }) }
            }
            if ($Uri -like '*/permissions*') {
                return @{ value = @(@{ link = @{ scope = 'organization'; type = 'view' } }) }
            }
            if ($Uri -like '*/drive/root/children*') {
                return @{ value = @(@{ id = 'item-1'; name = 'Plan.docx' }) }
            }
            return @{ value = @() }
        }
    }
}

Describe 'Invoke-BecCheck worker (T-0207)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Invoke-BecCheck -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Invoke-BecFindingRemediation -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-BecCheckJob -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Get-BecCheckNames -CommandType Function) | Should -Not -BeNullOrEmpty
        }

        It 'publishes the 11 SPEC section-3.2 checks' {
            Get-BecCheckNames | Should -Be @('mailboxRules', 'recentUsers', 'newApplications', 'mailboxPermissions', 'sentMessages', 'mfaDevices', 'passwordChanges', 'mailFlow', 'intuneDevices', 'signinLocations', 'sharingLinks')
        }

        It 'keeps the check path read-only: no tenant write before the remediation function' {
            $source = Get-Content -LiteralPath $script:worker -Raw
            $marker = 'function Invoke-BecFindingRemediation'
            $checkPath = $source.Substring(0, $source.IndexOf($marker))
            $checkPath | Should -Match 'Invoke-MgGraphRequest -Method GET'
            $checkPath | Should -Not -Match "-Method POST"
            $checkPath | Should -Not -Match "-Method PATCH"
            $checkPath | Should -Not -Match "-Method PUT"
            $checkPath | Should -Not -Match "-Method DELETE"
        }

        It 'never persists evidence or findings to disk, logs, or transcripts' {
            $source = Get-Content -LiteralPath $script:worker -Raw
            $source | Should -Not -Match 'Out-File'
            $source | Should -Not -Match 'Export-Csv'
            $source | Should -Not -Match 'Export-Clixml'
            $source | Should -Not -Match 'Add-Content'
            $source | Should -Not -Match 'Set-Content'
            $source | Should -Not -Match 'Start-Transcript'
            $source | Should -Not -Match 'Write-Host'
            $source | Should -Not -Match 'Invoke-Expression'
            $entrySource = Get-Content -LiteralPath $script:entrypoint -Raw
            $entrySource | Should -Not -Match 'Out-File'
            $entrySource | Should -Not -Match 'Start-Transcript'
            $entrySource | Should -Not -Match 'Write-Host'
        }

        It 'entrypoint reads the job envelope, delegates to the worker, and emits JSON' {
            $entrySource = Get-Content -LiteralPath $script:entrypoint -Raw
            $entrySource | Should -Match 'Invoke-BecCheck.ps1'
            $entrySource | Should -Match 'Read-BecCheckJob -Path'
            $entrySource | Should -Match 'Invoke-BecCheck -TenantId \$TenantId -UserId \$UserId'
            $entrySource | Should -Match 'Invoke-BecFindingRemediation'
            $entrySource | Should -Match 'ConvertTo-Json'
        }
    }

    Context 'the 11-check review' {
        BeforeEach {
            script:New-ClearMock
        }

        It 'requires the tenant and user identifiers' {
            { Invoke-BecCheck -TenantId '' -UserId 'user-1' } | Should -Throw
            { Invoke-BecCheck -TenantId 'tenant-a' -UserId '' } | Should -Throw
        }

        It 'returns all 11 checks with the tenant envelope' {
            $result = Invoke-BecCheck -TenantId 'tenant-a' -UserId 'user-1'

            $result.tenantId | Should -Be 'tenant-a'
            $result.userId | Should -Be 'user-1'
            @($result.checks) | Should -HaveCount 11
            @($result.checks.check) | Should -Be @(Get-BecCheckNames)
            $result.retrievedAt | Should -Not -BeNullOrEmpty
        }

        It 'flags a forwarding inbox rule as a finding with a remove-rule remediation' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Uri -like '*messageRules*') {
                    return @{ value = @(@{
                        id = 'rule-1'
                        displayName = 'Forward everything'
                        actions = @{ forwardTo = @(@{ emailAddress = @{ address = 'attacker@example.invalid' } }); stopProcessingRules = $true }
                    }) }
                }
                return @{ value = @() }
            }
            $result = Invoke-BecCheck -TenantId 'tenant-a' -UserId 'user-1'

            $rules = @($result.checks | Where-Object { $_.check -eq 'mailboxRules' })[0]
            $rules.state | Should -Be 'finding'
            @($rules.evidence) | Should -HaveCount 1
            $rules.remediation.action | Should -Be 'removeInboxRule'
            $rules.remediation.automated | Should -BeTrue
        }

        It 'flags a privileged application consent as a finding' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Uri -like '*oauth2PermissionGrants*') {
                    return @{ value = @(@{ clientId = 'app-1'; scope = 'Mail.Send User.Read' }) }
                }
                return @{ value = @() }
            }
            $result = Invoke-BecCheck -TenantId 'tenant-a' -UserId 'user-1'

            $apps = @($result.checks | Where-Object { $_.check -eq 'newApplications' })[0]
            $apps.state | Should -Be 'finding'
        }

        It 'flags sign-ins from two countries as a finding' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Uri -like '*auditLogs/signIns*') {
                    return @{ value = @(
                        @{ createdDateTime = $script:recentStamp; ipAddress = '10.0.0.1'; location = @{ countryOrRegion = 'US' } }
                        @{ createdDateTime = $script:recentStamp; ipAddress = '203.0.113.9'; location = @{ countryOrRegion = 'RU' } }
                    ) }
                }
                return @{ value = @() }
            }
            $result = Invoke-BecCheck -TenantId 'tenant-a' -UserId 'user-1'

            $locations = @($result.checks | Where-Object { $_.check -eq 'signinLocations' })[0]
            $locations.state | Should -Be 'finding'
            $locations.detail.countries | Should -Contain 'RU'
        }

        It 'flags an anonymous sharing link as a finding with manual remediation' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Uri -like '*/permissions*') {
                    return @{ value = @(@{ link = @{ scope = 'anonymous'; type = 'view' } }) }
                }
                if ($Uri -like '*/drive/root/children*') {
                    return @{ value = @(@{ id = 'item-1'; name = 'Plan.docx' }) }
                }
                return @{ value = @() }
            }
            $result = Invoke-BecCheck -TenantId 'tenant-a' -UserId 'user-1'

            $links = @($result.checks | Where-Object { $_.check -eq 'sharingLinks' })[0]
            $links.state | Should -Be 'finding'
            $links.remediation.automated | Should -BeFalse
        }

        It 'reports unknown with a reason when Exchange Online is unavailable' {
            $result = Invoke-BecCheck -TenantId 'tenant-a' -UserId 'user-1'

            $permissions = @($result.checks | Where-Object { $_.check -eq 'mailboxPermissions' })[0]
            $permissions.state | Should -Be 'unknown'
            $permissions.detail.reason | Should -Match 'Exchange Online'
            $flow = @($result.checks | Where-Object { $_.check -eq 'mailFlow' })[0]
            $flow.state | Should -Be 'unknown'
        }

        It 'keeps reviewing when one backing API fails' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Uri -like '*auditLogs/signIns*') {
                    throw 'Authorization_RequestDenied: AuditLog.Read.All is required'
                }
                if ($Uri -like '*messageRules*') {
                    return @{ value = @() }
                }
                return @{ value = @() }
            }
            $result = Invoke-BecCheck -TenantId 'tenant-a' -UserId 'user-1'

            @($result.checks) | Should -HaveCount 11
            $locations = @($result.checks | Where-Object { $_.check -eq 'signinLocations' })[0]
            $locations.state | Should -Be 'unknown'
            $locations.detail.reason | Should -Match 'AuditLog'
            $rules = @($result.checks | Where-Object { $_.check -eq 'mailboxRules' })[0]
            $rules.state | Should -Be 'clear'
        }
    }

    Context 'per-finding remediation' {
        BeforeEach {
            script:New-ClearMock
        }

        It 'refuses an unknown remediation action with no Graph call' {
            { Invoke-BecFindingRemediation -TenantId 'tenant-a' -UserId 'user-1' -Check 'mailboxRules' -Action 'wipeMailbox' -Confirmed } | Should -Throw '*users.bec_unknown_remediation*'
            Should -Invoke Invoke-MgGraphRequest -Times 0 -Exactly
        }

        It 'requires explicit confirmation and never auto-remediates' {
            { Invoke-BecFindingRemediation -TenantId 'tenant-a' -UserId 'user-1' -Check 'mailboxRules' -Action 'removeInboxRule' -Target 'rule-1' } | Should -Throw '*users.bec_confirm_required*'
            Should -Invoke Invoke-MgGraphRequest -Times 0 -Exactly
        }

        It 'removes an inbox rule with before capture and a success audit' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'GET') {
                    return @{ id = 'rule-1'; displayName = 'Forward everything' }
                }
                return @{}
            }
            $script:audits = @()
            $result = Invoke-BecFindingRemediation -TenantId 'tenant-a' -UserId 'user-1' -Check 'mailboxRules' -Action 'removeInboxRule' -Target 'rule-1' -Confirmed -WriteAudit { param($AuditEvent) $script:audits += $AuditEvent }

            $result.status | Should -Be 'remediated'
            $result.before.id | Should -Be 'rule-1'
            Should -Invoke Invoke-MgGraphRequest -ParameterFilter { $Method -eq 'DELETE' -and $Uri -like '*messageRules/rule-1' } -Times 1 -Exactly
            $script:audits | Should -HaveCount 1
            $script:audits[0].result | Should -Be 'success'
        }

        It 'requires the rule target for rule removal' {
            $result = Invoke-BecFindingRemediation -TenantId 'tenant-a' -UserId 'user-1' -Check 'mailboxRules' -Action 'removeInboxRule' -Confirmed

            $result.status | Should -Be 'failed'
            $result.error | Should -Match 'users.bec_missing_target'
        }

        It 'revokes sessions with confirmation' {
            $result = Invoke-BecFindingRemediation -TenantId 'tenant-a' -UserId 'user-1' -Check 'signinLocations' -Action 'revokeSessions' -Confirmed

            $result.status | Should -Be 'remediated'
            Should -Invoke Invoke-MgGraphRequest -ParameterFilter { $Method -eq 'POST' -and $Uri -like '*revokeSignInSessions' } -Times 1 -Exactly
        }

        It 'returns a per-finding failure with a failure audit when Graph rejects the write' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                throw 'Authorization_RequestDenied'
            }
            $script:audits = @()
            $result = Invoke-BecFindingRemediation -TenantId 'tenant-a' -UserId 'user-1' -Check 'signinLocations' -Action 'revokeSessions' -Confirmed -WriteAudit { param($AuditEvent) $script:audits += $AuditEvent }

            $result.status | Should -Be 'failed'
            $result.error | Should -Match 'Authorization_RequestDenied'
            $script:audits | Should -HaveCount 1
            $script:audits[0].result | Should -Be 'failure'
        }
    }

    Context 'job envelope' {
        It 'reads a check envelope' {
            $path = Join-Path ([System.IO.Path]::GetTempPath()) ("bec-check-{0}.json" -f ([guid]::NewGuid()))
            try {
                @{
                    schemaVersion = 'v1'
                    tenantId      = 'tenant-a'
                    correlationId = 'correlation-1'
                    payload       = @{ userId = 'user-1' }
                } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $path -Encoding UTF8

                $job = Read-BecCheckJob -Path $path

                $job['TenantId'] | Should -Be 'tenant-a'
                $job['UserId'] | Should -Be 'user-1'
                $job['Action'] | Should -BeNullOrEmpty
                $job['CorrelationId'] | Should -Be 'correlation-1'
            }
            finally {
                Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
            }
        }

        It 'reads a single-finding remediation envelope' {
            $path = Join-Path ([System.IO.Path]::GetTempPath()) ("bec-check-{0}.json" -f ([guid]::NewGuid()))
            try {
                @{
                    schemaVersion = 'v1'
                    tenantId      = 'tenant-a'
                    payload       = @{ userId = 'user-1'; check = 'mailboxRules'; action = 'removeInboxRule'; target = 'rule-1'; confirm = $true; actor = 'operator-1' }
                } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $path -Encoding UTF8

                $job = Read-BecCheckJob -Path $path

                $job['Action'] | Should -Be 'removeInboxRule'
                $job['Target'] | Should -Be 'rule-1'
                $job['Check'] | Should -Be 'mailboxRules'
                $job['Confirmed'] | Should -BeTrue
            }
            finally {
                Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
            }
        }

        It 'rejects a missing file, a bad schema version, and a missing user' {
            { Read-BecCheckJob -Path (Join-Path ([System.IO.Path]::GetTempPath()) 'no-such-job.json') } | Should -Throw

            $badVersion = Join-Path ([System.IO.Path]::GetTempPath()) ("bec-check-{0}.json" -f ([guid]::NewGuid()))
            @{ schemaVersion = 'v9'; tenantId = 'tenant-a'; payload = @{ userId = 'user-1' } } | ConvertTo-Json | Set-Content -LiteralPath $badVersion -Encoding UTF8
            try {
                { Read-BecCheckJob -Path $badVersion } | Should -Throw
            }
            finally {
                Remove-Item -LiteralPath $badVersion -Force -ErrorAction SilentlyContinue
            }

            $noUser = Join-Path ([System.IO.Path]::GetTempPath()) ("bec-check-{0}.json" -f ([guid]::NewGuid()))
            @{ schemaVersion = 'v1'; tenantId = 'tenant-a'; payload = @{} } | ConvertTo-Json | Set-Content -LiteralPath $noUser -Encoding UTF8
            try {
                { Read-BecCheckJob -Path $noUser } | Should -Throw
            }
            finally {
                Remove-Item -LiteralPath $noUser -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
