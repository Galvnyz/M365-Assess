BeforeAll {
    $common = [System.IO.Path]::GetFullPath("$PSScriptRoot/../../src/M365-Assess/Common")
    . (Join-Path -Path $common -ChildPath 'Export-AssessmentBridgeJson.ps1')
    $script:schemaPath = Join-Path -Path $common -ChildPath '../schemas/assessment-bridge.schema.json'

    function New-Row {
        param([hashtable]$Extra = @{})
        $row = [ordered]@{
            CheckId = 'ENTRA-DEVICE-002.1'; Status = 'Fail'; CurrentValue = '50'
            RiskSeverity = 'high'; Remediation = 'Set the limit to 15 or fewer.'
        }
        foreach ($key in $Extra.Keys) { $row[$key] = $Extra[$key] }
        [PSCustomObject]$row
    }

    function Export-Rows {
        param([object[]]$Rows, [string[]]$Sensitive = @())
        $path = Join-Path -Path $TestDrive -ChildPath "bridge-$([guid]::NewGuid()).json"
        $null = Export-AssessmentBridgeJson -AllFindings $Rows -TenantId 'fixture' -OutputPath $path -SensitiveCheckIds $Sensitive
        Get-Content -Path $path -Raw
    }
}

Describe 'Export-AssessmentBridgeJson - setting and recommendedValue fields' {
    It 'writes the setting name and recommended value alongside the current value' {
        $json = Export-Rows -Rows @(New-Row -Extra @{ Setting = 'Maximum Devices Per User'; RecommendedValue = '15 or fewer' })
        $finding = ($json | ConvertFrom-Json).findings[0]
        $finding.setting | Should -Be 'Maximum Devices Per User'
        $finding.recommendedValue | Should -Be '15 or fewer'
        $finding.currentValue | Should -Be '50'
        Test-Json -Json $json -SchemaFile $script:schemaPath | Should -BeTrue
    }

    It 'writes nulls and stays schema-valid when the row lacks both fields' {
        $json = Export-Rows -Rows @(New-Row)
        $finding = ($json | ConvertFrom-Json).findings[0]
        $finding.setting | Should -BeNullOrEmpty
        $finding.recommendedValue | Should -BeNullOrEmpty
        Test-Json -Json $json -SchemaFile $script:schemaPath | Should -BeTrue
    }

    It 'keeps the recommended value when the current value is redacted' {
        $json = Export-Rows -Rows @(New-Row -Extra @{ Setting = 'Maximum Devices Per User'; RecommendedValue = '15 or fewer' }) -Sensitive @('ENTRA-*')
        $finding = ($json | ConvertFrom-Json).findings[0]
        $finding.currentValue | Should -Be '[REDACTED]'
        $finding.recommendedValue | Should -Be '15 or fewer'
    }
}
