BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-ConditionalAccessReport' {
    BeforeAll {
        # Stub Get-MgContext so the connection check passes
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }
        function Get-MgIdentityConditionalAccessPolicy { param([switch]$All) }

        # Stub Import-Module to prevent actual module loading
        Mock Import-Module { }

        # Mock Get-MgIdentityConditionalAccessPolicy with realistic CA policies
        Mock Get-MgIdentityConditionalAccessPolicy {
            return @(
                [PSCustomObject]@{
                    DisplayName      = 'Require MFA for Admins'
                    State            = 'enabled'
                    CreatedDateTime  = '2025-01-10T08:00:00Z'
                    ModifiedDateTime = '2025-06-15T12:00:00Z'
                    Conditions       = @{
                        Users        = @{
                            IncludeUsers = @('All')
                            ExcludeUsers = @('breakglass@contoso.com')
                        }
                        Applications = @{
                            IncludeApplications = @('All')
                        }
                    }
                    GrantControls    = @{
                        BuiltInControls = @('mfa')
                        Operator        = 'OR'
                    }
                    SessionControls  = @{
                        SignInFrequency                  = @{ IsEnabled = $true; Value = 4; Type = 'hours' }
                        PersistentBrowser                = @{ IsEnabled = $false }
                        CloudAppSecurity                 = @{ IsEnabled = $false }
                        ApplicationEnforcedRestrictions  = @{ IsEnabled = $false }
                    }
                },
                [PSCustomObject]@{
                    DisplayName      = 'Block Legacy Auth'
                    State            = 'enabledForReportingButNotEnforced'
                    CreatedDateTime  = '2025-02-20T10:00:00Z'
                    ModifiedDateTime = $null
                    Conditions       = @{
                        Users        = @{
                            IncludeUsers = @('All')
                            ExcludeUsers = @()
                        }
                        Applications = @{
                            IncludeApplications = @('All')
                        }
                    }
                    GrantControls    = @{
                        BuiltInControls = @('block')
                        Operator        = $null
                    }
                    SessionControls  = @{
                        SignInFrequency                  = @{ IsEnabled = $false }
                        PersistentBrowser                = @{ IsEnabled = $false }
                        CloudAppSecurity                 = @{ IsEnabled = $false }
                        ApplicationEnforcedRestrictions  = @{ IsEnabled = $false }
                    }
                }
            )
        }

        # Run the collector
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $result = & "$PSScriptRoot/../../src/M365-Assess/Entra/Get-ConditionalAccessReport.ps1"
    }

    It 'Returns a non-empty policy report' {
        $result | Should -Not -BeNullOrEmpty
    }

    It 'Output has expected properties' {
        $first = $result | Select-Object -First 1
        $first.PSObject.Properties.Name | Should -Contain 'DisplayName'
        $first.PSObject.Properties.Name | Should -Contain 'State'
        $first.PSObject.Properties.Name | Should -Contain 'IncludeUsers'
        $first.PSObject.Properties.Name | Should -Contain 'GrantControls'
        $first.PSObject.Properties.Name | Should -Contain 'SessionControls'
    }

    It 'Returns one row per policy' {
        @($result).Count | Should -Be 2
    }

    It 'Flattens session controls correctly' {
        $mfaPolicy = $result | Where-Object { $_.DisplayName -eq 'Require MFA for Admins' }
        $mfaPolicy.SessionControls | Should -Match 'SignInFrequency'
    }
}

Describe 'Get-ConditionalAccessReport - Edge Cases' {
    BeforeAll {
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }
        function Get-MgIdentityConditionalAccessPolicy { param([switch]$All) }
        Mock Import-Module { }
    }

    Context 'when no CA policies exist' {
        BeforeAll {
            Mock Get-MgIdentityConditionalAccessPolicy { return @() }
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            $result = & "$PSScriptRoot/../../src/M365-Assess/Entra/Get-ConditionalAccessReport.ps1"
        }

        It 'Returns empty result without error' {
            $result | Should -BeNullOrEmpty
        }
    }

    Context 'when policies reuse user IDs and a lookup is forbidden' {
        BeforeAll {
            function Invoke-GraphReadBatch { param($Requests) }
            Mock Invoke-GraphReadBatch {
                $Requests.Count | Should -Be 2
                @{
                    '11111111-1111-1111-1111-111111111111'=@{status=200;body=@{userPrincipalName='admin@contoso.com'}}
                    '22222222-2222-2222-2222-222222222222'=@{status=403}
                }
            }
            Mock Get-MgIdentityConditionalAccessPolicy {
                @('A','B') | ForEach-Object {
                    [pscustomobject]@{DisplayName=$_;Conditions=@{Users=@{
                        IncludeUsers=@('All','11111111-1111-1111-1111-111111111111')
                        ExcludeUsers=@('22222222-2222-2222-2222-222222222222')
                    }}}
                }
            }
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            $result = & "$PSScriptRoot/../../src/M365-Assess/Entra/Get-ConditionalAccessReport.ps1"
        }
        It 'batches unique references while preserving unresolved IDs and All' {
            @($result).Count | Should -Be 2
            $result[0].IncludeUsers | Should -Match 'All'
            $result[0].IncludeUsers | Should -Match 'admin@contoso.com'
            $result[0].ExcludeUsers | Should -Be '22222222-2222-2222-2222-222222222222'
            Should -Invoke Invoke-GraphReadBatch -Times 1 -Exactly -Scope Context
        }
    }
}
