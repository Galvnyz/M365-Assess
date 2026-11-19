Describe 'Build-ReportData compromise indicators' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Common/Build-ReportData.ps1"

        function ConvertFrom-ReportDataJson {
            param([string]$Output)
            $json = $Output -replace '^window\.REPORT_DATA = ', '' -replace ';$', ''
            return $json | ConvertFrom-Json
        }

        function New-Row {
            param([string]$CheckId, [string]$Status, [string]$Evidence = '', [string]$Limitations = '')
            [PSCustomObject]@{
                CheckId          = $CheckId
                Status           = $Status
                Category         = 'Test'
                Setting          = "Setting for $CheckId"
                CurrentValue     = 'value'
                RecommendedValue = 'expected'
                Remediation      = 'fix'
                Section          = 'Test'
                RiskSeverity     = 'High'
                Frameworks       = @{}
                Evidence         = $Evidence
                Limitations      = $Limitations
            }
        }

        $script:eventJson = '{"total":1,"shown":1,"events":[{"Time":"","Actor":"victim@contoso.com","Target":"rule","Detail":"forwards"}]}'
    }

    Context 'when findings include IOC checks alongside posture checks' {
        BeforeAll {
            $rows = @(
                New-Row -CheckId 'ENTRA-MFA-001.1' -Status 'Pass'
                New-Row -CheckId 'EXO-AUTH-001.1' -Status 'Fail'
                New-Row -CheckId 'IOC-INBOXRULE-001.1' -Status 'Fail' -Evidence $script:eventJson -Limitations 'Rules have no creation date.'
                New-Row -CheckId 'IOC-CONSENT-001.1' -Status 'Unknown'
            )
            $script:data = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings $rows)
        }

        It 'should keep IOC checks out of findings' {
            @($script:data.findings).checkId | Should -Be @('ENTRA-MFA-001.1', 'EXO-AUTH-001.1')
        }

        It 'should emit IOC checks under indicators' {
            @($script:data.indicators).checkId | Should -Be @('IOC-INBOXRULE-001.1', 'IOC-CONSENT-001.1')
            $script:data.indicators[0].domain | Should -Be 'Compromise Indicators'
        }

        It 'should not count IOC checks in any domain rollup' {
            $script:data.domainStats.PSObject.Properties.Name | Should -Not -Contain 'Compromise Indicators'
            $totals = $script:data.domainStats.PSObject.Properties.Value | ForEach-Object { $_.total }
            ($totals | Measure-Object -Sum).Sum | Should -Be 2
            ($script:data.domainStats.PSObject.Properties.Value | ForEach-Object { $_.fail } | Measure-Object -Sum).Sum | Should -Be 1
        }

        It 'should not count IOC checks in the section summary' {
            ($script:data.summary | ForEach-Object { $_.Items } | Measure-Object -Sum).Sum | Should -Be 2
        }

        It 'should carry the event list and limitations through to the indicator' {
            $raw = $script:data.indicators[0].evidence.raw
            # The collector stores a JSON string; Build-ReportData JSON-encodes it once more.
            $events = ($raw | ConvertFrom-Json | ConvertFrom-Json).events
            $events[0].Actor | Should -Be 'victim@contoso.com'
            $script:data.indicators[0].evidence.limitations | Should -Be 'Rules have no creation date.'
        }
    }

    Context 'when a check is registered to the CompromiseHunt collector under another prefix' {
        It 'should route it to indicators by collector' {
            $registry = @{ 'CUSTOM-001' = @{ collector = 'CompromiseHunt'; riskSeverity = 'High'; frameworks = @{} } }
            $data = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @(New-Row -CheckId 'CUSTOM-001.1' -Status 'Pass') -RegistryData $registry)
            @($data.findings).Count | Should -Be 0
            @($data.indicators).checkId | Should -Be @('CUSTOM-001.1')
        }
    }

    Context 'when there are no IOC checks' {
        It 'should emit an empty indicators array' {
            $data = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @(New-Row -CheckId 'ENTRA-MFA-001.1' -Status 'Pass'))
            @($data.indicators).Count | Should -Be 0
            @($data.findings).Count | Should -Be 1
        }
    }
}
