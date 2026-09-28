BeforeAll {
    $common = "$PSScriptRoot/../../src/M365-Assess/Common"
    . "$common/AssessmentDecisions.ps1"
    . "$common/Get-CaCoverageEvidence.ps1"
    . "$common/Get-ExoAuditConfig.ps1"
    . "$common/Build-ReportData.ps1"
    . "$common/Export-AssessmentBridgeJson.ps1"
    function Get-ConnectionInformation { }
    function New-DecisionDocument {
        [PSCustomObject]@{schemaVersion='1.0';tenantId='11111111-1111-1111-1111-111111111111';decisions=@(
            [PSCustomObject]@{checkId='CA-TEST-001';setting='Protection';type='AcceptedRisk';justification='Approved migration';approvedBy='Assessor';approvedAt='2026-01-01T00:00:00Z';expiresAt='2099-01-01T00:00:00Z';evidence='Change reference';observedValue='False'}
        )}
    }
    function New-Observation {
        [PSCustomObject]@{CheckId='CA-TEST-001.1';Setting='Protection';Status='Fail';CurrentValue='False';Section='Entra';RiskSeverity='high';Frameworks=@{'cis-m365-v6'=@{controlId='1.1';profiles=@('E3')}}}
    }
}
Describe 'Assessor decisions preserve observations' {
    BeforeEach { $finding = New-Observation; $document = New-DecisionDocument }
    It 'excludes active accepted risk from actionable work without altering a failure' {
        Add-AssessmentDecisions -Findings @($finding) -Document $document
        $finding.Status | Should -Be 'Fail'
        $finding.CurrentValue | Should -Be 'False'
        $finding.Actionable | Should -BeFalse
        $finding.Decision.state | Should -Be 'Active'
    }
    It 'restores expired decisions to actionable work' {
        $document.decisions[0].expiresAt = '2026-02-01T00:00:00Z'
        Add-AssessmentDecisions -Findings @($finding) -Document $document
        $finding.Actionable | Should -BeTrue
        $finding.Decision.state | Should -Be 'Expired'
    }
    It 'does not reuse a waiver when the observed value changes' {
        $finding.CurrentValue = 'New failure'
        Add-AssessmentDecisions -Findings @($finding) -Document $document
        $finding.Decision.state | Should -Be 'EvidenceChanged'
        $finding.Actionable | Should -BeTrue
    }
    It 'never applies manual attestations to automated pass or fail observations' -ForEach @('Fail','Pass','Unknown') {
        $finding.Status = $_
        $document.decisions[0].type = 'ManualAttestation'
        Add-AssessmentDecisions -Findings @($finding) -Document $document
        $finding.Decision.state | Should -Be 'Ineligible'
        $finding.Status | Should -Be $_
    }
    It 'retains manual Review observations alongside active attestations' {
        $finding.Status = 'Review'; $document.decisions[0].type = 'ManualAttestation'
        Add-AssessmentDecisions -Findings @($finding) -Document $document
        $finding.Status | Should -Be 'Review'
        $finding.Decision.state | Should -Be 'Active'
    }
    It 'rejects ambiguous finding scope even if sub-numbers change' {
        $other = New-Observation; $other.CheckId='CA-TEST-001.2'
        Add-AssessmentDecisions -Findings @($finding,$other) -Document $document
        $finding.Decision.state | Should -Be 'Ambiguous'
    }
    It 'validates tenant identity and rejects duplicate scopes' {
        $path = Join-Path $TestDrive 'decisions.json'
        $document | ConvertTo-Json -Depth 8 | Set-Content $path
        (Import-AssessmentDecisions -Path $path -TenantId $document.tenantId).decisions.Count | Should -Be 1
        { Import-AssessmentDecisions -Path $path -TenantId 'different' } | Should -Throw '*tenantId*'
        $document.decisions = @($document.decisions[0],$document.decisions[0])
        $document | ConvertTo-Json -Depth 8 | Set-Content $path
        { Import-AssessmentDecisions -Path $path -TenantId $document.tenantId } | Should -Throw '*Duplicate*'
    }
}
Describe 'Evidence output contracts' {
    It 'validates zero, one and multiple findings without JSON replacement hacks' -ForEach @(0,1,2) {
        $rows = @(for ($n=0; $n -lt $_; $n++) { New-Observation })
        $assignment = Build-ReportDataJson -AllFindings $rows
        $json = $assignment.Substring('window.REPORT_DATA = '.Length).TrimEnd(';')
        Test-Json -Json $json -SchemaFile "$common/../schemas/report-data.schema.json" | Should -BeTrue
        $path = Join-Path $TestDrive "bridge-$_.json"
        $null = Export-AssessmentBridgeJson -AllFindings $rows -TenantId 'fixture' -OutputPath $path
        Test-Json -Json (Get-Content $path -Raw) -SchemaFile "$common/../schemas/assessment-bridge.schema.json" | Should -BeTrue
    }
    It 'safely escapes mixed-case script markup and preserves the original value after parsing' {
        $finding=New-Observation; $finding.CurrentValue='</ScRiPt><script>alert(1)</script>'
        $assignment=Build-ReportDataJson -AllFindings @($finding)
        $assignment | Should -Not -Match '(?i)</script'
        $json=$assignment.Substring('window.REPORT_DATA = '.Length).TrimEnd(';') | ConvertFrom-Json
        $json.findings[0].current | Should -BeExactly $finding.CurrentValue
    }
    It 'redacts decision and structured evidence with sensitive observations' {
        $finding=New-Observation; Add-AssessmentDecisions -Findings @($finding) -Document (New-DecisionDocument)
        $path=Join-Path $TestDrive 'redacted.json'
        $null=Export-AssessmentBridgeJson -AllFindings @($finding) -TenantId 'fixture' -OutputPath $path -SensitiveCheckIds @('CA-*')
        $data=Get-Content $path -Raw | ConvertFrom-Json
        $data.findings[0].currentValue | Should -Be '[REDACTED]'
        $data.findings[0].decision | Should -BeNullOrEmpty
        $data.findings[0].evidence | Should -BeNullOrEmpty
    }
    It 'marks complete collectors with query warnings incomplete' {
        $summary=@([PSCustomObject]@{Collector='Fixture';Status='Complete';Items=1;Error='GraphCollectionIncomplete'})
        (Get-AssessmentCollectionState -Summary $summary -Findings @()).state | Should -Be 'Incomplete'
    }
}
Describe 'Conservative Conditional Access evidence' {
    BeforeEach {
        $policy=@{state='enabled';conditions=@{users=@{includeUsers=@('All')};applications=@{includeApplications=@('All')};clientAppTypes=@('all')};grantControls=@{operator='OR';builtInControls=@('mfa')}}
    }
    It 'recognizes a mandatory MFA grant scoped to all users and applications' {
        (Get-CaCoverageEvidence -Policies @($policy))['MFA for all users'] | Should -BeTrue
    }
    It 'does not mistake compliant-device OR MFA for mandatory MFA' {
        $policy.grantControls.builtInControls=@('mfa','compliantDevice')
        (Get-CaCoverageEvidence -Policies @($policy))['MFA for all users'] | Should -BeFalse
    }
    It 'requires review of exclusions and conditional targeting' {
        $policy.conditions.users.excludeUsers=@('emergency-user')
        (Get-CaCoverageEvidence -Policies @($policy))['MFA for all users'] | Should -BeFalse
    }
    It 'does not count report-only policies' {
        $policy.state='enabledForReportingButNotEnforced'
        (Get-CaCoverageEvidence -Policies @($policy))['MFA for all users'] | Should -BeFalse
    }
}
Describe 'Authoritative Exchange audit source' {
    It 'rejects Purview-only sessions even when a command exists' {
        Mock Get-ConnectionInformation { [PSCustomObject]@{State='Connected';IsEopSession=$true;ModuleName='Purview'} }
        { Get-ExoAuditConfig } | Should -Throw '*Exchange Online connection*'
    }
    It 'reads the command from the identified Exchange module' -ForEach @($true,$false) {
        $script:auditValue=$_
        Mock Get-ConnectionInformation { [PSCustomObject]@{State='Connected';IsEopSession=$false;ModuleName='ExchangeFixture';ModulePrefix='Exo';ConnectionUri='https://outlook.office365.com'} }
        Mock Get-Command { { param($ErrorAction) [PSCustomObject]@{UnifiedAuditLogIngestionEnabled=$script:auditValue} } } -ParameterFilter { $Name -eq 'Get-ExoAdminAuditLogConfig' -and $Module -eq 'ExchangeFixture' }
        (Get-ExoAuditConfig).Enabled | Should -Be $_
        Should -Invoke Get-Command -Times 1 -Exactly -ParameterFilter { $Module -eq 'ExchangeFixture' }
    }
}
