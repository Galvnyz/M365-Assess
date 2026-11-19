BeforeAll {
    . (Join-Path $PSScriptRoot '../../src/M365-Assess/Common/ConvertTo-SafeCellValue.ps1')
}

Describe 'ConvertTo-SafeCellValue' {
    Context 'when the value could be evaluated by a spreadsheet (CSV mode)' {
        It 'should prefix an apostrophe to <Label>' -ForEach @(
            @{ Label = 'equals';          Value = '=HYPERLINK("https://example.test","x")' }
            @{ Label = 'plus';            Value = '+cmd' }
            @{ Label = 'minus';           Value = '-2+3' }
            @{ Label = 'at sign';         Value = '@SUM(A1)' }
            @{ Label = 'tab';             Value = "`t=1+1" }
            @{ Label = 'carriage return'; Value = "`r=1+1" }
        ) {
            ConvertTo-SafeCellValue -Value $Value | Should -BeExactly ("'" + $Value)
        }
    }

    Context 'when the value is ordinary text' {
        It 'should return <Label> unchanged' -ForEach @(
            @{ Label = 'plain text';        Value = 'Finance Team' }
            @{ Label = 'mid-string equals'; Value = 'a=b' }
            @{ Label = 'empty string';      Value = '' }
        ) {
            ConvertTo-SafeCellValue -Value $Value | Should -BeExactly $Value
        }

        It 'should return null unchanged' {
            ConvertTo-SafeCellValue -Value $null | Should -BeNullOrEmpty
        }
    }

    Context 'when -FormulaLeadOnly is used (XLSX mode)' {
        It 'should neutralise a leading equals sign' {
            ConvertTo-SafeCellValue -Value '=1+1' -FormulaLeadOnly | Should -BeExactly "'=1+1"
        }

        It 'should leave <Label> readable' -ForEach @(
            @{ Label = 'a negative number'; Value = '-1' }
            @{ Label = 'a phone number';    Value = '+1 555 0100' }
            @{ Label = 'a mention';         Value = '@everyone' }
        ) {
            ConvertTo-SafeCellValue -Value $Value -FormulaLeadOnly | Should -BeExactly $Value
        }
    }
}

Describe 'ConvertTo-SafeCellObject' {
    Context 'when rows contain a mix of property types' {
        BeforeAll {
            $script:row = [PSCustomObject][ordered]@{
                Setting      = '=HYPERLINK("https://example.test","Click")'
                CurrentValue = 'Enabled'
                Count        = 3
                When         = [datetime]'2026-01-01'
            }
            $script:safe = $script:row | ConvertTo-SafeCellObject -FormulaLeadOnly
        }

        It 'should neutralise string properties' {
            $script:safe.Setting | Should -BeExactly "'=HYPERLINK(`"https://example.test`",`"Click`")"
        }

        It 'should keep non-string properties typed' {
            $script:safe.Count | Should -BeOfType [int]
            $script:safe.When | Should -BeOfType [datetime]
        }

        It 'should preserve property order' {
            @($script:safe.PSObject.Properties.Name) | Should -Be @('Setting', 'CurrentValue', 'Count', 'When')
        }

        It 'should not modify the original object' {
            $script:row.Setting | Should -BeLike '=HYPERLINK*'
        }
    }

    Context 'when the pipeline contains null' {
        It 'should emit nothing for the null entry' {
            @(@($null, [PSCustomObject]@{ A = 'x' }) | ConvertTo-SafeCellObject).Count | Should -Be 1
        }
    }
}
