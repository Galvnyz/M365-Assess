BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Deploy-CaTemplate.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/deploy-ca-template.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker
}

Describe 'Deploy-CaTemplate worker (T-0286)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Invoke-DeployCaTemplate -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-DeployCaTemplateJob -CommandType Function) | Should -Not -BeNullOrEmpty
        }
    }

    Context 'Plan generation and DryRun' {
        BeforeEach {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                return @{ value = @() }
            }
        }

        It 'returns a plan preview with report-only state default' {
            $template = @{
                id = 'tmpl-mfa'
                name = 'Require MFA for All'
                policyJson = @{
                    displayName = 'Require MFA for All'
                    conditions = @{
                        users = @{ includeUsers = @('All'); excludeUsers = @('bg@contoso.com') }
                    }
                    grantControls = @{ builtInControls = @('mfa') }
                }
            } | ConvertTo-Json -Depth 5

            $res = Invoke-DeployCaTemplate -TenantId 'tenant-test' -TemplateJson $template -DryRun $true
            $res.success | Should -BeTrue
            $res.plan.policyName | Should -Be 'Require MFA for All'
            $res.plan.policyState | Should -Be 'enabledForReportingButNotEnforced'
            $res.plan.dryRun | Should -BeTrue
            $res.plan.diff.Count | Should -BeGreaterThan 0
        }

        It 'surfaces disable-security-defaults and create-groups in the plan' {
            $template = @{
                displayName = 'Block Legacy Auth'
                conditions = @{
                    users = @{ includeUsers = @('All'); excludeUsers = @('bg@contoso.com') }
                }
                grantControls = @{ builtInControls = @('block') }
            } | ConvertTo-Json -Depth 5

            $res = Invoke-DeployCaTemplate -TenantId 'tenant-test' -TemplateJson $template `
                -DisableSecurityDefaults $true -CreateGroups $true -DryRun $true

            $res.plan.disableSecurityDefaults | Should -BeTrue
            $res.plan.groupsToCreate.Count | Should -Be 2
            ($res.plan.diff -join "`n") | Should -Match "Security Defaults will be disabled"
            ($res.plan.diff -join "`n") | Should -Match "Create Group: SG-CA-Block Legacy Auth-Included"
        }
    }

    Context 'Conflict handling and Overwrite' {
        BeforeEach {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'GET') {
                    return @{
                        value = @(
                            @{
                                id = 'existing-pol-id'
                                displayName = 'Require MFA for All'
                                state = 'enabledForReportingButNotEnforced'
                            }
                        )
                    }
                }
                if ($Method -eq 'PATCH') {
                    return @{ id = 'existing-pol-id'; displayName = 'Require MFA for All' }
                }
                return @{}
            }
        }

        It 'flags conflict when policy already exists and overwrite is false' {
            $template = @{
                displayName = 'Require MFA for All'
                conditions = @{ users = @{ includeUsers = @('All'); excludeUsers = @('bg@contoso.com') } }
                grantControls = @{ builtInControls = @('mfa') }
            } | ConvertTo-Json -Depth 5

            $res = Invoke-DeployCaTemplate -TenantId 'tenant-test' -TemplateJson $template -Overwrite $false -DryRun $true
            $res.plan.conflict | Should -BeTrue
            $res.plan.valid | Should -BeFalse
            $res.plan.conflictMessage | Should -Match "already exists"
        }

        It 'diffs against existing policy and calls PATCH when overwrite is true' {
            $template = @{
                displayName = 'Require MFA for All'
                conditions = @{ users = @{ includeUsers = @('All'); excludeUsers = @('bg@contoso.com') } }
                grantControls = @{ builtInControls = @('mfa') }
            } | ConvertTo-Json -Depth 5

            $res = Invoke-DeployCaTemplate -TenantId 'tenant-test' -TemplateJson $template -PolicyState 'enabled' -Overwrite $true -DryRun $false
            $res.success | Should -BeTrue
            $res.plan.action | Should -Be 'update'
            ($res.plan.diff -join "`n") | Should -Match "Overwriting existing policy"
            $res.auditEvent.targetId | Should -Be 'existing-pol-id'
        }
    }

    Context 'Guardrail enforcement' {
        It 'hard-blocks template deploying All users + Block without break-glass exclusion' {
            $template = @{
                displayName = 'Dangerous Block All'
                conditions = @{ users = @{ includeUsers = @('All'); excludeUsers = @() } }
                grantControls = @{ builtInControls = @('block') }
            } | ConvertTo-Json -Depth 5

            { Invoke-DeployCaTemplate -TenantId 'tenant-test' -TemplateJson $template } | Should -Throw "*cannot block All users without an explicit break-glass exclusion*"
        }

        It 'admits deployment when break-glass exclusion is supplied' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                return @{ id = 'new-id'; value = @() }
            }

            $template = @{
                displayName = 'Safe Block All'
                conditions = @{ users = @{ includeUsers = @('All'); excludeUsers = @() } }
                grantControls = @{ builtInControls = @('block') }
            } | ConvertTo-Json -Depth 5

            $res = Invoke-DeployCaTemplate -TenantId 'tenant-test' -TemplateJson $template `
                -BreakGlassExclusions @('emergency@contoso.com') -DryRun $true
            $res.success | Should -BeTrue
        }
    }
}
