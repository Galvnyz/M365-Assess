BeforeAll {
    . (Join-Path $PSScriptRoot '../../src/M365-Assess/Common/Export-M365Remediation.ps1')
}

Describe 'Export-M365Remediation (D3 #787)' {

    BeforeEach {
        $script:assessFolder = Join-Path $TestDrive 'Assessment_test'
        New-Item -Path $script:assessFolder -ItemType Directory -Force | Out-Null

        # One Fail, one Warning, one Review, one Pass (Pass should be excluded from outputs)
        @(
            [PSCustomObject]@{
                CheckId = 'EXO-AUTH-001.1'; Setting = 'Modern Authentication Enabled'
                Status = 'Fail'; Category = 'Authentication'
                CurrentValue = 'False'; RecommendedValue = 'True'
                Remediation = 'Set-OrganizationConfig -OAuth2ClientProfileEnabled $true'
            }
            [PSCustomObject]@{
                CheckId = 'ENTRA-CA-003.1'; Setting = 'Enabled CA Policies'
                Status = 'Warning'; Category = 'Conditional Access'
                CurrentValue = '1'; RecommendedValue = '1+'
                Remediation = 'Add policies via portal'
            }
            [PSCustomObject]@{
                CheckId = 'COMPLIANCE-AUDIT-001.1'; Setting = 'Unified audit log'
                Status = 'Review'; Category = 'Auditing'
                CurrentValue = 'See logs'; RecommendedValue = 'Enabled'
                Remediation = 'Verify ingestion via portal'
            }
            [PSCustomObject]@{
                CheckId = 'EXO-AUTH-001.2'; Setting = 'Should be skipped (Pass)'
                Status = 'Pass'; Category = 'Authentication'
                CurrentValue = 'True'; RecommendedValue = 'True'
                Remediation = ''
            }
        ) | Export-Csv -Path (Join-Path $script:assessFolder 'mixed-config.csv') -NoTypeInformation -Encoding UTF8
    }

    Context 'output folder + format selection' {
        It 'creates Remediation/ under the assessment folder by default' {
            Export-M365Remediation -AssessmentFolder $script:assessFolder | Out-Null
            (Join-Path $script:assessFolder 'Remediation') | Should -Exist
        }

        It 'writes only the requested formats when -Format is supplied' {
            $written = @(Export-M365Remediation -AssessmentFolder $script:assessFolder -Format 'Jira')
            $written.Count | Should -Be 1
            $written[0] | Should -BeLike '*jira-import.csv'
        }

        It 'returns an array of full paths to written files' {
            $written = Export-M365Remediation -AssessmentFolder $script:assessFolder
            $written | Should -Not -BeNullOrEmpty
            foreach ($p in $written) { Test-Path $p | Should -BeTrue }
        }

        It 'rejects a non-existent assessment folder' {
            { Export-M365Remediation -AssessmentFolder 'C:\does\not\exist' } | Should -Throw '*not found*'
        }
    }

    Context 'GitHub Issues markdown' {
        It 'writes one .md file per Fail/Warning/Review finding (Pass excluded)' {
            Export-M365Remediation -AssessmentFolder $script:assessFolder -Format 'GitHub' | Out-Null
            $ghDir = Join-Path $script:assessFolder 'Remediation/github'
            $files = Get-ChildItem $ghDir -Filter '*.md'
            $files.Count | Should -Be 3   # the three remediation-relevant findings, NOT the Pass row
        }

        It 'embeds the CheckId and Status in each issue body' {
            Export-M365Remediation -AssessmentFolder $script:assessFolder -Format 'GitHub' | Out-Null
            $exo = Get-Content (Join-Path $script:assessFolder 'Remediation/github/EXO-AUTH-001.1.md') -Raw
            $exo | Should -Match 'EXO-AUTH-001\.1'
            $exo | Should -Match 'Fail'
        }

        It 'writes a create-issues.sh helper for bulk issue creation' {
            Export-M365Remediation -AssessmentFolder $script:assessFolder -Format 'GitHub' | Out-Null
            (Join-Path $script:assessFolder 'Remediation/github/create-issues.sh') | Should -Exist
        }
    }

    Context 'executive summary' {
        It 'reports the correct status counts' {
            Export-M365Remediation -AssessmentFolder $script:assessFolder -Format 'ExecutiveSummary' | Out-Null
            $exec = Get-Content (Join-Path $script:assessFolder 'Remediation/executive-summary.md') -Raw
            $exec | Should -Match '\| Fail \| 1 \|'
            $exec | Should -Match '\| Warning \| 1 \|'
            $exec | Should -Match '\| Review.*\| 1 \|'
        }
    }

    Context 'Jira CSV' {
        It 'maps M365-Assess severity to Jira priority' {
            Export-M365Remediation -AssessmentFolder $script:assessFolder -Format 'Jira' | Out-Null
            $rows = Import-Csv (Join-Path $script:assessFolder 'Remediation/jira-import.csv')
            $rows.Count | Should -Be 3   # Fail/Warning/Review
            $rows[0].'Issue Type' | Should -Be 'Task'
            $rows[0].Priority     | Should -Match '^(Highest|High|Medium|Low|Lowest)$'
        }

        It 'embeds the CheckId in the Summary column for traceability' {
            Export-M365Remediation -AssessmentFolder $script:assessFolder -Format 'Jira' | Out-Null
            $rows = Import-Csv (Join-Path $script:assessFolder 'Remediation/jira-import.csv')
            ($rows | Where-Object Summary -like '*EXO-AUTH-001*').Count | Should -BeGreaterThan 0
        }
    }

    Context 'Technical backlog markdown' {
        It 'writes a markdown table with all remediation-relevant findings' {
            Export-M365Remediation -AssessmentFolder $script:assessFolder -Format 'TechnicalBacklog' | Out-Null
            $body = Get-Content (Join-Path $script:assessFolder 'Remediation/technical-backlog.md') -Raw
            $body | Should -Match '\| Sequence \| CheckId'
            $body | Should -Match 'EXO-AUTH-001\.1'
            $body | Should -Match 'ENTRA-CA-003\.1'
            $body | Should -Match 'COMPLIANCE-AUDIT-001\.1'
        }
    }

    Context 'consistent Sequence wording across export formats (#969)' {
        It 'should use Sequence in GitHub, executive, Jira, and backlog output' {
            Export-M365Remediation -AssessmentFolder $script:assessFolder | Out-Null
            $folder = Join-Path $script:assessFolder 'Remediation'
            $github = Get-Content (Join-Path $folder 'github/EXO-AUTH-001.1.md') -Raw
            $github | Should -Match '\*\*Sequence:\*\* (now|soon|later)'
            $github | Should -Match 'sequence:(now|soon|later)'
            $executive = Get-Content (Join-Path $folder 'executive-summary.md') -Raw
            $executive | Should -Match '## Remediation sequence'
            $executive | Should -Match '\| Sequence \| Count \| Meaning \|'
            $jira = Import-Csv (Join-Path $folder 'jira-import.csv')
            foreach ($row in $jira) {
                $row.Labels | Should -Match 'sequence-(now|soon|later)'
            }
            $backlog = Get-Content (Join-Path $folder 'technical-backlog.md') -Raw
            $backlog | Should -Match '\| Sequence \| CheckId'
            foreach ($file in Get-ChildItem -Path $folder -Recurse -File) {
                (Get-Content $file.FullName -Raw) | Should -Not -Match 'horizon'
            }
        }
    }

    Context 'edge case: no remediation-relevant findings' {
        It 'warns and returns an empty array when only Pass findings exist' {
            $emptyFolder = Join-Path $TestDrive 'Assessment_pass_only'
            New-Item $emptyFolder -ItemType Directory -Force | Out-Null
            @(
                [PSCustomObject]@{ CheckId = 'TEST-001.1'; Setting = 'OK'; Status = 'Pass'; Category = 'Test'; CurrentValue = 'a'; RecommendedValue = 'a'; Remediation = '' }
            ) | Export-Csv -Path (Join-Path $emptyFolder 'pass-config.csv') -NoTypeInformation -Encoding UTF8

            $result = Export-M365Remediation -AssessmentFolder $emptyFolder -WarningAction SilentlyContinue
            $result | Should -BeNullOrEmpty
        }
    }
}
