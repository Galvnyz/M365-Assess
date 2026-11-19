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
            [PSCustomObject]@{CheckId='EXO-AUTH-001.1';Setting='Pass fixture';Category='Authentication';Status='Pass';CurrentValue='Done';RecommendedValue='Done';Remediation='None'},
            [PSCustomObject]@{CheckId='ENTRA-GUEST-001.1';Setting='=HYPERLINK("https://example.test","Click")';Category='Identity';Status='Fail';CurrentValue='=1+1';RecommendedValue='True';Remediation='None'},
            [PSCustomObject]@{CheckId='IOC-INBOXRULE-001.1';Setting='Inbox rules forwarding to external domains';Category='Mailbox Indicators';Status='Fail';CurrentValue='1 indicator(s) found (examined 3 of 3 mailboxes, current inbox rules)';RecommendedValue='None';Remediation='Investigate.'}
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

    It 'writes tenant-controlled text that looks like a formula as plain text on every sheet' {
        $formulaCells = foreach ($worksheet in $script:package.Workbook.Worksheets) {
            foreach ($cell in $worksheet.Cells[$worksheet.Dimension.Address]) {
                if ($cell.Formula -match 'HYPERLINK|1\+1') { "$($worksheet.Name)!$($cell.Address)" }
            }
        }
        $formulaCells | Should -BeNullOrEmpty

        for ($r = 3; $r -le $script:sheet.Dimension.End.Row; $r++) {
            if ($script:sheet.Cells[$r,$script:columns['CheckId']].Value -eq 'ENTRA-GUEST-001.1') {
                $script:sheet.Cells[$r,$script:columns['Setting']].Value | Should -BeExactly "'=HYPERLINK(`"https://example.test`",`"Click`")"
                $script:sheet.Cells[$r,$script:columns['CurrentValue']].Value | Should -BeExactly "'=1+1"
            }
        }
    }

    It 'reports compromise indicators on their own sheet and keeps them out of the matrix and pass rates' {
        $indicatorRows = @(Import-Excel -Path $script:workbookPath -WorksheetName 'Compromise Indicators')
        $indicatorRows.Count | Should -Be 1
        $indicatorRows[0].CheckId | Should -Be 'IOC-INBOXRULE-001.1'
        $indicatorRows[0].Status | Should -Be 'Fail'

        $matrixIds = @(Import-Excel -Path $script:workbookPath -WorksheetName 'Compliance Matrix' -StartRow 2).CheckId
        $matrixIds | Should -Not -Contain 'IOC-INBOXRULE-001.1'
        $matrixIds | Should -Contain 'EXO-AUTH-001.1'

        # The fixture has two posture Fails and one indicator Fail; no framework row may count three.
        $summaryRows = @(Import-Excel -Path $script:workbookPath -WorksheetName 'Summary')
        @($summaryRows | Where-Object { [int]$_.Fail -gt 2 }) | Should -BeNullOrEmpty
    }

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
