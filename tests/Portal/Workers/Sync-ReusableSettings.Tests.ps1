BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Sync-ReusableSettings.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/sync-reusable-settings.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker

    $script:FirewallId = 'vendor_msft_firewall_mdmstore_dynamickeywords_addresses_{0}'

    function Get-FirewallInstance {
        param([string[]]$Ranges)
        return @{
            '@odata.type'       = '#microsoft.graph.deviceManagementConfigurationSimpleSettingCollectionInstance'
            settingDefinitionId = $script:FirewallId
            simpleSettingCollectionValue = @($Ranges | ForEach-Object { @{ value = $_ } })
        }
    }

    function Get-TemplatesJson {
        param([object[]]$Templates)
        return ConvertTo-Json -InputObject @($Templates) -Depth 20
    }

    function Get-FirewallTemplate {
        param([string]$Id = 'tpl-fw', [string]$Name = 'Branch offices', [string[]]$Ranges = @('10.0.0.0/8', '192.168.1.0/24'))
        return @{
            id           = $Id
            name         = $Name
            settingsJson = @{ displayName = $Name; settingInstance = (Get-FirewallInstance -Ranges $Ranges) }
        }
    }
}

Describe 'Sync-ReusableSettings worker (T-0308)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Sync-ReusableSettingTemplate -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-SyncReusableSettingsJob -CommandType Function) | Should -Not -BeNullOrEmpty
        }
    }

    Context 'v1 sync scope' {
        It 'enumerates the participating settings types' {
            Get-ReusableSettingTypeKey -SettingDefinitionId $script:FirewallId | Should -Be 'firewallRemoteAddresses'
            Get-ReusableSettingTypeKey -SettingDefinitionId 'device_vendor_msft_defender_configuration_devicecontrol_policygroups_{0}_groupdata' |
                Should -Be 'deviceControlGroups'
            Get-ReusableSettingTypeKey -SettingDefinitionId 'device_vendor_msft_policy_config_browser_homepages' | Should -BeNullOrEmpty
        }

        It 'rejects a template outside the scope before touching Graph' {
            Mock Invoke-MgGraphRequest { }
            $bad = @{ id = 'tpl-x'; name = 'x'; settingsJson = @{ displayName = 'x'; settingInstance = @{ settingDefinitionId = 'device_vendor_msft_policy_config_browser_homepages' } } }
            { Sync-ReusableSettingTemplate -TenantId 't-1' -TemplatesJson (Get-TemplatesJson -Templates @($bad)) } |
                Should -Throw '*outside the v1 reusable-settings sync scope*'
            Should -Invoke Invoke-MgGraphRequest -Times 0
        }
    }

    Context 'job envelope' {
        It 'previews unless dryRun is explicitly false' {
            $path = Join-Path $TestDrive 'job.json'
            @{ tenantId = 't-1'; templatesJson = '[]' } | ConvertTo-Json | Set-Content -LiteralPath $path
            (Read-SyncReusableSettingsJob -Path $path)['DryRun'] | Should -BeTrue
            @{ tenantId = 't-1'; templatesJson = '[]'; dryRun = $false } | ConvertTo-Json | Set-Content -LiteralPath $path
            (Read-SyncReusableSettingsJob -Path $path)['DryRun'] | Should -BeFalse
        }

        It 'rejects an unknown action' {
            $path = Join-Path $TestDrive 'bad.json'
            @{ tenantId = 't-1'; action = 'purge' } | ConvertTo-Json | Set-Content -LiteralPath $path
            { Read-SyncReusableSettingsJob -Path $path } | Should -Throw '*unknown action*'
        }
    }

    Context 'list' {
        It 'returns live settings with their scope type' {
            Mock Invoke-MgGraphRequest {
                @{ value = @(
                        @{ id = 's-1'; displayName = 'Branch offices'; settingDefinitionId = $script:FirewallId; referencingConfigurationPolicyCount = 3 },
                        @{ id = 's-2'; displayName = 'Other'; settingDefinitionId = 'something_else'; referencingConfigurationPolicyCount = 0 }
                    ) }
            }
            $items = Get-TenantReusableSetting
            $items.Count | Should -Be 2
            $items[0].type | Should -Be 'firewallRemoteAddresses'
            $items[0].referencingPolicyCount | Should -Be 3
            $items[1].inScope | Should -BeFalse
        }
    }

    Context 'preview' {
        BeforeEach {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Uri -like '*referencingConfigurationPolicies*') {
                    return @{ value = @(@{ id = 'pol-1'; name = 'Firewall rules - HQ' }) }
                }
                return @{ value = @(
                        @{
                            id                  = 's-1'
                            displayName         = 'Branch offices'
                            settingDefinitionId = $script:FirewallId
                            settingInstance     = (Get-FirewallInstance -Ranges @('10.0.0.0/8'))
                        }
                    ) }
            }
        }

        It 'returns a per-setting leaf diff and referencing policies without writing' {
            $templates = Get-TemplatesJson -Templates @(
                (Get-FirewallTemplate),
                (Get-FirewallTemplate -Id 'tpl-new' -Name 'Datacenter' -Ranges @('172.16.0.0/12'))
            )
            $res = Sync-ReusableSettingTemplate -TenantId 't-1' -TemplatesJson $templates
            $res.preview | Should -BeTrue
            $update = $res.changes | Where-Object { $_.templateId -eq 'tpl-fw' }
            $update.action | Should -Be 'update'
            $update.settingId | Should -Be 's-1'
            $update.diff | Should -Contain '+ simpleSettingCollectionValue[1].value: "192.168.1.0/24"'
            $update.referencingPolicies[0].name | Should -Be 'Firewall rules - HQ'
            $create = $res.changes | Where-Object { $_.templateId -eq 'tpl-new' }
            $create.action | Should -Be 'create'
            $create.diff[0] | Should -Be '+ Reusable setting: Datacenter'
            ($create.diff -join "`n") | Should -Not -Match '- :'
            Should -Invoke Invoke-MgGraphRequest -Times 0 -ParameterFilter { $Method -ne 'GET' }
        }

        It 'reports no change when the live setting already matches' {
            $templates = Get-TemplatesJson -Templates @((Get-FirewallTemplate -Ranges @('10.0.0.0/8')))
            $res = Sync-ReusableSettingTemplate -TenantId 't-1' -TemplatesJson $templates
            $res.changes[0].action | Should -Be 'none'
            @($res.changes[0].diff).Count | Should -Be 0
        }

        It 'reports removed leaves' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Uri -like '*referencingConfigurationPolicies*') { return @{ value = @() } }
                return @{ value = @(@{ id = 's-1'; displayName = 'Branch offices'; settingDefinitionId = $script:FirewallId; settingInstance = (Get-FirewallInstance -Ranges @('10.0.0.0/8', '10.1.0.0/16')) }) }
            }
            $templates = Get-TemplatesJson -Templates @((Get-FirewallTemplate -Ranges @('10.0.0.0/8')))
            $res = Sync-ReusableSettingTemplate -TenantId 't-1' -TemplatesJson $templates
            $res.changes[0].diff | Should -Contain '- simpleSettingCollectionValue[1].value: "10.1.0.0/16"'
        }
    }

    Context 'apply' {
        It 'creates and updates, audits each write, and skips unchanged settings' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'POST') { return @{ id = 's-new' } }
                if ($Method -eq 'PUT') { return $null }
                if ($Uri -like '*referencingConfigurationPolicies*') { return @{ value = @(@{ id = 'pol-1'; name = 'HQ' }) } }
                return @{ value = @(
                        @{ id = 's-1'; displayName = 'Branch offices'; settingDefinitionId = $script:FirewallId; settingInstance = (Get-FirewallInstance -Ranges @('10.0.0.0/8')) },
                        @{ id = 's-2'; displayName = 'Same'; settingDefinitionId = $script:FirewallId; settingInstance = (Get-FirewallInstance -Ranges @('1.1.1.1/32')) }
                    ) }
            }
            $templates = Get-TemplatesJson -Templates @(
                (Get-FirewallTemplate),
                (Get-FirewallTemplate -Id 'tpl-new' -Name 'Datacenter' -Ranges @('172.16.0.0/12')),
                (Get-FirewallTemplate -Id 'tpl-same' -Name 'Same' -Ranges @('1.1.1.1/32'))
            )
            $res = Sync-ReusableSettingTemplate -TenantId 't-1' -TemplatesJson $templates -DryRun $false -Actor 'op@contoso'
            $res.preview | Should -BeFalse
            ($res.results | ForEach-Object { "$($_.templateId)=$($_.status)" }) |
                Should -Be @('tpl-fw=succeeded', 'tpl-new=succeeded', 'tpl-same=skipped')
            $res.auditEvents.Count | Should -Be 2
            $upd = $res.auditEvents | Where-Object { $_.action -eq 'intune.reusable-setting.update' }
            $upd.targetId | Should -Be 's-1'
            $upd.referencingPolicies | Should -Be @('pol-1')
            $upd.actor | Should -Be 'op@contoso'
            $upd.before.simpleSettingCollectionValue.Count | Should -Be 1
            ($res.auditEvents | Where-Object { $_.action -eq 'intune.reusable-setting.create' }).targetId | Should -Be 's-new'
            Should -Invoke Invoke-MgGraphRequest -Times 1 -ParameterFilter {
                $Method -eq 'PUT' -and $Uri -eq '/beta/deviceManagement/reusablePolicySettings/s-1' -and $Body -match 'deviceManagementReusablePolicySetting'
            }
        }

        It 'records a failed write and continues with the next setting' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'POST' -and $Body -match 'Datacenter') { throw 'Graph 400' }
                if ($Method -eq 'POST') { return @{ id = 's-ok' } }
                return @{ value = @() }
            }
            $templates = Get-TemplatesJson -Templates @(
                (Get-FirewallTemplate -Id 'tpl-new' -Name 'Datacenter'),
                (Get-FirewallTemplate -Id 'tpl-ok' -Name 'Branch offices')
            )
            $res = Sync-ReusableSettingTemplate -TenantId 't-1' -TemplatesJson $templates -DryRun $false
            ($res.results | Where-Object { $_.templateId -eq 'tpl-new' }).status | Should -Be 'failed'
            ($res.results | Where-Object { $_.templateId -eq 'tpl-new' }).error | Should -Match 'Graph 400'
            ($res.results | Where-Object { $_.templateId -eq 'tpl-ok' }).status | Should -Be 'succeeded'
            $res.auditEvents.Count | Should -Be 1
        }
    }
}
