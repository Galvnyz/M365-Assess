BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Set-GroupGalDelivery.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/set-group-gal-delivery.ps1'

    function global:Get-UnifiedGroup { param($Identity) }
    function global:Set-UnifiedGroup { param($Identity, $HiddenFromAddressListsEnabled, $RequireSenderAuthenticationEnabled, $GrantSendOnBehalfTo, $Confirm) }
    function global:Get-DistributionGroup { param($Identity) }
    function global:Set-DistributionGroup { param($Identity, $HiddenFromAddressListsEnabled, $RequireSenderAuthenticationEnabled, $GrantSendOnBehalfTo, $Confirm) }

    . $script:worker
}

Describe 'Set-GroupGalDelivery worker (T-0269)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Invoke-SetGroupGalDelivery -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Test-DeliveryManagementInput -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-SetGroupGalDeliveryJob -CommandType Function) | Should -Not -BeNullOrEmpty
        }
    }

    Context 'Delivery management validation' {
        It 'accepts valid send on behalf grants' {
            $val = Test-DeliveryManagementInput -RequireSenderAuthenticationEnabled $true -GrantSendOnBehalfTo @('user-1@contoso.com')
            $val.Valid | Should -BeTrue
        }

        It 'rejects whitespace or empty entries in GrantSendOnBehalfTo' {
            $val = Test-DeliveryManagementInput -RequireSenderAuthenticationEnabled $true -GrantSendOnBehalfTo @(' ')
            $val.Valid | Should -BeFalse
            $val.Message | Should -Match 'empty or whitespace'
        }
    }

    Context 'GAL and delivery management execution' {
        BeforeEach {
            Mock Get-UnifiedGroup {
                param($Identity)
                return [pscustomobject]@{
                    Identity                           = $Identity
                    HiddenFromAddressListsEnabled      = $false
                    RequireSenderAuthenticationEnabled = $false
                    GrantSendOnBehalfTo                = @()
                }
            }
            Mock Set-UnifiedGroup {}
        }

        It 'DryRun returns diff preview without calling Set-UnifiedGroup' {
            $plan = Invoke-SetGroupGalDelivery -TenantId 'tenant-test' -GroupId 'grp-123' -Target 'gal' -HiddenFromAddressListsEnabled $true -DryRun $true
            $plan.dryRun | Should -BeTrue
            $plan.diff[0] | Should -Match 'Set HiddenFromAddressListsEnabled: False -> True'
            Assert-MockCalled Set-UnifiedGroup -Times 0
        }

        It 'applies GAL changes and records audit event' {
            $res = Invoke-SetGroupGalDelivery -TenantId 'tenant-test' -GroupId 'grp-123' -Target 'gal' -HiddenFromAddressListsEnabled $true -DryRun $false
            $res.success | Should -BeTrue
            $res.after.hiddenFromAddressListsEnabled | Should -BeTrue
            $res.auditEvent.action | Should -Be 'group.gal'
            Assert-MockCalled Set-UnifiedGroup -Times 1 -ParameterFilter { $HiddenFromAddressListsEnabled -eq $true }
        }

        It 'applies delivery management changes and records audit event' {
            $res = Invoke-SetGroupGalDelivery -TenantId 'tenant-test' -GroupId 'grp-123' -Target 'delivery' -RequireSenderAuthenticationEnabled $true -GrantSendOnBehalfTo @('admin@contoso.com') -DryRun $false
            $res.success | Should -BeTrue
            $res.after.requireSenderAuthenticationEnabled | Should -BeTrue
            $res.after.grantSendOnBehalfTo[0] | Should -Be 'admin@contoso.com'
            $res.auditEvent.action | Should -Be 'group.delivery'
            Assert-MockCalled Set-UnifiedGroup -Times 1 -ParameterFilter { $RequireSenderAuthenticationEnabled -eq $true }
        }
    }
}
