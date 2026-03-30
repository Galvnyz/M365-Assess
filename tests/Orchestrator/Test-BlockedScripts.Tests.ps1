BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Test-BlockedScripts' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/Test-BlockedScripts.ps1"
    }

    Context 'when running on Windows with Bypass policy and blocked files' {
        BeforeAll {
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/Test-BlockedScripts.ps1"
            Mock Get-ExecutionPolicy { 'Bypass' }

            $fakeFile = [PSCustomObject]@{ FullName = 'C:\fake\test.ps1'; Name = 'test.ps1' }
            Mock Get-ChildItem { @($fakeFile) }
            Mock Get-Item { [PSCustomObject]@{ Stream = 'Zone.Identifier' } } -ParameterFilter { $Stream -eq 'Zone.Identifier' }
        }

        It 'Should return true without prompting (Bypass skips the check)' {
            $result = Test-BlockedScripts -ProjectRoot 'C:\fake'
            $result | Should -Be $true
        }
    }

    Context 'when RemoteSigned and no blocked files' {
        BeforeAll {
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/Test-BlockedScripts.ps1"
            Mock Get-ExecutionPolicy { 'RemoteSigned' }
            Mock Get-ChildItem { @() }
            Mock Get-Item { $null }
        }

        It 'Should return true (no blocked files found)' {
            $result = Test-BlockedScripts -ProjectRoot 'C:\fake'
            $result | Should -Be $true
        }
    }

    Context 'when RemoteSigned with blocked files in NonInteractive mode' {
        BeforeAll {
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/Test-BlockedScripts.ps1"
            Mock Get-ExecutionPolicy { 'RemoteSigned' }

            $fakeFile = [PSCustomObject]@{ FullName = 'C:\fake\test.ps1'; Name = 'test.ps1' }
            Mock Get-ChildItem { @($fakeFile) }
            Mock Get-Item { [PSCustomObject]@{ Stream = 'Zone.Identifier' } } -ParameterFilter { $Stream -eq 'Zone.Identifier' }
            Mock Write-Host { }
            Mock Write-Error { }
        }

        It 'Should write an error and return nothing' {
            $result = Test-BlockedScripts -ProjectRoot 'C:\fake' -NonInteractive
            $result | Should -BeNullOrEmpty
        }

        It 'Should output the unblock command' {
            Test-BlockedScripts -ProjectRoot 'C:\fake' -NonInteractive
            Should -Invoke Write-Error -Times 1
        }
    }

    Context 'when RemoteSigned with blocked files and user accepts unblock' {
        BeforeAll {
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/Test-BlockedScripts.ps1"
            Mock Get-ExecutionPolicy { 'RemoteSigned' }

            $script:fakeFile = [PSCustomObject]@{ FullName = 'C:\fake\test.ps1'; Name = 'test.ps1' }
            Mock Get-ChildItem { @($script:fakeFile) }
            Mock Get-Item { [PSCustomObject]@{ Stream = 'Zone.Identifier' } } -ParameterFilter { $Stream -eq 'Zone.Identifier' }
            Mock Read-Host { 'Y' }
            Mock Unblock-File { }
            Mock Write-Host { }
            Mock Write-Error { }
        }

        It 'Should prompt the user and attempt the unblock' {
            Test-BlockedScripts -ProjectRoot 'C:\fake'
            Should -Invoke Read-Host -Times 1
        }
    }

    Context 'when RemoteSigned with blocked files and user declines unblock' {
        BeforeAll {
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/Test-BlockedScripts.ps1"
            Mock Get-ExecutionPolicy { 'RemoteSigned' }

            $fakeFile = [PSCustomObject]@{ FullName = 'C:\fake\test.ps1'; Name = 'test.ps1' }
            Mock Get-ChildItem { @($fakeFile) }
            Mock Get-Item { [PSCustomObject]@{ Stream = 'Zone.Identifier' } } -ParameterFilter { $Stream -eq 'Zone.Identifier' }
            Mock Read-Host { 'n' }
            Mock Write-Host { }
            Mock Write-Error { }
        }

        It 'Should write an error and return nothing' {
            $result = Test-BlockedScripts -ProjectRoot 'C:\fake'
            $result | Should -BeNullOrEmpty
            Should -Invoke Write-Error -Times 1
        }
    }

    Context 'when Restricted policy with blocked files in NonInteractive mode' {
        BeforeAll {
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/Test-BlockedScripts.ps1"
            Mock Get-ExecutionPolicy { 'Restricted' }

            $fakeFile = [PSCustomObject]@{ FullName = 'C:\fake\script.ps1'; Name = 'script.ps1' }
            Mock Get-ChildItem { @($fakeFile) }
            Mock Get-Item { [PSCustomObject]@{ Stream = 'Zone.Identifier' } } -ParameterFilter { $Stream -eq 'Zone.Identifier' }
            Mock Write-Host { }
            Mock Write-Error { }
        }

        It 'Should output error with unblock command' {
            Test-BlockedScripts -ProjectRoot 'C:\fake' -NonInteractive
            Should -Invoke Write-Error -Times 1
        }
    }

    Context 'when Unblock-File fails' {
        BeforeAll {
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/Test-BlockedScripts.ps1"
            Mock Get-ExecutionPolicy { 'RemoteSigned' }

            $fakeFile = [PSCustomObject]@{ FullName = 'C:\fake\test.ps1'; Name = 'test.ps1' }
            Mock Get-ChildItem { @($fakeFile) }
            Mock Get-Item { [PSCustomObject]@{ Stream = 'Zone.Identifier' } } -ParameterFilter { $Stream -eq 'Zone.Identifier' }
            Mock Read-Host { 'Y' }
            Mock Unblock-File { throw 'Access denied' }
            Mock Write-Host { }
            Mock Write-Error { }
        }

        It 'Should catch the error and return nothing' {
            $result = Test-BlockedScripts -ProjectRoot 'C:\fake'
            $result | Should -BeNullOrEmpty
            Should -Invoke Write-Error -Times 1
        }
    }
}
