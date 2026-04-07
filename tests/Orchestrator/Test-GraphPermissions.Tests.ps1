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

    Context 'when app-only auth context returns .default scope' {
        BeforeEach {
            Mock Get-MgContext {
                return [PSCustomObject]@{
                    Scopes = @('.default')
                }
            }
        }

        It 'should skip validation and not throw' {
            {
                Test-GraphPermissions `
                    -RequiredScopes @('User.Read.All') `
                    -SectionScopeMap @{ Identity = @('User.Read.All') } `
                    -ActiveSections @('Identity')
            } | Should -Not -Throw
        }

        It 'should log INFO about app-only auth' {
            Test-GraphPermissions `
                -RequiredScopes @('User.Read.All') `
                -SectionScopeMap @{ Identity = @('User.Read.All') } `
                -ActiveSections @('Identity')
            $infoLog = $global:AssessmentLogCalls | Where-Object { $_.Level -eq 'INFO' -and $_.Message -match 'app-only' }
            $infoLog | Should -Not -BeNullOrEmpty
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
