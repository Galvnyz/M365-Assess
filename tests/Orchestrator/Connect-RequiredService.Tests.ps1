BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Connect-RequiredService' {
    BeforeAll {
        # Stub external commands
        function Get-MgContext { }
        function Get-MgOrganization { }
        function Disconnect-ExchangeOnline { }
        function Update-ProgressStatus { }
        function Test-GraphPermissions { }

        # Load helpers first (provides Write-AssessmentLog, Get-RecommendedAction)
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/Connect-RequiredService.ps1"

        Mock Write-Host { }
        Mock Write-AssessmentLog { }
    }

    Context 'when a service is already connected' {
        BeforeAll {
            $connectedServices = [System.Collections.Generic.List[string]]::new()
            $connectedServices.Add('Graph')
            $failedServices = [System.Collections.Generic.List[string]]::new()
            $connectServicePath = 'fake-connect.ps1'
        }

        It 'should skip without displaying a connection message' {
            Connect-RequiredService -Services @('Graph') -SectionName 'Identity'
            # If it skipped, Write-Host should not be called (no "Connecting to..." message)
            Should -Invoke Write-Host -Times 0
        }
    }

    Context 'when Exchange evidence must survive the Purview transition' {
        BeforeEach {
            $connectedServices = [System.Collections.Generic.List[string]]::new()
            $connectedServices.Add('ExchangeOnline')
            $failedServices = [System.Collections.Generic.List[string]]::new()
            $issues = [System.Collections.Generic.List[object]]::new()
            $assessmentEvidence = @{}
            $projectRoot = "$PSScriptRoot/../../src/M365-Assess"
            $connectServicePath = Join-Path $TestDrive 'capture-connect.ps1'
            Set-Content -Path $connectServicePath -Value '# no-op'
            $M365Environment = 'commercial'
            $script:resolvedTenantId = 'fixture-tenant'
            function Get-ConnectionInformation {
                [PSCustomObject]@{State='Connected';IsEopSession=$false;ModuleName='ExchangeFixture';TenantID='fixture-tenant';ConnectionUri='https://outlook.office365.com'}
            }
            Mock Get-Command { { param($ErrorAction) [PSCustomObject]@{UnifiedAuditLogIngestionEnabled=$true} } } -ParameterFilter { $Name -eq 'Get-AdminAuditLogConfig' -and $Module -eq 'ExchangeFixture' }
            Mock Disconnect-ExchangeOnline {
                $assessmentEvidence.ExchangeAudit.Enabled | Should -BeTrue
            }
        }
        It 'captures evidence before disconnecting and still connects Purview' {
            Connect-RequiredService -Services @('Purview') -SectionName 'Security'
            $assessmentEvidence.ExchangeAudit.Enabled | Should -BeTrue
            $assessmentEvidence.ExchangeAudit.TenantId | Should -Be 'fixture-tenant'
            $connectedServices | Should -Contain 'Purview'
            Should -Invoke Disconnect-ExchangeOnline -Times 1 -Exactly
        }
        It 'records capture failure without blocking the Purview connection' {
            Mock Get-ConnectionInformation { throw 'Audit connection unavailable' }
            Mock Disconnect-ExchangeOnline { }
            Connect-RequiredService -Services @('Purview') -SectionName 'Security'
            $assessmentEvidence.ExchangeAudit.Error | Should -Match 'unavailable'
            $connectedServices | Should -Contain 'Purview'
        }
    }

    Context 'when a service previously failed' {
        BeforeAll {
            $connectedServices = [System.Collections.Generic.List[string]]::new()
            $failedServices = [System.Collections.Generic.List[string]]::new()
            $failedServices.Add('ExchangeOnline')
            $connectServicePath = 'fake-connect.ps1'
        }

        It 'should skip without retrying' {
            Connect-RequiredService -Services @('ExchangeOnline') -SectionName 'Email'
            Should -Invoke Write-Host -Times 0
        }
    }

    Context 'when connecting a new service successfully' {
        BeforeAll {
            $connectedServices = [System.Collections.Generic.List[string]]::new()
            $failedServices = [System.Collections.Generic.List[string]]::new()
            $issues = [System.Collections.Generic.List[object]]::new()
            $connectServicePath = Join-Path $TestDrive 'mock-connect.ps1'
            Set-Content -Path $connectServicePath -Value '# no-op'
            $M365Environment = 'commercial'
            $graphScopes = @('User.Read.All')
            $script:graphPermissionsChecked = $false
            $Section = @('Identity')
            $sectionScopeMap = @{ 'Identity' = @('User.Read.All') }

            Mock Test-GraphPermissions { }
            Mock Get-MgOrganization {
                return [PSCustomObject]@{
                    Id              = 'test-id'
                    DisplayName     = 'Contoso'
                    VerifiedDomains = @(
                        [PSCustomObject]@{ Name = 'contoso.onmicrosoft.com'; IsInitial = $true }
                    )
                }
            }
        }

        It 'should add the service to connectedServices' {
            Connect-RequiredService -Services @('Graph') -SectionName 'Identity'
            $connectedServices | Should -Contain 'Graph'
        }

        It 'should display friendly service name' {
            $connectedServices.Clear()
            $script:graphPermissionsChecked = $false
            Connect-RequiredService -Services @('Graph') -SectionName 'Identity'
            Should -Invoke Write-Host -ParameterFilter {
                $Object -like '*Microsoft Graph*'
            }
        }
    }

    Context 'when connection throws an error' {
        BeforeAll {
            $connectedServices = [System.Collections.Generic.List[string]]::new()
            $failedServices = [System.Collections.Generic.List[string]]::new()
            $issues = [System.Collections.Generic.List[object]]::new()
            $connectServicePath = Join-Path $TestDrive 'fail-connect.ps1'
            Set-Content -Path $connectServicePath -Value 'throw "Connection refused"'
            $M365Environment = 'commercial'
        }

        It 'should add the service to failedServices' {
            Connect-RequiredService -Services @('ExchangeOnline') -SectionName 'Email'
            $failedServices | Should -Contain 'ExchangeOnline'
        }

        It 'should record an issue' {
            $issues.Count | Should -BeGreaterThan 0
            $issues[0].Severity | Should -Be 'ERROR'
        }
    }

    Context 'when EXO and Purview conflict' {
        BeforeAll {
            $connectedServices = [System.Collections.Generic.List[string]]::new()
            $connectedServices.Add('Purview')
            $failedServices = [System.Collections.Generic.List[string]]::new()
            $issues = [System.Collections.Generic.List[object]]::new()
            $connectServicePath = Join-Path $TestDrive 'mock-connect.ps1'
            Set-Content -Path $connectServicePath -Value '# no-op'
            $M365Environment = 'commercial'

            Mock Disconnect-ExchangeOnline { }
        }

        It 'should disconnect Purview before connecting ExchangeOnline' {
            Connect-RequiredService -Services @('ExchangeOnline') -SectionName 'Email'
            Should -Invoke Disconnect-ExchangeOnline -Times 1
        }

        It 'should remove Purview from connectedServices' {
            $connectedServices | Should -Not -Contain 'Purview'
        }
    }

    Context 'service display name mapping' {
        BeforeAll {
            $connectedServices = [System.Collections.Generic.List[string]]::new()
            $failedServices = [System.Collections.Generic.List[string]]::new()
            $issues = [System.Collections.Generic.List[object]]::new()
            $connectServicePath = Join-Path $TestDrive 'mock-connect.ps1'
            Set-Content -Path $connectServicePath -Value '# no-op'
            $M365Environment = 'commercial'
        }

        It 'should display "Exchange Online" for ExchangeOnline service' -ForEach @(
            @{ Service = 'ExchangeOnline'; Expected = 'Exchange Online' }
            @{ Service = 'Purview'; Expected = 'Purview' }
        ) {
            $connectedServices.Clear()
            $failedServices.Clear()
            Connect-RequiredService -Services @($Service) -SectionName 'Test'
            Should -Invoke Write-Host -ParameterFilter {
                $Object -like "*$Expected*"
            }
        }
    }
}
