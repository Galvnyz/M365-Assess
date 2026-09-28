$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../../src/M365-Assess/Common/Build-ReportData.ps1"
. "$PSScriptRoot/../../src/M365-Assess/Common/Get-ReportTemplate.ps1"
$values = @(
    '</script ><img id="injected-space">',
    '</ScRiPt/><img id="injected-slash">',
    "</script`t><img id=`"injected-tab`">",
    "</script`n><img id=`"injected-newline`">",
    '<!--<script></script><img id="injected-comment">',
    '</ScRiPt><script>window.injected = true</script>',
    'Ordinary text < 5 & "quotes" and literal \u003c'
)
$findings = for ($i = 0; $i -lt $values.Count; $i++) {
    [PSCustomObject]@{CheckId="CA-FIXTURE-00$i";Setting="Fixture $i";Status='Review';Section='Entra';CurrentValue=$values[$i]}
}
$assignment = Build-ReportDataJson -AllFindings $findings
$html = Get-ReportTemplate -ReportDataJson $assignment -ReportTitle 'Embedding fixture'
[PSCustomObject]@{html=$html;values=$values} | ConvertTo-Json -Depth 5 -Compress
