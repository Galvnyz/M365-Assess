BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Deploy-GroupTemplate.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/deploy-group-template.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker
}

Describe 'Deploy-GroupTemplate worker (T-0266)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Invoke-DeployGroupTemplate -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Resolve-GroupTemplateName -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-DeployGroupTemplateJob -CommandType Function) | Should -Not -BeNullOrEmpty
        }
    }

    Context 'Template name resolution and variables' {
        It 'resolves prefix, suffix, and variable tokens' {
            $naming = @{
                prefix = 'GRP-'
                suffix = '-Team'
                pattern = '{prefix}{department}-{name}{suffix}'
                conflictBehavior = 'block'
            }
            $vars = @{ department = 'Finance' }
            $res = Resolve-GroupTemplateName -BaseName 'Standard' -Naming $naming -Variables $vars
            $res.ResolvedName | Should -Be 'GRP-Finance-Standard-Team'
            $res.ConflictBehavior | Should -Be 'block'
        }
    }

    Context 'Deploy planning and execution' {
        BeforeEach {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'GET' -and $Uri -like '*displayName eq*Existing*') {
                    return @{ value = @(@{ id = 'grp-old'; displayName = 'Existing Group' }) }
                }
                if ($Method -eq 'GET' -and $Uri -like '*displayName eq*') {
                    return @{ value = @() }
                }
                if ($Method -eq 'POST' -and $Uri -like '*/groups') {
                    return @{ id = 'grp-deployed-1'; displayName = 'Deployed Group' }
                }
                if ($Method -eq 'POST' -and $Uri -like '*/owners*') {
                    return @{}
                }
                if ($Method -eq 'POST' -and $Uri -like '*/members*') {
                    if ($Body -match 'bad-user') {
                        throw "User bad-user not found"
                    }
                    return @{}
                }
            }
        }

        It 'DryRun returns resolved plan and detects name conflict' {
            $template = @{
                id = 'tpl-1'
                name = 'Existing Group'
                groupType = 'security'
                naming = @{ conflictBehavior = 'block' }
            }
            $plan = Invoke-DeployGroupTemplate -TenantId 'tenant-test' -Template $template -DryRun $true
            $plan.valid | Should -BeFalse
            $plan.conflict | Should -BeTrue
            $plan.conflictError | Should -Match 'Name conflict'
        }

        It 'DryRun returns valid plan when no conflict exists' {
            $template = @{
                id = 'tpl-2'
                name = 'Unique Group'
                groupType = 'security'
                owners = @('owner-1')
                members = @('member-1')
            }
            $plan = Invoke-DeployGroupTemplate -TenantId 'tenant-test' -Template $template -DryRun $true
            $plan.valid | Should -BeTrue
            $plan.conflict | Should -BeFalse
            $plan.targetName | Should -Be 'Unique Group'
        }

        It 'applies deployment, creates group, adds owners and members, and records deployment' {
            $template = @{
                id = 'tpl-3'
                name = 'Unique Group'
                groupType = 'security'
                owners = @('owner-1')
                members = @('member-1')
            }
            $res = Invoke-DeployGroupTemplate -TenantId 'tenant-test' -Template $template -DryRun $false -CreatedBy 'admin@example.com'
            $res.success | Should -BeTrue
            $res.deployment | Should -Not -BeNullOrEmpty
            $res.deployment.state | Should -Be 'succeeded'
            $res.deployment.results.Count | Should -Be 3
            $res.auditEvent.action | Should -Be 'group-template.deploy'
        }

        It 'reports partial failure when member add fails' {
            $template = @{
                id = 'tpl-4'
                name = 'Unique Group'
                groupType = 'security'
                owners = @('owner-1')
                members = @('bad-user')
            }
            $res = Invoke-DeployGroupTemplate -TenantId 'tenant-test' -Template $template -DryRun $false
            $res.deployment.state | Should -Be 'partial'
            $memberStep = $res.deployment.results | Where-Object { $_.step -eq 'addMember' }
            $memberStep.status | Should -Be 'failed'
            $memberStep.error | Should -Match 'bad-user'
        }
    }
}
