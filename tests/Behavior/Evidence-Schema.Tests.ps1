# tests/Behavior/Evidence-Schema.Tests.ps1 -- D1 #785
#
# Static regression guard: asserts the helper's output contract still includes
# the eight structured evidence fields. If a refactor accidentally drops one,
# the report appendix and XLSX evidence sheet would silently lose data -- this
# test catches it before merge.

BeforeAll {
    . (Join-Path $PSScriptRoot '../../src/M365-Assess/Common/SecurityConfigHelper.ps1')

    # Authoritative list -- update if the schema changes (and update docs/EVIDENCE-MODEL.md).
    $script:evidenceFields = @(
        'ObservedValue', 'ExpectedValue', 'EvidenceSource', 'EvidenceTimestamp',
        'CollectionMethod', 'PermissionRequired', 'Confidence', 'Limitations'
    )
}

Describe 'Evidence schema contract (D1 #785)' {

    Context 'Add-SecuritySetting output PSCustomObject' {
        It 'includes every field declared in the evidence schema' {
            $ctx = Initialize-SecurityConfig
            Add-SecuritySetting -Settings $ctx.Settings -CheckIdCounter $ctx.CheckIdCounter `
                -Category 'Test' -Setting 'schema regression' -CurrentValue 'x' `
                -RecommendedValue 'y' -Status 'Pass' -CheckId 'TEST-001'
            $row = $ctx.Settings[0]
            foreach ($field in $script:evidenceFields) {
                $row.PSObject.Properties[$field] | Should -Not -BeNullOrEmpty -Because "field '$field' must remain on the helper output (docs/EVIDENCE-MODEL.md)"
            }
        }

        It 'preserves the legacy free-form Evidence parameter alongside the structured fields' {
            # Backwards-compat: collectors that pre-date the schema still emit Evidence.
            $ctx = Initialize-SecurityConfig
            Add-SecuritySetting -Settings $ctx.Settings -CheckIdCounter $ctx.CheckIdCounter `
                -Category 'Test' -Setting 'legacy blob' -CurrentValue 'x' `
                -RecommendedValue 'y' -Status 'Pass' -CheckId 'TEST-001' `
                -Evidence ([PSCustomObject]@{ legacy = $true })
            $ctx.Settings[0].Evidence.legacy | Should -BeTrue
        }
    }

    Context 'Build-ReportData output' {
        BeforeAll {
            . (Join-Path $PSScriptRoot '../../src/M365-Assess/Common/Build-ReportData.ps1')
        }

        It 'omits the evidence object entirely when no field is populated' {
            $finding = [PSCustomObject]@{
                CheckId          = 'TEST-001.1'
                Category         = 'Test'
                Setting          = 'no evidence'
                CurrentValue     = 'x'
                RecommendedValue = 'y'
                Status           = 'Pass'
                Remediation      = ''
                Section          = 'Test'
            }
            $json = Build-ReportDataJson -AllFindings @($finding)
            $payload = $json -replace '^window\.REPORT_DATA\s*=\s*' -replace ';\s*$'
            $data = $payload | ConvertFrom-Json
            $data.findings[0].evidence | Should -BeNullOrEmpty
        }

        It 'emits a structured object when at least one field is populated' {
            $finding = [PSCustomObject]@{
                CheckId            = 'TEST-001.1'
                Category           = 'Test'
                Setting            = 'with evidence'
                CurrentValue       = 'x'
                RecommendedValue   = 'y'
                Status             = 'Pass'
                Remediation        = ''
                Section            = 'Test'
                EvidenceSource     = '/test/endpoint'
                PermissionRequired = 'Test.Read.All'
                Confidence         = 1.0
            }
            $json = Build-ReportDataJson -AllFindings @($finding)
            $payload = $json -replace '^window\.REPORT_DATA\s*=\s*' -replace ';\s*$'
            $data = $payload | ConvertFrom-Json
            $data.findings[0].evidence                    | Should -Not -BeNullOrEmpty
            $data.findings[0].evidence.evidenceSource     | Should -Be '/test/endpoint'
            $data.findings[0].evidence.permissionRequired | Should -Be 'Test.Read.All'
            $data.findings[0].evidence.confidence         | Should -Be 1.0
        }
    }
}
