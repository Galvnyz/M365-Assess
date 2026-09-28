$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../../src/M365-Assess/Common/Build-ReportData.ps1"
$findings = @(
    [PSCustomObject]@{ CheckId='CA-TEST-001.1'; Setting='Manual evidence'; Category='Identity'; Status='Review'; Section='Entra'; CurrentValue='Unverified'; RecommendedValue='Verified'; Remediation='Review evidence'; RiskSeverity='high'; Frameworks=@{ 'cis-m365-v6'=@{controlId='1.1';profiles=@('E3')} } },
    [PSCustomObject]@{ CheckId='CA-TEST-002.1'; Setting='Automated failure'; Category='Identity'; Status='Fail'; Section='Entra'; CurrentValue='False'; RecommendedValue='True'; Remediation='Enable protection'; RiskSeverity='critical'; Frameworks=@{ 'cis-m365-v6'=@{controlId='1.2';profiles=@()} } }
)
$script = Build-ReportDataJson -AllFindings $findings -SectionData @{tenant=@([PSCustomObject]@{TenantId='11111111-1111-1111-1111-111111111111';OrgDisplayName='Fixture';DefaultDomain='example.test'})}
$script.Substring('window.REPORT_DATA = '.Length).TrimEnd(';')
