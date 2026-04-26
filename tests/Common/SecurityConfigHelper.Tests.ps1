BeforeAll {
    . "$PSScriptRoot/../../src/M365-Assess/Common/SecurityConfigHelper.ps1"
}

Describe 'Add-SecuritySetting - remediation fallback' {
    BeforeEach {
        $ctx = Initialize-SecurityConfig
        $global:M365AssessRegistry = @{
            'ENTRA-MFA-001' = [PSCustomObject]@{ remediation = 'Registry remediation text' }
        }
    }
    AfterEach {
        Remove-Variable -Name M365AssessRegistry -Scope Global -ErrorAction SilentlyContinue
    }

    It 'Uses hardcoded Remediation when provided' {
        Add-SecuritySetting -Settings $ctx.Settings -CheckIdCounter $ctx.CheckIdCounter `
            -Category 'MFA' -Setting 'MFA Policy' -CurrentValue 'Enabled' `
            -RecommendedValue 'Enabled' -Status 'Pass' `
            -CheckId 'ENTRA-MFA-001' -Remediation 'Hardcoded text'
        $ctx.Settings[0].Remediation | Should -Be 'Hardcoded text'
    }

    It 'Falls back to registry remediation when Remediation param is empty' {
        Add-SecuritySetting -Settings $ctx.Settings -CheckIdCounter $ctx.CheckIdCounter `
            -Category 'MFA' -Setting 'MFA Policy' -CurrentValue 'Enabled' `
            -RecommendedValue 'Enabled' -Status 'Pass' `
            -CheckId 'ENTRA-MFA-001' -Remediation ''
        $ctx.Settings[0].Remediation | Should -Be 'Registry remediation text'
    }

    It 'Leaves Remediation empty when param is empty and CheckId has no registry entry' {
        Add-SecuritySetting -Settings $ctx.Settings -CheckIdCounter $ctx.CheckIdCounter `
            -Category 'MFA' -Setting 'Unknown Check' -CurrentValue 'x' `
            -RecommendedValue 'x' -Status 'Info' `
            -CheckId 'UNKNOWN-001' -Remediation ''
        $ctx.Settings[0].Remediation | Should -Be ''
    }
}

Describe 'Add-SecuritySetting - status taxonomy (#774)' {
    BeforeEach {
        $ctx = Initialize-SecurityConfig
    }

    It 'Accepts <Status> as a valid status value' -ForEach @(
        @{ Status = 'Pass' }
        @{ Status = 'Fail' }
        @{ Status = 'Warning' }
        @{ Status = 'Review' }
        @{ Status = 'Info' }
        @{ Status = 'Skipped' }
        @{ Status = 'Unknown' }
        @{ Status = 'NotApplicable' }
        @{ Status = 'NotLicensed' }
    ) {
        {
            Add-SecuritySetting -Settings $ctx.Settings -CheckIdCounter $ctx.CheckIdCounter `
                -Category 'Test' -Setting "Status $Status" -CurrentValue 'x' `
                -RecommendedValue 'y' -Status $Status -CheckId 'TEST-001'
        } | Should -Not -Throw

        $ctx.Settings[-1].Status | Should -Be $Status
    }

    It 'Rejects an invalid status value' {
        {
            Add-SecuritySetting -Settings $ctx.Settings -CheckIdCounter $ctx.CheckIdCounter `
                -Category 'Test' -Setting 'Invalid' -CurrentValue 'x' `
                -RecommendedValue 'y' -Status 'BananaPancakes' -CheckId 'TEST-001'
        } | Should -Throw -ExpectedMessage '*BananaPancakes*'
    }
}

Describe 'Add-SecuritySetting - structured evidence schema (D1 #785)' {
    BeforeEach {
        $ctx = Initialize-SecurityConfig
    }

    It 'Defaults all 8 evidence fields to empty/null when omitted' {
        Add-SecuritySetting -Settings $ctx.Settings -CheckIdCounter $ctx.CheckIdCounter `
            -Category 'Test' -Setting 'no evidence' -CurrentValue 'x' `
            -RecommendedValue 'y' -Status 'Pass' -CheckId 'TEST-001'
        $row = $ctx.Settings[0]
        $row.ObservedValue      | Should -Be ''
        $row.ExpectedValue      | Should -Be ''
        $row.EvidenceSource     | Should -Be ''
        $row.EvidenceTimestamp  | Should -Be ''
        $row.CollectionMethod   | Should -Be ''
        $row.PermissionRequired | Should -Be ''
        $row.Confidence         | Should -BeNullOrEmpty
        $row.Limitations        | Should -Be ''
    }

    It 'Round-trips populated evidence fields onto the output PSCustomObject' {
        Add-SecuritySetting -Settings $ctx.Settings -CheckIdCounter $ctx.CheckIdCounter `
            -Category 'Test' -Setting 'with evidence' -CurrentValue 'x' `
            -RecommendedValue 'y' -Status 'Pass' -CheckId 'TEST-001' `
            -ObservedValue 'true' -ExpectedValue 'true' `
            -EvidenceSource '/test/endpoint' -EvidenceTimestamp '2026-04-26T10:00:00Z' `
            -CollectionMethod 'Direct' -PermissionRequired 'Test.Read.All' `
            -Confidence 0.95 -Limitations 'tested in lab tenant only'
        $row = $ctx.Settings[0]
        $row.ObservedValue      | Should -Be 'true'
        $row.ExpectedValue      | Should -Be 'true'
        $row.EvidenceSource     | Should -Be '/test/endpoint'
        $row.EvidenceTimestamp  | Should -Be '2026-04-26T10:00:00Z'
        $row.CollectionMethod   | Should -Be 'Direct'
        $row.PermissionRequired | Should -Be 'Test.Read.All'
        $row.Confidence         | Should -Be 0.95
        $row.Limitations        | Should -Be 'tested in lab tenant only'
    }

    It 'Rejects CollectionMethod values outside the controlled vocabulary' {
        {
            Add-SecuritySetting -Settings $ctx.Settings -CheckIdCounter $ctx.CheckIdCounter `
                -Category 'Test' -Setting 'bad method' -CurrentValue 'x' `
                -RecommendedValue 'y' -Status 'Pass' -CheckId 'TEST-001' `
                -CollectionMethod 'Hallucinated'
        } | Should -Throw
    }

    It 'Rejects Confidence outside the [0.0, 1.0] range' {
        {
            Add-SecuritySetting -Settings $ctx.Settings -CheckIdCounter $ctx.CheckIdCounter `
                -Category 'Test' -Setting 'bad confidence' -CurrentValue 'x' `
                -RecommendedValue 'y' -Status 'Pass' -CheckId 'TEST-001' `
                -Confidence 1.5
        } | Should -Throw
    }

    It 'Accepts the legacy Evidence blob alongside structured fields' {
        Add-SecuritySetting -Settings $ctx.Settings -CheckIdCounter $ctx.CheckIdCounter `
            -Category 'Test' -Setting 'mixed' -CurrentValue 'x' `
            -RecommendedValue 'y' -Status 'Pass' -CheckId 'TEST-001' `
            -Evidence ([PSCustomObject]@{ rawCount = 7 }) -ObservedValue '7'
        $ctx.Settings[0].Evidence.rawCount | Should -Be 7
        $ctx.Settings[0].ObservedValue     | Should -Be '7'
    }
}
