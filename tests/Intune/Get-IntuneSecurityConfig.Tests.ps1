BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-IntuneSecurityConfig' {
    BeforeAll {
        # Stub the progress function so Add-Setting's guard passes
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        # Mock Invoke-MgGraphRequest with realistic Intune data
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri)
            switch -Wildcard ($Uri) {
                '*/deviceManagement/settings' {
                    return @{ deviceComplianceCheckinThresholdDays = 14 }
                }
                '*/deviceManagement/deviceEnrollmentConfigurations' {
                    return @{ value = @(
                        @{
                            '@odata.type' = '#microsoft.graph.deviceEnrollmentPlatformRestrictionsConfiguration'
                            iosRestriction = @{ personalDeviceEnrollmentBlocked = $true }
                            androidRestriction = @{ personalDeviceEnrollmentBlocked = $true }
                            windowsRestriction = @{ personalDeviceEnrollmentBlocked = $true }
                        }
                    )}
                }
                default {
                    return @{ value = @() }
                }
            }
        }

        # Run the collector by dot-sourcing it
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneSecurityConfig.ps1"
    }

    It 'Returns a non-empty settings list' {
        $settings.Count | Should -BeGreaterThan 0
    }

    It 'All settings have required properties' {
        foreach ($s in $settings) {
            $s.PSObject.Properties.Name | Should -Contain 'Category'
            $s.PSObject.Properties.Name | Should -Contain 'Setting'
            $s.PSObject.Properties.Name | Should -Contain 'Status'
            $s.PSObject.Properties.Name | Should -Contain 'CurrentValue'
            $s.PSObject.Properties.Name | Should -Contain 'RecommendedValue'
            $s.PSObject.Properties.Name | Should -Contain 'CheckId'
        }
    }

    It 'All Status values are valid' {
        $validStatuses = @('Pass', 'Fail', 'Warning', 'Review', 'Info', 'N/A')
        foreach ($s in $settings) {
            $s.Status | Should -BeIn $validStatuses `
                -Because "Setting '$($s.Setting)' has status '$($s.Status)'"
        }
    }

    It 'All non-empty CheckIds follow naming convention' {
        $withCheckId = $settings | Where-Object { $_.CheckId -and $_.CheckId.Trim() -ne '' }
        $withCheckId.Count | Should -BeGreaterThan 0
        foreach ($s in $withCheckId) {
            $s.CheckId | Should -Match '^[A-Z]+(-[A-Z0-9]+)+-\d{3}(\.\d+)?$' `
                -Because "CheckId '$($s.CheckId)' should follow convention"
        }
    }

    It 'All CheckIds use the INTUNE- prefix' {
        $withCheckId = $settings | Where-Object { $_.CheckId -and $_.CheckId.Trim() -ne '' }
        foreach ($s in $withCheckId) {
            $s.CheckId | Should -Match '^INTUNE-' `
                -Because "CheckId '$($s.CheckId)' should use INTUNE- prefix"
        }
    }

    It 'Non-compliant threshold check passes when threshold is 14 days' {
        $complianceCheck = $settings | Where-Object {
            $_.CheckId -like 'INTUNE-COMPLIANCE-001*' -and $_.Setting -eq 'Non-Compliant Default Threshold'
        }
        $complianceCheck | Should -Not -BeNullOrEmpty
        $complianceCheck.Status | Should -Be 'Pass'
    }

    It 'Personal device enrollment check passes when blocked on all platforms' {
        $enrollCheck = $settings | Where-Object {
            $_.CheckId -like 'INTUNE-ENROLL-001*' -and $_.Setting -eq 'Personal Device Enrollment Blocked'
        }
        $enrollCheck | Should -Not -BeNullOrEmpty
        $enrollCheck.Status | Should -Be 'Pass'
    }

    It 'Returns exactly 2 checks' {
        $settings.Count | Should -Be 2
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-IntuneSecurityConfig - Personal Devices Allowed' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        Mock Invoke-MgGraphRequest {
            param($Method, $Uri)
            switch -Wildcard ($Uri) {
                '*/deviceManagement/settings' {
                    return @{ deviceComplianceCheckinThresholdDays = 90 }
                }
                '*/deviceManagement/deviceEnrollmentConfigurations' {
                    return @{ value = @(
                        @{
                            '@odata.type' = '#microsoft.graph.deviceEnrollmentPlatformRestrictionsConfiguration'
                            iosRestriction = @{ personalDeviceEnrollmentBlocked = $false }
                            androidRestriction = @{ personalDeviceEnrollmentBlocked = $true }
                            windowsRestriction = @{ personalDeviceEnrollmentBlocked = $true }
                        }
                    )}
                }
                default {
                    return @{ value = @() }
                }
            }
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneSecurityConfig.ps1"
    }

    It 'Non-compliant threshold check warns when threshold exceeds 30 days' {
        $complianceCheck = $settings | Where-Object {
            $_.CheckId -like 'INTUNE-COMPLIANCE-001*'
        }
        $complianceCheck | Should -Not -BeNullOrEmpty
        $complianceCheck.Status | Should -Be 'Warning'
    }

    It 'Personal device enrollment check fails when allowed on any platform' {
        $enrollCheck = $settings | Where-Object {
            $_.CheckId -like 'INTUNE-ENROLL-001*'
        }
        $enrollCheck | Should -Not -BeNullOrEmpty
        $enrollCheck.Status | Should -Be 'Fail'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}
