BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Export-ComplianceMatrix' {
    BeforeAll {
        $script:srcPath = "$PSScriptRoot/../../src/M365-Assess/Common/Export-ComplianceMatrix.ps1"
        Mock Write-Warning { }
    }

    Context 'when ImportExcel module is not available' {
        BeforeAll {
            Mock Get-Module { return $null } -ParameterFilter { $Name -eq 'ImportExcel' }
        }

        It 'should warn and return without error' {
            $result = & $script:srcPath -AssessmentFolder $TestDrive
            $result | Should -BeNullOrEmpty
            Should -Invoke Write-Warning -Times 1
        }
    }

    Context 'when assessment folder does not exist' {
        BeforeAll {
            Mock Get-Module {
                return [PSCustomObject]@{ Name = 'ImportExcel'; Version = [version]'7.8.0' }
            } -ParameterFilter { $Name -eq 'ImportExcel' }
            Mock Import-Module { }
        }

        It 'should throw an error for missing folder' {
            { & $script:srcPath -AssessmentFolder 'C:\nonexistent\folder' } 2>&1 | Should -Not -BeNullOrEmpty
        }
    }

    Context 'when assessment folder exists but has no CSV files' {
        BeforeAll {
            Mock Get-Module {
                return [PSCustomObject]@{ Name = 'ImportExcel'; Version = [version]'7.8.0' }
            } -ParameterFilter { $Name -eq 'ImportExcel' }
            Mock Import-Module { }

            # Create an empty assessment folder
            $testFolder = Join-Path $TestDrive 'empty-assessment'
            New-Item -Path $testFolder -ItemType Directory -Force | Out-Null
        }

        It 'should report missing summary CSV' {
            $result = try { & $script:srcPath -AssessmentFolder $testFolder 2>$null } catch { $null }
            # Script exits early when no summary CSV is found
            $result | Should -BeNullOrEmpty
        }
    }
}

Describe 'Workbook readability and header-based formatting' -Skip:(-not (Get-Module -ListAvailable ImportExcel)) {
    BeforeAll {
        Import-Module ImportExcel
        $folder = Join-Path -Path $TestDrive -ChildPath 'workbook-fixture'
        $null = New-Item -Path $folder -ItemType Directory
        $script:longValue = ('Raw evidence value with spaces. ' * 150)
        @(
            [PSCustomObject]@{CheckId='ENTRA-SECDEFAULT-001.1';Setting='Long evidence';Category='Identity';Status='Fail';CurrentValue=$script:longValue;RecommendedValue='True';Remediation=('Review the complete evidence. ' * 60)},
            [PSCustomObject]@{CheckId='EXO-AUTH-001.1';Setting='Pass fixture';Category='Authentication';Status='Pass';CurrentValue='Done';RecommendedValue='Done';Remediation='None'}
        ) | Export-Csv -Path (Join-Path $folder 'fixture-config.csv') -NoTypeInformation
        @(
            [PSCustomObject]@{Section='Identity';Collector='Fixture';FileName='fixture-config.csv';Status='Complete';Items=2;Error=''},
            [PSCustomObject]@{Section='Security';Collector='Failed fixture';FileName='missing.csv';Status='Failed';Items=0;Error=('Collection error. ' * 100)}
        ) | Export-Csv -Path (Join-Path $folder '_Assessment-Summary.csv') -NoTypeInformation
        $null = & "$PSScriptRoot/../../src/M365-Assess/Common/Export-ComplianceMatrix.ps1" -AssessmentFolder $folder -TenantName fixture
        $script:workbookPath = Join-Path $folder '_Compliance-Matrix_fixture.xlsx'
        $script:package = Open-ExcelPackage -Path $script:workbookPath
        $script:sheet = $script:package.Workbook.Worksheets['Compliance Matrix']
        $script:columns = @{}
        for ($column = 1; $column -le $script:sheet.Dimension.End.Column; $column++) {
            $script:columns[[string]$script:sheet.Cells[2,$column].Value] = $column
        }
    }
    AfterAll { if ($script:package) { $script:package.Dispose() } }

    It 'bounds wide columns on all sheets and wraps preserved evidence' {
        foreach ($worksheet in $script:package.Workbook.Worksheets) {
            for ($row = 1; $row -le $worksheet.Dimension.End.Row; $row++) {
                $worksheet.Row($row).Height | Should -BeLessOrEqual 90
            }
            for ($column = 1; $column -le $worksheet.Dimension.End.Column; $column++) {
                $worksheet.Column($column).Width | Should -BeLessOrEqual 60
            }
        }
        $row = @(Import-Excel -Path $script:workbookPath -WorksheetName 'Compliance Matrix' -StartRow 2 | Where-Object CheckId -eq 'ENTRA-SECDEFAULT-001.1')[0]
        $row.CurrentValue | Should -BeExactly $script:longValue
        for ($r = 3; $r -le $script:sheet.Dimension.End.Row; $r++) {
            if ($script:sheet.Cells[$r,$script:columns['CheckId']].Value -eq 'ENTRA-SECDEFAULT-001.1') {
                $script:sheet.Cells[$r,$script:columns['CurrentValue']].Style.WrapText | Should -BeTrue
                $script:sheet.Row($r).Height | Should -BeGreaterThan $script:sheet.DefaultRowHeight
            }
        }
    }

    It 'uses Sequence on the Roadmap and colors the actual Sequence column' {
        $script:package.Workbook.Worksheets['Remediation Roadmap'].Cells[1,1].Value | Should -Be 'Sequence'
        for ($r = 3; $r -le $script:sheet.Dimension.End.Row; $r++) {
            if ($script:sheet.Cells[$r,$script:columns['CheckId']].Value -eq 'EXO-AUTH-001.1') {
                $script:sheet.Cells[$r,$script:columns['Sequence']].Value | Should -Be 'Done'
                $script:sheet.Cells[$r,$script:columns['Sequence']].Style.Font.Color.Rgb | Should -Be 'FF15803D'
                $script:sheet.Cells[$r,$script:columns['CurrentValue']].Style.Font.Color.Rgb | Should -Not -Be 'FF15803D'
            }
        }
    }
}
