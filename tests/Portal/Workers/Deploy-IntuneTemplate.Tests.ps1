BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Deploy-IntuneTemplate.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/deploy-intune-template.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker

    function Get-TestTemplateJson {
        param(
            [string]$PolicyType = 'compliance',
            [object[]]$Assignments = @()
        )
        $policyJson = if ($PolicyType -eq 'compliance') {
            @{
                '@odata.type'         = '#microsoft.graph.windows10CompliancePolicy'
                displayName           = 'Win Baseline'
                passwordRequired      = $true
                passwordMinimumLength = 12
            }
        }
        else {
            @{
                '@odata.type' = '#microsoft.graph.deviceManagementConfigurationPolicy'
                name          = 'Defender Baseline'
                settings      = @{ realtime = $true }
            }
        }
        return @{
            id          = 'tpl-1'
            name        = 'Template'
            platform    = 'windows10'
            policyType  = $PolicyType
            policyJson  = $policyJson
            assignments = $Assignments
        } | ConvertTo-Json -Depth 10
    }
}

Describe 'Deploy-IntuneTemplate worker (T-0306)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Invoke-DeployIntuneTemplate -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-DeployIntuneTemplateJob -CommandType Function) | Should -Not -BeNullOrEmpty
        }
    }

    Context 'job envelope' {
        It 'reads the deploy-drawer options with defaults' {
            $path = Join-Path $TestDrive 'job.json'
            @{ tenantId = 't-1'; templateJson = '{}'; groups = @('Pilot'); overwrite = $true } |
                ConvertTo-Json | Set-Content -LiteralPath $path
            $job = Read-DeployIntuneTemplateJob -Path $path
            $job['TenantId'] | Should -Be 't-1'
            $job['AssignmentMode'] | Should -Be 'template'
            $job['PolicyState'] | Should -Be 'enabled'
            $job['Groups'] | Should -Be @('Pilot')
            $job['Overwrite'] | Should -BeTrue
            $job['CreateGroups'] | Should -BeFalse
        }

        It 'rejects an envelope without a template' {
            $path = Join-Path $TestDrive 'bad.json'
            @{ tenantId = 't-1' } | ConvertTo-Json | Set-Content -LiteralPath $path
            { Read-DeployIntuneTemplateJob -Path $path } | Should -Throw '*templateJson*'
        }
    }

    Context 'plan (DryRun)' {
        BeforeEach {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Uri -like '/v1.0/groups*') { return @{ value = @() } }
                return @{ value = @() }
            }
        }

        It 'plans a new compliance policy with the template settings and no writes' {
            $res = Invoke-DeployIntuneTemplate -TenantId 't-1' -TemplateJson (Get-TestTemplateJson) -DryRun $true
            $res.plan.valid | Should -BeTrue
            $res.plan.action | Should -Be 'create'
            $res.plan.policyName | Should -Be 'Win Baseline'
            ($res.plan.diff -join "`n") | Should -Match '\+ passwordMinimumLength: 12'
            ($res.plan.diff -join "`n") | Should -Match 'scheduledActionsForRule'
            Should -Invoke Invoke-MgGraphRequest -Times 0 -ParameterFilter { $Method -ne 'GET' }
        }

        It 'plans groups to create when create-groups is on' {
            $res = Invoke-DeployIntuneTemplate -TenantId 't-1' -TemplateJson (Get-TestTemplateJson) -AssignmentMode 'groups' -Groups @('Pilot Devices') -CreateGroups $true -DryRun $true
            $res.plan.valid | Should -BeTrue
            $res.plan.groupsToCreate | Should -Be @('Pilot Devices')
            ($res.plan.diff -join "`n") | Should -Match '\+ Create group: Pilot Devices'
            ($res.plan.diff -join "`n") | Should -Match '\+ Assign: Pilot Devices'
        }

        It 'marks the plan invalid when a group is missing and create-groups is off' {
            $res = Invoke-DeployIntuneTemplate -TenantId 't-1' -TemplateJson (Get-TestTemplateJson) -AssignmentMode 'groups' -Groups @('Nope') -DryRun $true
            $res.plan.valid | Should -BeFalse
            $res.plan.issues[0] | Should -Match "group 'Nope' does not exist"
        }

        It 'deploys unassigned when the policy state is disabled' {
            $res = Invoke-DeployIntuneTemplate -TenantId 't-1' -TemplateJson (Get-TestTemplateJson) -AssignmentMode 'allDevices' -PolicyState 'disabled' -DryRun $true
            $res.plan.assignmentMode | Should -Be 'none'
            @($res.plan.assignments).Count | Should -Be 0
            ($res.plan.diff -join "`n") | Should -Match 'deployed without assignments'
        }

        It 'rejects an unknown assignment mode' {
            { Invoke-DeployIntuneTemplate -TenantId 't-1' -TemplateJson (Get-TestTemplateJson) -AssignmentMode 'everyone' -DryRun $true } |
                Should -Throw '*unknown assignment mode*'
        }
    }

    Context 'conflicts and overwrite' {
        BeforeEach {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'GET') {
                    return @{ value = @(@{ id = 'live-1'; displayName = 'Win Baseline'; passwordRequired = $true; passwordMinimumLength = 8 }) }
                }
                return @{ id = 'live-1' }
            }
        }

        It 'flags a same-name live policy as a conflict without overwrite' {
            $res = Invoke-DeployIntuneTemplate -TenantId 't-1' -TemplateJson (Get-TestTemplateJson) -DryRun $true
            $res.plan.conflict | Should -BeTrue
            $res.plan.valid | Should -BeFalse
            $res.plan.conflictMessage | Should -Match 'Enable overwrite'
        }

        It 'refuses to apply a conflicting deploy' {
            { Invoke-DeployIntuneTemplate -TenantId 't-1' -TemplateJson (Get-TestTemplateJson) } |
                Should -Throw '*Deploy blocked*'
        }

        It 'diffs the template against the live policy on overwrite' {
            $res = Invoke-DeployIntuneTemplate -TenantId 't-1' -TemplateJson (Get-TestTemplateJson) -Overwrite $true -DryRun $true
            $res.plan.action | Should -Be 'update'
            $diff = $res.plan.diff -join "`n"
            $diff | Should -Match "~ passwordMinimumLength: 8 -> 12"
            $diff | Should -Not -Match 'passwordRequired:'
        }

        It 'PATCHes the live compliance policy and audits before/after' {
            $res = Invoke-DeployIntuneTemplate -TenantId 't-1' -TemplateJson (Get-TestTemplateJson) -Overwrite $true
            $res.state | Should -Be 'succeeded'
            $res.policyId | Should -Be 'live-1'
            $res.auditEvent.action | Should -Be 'intune.template.deploy.update'
            $res.auditEvent.before.passwordMinimumLength | Should -Be 8
            $res.auditEvent.after.passwordMinimumLength | Should -Be 12
            Should -Invoke Invoke-MgGraphRequest -Times 1 -ParameterFilter {
                $Method -eq 'PATCH' -and $Uri -eq '/v1.0/deviceManagement/deviceCompliancePolicies/live-1'
            }
        }
    }

    Context 'apply' {
        It 'creates groups, the policy, and assignments, and audits the write' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'GET') { return @{ value = @() } }
                if ($Uri -eq '/v1.0/groups') { return @{ id = 'grp-new' } }
                return @{ id = 'pol-new' }
            }
            $res = Invoke-DeployIntuneTemplate -TenantId 't-1' -TemplateJson (Get-TestTemplateJson -PolicyType 'configuration') -AssignmentMode 'groups' -Groups @('Pilot') -CreateGroups $true
            $res.state | Should -Be 'succeeded'
            $res.policyId | Should -Be 'pol-new'
            $res.auditEvent.action | Should -Be 'intune.template.deploy.create'
            @($res.steps | ForEach-Object { $_.step }) | Should -Be @('createGroup', 'createPolicy', 'assign')
            Should -Invoke Invoke-MgGraphRequest -Times 1 -ParameterFilter {
                $Uri -eq '/v1.0/deviceManagement/configurationPolicies/pol-new/assign' -and $Body -match 'grp-new'
            }
        }

        It 'resolves portal-shaped template group assignments by name' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Uri -like '/v1.0/groups?*') { return @{ value = @(@{ id = 'grp-it'; displayName = 'IT Group' }) } }
                if ($Method -eq 'GET') { return @{ value = @() } }
                return @{ id = 'pol-new' }
            }
            $template = Get-TestTemplateJson -Assignments @(
                @{ target = 'IT Group'; targetType = 'groupAssignmentTarget' },
                @{ target = 'allDevicesAssignmentTarget'; targetType = 'allDevicesAssignmentTarget' }
            )
            $res = Invoke-DeployIntuneTemplate -TenantId 't-1' -TemplateJson $template
            $res.state | Should -Be 'succeeded'
            Should -Invoke Invoke-MgGraphRequest -Times 1 -ParameterFilter {
                $Uri -like '*/assign' -and $Body -match '"groupId":"grp-it"' -and $Body -match 'allDevicesAssignmentTarget'
            }
        }

        It 'reports partial when the assignment step fails after the policy write' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'GET') { return @{ value = @() } }
                if ($Uri -like '*/assign') { throw 'assign failed: 403' }
                return @{ id = 'pol-new' }
            }
            $res = Invoke-DeployIntuneTemplate -TenantId 't-1' -TemplateJson (Get-TestTemplateJson) -AssignmentMode 'allUsers'
            $res.state | Should -Be 'partial'
            $res.success | Should -BeTrue
            ($res.steps | Where-Object { $_.step -eq 'assign' }).status | Should -Be 'failed'
            $res.auditEvent | Should -Not -BeNullOrEmpty
        }

        It 'reports failed with no audit event when the policy write fails' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'GET') { return @{ value = @() } }
                throw 'Graph 400: bad settings'
            }
            $res = Invoke-DeployIntuneTemplate -TenantId 't-1' -TemplateJson (Get-TestTemplateJson)
            $res.state | Should -Be 'failed'
            $res.success | Should -BeFalse
            $res.error | Should -Match 'bad settings'
            $res.auditEvent | Should -BeNullOrEmpty
        }
    }
}
