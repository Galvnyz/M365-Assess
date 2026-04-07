BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Assert-GraphConnection' {
    BeforeAll {
        # Stub Get-MgContext before loading the script
        function Get-MgContext { }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
    }

    Context 'when connected to Graph' {
        BeforeAll {
            Mock Get-MgContext { return @{ TenantId = 'test-tenant-id' } }
        }

        It 'should return true' {
            Assert-GraphConnection | Should -Be $true
        }
    }

    Context 'when Get-MgContext returns null' {
        BeforeAll {
            Mock Get-MgContext { return $null }
        }

        It 'should return false' {
            $ErrorActionPreference = 'Continue'
            Assert-GraphConnection 2>$null | Should -Be $false
        }
    }

    Context 'when Get-MgContext throws' {
        BeforeAll {
            Mock Get-MgContext { throw 'Not connected' }
        }

        It 'should return false' {
            $ErrorActionPreference = 'Continue'
            Assert-GraphConnection 2>$null | Should -Be $false
        }
    }
}

Describe 'Test-GraphTokenValid' {
    BeforeAll {
        function global:Get-MgContext { }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
    }

    It 'returns true when context has TenantId' {
        Mock Get-MgContext { return [PSCustomObject]@{ TenantId = 'test-tenant-id' } }
        Test-GraphTokenValid | Should -Be $true
    }
    It 'returns false when context is null' {
        Mock Get-MgContext { return $null }
        Test-GraphTokenValid | Should -Be $false
    }
    It 'returns false when Get-MgContext throws' {
        Mock Get-MgContext { throw 'SDK error' }
        Test-GraphTokenValid | Should -Be $false
    }
    It 'returns false when TenantId is null' {
        Mock Get-MgContext { return [PSCustomObject]@{ TenantId = $null } }
        Test-GraphTokenValid | Should -Be $false
    }

    AfterAll { Remove-Item Function:\Get-MgContext -ErrorAction SilentlyContinue }
}

Describe 'Export-AssessmentCsv' {
    BeforeAll {
        function Get-MgContext { }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
    }

    Context 'when data is not empty' {
        BeforeAll {
            $testPath = Join-Path $TestDrive 'test-export.csv'
            $testData = @(
                [PSCustomObject]@{ Name = 'Item1'; Value = 'A' }
                [PSCustomObject]@{ Name = 'Item2'; Value = 'B' }
            )
        }

        It 'should return the count of exported items' {
            $count = Export-AssessmentCsv -Path $testPath -Data $testData -Label 'Test'
            $count | Should -Be 2
        }

        It 'should create a CSV file' {
            Export-AssessmentCsv -Path $testPath -Data $testData -Label 'Test'
            Test-Path $testPath | Should -BeTrue
        }

        It 'should write correct CSV content' {
            Export-AssessmentCsv -Path $testPath -Data $testData -Label 'Test'
            $csv = Import-Csv -Path $testPath
            $csv.Count | Should -Be 2
            $csv[0].Name | Should -Be 'Item1'
        }
    }

    Context 'when data is empty' {
        It 'should return 0' {
            $testPath = Join-Path $TestDrive 'empty-export.csv'
            $count = Export-AssessmentCsv -Path $testPath -Data @() -Label 'Empty'
            $count | Should -Be 0
        }

        It 'should not create a file' {
            $testPath = Join-Path $TestDrive 'no-file.csv'
            Export-AssessmentCsv -Path $testPath -Data @() -Label 'Empty'
            Test-Path $testPath | Should -BeFalse
        }
    }
}

Describe 'Write-AssessmentLog' {
    BeforeAll {
        function Get-MgContext { }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
    }

    Context 'when log file path is set' {
        BeforeAll {
            $script:logFilePath = Join-Path $TestDrive 'test-log.txt'
            Set-Content -Path $script:logFilePath -Value '' -Encoding UTF8
        }

        It 'should write a timestamped line' {
            Write-AssessmentLog -Level INFO -Message 'Test message'
            $content = Get-Content -Path $script:logFilePath
            $content | Should -Not -BeNullOrEmpty
            $content[-1] | Should -Match '\[\d{4}-\d{2}-\d{2}.*\] \[INFO\] Test message'
        }

        It 'should include section and collector when provided' {
            Write-AssessmentLog -Level WARN -Message 'Warn msg' -Section 'Identity' -Collector 'MFA'
            $content = Get-Content -Path $script:logFilePath
            $content[-1] | Should -Match '\[WARN\] \[Identity\] \[MFA\] Warn msg'
        }

        It 'should indent detail lines' {
            Write-AssessmentLog -Level ERROR -Message 'Error' -Detail "Line1`nLine2"
            $content = Get-Content -Path $script:logFilePath
            ($content | Where-Object { $_ -match '^\s{4}Line1' }) | Should -Not -BeNullOrEmpty
            ($content | Where-Object { $_ -match '^\s{4}Line2' }) | Should -Not -BeNullOrEmpty
        }
    }

    Context 'when log file path is not set' {
        BeforeAll {
            $script:logFilePath = $null
        }

        It 'should not throw' {
            { Write-AssessmentLog -Level INFO -Message 'No file' } | Should -Not -Throw
        }
    }
}

