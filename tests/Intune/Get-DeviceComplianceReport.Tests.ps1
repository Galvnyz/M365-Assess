BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-DeviceComplianceReport' {
    BeforeAll {
        function global:Assert-GraphConnection { return $true }
        function global:Write-AssessmentLog { param($Message, $Level) }

        Mock Get-MgDeviceManagementManagedDevice {
            return @(
                [PSCustomObject]@{
                    DeviceName        = 'DESKTOP-WIN01'
                    UserDisplayName   = 'Alice Smith'
                    UserPrincipalName = 'alice@contoso.com'
                    OperatingSystem   = 'Windows'
                    OsVersion         = '10.0.19045'
                    ComplianceState   = 'compliant'
                    IsEncrypted       = $true
                    LastSyncDateTime  = [datetime]'2026-04-01'
                    EnrolledDateTime  = [datetime]'2026-01-01'
                    Model             = 'Surface Pro 9'
                    Manufacturer      = 'Microsoft'
                    SerialNumber      = 'SN12345'
                    ManagementAgent   = 'mdm'
                }
                [PSCustomObject]@{
                    DeviceName        = 'IPHONE-BOB'
                    UserDisplayName   = 'Bob Jones'
                    UserPrincipalName = 'bob@contoso.com'
                    OperatingSystem   = 'iOS'
                    OsVersion         = '17.1'
                    ComplianceState   = 'noncompliant'
                    IsEncrypted       = $true
                    LastSyncDateTime  = [datetime]'2026-04-02'
                    EnrolledDateTime  = [datetime]'2026-02-01'
                    Model             = 'iPhone 15'
                    Manufacturer      = 'Apple'
                    SerialNumber      = 'SN67890'
                    ManagementAgent   = 'mdm'
                }
                [PSCustomObject]@{
                    DeviceName        = 'DESKTOP-WIN02'
                    UserDisplayName   = 'Carol White'
                    UserPrincipalName = 'carol@contoso.com'
                    OperatingSystem   = 'Windows'
                    OsVersion         = '11.0.22621'
                    ComplianceState   = 'noncompliant'
                    IsEncrypted       = $false
                    LastSyncDateTime  = [datetime]'2026-04-01'
                    EnrolledDateTime  = [datetime]'2026-01-15'
                    Model             = 'ThinkPad X1'
                    Manufacturer      = 'Lenovo'
                    SerialNumber      = 'SN11111'
                    ManagementAgent   = 'mdm'
                }
            )
        }

        $script:result = & "$PSScriptRoot/../../src/M365-Assess/Intune/Get-DeviceComplianceReport.ps1"
    }

    It 'returns all devices with no filter' {
        @($script:result).Count | Should -Be 3
    }

    It 'result has DeviceName property' {
        foreach ($d in @($script:result)) {
            $d.PSObject.Properties.Name | Should -Contain 'DeviceName'
        }
    }

    It 'result has ComplianceState property' {
        foreach ($d in @($script:result)) {
            $d.PSObject.Properties.Name | Should -Contain 'ComplianceState'
        }
    }

    It 'result has OperatingSystem property' {
        foreach ($d in @($script:result)) {
            $d.PSObject.Properties.Name | Should -Contain 'OperatingSystem'
        }
    }

    AfterAll {
        Remove-Item Function:\Assert-GraphConnection -ErrorAction SilentlyContinue
        Remove-Item Function:\Write-AssessmentLog -ErrorAction SilentlyContinue
    }
}

Describe 'Get-DeviceComplianceReport - Platform filter' {
    BeforeAll {
        function global:Assert-GraphConnection { return $true }
        function global:Write-AssessmentLog { param($Message, $Level) }

        Mock Get-MgDeviceManagementManagedDevice {
            return @(
                [PSCustomObject]@{
                    DeviceName        = 'DESKTOP-WIN01'
                    UserDisplayName   = 'Alice Smith'
                    UserPrincipalName = 'alice@contoso.com'
                    OperatingSystem   = 'Windows'
                    OsVersion         = '10.0.19045'
                    ComplianceState   = 'compliant'
                    IsEncrypted       = $true
                    LastSyncDateTime  = [datetime]'2026-04-01'
                    EnrolledDateTime  = [datetime]'2026-01-01'
                    Model             = 'Surface Pro 9'
                    Manufacturer      = 'Microsoft'
                    SerialNumber      = 'SN12345'
                    ManagementAgent   = 'mdm'
                }
                [PSCustomObject]@{
                    DeviceName        = 'IPHONE-BOB'
                    UserDisplayName   = 'Bob Jones'
                    UserPrincipalName = 'bob@contoso.com'
                    OperatingSystem   = 'iOS'
                    OsVersion         = '17.1'
                    ComplianceState   = 'noncompliant'
                    IsEncrypted       = $true
                    LastSyncDateTime  = [datetime]'2026-04-02'
                    EnrolledDateTime  = [datetime]'2026-02-01'
                    Model             = 'iPhone 15'
                    Manufacturer      = 'Apple'
                    SerialNumber      = 'SN67890'
                    ManagementAgent   = 'mdm'
                }
            )
        }

        $script:windowsResult = & "$PSScriptRoot/../../src/M365-Assess/Intune/Get-DeviceComplianceReport.ps1" -Platform Windows
        $script:nonCompliantResult = & "$PSScriptRoot/../../src/M365-Assess/Intune/Get-DeviceComplianceReport.ps1" -ComplianceState NonCompliant
    }

    It 'Platform Windows filter returns only Windows devices' {
        $nonWindows = @($script:windowsResult) | Where-Object { $_.OperatingSystem -ne 'Windows' }
        $nonWindows | Should -BeNullOrEmpty
    }

    It 'Platform Windows filter returns at least 1 device' {
        @($script:windowsResult).Count | Should -BeGreaterOrEqual 1
    }

    It 'ComplianceState NonCompliant filter returns only noncompliant devices' {
        $compliant = @($script:nonCompliantResult) | Where-Object { $_.ComplianceState -eq 'compliant' }
        $compliant | Should -BeNullOrEmpty
    }

    It 'ComplianceState NonCompliant filter returns at least 1 device' {
        @($script:nonCompliantResult).Count | Should -BeGreaterOrEqual 1
    }

    AfterAll {
        Remove-Item Function:\Assert-GraphConnection -ErrorAction SilentlyContinue
        Remove-Item Function:\Write-AssessmentLog -ErrorAction SilentlyContinue
    }
}
