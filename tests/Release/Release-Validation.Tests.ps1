param([string]$OutputRoot)

# The dedicated command requires ImportExcel; ordinary Pester lanes without it
# can still run their existing unit tests. CI's release fixture step is mandatory.
Describe 'Offline release artifact validation' -Tag 'ReleaseValidation' -Skip:(-not (Get-Module -ListAvailable ImportExcel)) {
    BeforeAll {
        $script:repoRoot = [IO.Path]::GetFullPath((Join-Path -Path $PSScriptRoot -ChildPath '../..'))
        $script:sampleRoot = Join-Path -Path $script:repoRoot -ChildPath 'docs/sample-report'
        $script:outputRoot = if ($OutputRoot) { $OutputRoot } else { Join-Path -Path $TestDrive -ChildPath 'release-validation' }
        $script:assessmentRoot = Join-Path -Path $script:outputRoot -ChildPath 'assessments'
        $src = Join-Path -Path $script:repoRoot -ChildPath 'src/M365-Assess'
        Get-ChildItem -Path "$src/Orchestrator" -Filter '*.ps1' | ForEach-Object { . $_.FullName }
        . "$src/Common/Resolve-TenantIdentity.ps1"
        . "$src/Invoke-M365Assessment.ps1"
        Import-Module ImportExcel -RequiredVersion 7.8.10
        $script:version = (Import-PowerShellDataFile -Path "$src/M365-Assess.psd1").ModuleVersion
        $script:changeFinding = $false
        $script:sampleFiles = @(Get-ChildItem -Path $script:sampleRoot -Filter '*.csv' | Where-Object Name -NotLike '_*')
        $script:expectedFindings = @($script:sampleFiles | ForEach-Object { Import-Csv -LiteralPath $_.FullName } | Where-Object { $_.CheckId }).Count
        $script:oldRegistry = $global:M365AssessRegistry

        # Only replace collection and identity resolution. Baseline, report,
        # workbook, logging, and provenance implementations remain real.
        Mock Get-AssessmentMaps {
            $collectors = @($script:sampleFiles | ForEach-Object {
                @{ Name = $_.BaseName; Label = $_.BaseName
                   Script = '../../tests/Release/Sample-Collector.ps1'
                   Params = @{ FixturePath = $_.FullName; ChangeFinding = $script:changeFinding } }
            })
            @{ SectionServiceMap = @{ Tenant = @() }; SectionScopeMap = @{}
               SectionModuleMap = @{}; CollectorMap = [ordered]@{ Tenant = $collectors }; DnsCollector = @{} }
        }
        Mock Resolve-TenantIdentity {
            @{ Guid = '11111111-1111-1111-1111-111111111111'; DisplayName = 'Contoso Corporation'
               PrimaryDomain = 'contoso.com'; Environment = 'commercial' }
        }
        Mock Test-BlockedScripts { $true }
        Mock Connect-RequiredService { throw 'Offline validation must never connect to tenant services.' }
        Mock Resolve-M365Environment { throw 'Offline validation must never perform cloud discovery.' }
        Mock Write-Host { }

        Invoke-M365Assessment -TenantId 'contoso.com' -Section Tenant -M365Environment commercial -SkipConnection -NonInteractive -AutoBaseline -IncludeTrend -OutputFolder $script:assessmentRoot | Out-Null
        # Folder and auto-baseline labels have second resolution.
        Start-Sleep -Milliseconds 1100
        $script:changeFinding = $true
        Invoke-M365Assessment -TenantId 'contoso.com' -Section Tenant -M365Environment commercial -SkipConnection -NonInteractive -AutoBaseline -IncludeTrend -OutputFolder $script:assessmentRoot | Out-Null
        $script:folders = @(Get-ChildItem -LiteralPath $script:assessmentRoot -Directory -Filter 'Assessment_*' | Sort-Object Name)
    }

    AfterAll {
        if (Get-Command -Name Complete-CheckProgress -ErrorAction SilentlyContinue) { Complete-CheckProgress }
        $global:M365AssessRegistry = $script:oldRegistry
    }

    It 'creates two fresh assessment folders with all expected artifacts and source CSVs' {
        $script:folders.Count | Should -Be 2
        foreach ($folder in $script:folders) {
            $folder.Name | Should -Match '^Assessment_\d{8}_\d{6}_contoso$'
            foreach ($name in @('_Assessment-Report_contoso.html', '_Compliance-Matrix_contoso.xlsx', '_Assessment_contoso.json', '_Assessment-Summary_contoso.csv', '_Assessment-Log_contoso.txt', '_Assessment-Provenance.json') + @($script:sampleFiles.Name)) {
                $path = Join-Path -Path $folder.FullName -ChildPath $name
                $path | Should -Exist
                (Get-Item -LiteralPath $path).Length | Should -BeGreaterThan 0
            }
            @(Get-ChildItem -LiteralPath $folder.FullName -Filter '*Issues*').Count | Should -Be 0
            $summary = @(Import-Csv -LiteralPath (Join-Path -Path $folder.FullName -ChildPath '_Assessment-Summary_contoso.csv'))
            $summary.Count | Should -Be $script:sampleFiles.Count
            @($summary | Where-Object { $_.Status -ne 'Complete' -or $_.Error }).Count | Should -Be 0
            foreach ($collector in $summary) {
                [int]$collector.Items | Should -Be @(Import-Csv -LiteralPath (Join-Path -Path $folder.FullName -ChildPath $collector.FileName)).Count
            }
        }
    }

    It 'saves two AutoBaselines and compares the changed finding on the second run' {
        $baselines = @(Get-ChildItem -Path "$script:assessmentRoot/Baselines" -Directory | Sort-Object Name)
        $baselines.Count | Should -Be 2
        foreach ($baseline in $baselines) {
            $manifest = Get-Content -LiteralPath (Join-Path -Path $baseline.FullName -ChildPath 'manifest.json') -Raw | ConvertFrom-Json
            $manifest.Label | Should -Match '^auto_'
            $manifest.TenantGuid | Should -Be '11111111-1111-1111-1111-111111111111'
            $manifest.AssessmentVersion | Should -Be $script:version
            $manifest.CheckCount | Should -Be $script:expectedFindings
        }
        $log = Get-Content -LiteralPath (Join-Path -Path $script:folders[1].FullName -ChildPath '_Assessment-Log_contoso.txt') -Raw
        $log | Should -Match 'AutoBaseline: comparing to auto_'
        $log | Should -Match 'AutoBaseline drift: 1 changes'
        Should -Invoke Connect-RequiredService -Times 0 -Exactly
        Should -Invoke Resolve-M365Environment -Times 0 -Exactly
    }

    It 'renders both generated offline HTML files and validates embedded report data' {
        for ($index = 0; $index -lt $script:folders.Count; $index++) {
            $folder = $script:folders[$index]
            & node "$script:repoRoot/scripts/validate-release-report.mjs" (Join-Path -Path $folder.FullName -ChildPath '_Assessment-Report_contoso.html') $script:expectedFindings ($index + 1)
            $LASTEXITCODE | Should -Be 0
        }
    }

    It 'opens each workbook and reconciles findings, collection rows, and readable column widths' {
        foreach ($folder in $script:folders) {
            $path = Join-Path -Path $folder.FullName -ChildPath '_Compliance-Matrix_contoso.xlsx'
            $package = Open-ExcelPackage -Path $path
            try {
                foreach ($name in @('Compliance Matrix', 'Summary', 'Collection Status', 'Remediation Roadmap')) {
                    $package.Workbook.Worksheets[$name] | Should -Not -BeNullOrEmpty
                }
                foreach ($sheet in $package.Workbook.Worksheets) {
                    for ($column = 1; $column -le $sheet.Dimension.End.Column; $column++) {
                        $sheet.Column($column).Width | Should -BeLessOrEqual 60
                    }
                }
                $package.Workbook.Worksheets['Remediation Roadmap'].Cells[1,1].Text | Should -Be 'Sequence'
            }
            finally { $package.Dispose() }
            $matrix = @(Import-Excel -Path $path -WorksheetName 'Compliance Matrix' -StartRow 2)
            $matrix.Count | Should -Be $script:expectedFindings
            @(Import-Excel -Path $path -WorksheetName 'Collection Status').Count | Should -Be $script:sampleFiles.Count
            foreach ($source in $script:sampleFiles) {
                foreach ($expected in @(Import-Csv -LiteralPath $source.FullName | Where-Object { $_.CheckId })) {
                    $actual = @($matrix | Where-Object CheckId -EQ $expected.CheckId)
                    $actual.Count | Should -Be 1
                    if ($folder -eq $script:folders[1] -and $expected.CheckId -eq 'ENTRA-SECDEFAULT-001.1') {
                        $expected.CurrentValue = 'False'
                        $expected.Status = 'Fail'
                    }
                    $actual[0].CurrentValue | Should -BeExactly $expected.CurrentValue
                    $actual[0].Status | Should -Be $expected.Status
                }
            }
            $first = @($matrix | Where-Object CheckId -EQ 'ENTRA-SECDEFAULT-001.1')[0]
            $first.Status | Should -Be $(if ($folder -eq $script:folders[0]) { 'Pass' } else { 'Fail' })
        }
        $drift = @(Import-Excel -Path (Join-Path -Path $script:folders[1].FullName -ChildPath '_Compliance-Matrix_contoso.xlsx') -WorksheetName 'Drift')
        $drift.Count | Should -Be 1
        $drift[0].CheckId | Should -Be 'ENTRA-SECDEFAULT-001.1'
    }

    It 'retains clean completed assessment logs and valid hashes for every delivered file' {
        foreach ($folder in $script:folders) {
            $log = Get-Content -LiteralPath (Join-Path -Path $folder.FullName -ChildPath '_Assessment-Log_contoso.txt') -Raw
            $log | Should -Not -Match '\[(WARN|ERROR)\]'
            $log | Should -Match 'Assessment complete'
            $log | Should -Match 'AutoBaseline saved'
            $log | Should -Match 'HTML report generated'
            $log | Should -Match 'Service cleanup complete'
            $provenance = Get-Content -LiteralPath (Join-Path -Path $folder.FullName -ChildPath '_Assessment-Provenance.json') -Raw | ConvertFrom-Json
            $provenance.toolVersion | Should -Be $script:version
            $files = @(Get-ChildItem -LiteralPath $folder.FullName -File | Where-Object Name -NE '_Assessment-Provenance.json')
            $provenance.outputArtifacts.Count | Should -Be $files.Count
            foreach ($file in $files) {
                $entry = @($provenance.outputArtifacts | Where-Object name -EQ $file.Name)
                $entry.Count | Should -Be 1
                $entry[0].bytes | Should -Be $file.Length
                $entry[0].sha256 | Should -Be (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
            }
        }
    }
}
