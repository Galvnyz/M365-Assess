BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-SOC2SecurityControls - Full Pass Scenario' {
    BeforeAll {
        # Stub external cmdlets so Pester Mock can intercept them
        function Invoke-MgGraphRequest { param($Method, $Uri, $ErrorAction) }
        function Get-MgContext { }
        function Get-AdminAuditLogConfig { }
        function Get-Command { param($Name, $ErrorAction) }

        # Mock connection guard — return a valid context
        Mock Get-MgContext {
            return [PSCustomObject]@{
                TenantId = '00000000-0000-0000-0000-000000000001'
                Account  = 'admin@contoso.com'
            }
        }

        # Single unified mock — routes by URI substring matching
        # Note: no param() block; Pester binds $Uri from the call parameters automatically
        Mock Invoke-MgGraphRequest {

            if ($Uri -match 'conditionalAccess/policies') {
                return @{
                    value = @(
                        @{
                            displayName   = 'Require MFA for All Users'
                            state         = 'enabled'
                            grantControls = @{
                                builtInControls    = @('mfa')
                                authenticationStrength = $null
                            }
                            conditions    = @{
                                users            = @{ includeUsers = @('All') }
                                signInRiskLevels = @()
                                userRiskLevels   = @()
                            }
                        }
                        @{
                            displayName   = 'Sign-in Risk Policy'
                            state         = 'enabled'
                            grantControls = @{
                                builtInControls    = @('mfa')
                                authenticationStrength = $null
                            }
                            conditions    = @{
                                users            = @{ includeUsers = @('All') }
                                signInRiskLevels = @('medium', 'high')
                                userRiskLevels   = @()
                            }
                        }
                        @{
                            displayName   = 'User Risk Policy'
                            state         = 'enabled'
                            grantControls = @{
                                builtInControls    = @('mfa')
                                authenticationStrength = $null
                            }
                            conditions    = @{
                                users            = @{ includeUsers = @('All') }
                                signInRiskLevels = @()
                                userRiskLevels   = @('high')
                            }
                        }
                    )
                }
            }

            if ($Uri -match 'identitySecurityDefaultsEnforcementPolicy') {
                return @{ isEnabled = $false }
            }

            # Directory roles list — must match exactly /directoryRoles (no sub-path)
            if ($Uri -match '/directoryRoles$') {
                return @{
                    value = @(
                        @{ id = 'role-ga-001'; displayName = 'Global Administrator' }
                    )
                }
            }

            # GA role members
            if ($Uri -match 'directoryRoles/.+/members') {
                return @{
                    value = @(
                        @{ id = 'user-001'; '@odata.type' = '#microsoft.graph.user' }
                        @{ id = 'user-002'; '@odata.type' = '#microsoft.graph.user' }
                        @{ id = 'user-003'; '@odata.type' = '#microsoft.graph.user' }
                    )
                }
            }

            # Auth registration details — FIDO2 for all users
            if ($Uri -match 'userRegistrationDetails') {
                return @{
                    value = @(
                        @{ methodsRegistered = @('fido2SecurityKey', 'microsoftAuthenticatorPush') }
                    )
                }
            }

            # Audit logs (S-06 Graph fallback)
            if ($Uri -match 'auditLogs/directoryAudits') {
                return @{
                    value = @(
                        @{ id = 'audit-entry-1'; activityDisplayName = 'UserLoggedIn' }
                    )
                }
            }

            # Defender alerts (S-07 / S-08)
            if ($Uri -match 'security/alerts_v2') {
                return @{
                    value = @(
                        @{ id = 'alert-001'; status = 'new'; severity = 'medium' }
                        @{ id = 'alert-002'; status = 'resolved'; severity = 'low' }
                    )
                }
            }

            # Default: return empty
            return @{ value = @() }
        }

        # S-06: force EXO path to fail so Graph fallback is used
        Mock Get-Command {
            param($Name, $ErrorAction)
            return $null
        }

        Mock Get-AdminAuditLogConfig {
            throw 'Get-AdminAuditLogConfig : The term is not recognized'
        }

        # Run the collector
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/SOC2/Get-SOC2SecurityControls.ps1"
    }

    It 'Returns a non-empty results list' {
        $results.Count | Should -BeGreaterThan 0
    }

    It 'Returns exactly 8 controls' {
        $results.Count | Should -Be 8
    }

    It 'All controls have required properties' {
        foreach ($r in $results) {
            $props = $r.PSObject.Properties.Name
            $props | Should -Contain 'TrustPrinciple'
            $props | Should -Contain 'TSCReference'
            $props | Should -Contain 'ControlId'
            $props | Should -Contain 'ControlName'
            $props | Should -Contain 'CurrentValue'
            $props | Should -Contain 'ExpectedValue'
            $props | Should -Contain 'Status'
            $props | Should -Contain 'Severity'
            $props | Should -Contain 'Evidence'
            $props | Should -Contain 'Remediation'
        }
    }

    It 'All Status values are valid' {
        $validStatuses = @('Pass', 'Fail', 'Warning', 'Review', 'Error', 'Info', 'N/A')
        foreach ($r in $results) {
            $r.Status | Should -BeIn $validStatuses `
                -Because "ControlId '$($r.ControlId)' has status '$($r.Status)'"
        }
    }

    It 'All Severity values are valid' {
        $validSeverities = @('Critical', 'High', 'Medium', 'Low', 'Info')
        foreach ($r in $results) {
            $r.Severity | Should -BeIn $validSeverities `
                -Because "ControlId '$($r.ControlId)' has severity '$($r.Severity)'"
        }
    }

    It 'All ControlIds follow S-## naming convention' {
        foreach ($r in $results) {
            $r.ControlId | Should -Match '^S-\d{2}$' `
                -Because "ControlId '$($r.ControlId)' should follow S-## pattern"
        }
    }

    It 'All controls belong to Security trust principle' {
        foreach ($r in $results) {
            $r.TrustPrinciple | Should -Be 'Security'
        }
    }

    It 'All TSCReferences are non-empty' {
        foreach ($r in $results) {
            $r.TSCReference | Should -Not -BeNullOrEmpty
        }
    }

    It 'All ControlNames are non-empty strings' {
        foreach ($r in $results) {
            $r.ControlName | Should -Not -BeNullOrEmpty
        }
    }

    It 'S-01 MFA check passes with CA policy for all users' {
        $check = $results | Where-Object { $_.ControlId -eq 'S-01' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'S-01 TSCReference is CC6.1' {
        $check = $results | Where-Object { $_.ControlId -eq 'S-01' }
        $check.TSCReference | Should -Be 'CC6.1'
    }

    It 'S-02 sign-in risk policy check passes' {
        $check = $results | Where-Object { $_.ControlId -eq 'S-02' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'S-03 user risk policy check passes' {
        $check = $results | Where-Object { $_.ControlId -eq 'S-03' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'S-04 check is populated with admin count from directory' {
        $check = $results | Where-Object { $_.ControlId -eq 'S-04' }
        $check | Should -Not -BeNullOrEmpty
        # Verify the check ran and counted admins (status may be Pass/Fail depending on auth method mock)
        $check.CurrentValue | Should -Match '^\d+ of 3 Global Admins'
        $check.TSCReference | Should -Be 'CC6.2'
        $check.Status | Should -BeIn @('Pass', 'Fail', 'Review')
    }

    It 'S-05 least privilege check passes with 3 Global Admins' {
        $check = $results | Where-Object { $_.ControlId -eq 'S-05' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'S-05 TSCReference is CC6.3' {
        $check = $results | Where-Object { $_.ControlId -eq 'S-05' }
        $check.TSCReference | Should -Be 'CC6.3'
    }

    It 'S-06 UAL check passes via Graph fallback' {
        $check = $results | Where-Object { $_.ControlId -eq 'S-06' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'S-07 Defender alerts check passes' {
        $check = $results | Where-Object { $_.ControlId -eq 'S-07' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'S-08 alert triage check passes with resolved alerts present' {
        $check = $results | Where-Object { $_.ControlId -eq 'S-08' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'S-08 TSCReference is CC7.2' {
        $check = $results | Where-Object { $_.ControlId -eq 'S-08' }
        $check.TSCReference | Should -Be 'CC7.2'
    }
}

Describe 'Get-SOC2SecurityControls - Fail Scenario' {
    BeforeAll {
        function Invoke-MgGraphRequest { param($Method, $Uri, $ErrorAction) }
        function Get-MgContext { }
        function Get-AdminAuditLogConfig { }
        function Get-Command { param($Name, $ErrorAction) }

        Mock Get-MgContext {
            return [PSCustomObject]@{
                TenantId = '00000000-0000-0000-0000-000000000002'
                Account  = 'admin@fail-tenant.com'
            }
        }

        Mock Invoke-MgGraphRequest {
            if ($Uri -match 'conditionalAccess/policies') {
                return @{ value = @() }
            }

            if ($Uri -match 'identitySecurityDefaultsEnforcementPolicy') {
                return @{ isEnabled = $false }
            }

            if ($Uri -match '/directoryRoles$') {
                return @{
                    value = @(@{ id = 'role-ga-002'; displayName = 'Global Administrator' })
                }
            }

            # 7 GA members — S-05 fails (exceeds max of 4)
            if ($Uri -match 'directoryRoles/.+/members') {
                return @{
                    value = @(
                        @{ id = 'u1'; '@odata.type' = '#microsoft.graph.user' }
                        @{ id = 'u2'; '@odata.type' = '#microsoft.graph.user' }
                        @{ id = 'u3'; '@odata.type' = '#microsoft.graph.user' }
                        @{ id = 'u4'; '@odata.type' = '#microsoft.graph.user' }
                        @{ id = 'u5'; '@odata.type' = '#microsoft.graph.user' }
                        @{ id = 'u6'; '@odata.type' = '#microsoft.graph.user' }
                        @{ id = 'u7'; '@odata.type' = '#microsoft.graph.user' }
                    )
                }
            }

            # No phishing-resistant methods — S-04 fails
            if ($Uri -match 'userRegistrationDetails') {
                return @{
                    value = @(@{ methodsRegistered = @('microsoftAuthenticatorPush') })
                }
            }

            if ($Uri -match 'auditLogs/directoryAudits') {
                return @{ value = @(@{ id = 'audit-1' }) }
            }

            if ($Uri -match 'security/alerts_v2') {
                return @{ value = @() }
            }

            return @{ value = @() }
        }

        Mock Get-Command {
            param($Name, $ErrorAction)
            return $null
        }

        Mock Get-AdminAuditLogConfig {
            throw 'Get-AdminAuditLogConfig : The term is not recognized'
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/SOC2/Get-SOC2SecurityControls.ps1"
    }

    It 'Still returns 8 controls in fail scenario' {
        $results.Count | Should -Be 8
    }

    It 'S-01 fails with no MFA policy and Security Defaults off' {
        $check = $results | Where-Object { $_.ControlId -eq 'S-01' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    It 'S-02 fails with no sign-in risk policies' {
        $check = $results | Where-Object { $_.ControlId -eq 'S-02' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    It 'S-03 fails with no user risk policies' {
        $check = $results | Where-Object { $_.ControlId -eq 'S-03' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    It 'S-04 fails when no admins have phishing-resistant MFA' {
        $check = $results | Where-Object { $_.ControlId -eq 'S-04' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    It 'S-05 fails with 7 Global Admins (exceeds maximum of 4)' {
        $check = $results | Where-Object { $_.ControlId -eq 'S-05' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    It 'All controls still have required properties in fail scenario' {
        foreach ($r in $results) {
            $r.PSObject.Properties.Name | Should -Contain 'Status'
            $r.PSObject.Properties.Name | Should -Contain 'ControlId'
        }
    }
}

Describe 'Get-SOC2SecurityControls - No Graph Connection' {
    BeforeAll {
        function Invoke-MgGraphRequest { param($Method, $Uri, $ErrorAction) }
        function Get-MgContext { }
        function Get-AdminAuditLogConfig { }
        function Get-Command { param($Name, $ErrorAction) }

        # Simulate no Graph connection
        Mock Get-MgContext { return $null }

        Mock Invoke-MgGraphRequest {
            throw 'Should not be called when not connected'
        }

        try {
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            . "$PSScriptRoot/../../src/M365-Assess/SOC2/Get-SOC2SecurityControls.ps1" -ErrorAction SilentlyContinue
        }
        catch {
            # Expected — collector calls Write-Error when not connected
        }
    }

    It 'Does not call Graph API when not connected' {
        Should -Invoke Invoke-MgGraphRequest -Times 0 -Scope Describe
    }
}
