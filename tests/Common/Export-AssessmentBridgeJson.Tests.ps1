BeforeAll {
    . "$PSScriptRoot/../../src/M365-Assess/Common/Export-AssessmentBridgeJson.ps1"

    # The portal ingests this file's findings (T-0833); its fixture is this export's output.
    $script:portalFixture = Join-Path -Path $PSScriptRoot -ChildPath '../../portal/db/src/fixtures/assessment-bridge.json'

    function Get-BridgeFixtureRow {
        @(
            [PSCustomObject]@{
                CheckId = 'CA-REPORTONLY-001.1'; Category = 'Conditional Access'; Setting = 'Report-only policies'
                CurrentValue = '2 report-only'; RecommendedValue = '0 report-only'; Status = 'Warning'
                Remediation = 'Move report-only policies to enabled.'; Section = 'Identity'; Source = 'Entra'
                RiskSeverity = 'High'; Frameworks = @{ 'cis-m365-v6' = @{ controlId = '5.2.2.1' } }
            }
            [PSCustomObject]@{
                CheckId = 'EXO-AUDIT-001.1'; Category = 'Auditing'; Setting = 'Mailbox auditing'
                CurrentValue = 'Enabled'; RecommendedValue = 'Enabled'; Status = 'Pass'
                Remediation = ''; Section = 'Email'; Source = 'Exchange Online'
                RiskSeverity = 'Medium'; Frameworks = @{ 'cis-m365-v6' = @{ controlId = '6.1.1' }; 'nist-800-53' = @{ controlId = 'AU-2' } }
            }
            [PSCustomObject]@{
                CheckId = 'SPO-SHARING-001.1'; Category = 'Sharing'; Setting = 'External sharing'
                CurrentValue = 'Anyone'; RecommendedValue = 'Existing guests'; Status = 'Fail'
                Remediation = 'Restrict external sharing.'; Section = 'Collaboration'; Source = 'SharePoint'
                RiskSeverity = 'Critical'; Frameworks = @{}
            }
            [PSCustomObject]@{
                CheckId = 'ENTRA-GUEST-001.1'; Category = 'Guests'; Setting = 'Guest invite settings'
                CurrentValue = 'Admins and members'; RecommendedValue = 'Admins only'; Status = 'Review'
                Remediation = 'Review guest invitation settings.'; Section = 'Identity'; Source = 'Entra'
                RiskSeverity = 'Low'; Frameworks = @{}
            }
        )
    }

    function Invoke-BridgeExport {
        param([string]$Path, [object[]]$Rows)
        Export-AssessmentBridgeJson -AllFindings $Rows -TenantId '00000000-0000-0000-0000-000000000001' -TenantName 'Fixture Tenant' -AssessedAt '2026-09-27T00:00:00.0000000Z' -AssessmentVersion '0.0.0' -RegistryVersion 'fixture' -OutputPath $Path | Out-Null
        Get-Content -Path $Path -Raw | ConvertFrom-Json -DateKind String
    }
}

Describe 'Export-AssessmentBridgeJson' {
    It 'writes one finding per row with the row''s descriptive fields' {
        $out = Invoke-BridgeExport -Path (Join-Path -Path $TestDrive -ChildPath 'bridge.json') -Rows (Get-BridgeFixtureRow)
        $out.findings | Should -HaveCount 4
        $first = $out.findings[0]
        $first.checkId | Should -Be 'CA-REPORTONLY-001.1'
        $first.severity | Should -Be 'high'
        $first.category | Should -Be 'Conditional Access'
        $first.setting | Should -Be 'Report-only policies'
        $first.recommendedValue | Should -Be '0 report-only'
        $first.section | Should -Be 'Identity'
        $first.collector | Should -Be 'Entra'
        $first.frameworks | Should -Be @('cis-m365-v6')
    }

    It 'writes a single framework as a JSON array' {
        $path = Join-Path -Path $TestDrive -ChildPath 'single.json'
        $null = Invoke-BridgeExport -Path $path -Rows @((Get-BridgeFixtureRow)[0])
        (Get-Content -Path $path -Raw) | Should -Match '"frameworks":\s*\[\s*"cis-m365-v6"\s*\]'
    }

    It 'writes null for descriptive fields a row does not carry' {
        $row = [PSCustomObject]@{ CheckId = 'X-001.1'; Status = 'Pass'; CurrentValue = 'a'; Remediation = '' }
        $out = Invoke-BridgeExport -Path (Join-Path -Path $TestDrive -ChildPath 'sparse.json') -Rows @($row)
        $out.findings[0].category | Should -BeNullOrEmpty
        $out.findings[0].collector | Should -BeNullOrEmpty
        $out.findings[0].severity | Should -Be 'medium'
        @($out.findings[0].frameworks) | Should -HaveCount 0
    }

    It 'redacts current values of sensitive checks' {
        $path = Join-Path -Path $TestDrive -ChildPath 'redacted.json'
        Export-AssessmentBridgeJson -AllFindings (Get-BridgeFixtureRow) -TenantId 't' -OutputPath $path -SensitiveCheckIds @('EXO-*') | Out-Null
        $out = Get-Content -Path $path -Raw | ConvertFrom-Json
        ($out.findings | Where-Object { $_.checkId -eq 'EXO-AUDIT-001.1' }).currentValue | Should -Be '[REDACTED]'
    }

    It 'counts findings by domain' {
        $out = Invoke-BridgeExport -Path (Join-Path -Path $TestDrive -ChildPath 'domains.json') -Rows (Get-BridgeFixtureRow)
        $out.domainSummary.'Conditional Access'.warn | Should -Be 1
        $out.domainSummary.'Entra ID'.review | Should -Be 1
        $out.domainSummary.'SharePoint & OneDrive'.fail | Should -Be 1
    }

    It 'matches the portal ingestion fixture' {
        $expected = Invoke-BridgeExport -Path (Join-Path -Path $TestDrive -ChildPath 'fixture.json') -Rows (Get-BridgeFixtureRow)
        $fixture = Get-Content -Path $script:portalFixture -Raw | ConvertFrom-Json -DateKind String
        ($fixture | ConvertTo-Json -Depth 8) | Should -Be ($expected | ConvertTo-Json -Depth 8)
    }
}
