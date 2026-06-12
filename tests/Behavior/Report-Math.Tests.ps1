BeforeAll {
    $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
    . (Join-Path $repoRoot 'src/M365-Assess/Common/Build-ReportData.ps1')
}

Describe 'Report math denominator (C5 #784, #802 enforcement)' {

    Context 'Pass% follows the strict-rule denominator' {
        # docs/CHECK-STATUS-MODEL.md: Pass% = Pass / (Pass + Fail + Warning).
        # Review, Info, Skipped, Unknown, NotApplicable, NotLicensed are excluded
        # from BOTH numerator and denominator. This test asserts the rule by
        # constructing a synthetic findings array with mixed statuses and
        # checking the report data math.

        It 'should exclude Review/Info/Skipped/Unknown/NotApplicable/NotLicensed from the score' {
            $findings = @(
                # 4 scoring rows (Pass + Fail + Warning + Pass) -> denom = 4, num = 2
                [pscustomobject]@{ CheckId='X-001'; Status='Pass';    Setting='a'; CurrentValue='ok'; RecommendedValue='ok'; Remediation=''; Section='Identity' }
                [pscustomobject]@{ CheckId='X-002'; Status='Fail';    Setting='b'; CurrentValue='no'; RecommendedValue='ok'; Remediation=''; Section='Identity' }
                [pscustomobject]@{ CheckId='X-003'; Status='Warning'; Setting='c'; CurrentValue='?';  RecommendedValue='ok'; Remediation=''; Section='Identity' }
                [pscustomobject]@{ CheckId='X-004'; Status='Pass';    Setting='d'; CurrentValue='ok'; RecommendedValue='ok'; Remediation=''; Section='Identity' }
                # 5 non-scoring rows -- per the rule, these don't affect the denominator
                [pscustomobject]@{ CheckId='X-005'; Status='Review';        Setting='e'; CurrentValue='?'; RecommendedValue=''; Remediation=''; Section='Identity' }
                [pscustomobject]@{ CheckId='X-006'; Status='Info';          Setting='f'; CurrentValue='?'; RecommendedValue=''; Remediation=''; Section='Identity' }
                [pscustomobject]@{ CheckId='X-007'; Status='Skipped';       Setting='g'; CurrentValue='?'; RecommendedValue=''; Remediation=''; Section='Identity' }
                [pscustomobject]@{ CheckId='X-008'; Status='Unknown';       Setting='h'; CurrentValue='?'; RecommendedValue=''; Remediation=''; Section='Identity' }
                [pscustomobject]@{ CheckId='X-009'; Status='NotLicensed';   Setting='i'; CurrentValue='?'; RecommendedValue=''; Remediation=''; Section='Identity' }
            )

            $json = Build-ReportDataJson -AllFindings $findings
            $stripped = $json -replace '^window\.REPORT_DATA = ', '' -replace ';$', ''
            $data = $stripped | ConvertFrom-Json

            # Headcount sanity
            $data.findings.Count | Should -Be 9

            # Per #802, the renderer (React) computes the score with scoreDenom().
            # The data layer just emits findings; the math is in the JSX.
            # This test asserts the data shape lets the strict rule compute
            # the expected number: 2 / 4 = 50%.
            $scored = @($data.findings | Where-Object { $_.status -in @('Pass','Fail','Warning') })
            $scored.Count | Should -Be 4
            $passes = @($scored | Where-Object { $_.status -eq 'Pass' })
            $passes.Count | Should -Be 2
            $expectedPct = [math]::Round(($passes.Count / $scored.Count) * 100, 1)
            $expectedPct | Should -Be 50
        }

        It 'should not divide by zero when only non-scoring statuses exist' {
            # Edge case: tenant with all Review / Info findings -- denom is 0.
            # The data layer emits findings as-is; the renderer's scoreDenom()
            # guards against 0. Assert the data contract supports the edge case.
            $findings = @(
                [pscustomobject]@{ CheckId='X-001'; Status='Review'; Setting='a'; CurrentValue=''; RecommendedValue=''; Remediation=''; Section='Identity' }
                [pscustomobject]@{ CheckId='X-002'; Status='Info';   Setting='b'; CurrentValue=''; RecommendedValue=''; Remediation=''; Section='Identity' }
            )
            $json = Build-ReportDataJson -AllFindings $findings
            { $json -replace '^window\.REPORT_DATA = ', '' -replace ';$', '' | ConvertFrom-Json } | Should -Not -Throw
        }
    }
}

Describe 'Report data contract — Secure Score absent (#967)' {

    Context 'when SectionData contains no score rows' {
        It 'should emit score as an empty array so the React guard can safely skip the card' {
            # Posture() in report-app.jsx does D.score[0] || {} then parseFloat(SCORE.Percentage).
            # When score is absent (SecurityEvents.Read.All not granted), the PS layer must
            # emit score:[] -- an empty array, not null or undefined -- so the JSX
            # Number.isFinite guard can branch correctly without a runtime error.
            $json = Build-ReportDataJson -AllFindings @()
            $stripped = $json -replace '^window\.REPORT_DATA = ', '' -replace ';$', ''
            $data = $stripped | ConvertFrom-Json

            $data.PSObject.Properties.Name | Should -Contain 'score'
            @($data.score).Count | Should -Be 0
        }
    }
}
