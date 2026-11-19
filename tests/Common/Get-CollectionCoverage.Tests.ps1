BeforeAll {
    function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
    . (Join-Path $PSScriptRoot '../../src/M365-Assess/Common/SecurityConfigHelper.ps1')
    . (Join-Path $PSScriptRoot '../../src/M365-Assess/Common/Get-CollectionCoverage.ps1')

    $script:baseParams = @{
        CheckId          = 'IOC-TEST-001'
        Category         = 'Test'
        Setting          = 'Test indicator'
        HitStatus        = 'Fail'
        Window           = 'current items'
        RecommendedValue = 'None'
        Remediation      = 'Investigate.'
    }
}

AfterAll {
    Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
}

Describe 'New-CollectionCoverage' {
    Context 'when every item was examined without error' {
        It 'should be complete' {
            (New-CollectionCoverage -Scope 'mailboxes' -Total 5 -Examined 5).Complete | Should -BeTrue
        }

        It 'should be complete for an empty set' {
            (New-CollectionCoverage -Scope 'mailboxes' -Total 0 -Examined 0).Complete | Should -BeTrue
        }
    }

    Context 'when coverage has gaps' {
        It 'should be incomplete when fewer items were examined than exist' {
            (New-CollectionCoverage -Scope 'mailboxes' -Total 5 -Examined 4).Complete | Should -BeFalse
        }

        It 'should be incomplete when an error was recorded even if counts match' {
            (New-CollectionCoverage -Scope 'mailboxes' -Total 0 -Examined 0 -Errors 'Could not list mailboxes').Complete | Should -BeFalse
        }

        It 'should ignore blank error entries' {
            (New-CollectionCoverage -Scope 'mailboxes' -Total 2 -Examined 2 -Errors @('', ' ')).Complete | Should -BeTrue
        }
    }
}

Describe 'Add-IndicatorSetting' {
    BeforeEach {
        $script:ctx = Initialize-SecurityConfig
    }

    Context 'when no indicators were found and coverage is complete' {
        BeforeEach {
            $coverage = New-CollectionCoverage -Scope 'mailboxes' -Total 3 -Examined 3
            Add-IndicatorSetting @script:baseParams -Coverage $coverage -Indicators @()
            $script:row = $script:ctx.Settings[0]
        }

        It 'should report Pass' {
            $script:row.Status | Should -Be 'Pass'
        }

        It 'should state how much was examined' {
            $script:row.CurrentValue | Should -Be 'No indicators found (examined 3 of 3 mailboxes, current items)'
        }

        It 'should say that a clean result is not proof' {
            $script:row.Remediation | Should -Match 'not proof'
        }
    }

    Context 'when no indicators were found but coverage is incomplete' {
        It 'should report Unknown, never Pass, for <Label>' -ForEach @(
            @{ Label = 'a failed listing';   Total = 0;  Examined = 0; Errors = @('Could not list mailboxes: Access denied') }
            @{ Label = 'a partial read';     Total = 10; Examined = 7; Errors = @('user@contoso.com: throttled') }
            @{ Label = 'a silent shortfall'; Total = 10; Examined = 9; Errors = @() }
        ) {
            $coverage = New-CollectionCoverage -Scope 'mailboxes' -Total $Total -Examined $Examined -Errors $Errors
            Add-IndicatorSetting @script:baseParams -Coverage $coverage -Indicators @()
            $script:ctx.Settings[0].Status | Should -Be 'Unknown'
            $script:ctx.Settings[0].CurrentValue | Should -Match '^Not evaluated'
            $script:ctx.Settings[0].Limitations | Should -Match 'Coverage incomplete'
        }

        It 'should carry the first error into Limitations' {
            $coverage = New-CollectionCoverage -Scope 'mailboxes' -Total 0 -Examined 0 -Errors 'Could not list mailboxes: Access denied'
            Add-IndicatorSetting @script:baseParams -Coverage $coverage
            $script:ctx.Settings[0].Limitations | Should -Match 'Access denied'
        }
    }

    Context 'when indicators were found' {
        BeforeEach {
            $script:hits = 1..60 | ForEach-Object {
                [PSCustomObject]@{ Time = ''; Actor = "user$_@contoso.com"; Target = 'rule'; Detail = 'forwards' }
            }
        }

        It 'should use the hit status' {
            $coverage = New-CollectionCoverage -Scope 'mailboxes' -Total 60 -Examined 60
            Add-IndicatorSetting @script:baseParams -Coverage $coverage -Indicators $script:hits
            $script:ctx.Settings[0].Status | Should -Be 'Fail'
            $script:ctx.Settings[0].CurrentValue | Should -Match '^60 indicator\(s\) found'
        }

        It 'should still report the hits when coverage is incomplete and say more may exist' {
            $coverage = New-CollectionCoverage -Scope 'mailboxes' -Total 80 -Examined 60 -Errors 'x: failed'
            Add-IndicatorSetting @script:baseParams -Coverage $coverage -Indicators $script:hits
            $script:ctx.Settings[0].Status | Should -Be 'Fail'
            $script:ctx.Settings[0].CurrentValue | Should -Match 'more may exist'
        }

        It 'should store at most MaxEvents events but keep the true total' {
            $coverage = New-CollectionCoverage -Scope 'mailboxes' -Total 60 -Examined 60
            Add-IndicatorSetting @script:baseParams -Coverage $coverage -Indicators $script:hits -MaxEvents 50
            $evidence = "$($script:ctx.Settings[0].Evidence)" | ConvertFrom-Json
            $evidence.total | Should -Be 60
            $evidence.shown | Should -Be 50
            @($evidence.events).Count | Should -Be 50
            $evidence.coverage.complete | Should -BeTrue
        }

        It 'should store evidence as a string so it survives a CSV round trip' {
            $coverage = New-CollectionCoverage -Scope 'mailboxes' -Total 60 -Examined 60
            Add-IndicatorSetting @script:baseParams -Coverage $coverage -Indicators $script:hits
            $csvPath = Join-Path $TestDrive 'roundtrip.csv'
            $script:ctx.Settings | Export-Csv -Path $csvPath -NoTypeInformation -Encoding UTF8
            $evidence = (Import-Csv -Path $csvPath)[0].Evidence | ConvertFrom-Json
            $evidence.events[0].Actor | Should -Be 'user1@contoso.com'
        }
    }
}