Describe 'Get-RecommendedAction' {
    BeforeAll {
        function Get-MgContext { }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
    }

    It 'should match WAM broker errors' {
        $result = Get-RecommendedAction -ErrorMessage 'WAM broker failed to authenticate'
        $result | Should -Match 'WAM broker'
    }

    It 'should match 401 Unauthorized errors' {
        $result = Get-RecommendedAction -ErrorMessage '401 Unauthorized: insufficient scope'
        $result | Should -Match 'Re-authenticate'
    }

    It 'should match 403 Forbidden errors' {
        $result = Get-RecommendedAction -ErrorMessage '403 Forbidden: Insufficient privileges'
        $result | Should -Match 'permissions'
    }

    It 'should match not installed errors' {
        $result = Get-RecommendedAction -ErrorMessage 'The term Get-Something is not recognized'
        $result | Should -Match 'module is installed'
    }

    It 'should match timeout errors' {
        $result = Get-RecommendedAction -ErrorMessage 'The operation has timed out'
        $result | Should -Match 'timeout'
    }

    It 'should return default action for unknown errors' {
        $result = Get-RecommendedAction -ErrorMessage 'Some random error'
        $result | Should -Match 'Review the error details'
    }
}

Describe 'Export-IssueReport' {
    BeforeAll {
        function Get-MgContext { }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
    }

    Context 'when issues are provided' {
        BeforeAll {
            $testPath = Join-Path $TestDrive 'issues.log'
            $issues = @(
                [PSCustomObject]@{
                    Severity     = 'ERROR'
                    Section      = 'Identity'
                    Collector    = 'MFA Report'
                    Description  = 'Graph connection failed'
                    ErrorMessage = '403 Forbidden'
                    Action       = 'Grant permissions'
                }
                [PSCustomObject]@{
                    Severity     = 'WARNING'
                    Section      = 'Email'
                    Collector    = 'Mail Flow'
                    Description  = 'Partial data'
                    ErrorMessage = 'Timeout'
                    Action       = 'Retry'
                }
            )
            Export-IssueReport -Path $testPath -Issues $issues -TenantName 'contoso' -Version '1.2.0'
        }

        It 'should create the issue report file' {
            Test-Path $testPath | Should -BeTrue
        }

        It 'should contain issue details' {
            $content = Get-Content -Path $testPath -Raw
            $content | Should -Match 'Issue 1 / 2'
            $content | Should -Match 'Graph connection failed'
        }

        It 'should include version and tenant' {
            $content = Get-Content -Path $testPath -Raw
            $content | Should -Match 'v1\.2\.0'
            $content | Should -Match 'contoso'
        }

        It 'should have correct summary counts' {
            $content = Get-Content -Path $testPath -Raw
            $content | Should -Match '1 errors, 1 warnings, 0 info'
        }
    }

    Context 'when no issues' {
        BeforeAll {
            $testPath = Join-Path $TestDrive 'no-issues.log'
            Export-IssueReport -Path $testPath -Issues @()
        }

        It 'should create a file with zero counts' {
            $content = Get-Content -Path $testPath -Raw
            $content | Should -Match '0 errors, 0 warnings, 0 info'
        }
    }
}

Describe 'Show-CollectorResult' {
    BeforeAll {
        function Get-MgContext { }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        Mock Write-Host { }
    }

    It 'should call Write-Host for Complete status' {
        Show-CollectorResult -Label 'MFA Report' -Status 'Complete' -Items 5 -DurationSeconds 2.3
        Should -Invoke Write-Host -Times 1 -Exactly
    }

    It 'should call Write-Host for Skipped status' {
        Show-CollectorResult -Label 'Device Summary' -Status 'Skipped' -Items 0 -DurationSeconds 0 -ErrorMessage 'Not licensed'
        Should -Invoke Write-Host -Times 1 -Exactly
    }

    It 'should call Write-Host for Failed status' {
        Show-CollectorResult -Label 'Secure Score' -Status 'Failed' -Items 0 -DurationSeconds 0 -ErrorMessage '403 Forbidden'
        Should -Invoke Write-Host -Times 1 -Exactly
    }
}

Describe 'Show-SectionHeader' {
    BeforeAll {
        function Get-MgContext { }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        Mock Write-Host { }
    }

    It 'should call Write-Host with section name' {
        Show-SectionHeader -Name 'Identity'
        Should -Invoke Write-Host -Times 1 -Exactly
    }
}
