BeforeAll {
    function global:Write-AssessmentLog {
        param(
            [string]$Level,
            [string]$Message,
            [string]$Section
        )
        # Capture calls for assertion
        $global:AssessmentLogCalls += @([PSCustomObject]@{ Level = $Level; Message = $Message; Section = $Section })
    }

    . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/Test-GraphPermissions.ps1"
}

AfterAll {
    Remove-Item Function:\Write-AssessmentLog -ErrorAction SilentlyContinue
    Remove-Variable -Name AssessmentLogCalls -Scope Global -ErrorAction SilentlyContinue
}

Describe 'Test-GraphPermissions' {
    BeforeEach {
        $global:AssessmentLogCalls = @()
    }

    Context 'when all required scopes are granted' {
        BeforeAll {
            $sectionScopeMap = @{
                Identity = @('User.Read.All', 'Directory.Read.All')
                Email    = @('MailboxSettings.Read')
            }
            $activeSections   = @('Identity', 'Email')
            $requiredScopes   = @('User.Read.All', 'Directory.Read.All', 'MailboxSettings.Read')
        }

        BeforeEach {
            Mock Get-MgContext {
                return [PSCustomObject]@{
                    Scopes = @('User.Read.All', 'Directory.Read.All', 'MailboxSettings.Read', 'openid', 'profile')
                }
            }
        }

        It 'should complete without error' {
            { Test-GraphPermissions -RequiredScopes $requiredScopes -SectionScopeMap $sectionScopeMap -ActiveSections $activeSections } | Should -Not -Throw
        }

        It 'should log an INFO message when all scopes are granted' {
            Test-GraphPermissions -RequiredScopes $requiredScopes -SectionScopeMap $sectionScopeMap -ActiveSections $activeSections
            $infoLogs = @($global:AssessmentLogCalls | Where-Object { $_.Level -eq 'INFO' })
            $infoLogs.Count | Should -BeGreaterOrEqual 1
        }

        It 'should not log any WARN messages' {
            Test-GraphPermissions -RequiredScopes $requiredScopes -SectionScopeMap $sectionScopeMap -ActiveSections $activeSections
            $warnLogs = @($global:AssessmentLogCalls | Where-Object { $_.Level -eq 'WARN' -and $_.Message -match 'Missing' })
            $warnLogs.Count | Should -Be 0
        }
    }

    Context 'when a required scope is missing' {
        BeforeAll {
            $sectionScopeMap = @{
                Identity = @('User.Read.All', 'AuditLog.Read.All')
                Email    = @('MailboxSettings.Read')
            }
            $activeSections   = @('Identity', 'Email')
            $requiredScopes   = @('User.Read.All', 'AuditLog.Read.All', 'MailboxSettings.Read')
        }

        BeforeEach {
            Mock Get-MgContext {
                return [PSCustomObject]@{
                    # AuditLog.Read.All is NOT in the granted scopes
                    Scopes = @('User.Read.All', 'MailboxSettings.Read', 'openid')
                }
            }
        }

        It 'should log a WARN message about missing scopes' {
            Test-GraphPermissions -RequiredScopes $requiredScopes -SectionScopeMap $sectionScopeMap -ActiveSections $activeSections
            $warnLogs = @($global:AssessmentLogCalls | Where-Object { $_.Level -eq 'WARN' })
            $warnLogs.Count | Should -BeGreaterOrEqual 1
        }

        It 'should identify the missing scope in the warning message' {
            Test-GraphPermissions -RequiredScopes $requiredScopes -SectionScopeMap $sectionScopeMap -ActiveSections $activeSections
            $warnLog = $global:AssessmentLogCalls | Where-Object { $_.Level -eq 'WARN' -and $_.Message -match 'Missing' }
            $warnLog.Message | Should -Match 'auditlog.read.all'
        }
    }

    Context 'when Graph context is not available' {
        BeforeEach {
            Mock Get-MgContext { return $null }
        }

        It 'should not throw' {
            {
                Test-GraphPermissions `
                    -RequiredScopes @('User.Read.All') `
                    -SectionScopeMap @{ Identity = @('User.Read.All') } `
                    -ActiveSections @('Identity')
            } | Should -Not -Throw
        }

        It 'should log a WARN about context not available' {
            Test-GraphPermissions `
                -RequiredScopes @('User.Read.All') `
                -SectionScopeMap @{ Identity = @('User.Read.All') } `
                -ActiveSections @('Identity')
            $warnLog = $global:AssessmentLogCalls | Where-Object { $_.Level -eq 'WARN' }
            $warnLog | Should -Not -BeNullOrEmpty
        }
    }

    Context 'when app-only auth context returns .default scope (B2 #773)' {
        BeforeEach {
            Mock Get-MgContext {
                return [PSCustomObject]@{
                    Scopes   = @('.default')
                    ClientId = 'fake-client-id'
                }
            }
        }

        It 'should hand off to app-role validation and not throw' {
            # With no Get-MgServicePrincipal mock, the validator catches the
            # command-not-found and emits the structured "could not verify"
            # warning per the AC.
            {
                Test-GraphPermissions `
                    -RequiredScopes @('User.Read.All') `
                    -SectionScopeMap @{ Identity = @('User.Read.All') } `
                    -ActiveSections @('Identity')
            } | Should -Not -Throw
        }

        It 'should emit a structured WARN when the validator cannot verify (no app-role data)' {
            # AC: "If full validation can't be done, emit a structured warning, not silence"
            Test-GraphPermissions `
                -RequiredScopes @('User.Read.All') `
                -SectionScopeMap @{ Identity = @('User.Read.All') } `
                -ActiveSections @('Identity')
            $warnLog = $global:AssessmentLogCalls | Where-Object { $_.Level -eq 'WARN' -and $_.Message -match 'could not be performed|not found|not in context' }
            $warnLog | Should -Not -BeNullOrEmpty
        }
    }

    Context 'Test-GraphAppRolePermissions -- happy path' {
        BeforeAll {
            $graphAppRoles = @(
                [pscustomobject]@{ Id = [guid]'11111111-1111-1111-1111-111111111111'; Value = 'User.Read.All' }
                [pscustomobject]@{ Id = [guid]'22222222-2222-2222-2222-222222222222'; Value = 'AuditLog.Read.All' }
                [pscustomobject]@{ Id = [guid]'33333333-3333-3333-3333-333333333333'; Value = 'Organization.Read.All' }
            )
            $script:appRoles = $graphAppRoles
        }

        BeforeEach {
            Mock Get-MgServicePrincipal {
                # First call: lookup of the running app's SP
                # Second call: lookup of Microsoft Graph SP
                if ($Filter -match "appId eq '00000003-0000-0000-c000-000000000000'") {
                    return [pscustomobject]@{ Id = 'graph-sp-id'; AppRoles = $script:appRoles }
                }
                return [pscustomobject]@{ Id = 'running-sp-id' }
            }
            Mock Get-MgServicePrincipalAppRoleAssignment {
                return @(
                    [pscustomobject]@{ ResourceId = 'graph-sp-id'; AppRoleId = $script:appRoles[0].Id }
                    [pscustomobject]@{ ResourceId = 'graph-sp-id'; AppRoleId = $script:appRoles[1].Id }
                    [pscustomobject]@{ ResourceId = 'graph-sp-id'; AppRoleId = $script:appRoles[2].Id }
                )
            }
        }

        It 'should log INFO when all required roles are granted' {
            # 'Licensing' section only requires Organization.Read.All + User.Read.All,
            # both of which our mock grants. (Tenant requires more roles than our
            # minimal fixture covers, so we use Licensing here.)
            $context = [pscustomobject]@{ ClientId = 'fake-client'; Scopes = @('.default') }
            Test-GraphAppRolePermissions -Context $context -ActiveSections @('Licensing')
            $infoLog = $global:AssessmentLogCalls | Where-Object { $_.Level -eq 'INFO' -and $_.Message -match 'app-role validation passed' }
            $infoLog | Should -Not -BeNullOrEmpty
        }

        It 'should log WARN when a required role is missing' {
            # Mock the assignment list to omit one of the granted roles
            Mock Get-MgServicePrincipalAppRoleAssignment {
                return @(
                    [pscustomobject]@{ ResourceId = 'graph-sp-id'; AppRoleId = $script:appRoles[0].Id }
                    # AuditLog.Read.All NOT granted
                )
            }
            $context = [pscustomobject]@{ ClientId = 'fake-client'; Scopes = @('.default') }
            Test-GraphAppRolePermissions -Context $context -ActiveSections @('Identity')
            $warnLog = $global:AssessmentLogCalls | Where-Object { $_.Level -eq 'WARN' -and $_.Message -match 'Missing Graph app roles' }
            $warnLog | Should -Not -BeNullOrEmpty
            $warnLog.Message | Should -Match 'AuditLog.Read.All'
        }
    }

    Context 'Test-GraphAppRolePermissions -- failure paths' {
        It 'should emit a WARN when ClientId is missing from context' {
            $context = [pscustomobject]@{ Scopes = @('.default') }  # no ClientId
            Test-GraphAppRolePermissions -Context $context -ActiveSections @('Identity')
            $warnLog = $global:AssessmentLogCalls | Where-Object { $_.Level -eq 'WARN' -and $_.Message -match 'ClientId missing' }
            $warnLog | Should -Not -BeNullOrEmpty
        }

        It 'should emit a structured WARN when SP lookup throws' {
            Mock Get-MgServicePrincipal { throw 'Insufficient permissions to read service principal' }
            $context = [pscustomobject]@{ ClientId = 'fake-client'; Scopes = @('.default') }
            Test-GraphAppRolePermissions -Context $context -ActiveSections @('Identity')
            $warnLog = $global:AssessmentLogCalls | Where-Object { $_.Level -eq 'WARN' -and $_.Message -match 'could not be performed' }
            $warnLog | Should -Not -BeNullOrEmpty
        }
    }

    Context 'when context has empty scopes array' {
        BeforeEach {
            Mock Get-MgContext {
                return [PSCustomObject]@{
                    Scopes = @()
                }
            }
        }

        It 'should skip validation without throwing' {
            {
                Test-GraphPermissions `
                    -RequiredScopes @('User.Read.All') `
                    -SectionScopeMap @{ Identity = @('User.Read.All') } `
                    -ActiveSections @('Identity')
            } | Should -Not -Throw
        }
    }

    Context 'when SectionScopeMap correctly maps missing scope to affected section' {
        BeforeEach {
            Mock Get-MgContext {
                return [PSCustomObject]@{
                    Scopes = @('User.Read.All')
                    # AuditLog.Read.All is missing
                }
            }
        }

        It 'should identify Identity as affected section when AuditLog.Read.All is missing' {
            $sectionScopeMap = @{
                Identity = @('User.Read.All', 'AuditLog.Read.All')
            }
            Test-GraphPermissions `
                -RequiredScopes @('User.Read.All', 'AuditLog.Read.All') `
                -SectionScopeMap $sectionScopeMap `
                -ActiveSections @('Identity')

            $warnLog = $global:AssessmentLogCalls | Where-Object { $_.Level -eq 'WARN' -and $_.Message -match 'auditlog' }
            $warnLog | Should -Not -BeNullOrEmpty
        }
    }
}
