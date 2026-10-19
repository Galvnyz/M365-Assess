BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Export-AssessmentBaseline' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/Export-AssessmentBaseline.ps1"

        # Create a temp assessment folder with test CSVs
        $script:tempAssessment = Join-Path -Path $TestDrive -ChildPath 'Assessment_20260101_000000'
        $null = New-Item -Path $script:tempAssessment -ItemType Directory -Force

        # Security-config CSV (has CheckId + Status) — should be baselined
        $securityCsvPath = Join-Path -Path $script:tempAssessment -ChildPath '10a-Entra-Security-Config.csv'
        @(
            [PSCustomObject]@{ CheckId = 'ENTRA-MFA-001'; Setting = 'MFA required'; Status = 'Pass'; CurrentValue = 'Enabled' }
            [PSCustomObject]@{ CheckId = 'ENTRA-MFA-002'; Setting = 'MFA legacy'; Status = 'Fail'; CurrentValue = 'Disabled' }
        ) | Export-Csv -Path $securityCsvPath -NoTypeInformation -Encoding UTF8

        # Non-security-config CSV (no CheckId column) — should be skipped
        $nonSecCsvPath = Join-Path -Path $script:tempAssessment -ChildPath '02-User-Summary.csv'
        @(
            [PSCustomObject]@{ DisplayName = 'User One'; UPN = 'user@test.com' }
        ) | Export-Csv -Path $nonSecCsvPath -NoTypeInformation -Encoding UTF8

        $script:tempOutput = Join-Path -Path $TestDrive -ChildPath 'Output'
        $null = New-Item -Path $script:tempOutput -ItemType Directory -Force
    }

    Context 'when exporting a valid assessment folder' {
        BeforeAll {
            $script:result = Export-AssessmentBaseline `
                -AssessmentFolder $script:tempAssessment `
                -OutputFolder $script:tempOutput `
                -Label 'Q1-2026' `
                -TenantId 'contoso.com' `
                -Sections @('Entra', 'Exchange') `
                -Version '1.11.0'
        }

        It 'should return the baseline folder path' {
            $script:result | Should -Not -BeNullOrEmpty
            $script:result | Should -Match 'Baselines'
        }

        It 'should create the baseline directory' {
            Test-Path -Path $script:result -PathType Container | Should -Be $true
        }

        It 'should write a manifest file' {
            $metaPath = Join-Path -Path $script:result -ChildPath 'manifest.json'
            Test-Path -Path $metaPath | Should -Be $true
        }

        It 'should write correct manifest fields' {
            $metaPath = Join-Path -Path $script:result -ChildPath 'manifest.json'
            $meta = Get-Content -Path $metaPath -Raw | ConvertFrom-Json
            $meta.Label             | Should -Be 'Q1-2026'
            $meta.TenantId          | Should -Be 'contoso.com'
            $meta.AssessmentVersion | Should -Be '1.11.0'
            $meta.Sections          | Should -Contain 'Entra'
            $meta.SavedAt           | Should -Not -BeNullOrEmpty
            $meta.CheckCount        | Should -BeGreaterOrEqual 0
        }

        It 'should serialize the security-config CSV to JSON' {
            $jsonPath = Join-Path -Path $script:result -ChildPath '10a-Entra-Security-Config.json'
            Test-Path -Path $jsonPath | Should -Be $true
            $rows = Get-Content -Path $jsonPath -Raw | ConvertFrom-Json
            $rows.Count | Should -Be 2
            $rows[0].CheckId | Should -Be 'ENTRA-MFA-001'
        }

        It 'should skip the non-security-config CSV' {
            $skippedPath = Join-Path -Path $script:result -ChildPath '02-User-Summary.json'
            Test-Path -Path $skippedPath | Should -Be $false
        }

        It 'should label the baseline folder with sanitised label and tenant' {
            $script:result | Should -Match 'Q1-2026_contoso\.com'
        }
    }

    Context 'when the label contains special characters' {
        It 'should sanitise them for the folder name' {
            $dir = Export-AssessmentBaseline `
                -AssessmentFolder $script:tempAssessment `
                -OutputFolder $script:tempOutput `
                -Label 'Baseline 2026/Q1' `
                -TenantId 'contoso.com'
            $dir | Should -Match 'Baseline_2026_Q1_contoso\.com'
        }
    }

    Context 'GUID-keyed folders + enriched manifest (C1 #780)' {
        It 'should name the folder with TenantGuid when supplied' {
            $dir = Export-AssessmentBaseline `
                -AssessmentFolder $script:tempAssessment `
                -OutputFolder $script:tempOutput `
                -Label 'Q2-2026' `
                -TenantId 'whatever.user.typed.com' `
                -TenantGuid '11111111-2222-3333-4444-555555555555'
            $dir | Should -Match 'Q2-2026_11111111-2222-3333-4444-555555555555$'
        }

        It 'should fall back to TenantId in the folder name when TenantGuid is empty (legacy callers)' {
            $dir = Export-AssessmentBaseline `
                -AssessmentFolder $script:tempAssessment `
                -OutputFolder $script:tempOutput `
                -Label 'Q3-2026' `
                -TenantId 'legacy.contoso.com'
            $dir | Should -Match 'Q3-2026_legacy\.contoso\.com$'
        }

        It 'should write the new identity fields into the manifest' {
            $dir = Export-AssessmentBaseline `
                -AssessmentFolder $script:tempAssessment `
                -OutputFolder $script:tempOutput `
                -Label 'Q4-2026' `
                -TenantId 'contoso.com' `
                -TenantGuid '99999999-0000-1111-2222-333333333333' `
                -DisplayName 'Contoso Ltd' `
                -PrimaryDomain 'contoso.com' `
                -Environment 'commercial'
            $meta = Get-Content (Join-Path $dir 'manifest.json') -Raw | ConvertFrom-Json
            $meta.TenantGuid    | Should -Be '99999999-0000-1111-2222-333333333333'
            $meta.DisplayName   | Should -Be 'Contoso Ltd'
            $meta.PrimaryDomain | Should -Be 'contoso.com'
            $meta.Environment   | Should -Be 'commercial'
            # Legacy field still preserved for back-compat readers
            $meta.TenantId      | Should -Be 'contoso.com'
        }

        It 'should sanitise braces / curly characters out of the GUID folder suffix' {
            $dir = Export-AssessmentBaseline `
                -AssessmentFolder $script:tempAssessment `
                -OutputFolder $script:tempOutput `
                -Label 'Q5' `
                -TenantId 'contoso.com' `
                -TenantGuid '{aaaa1111-2222-3333-4444-555555555555}'
            $dir | Should -Match '_aaaa1111-2222-3333-4444-555555555555$'
            $dir | Should -Not -Match '[{}]'
        }
    }
}

