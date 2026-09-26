BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Set-AssignmentFilter.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/set-assignment-filter.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker

    $script:Live = @{
        id          = 'f-1'
        displayName = 'Corporate laptops'
        description = 'HR and finance'
        platform    = 'windows10AndLater'
        rule        = '(device.deviceOwnership -eq "Corporate")'
    }

    function Get-FilterJson {
        param([hashtable]$Filter)
        return $Filter | ConvertTo-Json -Compress
    }
}

Describe 'Set-AssignmentFilter worker (T-0309)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Invoke-SetAssignmentFilter -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-SetAssignmentFilterJob -CommandType Function) | Should -Not -BeNullOrEmpty
        }
    }

    Context 'job envelope' {
        It 'reads an action and rejects unknown ones' {
            $path = Join-Path $TestDrive 'job.json'
            @{ tenantId = 't-1'; action = 'delete'; filterId = 'f-1'; confirmName = 'Corporate laptops' } |
                ConvertTo-Json | Set-Content -LiteralPath $path
            $job = Read-SetAssignmentFilterJob -Path $path
            $job['Action'] | Should -Be 'delete'
            $job['ConfirmName'] | Should -Be 'Corporate laptops'
            @{ tenantId = 't-1'; action = 'purge' } | ConvertTo-Json | Set-Content -LiteralPath $path
            { Read-SetAssignmentFilterJob -Path $path } | Should -Throw '*unknown action*'
        }
    }

    Context 'validation' {
        It 'rejects a Graph platform outside the registry mapping' {
            Mock Invoke-MgGraphRequest { }
            { Invoke-SetAssignmentFilter -TenantId 't-1' -Action 'create' -FilterJson (Get-FilterJson @{ displayName = 'x'; platform = 'windowsPhone81'; rule = 'r' }) } |
                Should -Throw '*unsupported assignment filter platform*'
            Should -Invoke Invoke-MgGraphRequest -Times 0
        }

        It 'requires name, platform, and rule to create' {
            Mock Invoke-MgGraphRequest { }
            { Invoke-SetAssignmentFilter -TenantId 't-1' -Action 'create' -FilterJson (Get-FilterJson @{ displayName = 'x'; platform = 'iOS' }) } |
                Should -Throw "*create requires 'rule'*"
        }
    }

    Context 'CRUD with before/after audit' {
        It 'lists filters with registry platforms' {
            Mock Invoke-MgGraphRequest { @{ value = @($script:Live, @{ id = 'f-2'; displayName = 'Phones'; platform = 'windowsPhone81'; rule = 'x' }) } }
            $res = Invoke-SetAssignmentFilter -TenantId 't-1' -Action 'list'
            $res.items.Count | Should -Be 2
            $res.items[0].platform | Should -Be 'windows'
            $res.items[1].platform | Should -BeNullOrEmpty
        }

        It 'creates a filter and audits with no before' {
            Mock Invoke-MgGraphRequest { param($Method, $Uri, $Body) $script:Live }
            $res = Invoke-SetAssignmentFilter -TenantId 't-1' -Action 'create' -Actor 'op' -FilterJson (Get-FilterJson @{ displayName = 'Corporate laptops'; platform = 'windows10AndLater'; rule = $script:Live.rule })
            $res.filter.id | Should -Be 'f-1'
            $res.auditEvent.action | Should -Be 'intune.assignment-filter.create'
            $res.auditEvent.before | Should -BeNullOrEmpty
            $res.auditEvent.after.rule | Should -Be $script:Live.rule
            Should -Invoke Invoke-MgGraphRequest -Times 1 -ParameterFilter { $Method -eq 'POST' -and $Body -match 'windows10AndLater' }
        }

        It 'edits a filter with before/after from Graph' {
            $script:edited = $false
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'PATCH') { $script:edited = $true; return $null }
                if ($script:edited) { $f = $script:Live.Clone(); $f.rule = '(device.model -eq "Surface")'; return $f }
                return $script:Live
            }
            $res = Invoke-SetAssignmentFilter -TenantId 't-1' -Action 'edit' -FilterId 'f-1' -FilterJson (Get-FilterJson @{ rule = '(device.model -eq "Surface")' })
            $res.auditEvent.before.rule | Should -Be $script:Live.rule
            $res.auditEvent.after.rule | Should -Be '(device.model -eq "Surface")'
        }

        It 'refuses to change the platform of an existing filter' {
            Mock Invoke-MgGraphRequest { $script:Live }
            { Invoke-SetAssignmentFilter -TenantId 't-1' -Action 'edit' -FilterId 'f-1' -FilterJson (Get-FilterJson @{ platform = 'iOS' }) } |
                Should -Throw '*platform cannot be changed*'
            Should -Invoke Invoke-MgGraphRequest -Times 0 -ParameterFilter { $Method -eq 'PATCH' }
        }

        It 'deletes only when confirmName matches exactly, auditing the before' {
            Mock Invoke-MgGraphRequest { param($Method, $Uri, $Body) if ($Method -eq 'GET') { $script:Live } }
            { Invoke-SetAssignmentFilter -TenantId 't-1' -Action 'delete' -FilterId 'f-1' -ConfirmName 'corporate laptops' } |
                Should -Throw '*does not match*'
            $res = Invoke-SetAssignmentFilter -TenantId 't-1' -Action 'delete' -FilterId 'f-1' -ConfirmName 'Corporate laptops'
            $res.auditEvent.before.displayName | Should -Be 'Corporate laptops'
            $res.auditEvent.after | Should -BeNullOrEmpty
            Should -Invoke Invoke-MgGraphRequest -Times 1 -ParameterFilter { $Method -eq 'DELETE' -and $Uri -like '*/f-1' }
        }
    }

    Context 'template deploy' {
        BeforeEach {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'GET') { return @{ value = @($script:Live) } }
                return @{ id = 'f-new'; displayName = 'New filter'; platform = 'windows10AndLater'; rule = 'r' }
            }
        }

        It 'plans create for a missing filter and update for a changed rule' {
            $create = Invoke-SetAssignmentFilter -TenantId 't-1' -Action 'plan' -FilterJson (Get-FilterJson @{ displayName = 'New filter'; platform = 'windows10AndLater'; rule = 'r' })
            $create.action | Should -Be 'create'
            $update = Invoke-SetAssignmentFilter -TenantId 't-1' -Action 'plan' -FilterJson (Get-FilterJson @{ displayName = 'Corporate laptops'; platform = 'windows10AndLater'; rule = '(device.model -eq "X")' })
            $update.action | Should -Be 'update'
            $update.filterId | Should -Be 'f-1'
            $update.diff | Should -Contain "~ rule: '(device.deviceOwnership -eq `"Corporate`")' -> '(device.model -eq `"X`")'"
            Should -Invoke Invoke-MgGraphRequest -Times 0 -ParameterFilter { $Method -ne 'GET' }
        }

        It 'flags a same-name filter on another platform as invalid' {
            $plan = Invoke-SetAssignmentFilter -TenantId 't-1' -Action 'plan' -FilterJson (Get-FilterJson @{ displayName = 'Corporate laptops'; platform = 'iOS'; rule = 'r' })
            $plan.valid | Should -BeFalse
            $plan.issue | Should -Match 'cannot be changed'
        }

        It 'skips an identical filter and deploys changes with before/after audit' {
            $same = Invoke-SetAssignmentFilter -TenantId 't-1' -Action 'deploy' -FilterJson (Get-FilterJson @{ displayName = 'Corporate laptops'; platform = 'windows10AndLater'; rule = $script:Live.rule })
            $same.state | Should -Be 'skipped'
            $changed = Invoke-SetAssignmentFilter -TenantId 't-1' -Action 'deploy' -FilterJson (Get-FilterJson @{ displayName = 'Corporate laptops'; platform = 'windows10AndLater'; rule = '(device.model -eq "X")' })
            $changed.state | Should -Be 'succeeded'
            $changed.auditEvent.action | Should -Be 'intune.assignment-filter.deploy.update'
            $changed.auditEvent.before.rule | Should -Be $script:Live.rule
            $changed.auditEvent.after.rule | Should -Be '(device.model -eq "X")'
            Should -Invoke Invoke-MgGraphRequest -Times 1 -ParameterFilter { $Method -eq 'PATCH' -and $Uri -like '*/f-1' }
        }
    }
}
