Describe 'Assessment trust across generated artifacts' {
    BeforeAll {
        $common = "$PSScriptRoot/../../src/M365-Assess/Common"
        $folder = Join-Path $TestDrive 'assessment'
        $null = New-Item -ItemType Directory -Path $folder
        [PSCustomObject]@{TenantId='11111111-1111-1111-1111-111111111111';OrgDisplayName='Fixture';DefaultDomain='example.test'} | Export-Csv "$folder/01-Tenant-Info.csv" -NoTypeInformation
        @(
            [PSCustomObject]@{Section='Entra';Collector='Fixture checks';FileName='07b-Entra-Security-Config.csv';Status='Complete';Items=1;Error=''},
            [PSCustomObject]@{Section='Purview';Collector='Unavailable collector';FileName='missing.csv';Status='Failed';Items=0;Error='403 Forbidden'}
        ) | Export-Csv "$folder/_Assessment-Summary.csv" -NoTypeInformation
        [PSCustomObject]@{CheckId='ENTRA-SECDEFAULT-001.1';Setting='Security Defaults Enabled';Category='Identity';Status='Fail';CurrentValue='False';RecommendedValue='True';Remediation='Verify protection';ObservedValue='False';EvidenceSource='Graph';Limitations='Fixture limitation'} | Export-Csv "$folder/07b-Entra-Security-Config.csv" -NoTypeInformation
        $document = @{schemaVersion='1.0';tenantId='11111111-1111-1111-1111-111111111111';decisions=@(@{checkId='ENTRA-SECDEFAULT-001';setting='Security Defaults Enabled';type='AcceptedRisk';observedValue='False';approvedBy='Assessor';approvedAt='2026-01-01T00:00:00Z';expiresAt='2099-01-01T00:00:00Z';justification='Migration review';evidence='Evidence reference'})}
        $document | ConvertTo-Json -Depth 8 | Set-Content "$folder/_Assessment-Decisions.json"
        $null = & "$common/Export-AssessmentReport.ps1" -AssessmentFolder $folder
        $bridge = Get-Content "$folder/_Assessment.json" -Raw | ConvertFrom-Json
        $html = Get-Content "$folder/_Assessment-Report.html" -Raw
    }
    It 'preserves raw failure, decision, limitation and missing collector in bridge JSON' {
        $bridge.findings[0].status | Should -Be 'Fail'
        $bridge.findings[0].decision.state | Should -Be 'Active'
        $bridge.findings[0].actionable | Should -BeFalse
        $bridge.findings[0].evidence.Limitations | Should -Be 'Fixture limitation'
        $bridge.collection.state | Should -Be 'Incomplete'
        $bridge.collection.incompleteCollectors | Should -Be 1
    }
    It 'embeds the same evidence in HTML and stays within the fixture budget' {
        $html | Should -Match 'Fixture limitation'
        $html | Should -Match 'Migration review'
        $html | Should -Match 'Unavailable collector'
        $bytes = [System.Text.Encoding]::UTF8.GetByteCount($html)
        if ($bytes -gt 2500000) { Write-Warning "Fixture HTML exceeds 2.5 MB: $bytes bytes" }
        $bytes | Should -BeLessThan 3000000
    }
    It 'exports decisions and collection status to real XLSX sheets' -Skip:(-not (Get-Module -ListAvailable ImportExcel)) {
        $path = "$folder/_Compliance-Matrix_tenant.xlsx"
        $matrix = @(Import-Excel -Path $path -WorksheetName 'Compliance Matrix' -StartRow 2)
        $matrix[0].Status | Should -Be 'Fail'
        $matrix[0].Decision_state | Should -Be 'Active'
        $matrix[0].Decision_justification | Should -Be 'Migration review'
        $collectors = @(Import-Excel -Path $path -WorksheetName 'Collection Status')
        $collectors.Count | Should -Be 2
        $collectors[1].Status | Should -Be 'Failed'
    }
    It 'records decision-only changes as Modified in baseline comparison' {
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/Export-AssessmentBaseline.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/Compare-AssessmentBaseline.ps1"
        $baseline = Export-AssessmentBaseline -AssessmentFolder $folder -OutputFolder $TestDrive -Label 'before' -TenantId $document.tenantId
        $document.decisions[0].justification = 'Updated evidence review'
        $document | ConvertTo-Json -Depth 8 | Set-Content "$folder/_Assessment-Decisions.json"
        $changes = @(Compare-AssessmentBaseline -AssessmentFolder $folder -BaselineFolder $baseline)
        $changes.Count | Should -Be 1
        $changes[0].ChangeType | Should -Be 'Modified'
        $changes[0].Category | Should -Be 'Assessor decision'
    }
}
