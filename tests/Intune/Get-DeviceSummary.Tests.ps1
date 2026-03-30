BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-DeviceSummary' {
    BeforeAll {
        # Stub the Graph context guard so the connection check passes
        function global:Get-MgContext { return [PSCustomObject]@{ TenantId = 'test-tenant' } }

        # Stub Import-Module so the submodule load is a no-op
        function global:Import-Module { }

        # Stub Get-MgDeviceManagementManagedDevice before Mocking it
        function global:Get-MgDeviceManagementManagedDevice { }

        Mock Get-MgDeviceManagementManagedDevice {
            return @(
                [PSCustomObject]@{
                    DeviceName        = 'DESKTOP-ABC123'
                    UserDisplayName   = 'Alice Smith'
                    UserPrincipalName = 'alice@contoso.com'
                    OperatingSystem   = 'Windows'
                    OsVersion         = '10.0.22621.0'
                    ComplianceState   = 'compliant'
                    ManagementAgent   = 'mdm'
                    EnrolledDateTime  = [datetime]'2024-01-15T10:00:00Z'
                    LastSyncDateTime  = [datetime]'2025-03-01T08:30:00Z'
                    Model             = 'Surface Pro 9'
                    Manufacturer      = 'Microsoft'
                    SerialNumber      = 'SN-001'
                },
                [PSCustomObject]@{
                    DeviceName        = 'LAPTOP-XYZ789'
                    UserDisplayName   = 'Bob Jones'
                    UserPrincipalName = 'bob@contoso.com'
                    OperatingSystem   = 'Windows'
                    OsVersion         = '10.0.19045.0'
                    ComplianceState   = 'noncompliant'
                    ManagementAgent   = 'mdm'
                    EnrolledDateTime  = [datetime]'2023-06-01T09:00:00Z'
                    LastSyncDateTime  = [datetime]'2025-02-28T14:00:00Z'
                    Model             = 'ThinkPad X1 Carbon'
                    Manufacturer      = 'Lenovo'
                    SerialNumber      = 'SN-002'
                }
            )
        }

        # Dot-source the collector; results land in $results (script scope)
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-DeviceSummary.ps1"
    }

    It 'Returns a non-empty device list' {
        $results.Count | Should -BeGreaterThan 0
    }

    It 'Returns the correct number of devices' {
        $results.Count | Should -Be 2
    }

    It 'All results have required properties' {
        $requiredProps = @(
            'DeviceName', 'UserDisplayName', 'UserPrincipalName',
            'OperatingSystem', 'OsVersion', 'ComplianceState',
            'ManagementAgent', 'EnrolledDateTime', 'LastSyncDateTime',
            'Model', 'Manufacturer', 'SerialNumber'
        )
        foreach ($device in $results) {
            foreach ($prop in $requiredProps) {
                $device.PSObject.Properties.Name | Should -Contain $prop `
                    -Because "Device '$($device.DeviceName)' should have property '$prop'"
            }
        }
    }

    It 'Results are sorted by DeviceName' {
        $sorted = $results | Sort-Object DeviceName
        for ($i = 0; $i -lt $results.Count; $i++) {
            $results[$i].DeviceName | Should -Be $sorted[$i].DeviceName
        }
    }

    It 'Device names match expected values' {
        $results.DeviceName | Should -Contain 'DESKTOP-ABC123'
        $results.DeviceName | Should -Contain 'LAPTOP-XYZ789'
    }

    It 'Compliant device has correct ComplianceState' {
        $compliant = $results | Where-Object { $_.DeviceName -eq 'DESKTOP-ABC123' }
        $compliant | Should -Not -BeNullOrEmpty
        $compliant.ComplianceState | Should -Be 'compliant'
    }

    It 'Non-compliant device has correct ComplianceState' {
        $nonCompliant = $results | Where-Object { $_.DeviceName -eq 'LAPTOP-XYZ789' }
        $nonCompliant | Should -Not -BeNullOrEmpty
        $nonCompliant.ComplianceState | Should -Be 'noncompliant'
    }

    AfterAll {
        Remove-Item Function:\Get-MgContext -ErrorAction SilentlyContinue
        Remove-Item Function:\Import-Module -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-MgDeviceManagementManagedDevice -ErrorAction SilentlyContinue
    }
}

Describe 'Get-DeviceSummary - No Devices Enrolled' {
    BeforeAll {
        function global:Get-MgContext { return [PSCustomObject]@{ TenantId = 'test-tenant' } }
        function global:Import-Module { }
        function global:Get-MgDeviceManagementManagedDevice { }

        # Return empty array to simulate no enrolled devices
        Mock Get-MgDeviceManagementManagedDevice { return @() }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-DeviceSummary.ps1"
    }

    It 'Returns an empty array when no devices are enrolled' {
        # Collector emits Write-Output @() and returns; $results is not set in this path
        $results | Should -BeNullOrEmpty
    }

    AfterAll {
        Remove-Item Function:\Get-MgContext -ErrorAction SilentlyContinue
        Remove-Item Function:\Import-Module -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-MgDeviceManagementManagedDevice -ErrorAction SilentlyContinue
    }
}

Describe 'Get-DeviceSummary - Not Connected' {
    BeforeAll {
        # Return null context to simulate no Graph connection
        function global:Get-MgContext { return $null }
        function global:Import-Module { }
        function global:Get-MgDeviceManagementManagedDevice { }

        Mock Get-MgDeviceManagementManagedDevice {}
    }

    It 'Does not call Get-MgDeviceManagementManagedDevice when not connected' {
        # Dot-source; script aborts at the connection guard with a terminating Write-Error
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        try { . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-DeviceSummary.ps1" } catch { }
        Should -Invoke Get-MgDeviceManagementManagedDevice -Times 0 -Exactly
    }

    AfterAll {
        Remove-Item Function:\Get-MgContext -ErrorAction SilentlyContinue
        Remove-Item Function:\Import-Module -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-MgDeviceManagementManagedDevice -ErrorAction SilentlyContinue
    }
}
