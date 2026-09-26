# Get-GroupUsage.Tests.ps1 — Unit tests for Get-GroupUsage (T-0270).

BeforeAll {
    $script:workerPath = Join-Path -Path $PSScriptRoot -ChildPath '../../../portal/workers/M365Portal.Workers/Get-GroupUsage.ps1'
    $script:entrypoint = Join-Path -Path $PSScriptRoot -ChildPath '../../../portal/workers/get-group-usage.ps1'
    . $script:workerPath
}

Describe 'Get-GroupUsage worker (T-0270)' {
    Context 'Worker and entrypoint files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:workerPath | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            Get-Command Read-GroupUsageJob -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty
            Get-Command Calculate-GroupUsage -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty
            Get-Command Get-GroupUsage -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty
        }
    }

    Context 'Read-GroupUsageJob' {
        It 'reads envelope and applies defaults' {
            $temp = New-TemporaryFile
            try {
                '{"tenantId":"tenant-abc"}' | Set-Content -LiteralPath $temp.FullName
                $job = Read-GroupUsageJob -Path $temp.FullName
                $job['TenantId'] | Should -Be 'tenant-abc'
                $job['InactiveDaysThreshold'] | Should -Be 90
            }
            finally {
                Remove-Item -LiteralPath $temp.FullName -Force -ErrorAction SilentlyContinue
            }
        }

        It 'reads custom inactiveDaysThreshold' {
            $temp = New-TemporaryFile
            try {
                '{"tenantId":"tenant-abc","inactiveDaysThreshold":180}' | Set-Content -LiteralPath $temp.FullName
                $job = Read-GroupUsageJob -Path $temp.FullName
                $job['InactiveDaysThreshold'] | Should -Be 180
            }
            finally {
                Remove-Item -LiteralPath $temp.FullName -Force -ErrorAction SilentlyContinue
            }
        }
    }

    Context 'Calculate-GroupUsage calculations' {
        It 'calculates ownerless, inactive, and guest metrics correctly' {
            $refDate = [datetime]'2026-09-26T12:00:00Z'
            $groups = @(
                [pscustomobject]@{
                    id               = 'grp-1'
                    displayName      = 'Active Group with Owners'
                    mail             = 'active@contoso.com'
                    groupType        = 'm365'
                    membershipCount  = 10
                    ownerCount       = 2
                    guestCount       = 0
                    lastActivityDate = '2026-09-20T00:00:00Z' # 6 days ago (active)
                },
                [pscustomobject]@{
                    id               = 'grp-2'
                    displayName      = 'Ownerless Group'
                    mail             = 'orphan@contoso.com'
                    groupType        = 'security'
                    membershipCount  = 5
                    ownerCount       = 0 # ownerless!
                    guestCount       = 2
                    lastActivityDate = '2026-09-10T00:00:00Z' # 16 days ago (active)
                },
                [pscustomobject]@{
                    id               = 'grp-3'
                    displayName      = 'Inactive Group'
                    mail             = 'stale@contoso.com'
                    groupType        = 'm365'
                    membershipCount  = 20
                    ownerCount       = 1
                    guestCount       = 3
                    lastActivityDate = '2026-05-01T00:00:00Z' # > 90 days ago (inactive!)
                }
            )

            $report = Calculate-GroupUsage -TenantId 'tenant-test' -InactiveDaysThreshold 90 -Groups $groups -ReferenceDate $refDate

            $report.tenantId | Should -Be 'tenant-test'
            $report.inactiveDaysThreshold | Should -Be 90
            $report.summary.totalGroups | Should -Be 3
            $report.summary.totalMembersCount | Should -Be 35
            $report.summary.totalGuestsCount | Should -Be 5
            $report.summary.ownerlessGroupsCount | Should -Be 1
            $report.summary.inactiveGroupsCount | Should -Be 1

            # Verify ownerless list
            $report.ownerlessGroups.Count | Should -Be 1
            $report.ownerlessGroups[0].id | Should -Be 'grp-2'
            $report.ownerlessGroups[0].displayName | Should -Be 'Ownerless Group'

            # Verify inactive list
            $report.inactiveGroups.Count | Should -Be 1
            $report.inactiveGroups[0].id | Should -Be 'grp-3'
            $report.inactiveGroups[0].displayName | Should -Be 'Inactive Group'
            $report.inactiveGroups[0].daysInactive | Should -BeGreaterThan 90

            # Verify guest metrics
            $report.guestMetrics.totalGuests | Should -Be 5
            $report.guestMetrics.groupsWithGuestsCount | Should -Be 2
            $report.guestMetrics.topGuestGroups.Count | Should -Be 2
            $report.guestMetrics.topGuestGroups[0].id | Should -Be 'grp-3'
            $report.guestMetrics.topGuestGroups[0].guestCount | Should -Be 3

            # Verify membership growth trend
            $report.membershipGrowth.Count | Should -Be 4
            $report.membershipGrowth[-1].memberCount | Should -Be 35
        }
    }
}