Describe 'Baseline finding counts exclude context-only rows' {
    BeforeAll { . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/Export-AssessmentBaseline.ps1" }
    It 'serializes only identified findings and counts the same rows' {
        $folder = Join-Path -Path $TestDrive -ChildPath 'context-fixture'
        $null = New-Item -Path $folder -ItemType Directory
        @(
            [PSCustomObject]@{CheckId='TEST-001.1';Status='Fail';Setting='Valid finding'},
            [PSCustomObject]@{CheckId='';Status='Warning';Setting='Context only'},
            [PSCustomObject]@{CheckId='   ';Status='Warning';Setting='Whitespace identifier'}
        ) | Export-Csv -Path (Join-Path $folder 'checks-config.csv') -NoTypeInformation
        [PSCustomObject]@{CheckId='';Status='Warning';Setting='Context only'} | Export-Csv -Path (Join-Path $folder 'empty-config.csv') -NoTypeInformation
        $baseline = Export-AssessmentBaseline -AssessmentFolder $folder -OutputFolder $TestDrive -Label 'filtered' -TenantId 'example.test'
        $manifest = Get-Content -LiteralPath (Join-Path $baseline 'manifest.json') -Raw | ConvertFrom-Json
        $manifest.CheckCount | Should -Be 1
        $json = Get-Content -LiteralPath (Join-Path $baseline 'checks-config.json') -Raw
        $json.TrimStart().StartsWith('[') | Should -BeTrue
        $rows = @($json | ConvertFrom-Json)
        $rows.Count | Should -Be 1
        $rows[0].CheckId | Should -Be 'TEST-001.1'
        Join-Path -Path $baseline -ChildPath 'empty-config.json' | Should -Not -Exist
    }
}
