BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Get-CaReportOnly.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/get-ca-report-only.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker
}

Describe 'Get-CaReportOnly worker (T-0289)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Get-CaReportOnly -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-CaReportOnlyJob -CommandType Function) | Should -Not -BeNullOrEmpty
        }
    }

    Context 'Job envelope reading' {
        It 'throws when envelope does not exist' {
            { Read-CaReportOnlyJob -Path '/path/does/not/exist.json' } | Should -Throw "*not found*"
        }

        It 'throws when tenantId is missing' {
            $tmp = New-TemporaryFile
            Set-Content -LiteralPath $tmp.FullName -Value '{"policyId":"pol-1"}'
            try {
                { Read-CaReportOnlyJob -Path $tmp.FullName } | Should -Throw "*missing mandatory 'tenantId'*"
            }
            finally {
                Remove-Item -LiteralPath $tmp.FullName -Force -ErrorAction SilentlyContinue
            }
        }
    }

    Context 'Report-only evaluation' {
        It 'evaluates report-only policies against sign-in logs and computes impact' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri)
                $Method | Should -Be 'GET'

                if ($Uri -eq '/v1.0/identity/conditionalAccess/policies') {
                    return [pscustomobject]@{
                        value = @(
                            [pscustomobject]@{
                                id          = 'pol-ro-1'
                                displayName = 'Require MFA (Report-Only)'
                                state       = 'enabledForReportingButNotEnforced'
                                grantControls = [pscustomobject]@{
                                    builtInControls = @('mfa')
                                }
                            },
                            [pscustomobject]@{
                                id          = 'pol-enforced-1'
                                displayName = 'Block Legacy Auth (Enforced)'
                                state       = 'enabled'
                                grantControls = [pscustomobject]@{
                                    builtInControls = @('block')
                                }
                            }
                        )
                    }
                }

                if ($Uri -like '/v1.0/auditLogs/signIns*') {
                    return [pscustomobject]@{
                        value = @(
                            [pscustomobject]@{
                                id                = 'si-1'
                                createdDateTime   = '2026-09-26T12:00:00Z'
                                userPrincipalName = 'user1@contoso.com'
                                appDisplayName    = 'Exchange Online'
                                ipAddress         = '192.168.1.10'
                                location          = [pscustomobject]@{ city = 'New York'; countryOrRegion = 'US' }
                                appliedConditionalAccessPolicies = @(
                                    [pscustomobject]@{
                                        id          = 'pol-ro-1'
                                        displayName = 'Require MFA (Report-Only)'
                                        result      = 'reportOnlyFailure'
                                    }
                                )
                            },
                            [pscustomobject]@{
                                id                = 'si-2'
                                createdDateTime   = '2026-09-26T12:05:00Z'
                                userPrincipalName = 'user1@contoso.com'
                                appDisplayName    = 'SharePoint Online'
                                ipAddress         = '192.168.1.10'
                                location          = [pscustomobject]@{ city = 'New York'; countryOrRegion = 'US' }
                                appliedConditionalAccessPolicies = @(
                                    [pscustomobject]@{
                                        id          = 'pol-ro-1'
                                        displayName = 'Require MFA (Report-Only)'
                                        result      = 'reportOnlyFailure'
                                    }
                                )
                            },
                            [pscustomobject]@{
                                id                = 'si-3'
                                createdDateTime   = '2026-09-26T12:10:00Z'
                                userPrincipalName = 'user2@contoso.com'
                                appDisplayName    = 'Exchange Online'
                                ipAddress         = '10.0.0.5'
                                location          = [pscustomobject]@{ city = 'London'; countryOrRegion = 'GB' }
                                appliedConditionalAccessPolicies = @(
                                    [pscustomobject]@{
                                        id          = 'pol-ro-1'
                                        displayName = 'Require MFA (Report-Only)'
                                        result      = 'reportOnlySuccess'
                                    }
                                )
                            }
                        )
                    }
                }

                return $null
            }

            $res = Get-CaReportOnly -TenantId 'tenant-test'
            $res.tenantId | Should -Be 'tenant-test'
            $res.summary.totalReportOnlyPolicies | Should -Be 1
            $res.summary.totalEvaluated | Should -Be 3
            $res.summary.totalWouldBlock | Should -Be 2

            $pol = $res.reportOnlyPolicies[0]
            $pol.policyId | Should -Be 'pol-ro-1'
            $pol.policyName | Should -Be 'Require MFA (Report-Only)'
            $pol.wouldBlockCount | Should -Be 2
            $pol.wouldGrantCount | Should -Be 1
            $pol.notAppliedCount | Should -Be 0
            $pol.totalEvaluated | Should -Be 3

            # Check affected users
            $pol.affectedUsers.Count | Should -Be 1
            $pol.affectedUsers[0].userPrincipalName | Should -Be 'user1@contoso.com'
            $pol.affectedUsers[0].failCount | Should -Be 2

            # Check affected apps
            $pol.affectedApps.Count | Should -Be 2

            # Check sample events
            $pol.sampleEvents.Count | Should -BeGreaterThan 0
            $pol.sampleEvents[0].wouldBlock | Should -BeTrue
        }

        It 'handles gracefully when no report-only policies exist' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri)
                if ($Uri -eq '/v1.0/identity/conditionalAccess/policies') {
                    return [pscustomobject]@{
                        value = @(
                            [pscustomobject]@{
                                id          = 'pol-enforced-1'
                                displayName = 'Block Legacy Auth (Enforced)'
                                state       = 'enabled'
                            }
                        )
                    }
                }
                return [pscustomobject]@{ value = @() }
            }

            $res = Get-CaReportOnly -TenantId 'tenant-test'
            $res.summary.totalReportOnlyPolicies | Should -Be 0
            $res.summary.totalEvaluated | Should -Be 0
            $res.reportOnlyPolicies.Count | Should -Be 0
        }
    }
}
