BeforeAll {
    . "$PSScriptRoot/../../src/M365-Assess/Common/ReportHelpers.ps1"
}

Describe 'ConvertTo-HtmlSafe' {
    It 'should escape ampersand' {
        ConvertTo-HtmlSafe -Text 'a & b' | Should -Be 'a &amp; b'
    }

    It 'should escape less-than' {
        ConvertTo-HtmlSafe -Text '<script>' | Should -Be '&lt;script&gt;'
    }

    It 'should escape double-quote' {
        ConvertTo-HtmlSafe -Text '"value"' | Should -Be '&quot;value&quot;'
    }

    It 'should escape multiple special characters in one string' {
        ConvertTo-HtmlSafe -Text '<a href="test&value">' | Should -Be '&lt;a href=&quot;test&amp;value&quot;&gt;'
    }

    It 'should return empty string for null input' {
        ConvertTo-HtmlSafe -Text $null | Should -Be ''
    }

    It 'should return empty string for empty string input' {
        ConvertTo-HtmlSafe -Text '' | Should -Be ''
    }

    It 'should leave safe characters unchanged' {
        ConvertTo-HtmlSafe -Text 'Hello World 123' | Should -Be 'Hello World 123'
    }
}

Describe 'Get-StatusBadge' {
    It 'should return Complete badge with correct class' {
        $result = Get-StatusBadge -Status 'Complete'
        $result | Should -Match 'badge-complete'
        $result | Should -Match 'Complete'
    }

    It 'should return Skipped badge with correct class' {
        $result = Get-StatusBadge -Status 'Skipped'
        $result | Should -Match 'badge-skipped'
        $result | Should -Match 'Skipped'
    }

    It 'should return Failed badge with correct class' {
        $result = Get-StatusBadge -Status 'Failed'
        $result | Should -Match 'badge-failed'
        $result | Should -Match 'Failed'
    }

    It 'should return generic badge for unknown status' {
        $result = Get-StatusBadge -Status 'Unknown'
        $result | Should -Match 'badge'
        $result | Should -Match 'Unknown'
    }

    It 'should wrap status in a span element' {
        $result = Get-StatusBadge -Status 'Complete'
        $result | Should -Match '<span'
        $result | Should -Match '</span>'
    }
}

Describe 'Format-ColumnHeader' {
    It 'should insert space between camelCase words' {
        Format-ColumnHeader -Name 'createdDate' | Should -Be 'created Date'
    }

    It 'should handle consecutive uppercase acronyms' {
        Format-ColumnHeader -Name 'MFAStatus' | Should -Be 'MFA Status'
    }

    It 'should return the name unchanged when no camelCase pattern' {
        Format-ColumnHeader -Name 'Status' | Should -Be 'Status'
    }

    It 'should return null/empty input unchanged' {
        Format-ColumnHeader -Name '' | Should -BeNullOrEmpty
    }

    It 'should handle names with digits' {
        # e.g. "checkId1Name" -> "check Id1 Name"  (digit before uppercase)
        $result = Format-ColumnHeader -Name 'check1Name'
        $result | Should -Match 'Name'
    }
}

Describe 'Get-SeverityBadge' {
    It 'should return ERROR badge with failed class' {
        $result = Get-SeverityBadge -Severity 'ERROR'
        $result | Should -Match 'badge-failed'
        $result | Should -Match 'ERROR'
    }

    It 'should return WARNING badge with warning class' {
        $result = Get-SeverityBadge -Severity 'WARNING'
        $result | Should -Match 'badge-warning'
        $result | Should -Match 'WARNING'
    }

    It 'should return INFO badge with info class' {
        $result = Get-SeverityBadge -Severity 'INFO'
        $result | Should -Match 'badge-info'
        $result | Should -Match 'INFO'
    }

    It 'should return generic badge for unknown severity' {
        $result = Get-SeverityBadge -Severity 'CRITICAL'
        $result | Should -Match 'badge'
        $result | Should -Match 'CRITICAL'
    }
}

Describe 'Get-SvgDonut' {
    It 'should return a string containing svg element' {
        $result = Get-SvgDonut -Percentage 75
        $result | Should -Match '<svg'
    }

    It 'should return a string containing circle elements' {
        $result = Get-SvgDonut -Percentage 75
        $result | Should -Match '<circle'
    }

    It 'should include the percentage label in the output' {
        $result = Get-SvgDonut -Percentage 80
        $result | Should -Match '80%'
    }

    It 'should accept a custom label and use it instead of percentage' {
        $result = Get-SvgDonut -Percentage 50 -Label 'Custom'
        $result | Should -Match 'Custom'
        $result | Should -Not -Match '50%'
    }

    It 'should handle 0 percent without error' {
        { Get-SvgDonut -Percentage 0 } | Should -Not -Throw
    }

    It 'should handle 100 percent without error' {
        { Get-SvgDonut -Percentage 100 } | Should -Not -Throw
    }
}

Describe 'Get-SvgMultiDonut' {
    BeforeAll {
        $segments = @(
            @{ Pct = 60; Css = 'success' }
            @{ Pct = 25; Css = 'danger' }
            @{ Pct = 15; Css = 'warning' }
        )
    }

    It 'should return a string containing svg element' {
        $result = Get-SvgMultiDonut -Segments $segments
        $result | Should -Match '<svg'
    }

    It 'should return a string containing circle elements' {
        $result = Get-SvgMultiDonut -Segments $segments
        $result | Should -Match '<circle'
    }

    It 'should include center label in output' {
        $result = Get-SvgMultiDonut -Segments $segments -CenterLabel '60%'
        $result | Should -Match '60%'
    }

    It 'should handle empty segments without error' {
        { Get-SvgMultiDonut -Segments @() } | Should -Not -Throw
    }
}

Describe 'Get-SvgHorizontalBar' {
    BeforeAll {
        $segments = @(
            @{ Pct = 60; Css = 'success'; Label = 'Pass'; Count = 12 }
            @{ Pct = 40; Css = 'danger'; Label = 'Fail'; Count = 8 }
        )
    }

    It 'should return HTML containing hbar-chart div' {
        $result = Get-SvgHorizontalBar -Segments $segments
        $result | Should -Match 'hbar-chart'
    }

    It 'should include segment divs for non-zero segments' {
        $result = Get-SvgHorizontalBar -Segments $segments
        $result | Should -Match 'hbar-segment'
    }

    It 'should not render segments with 0 percent' {
        $zeroSeg = @(
            @{ Pct = 0; Css = 'success'; Label = 'Pass'; Count = 0 }
            @{ Pct = 100; Css = 'danger'; Label = 'Fail'; Count = 10 }
        )
        $result = Get-SvgHorizontalBar -Segments $zeroSeg
        # Only one segment should render
        ($result | Select-String -Pattern 'hbar-segment' -AllMatches).Matches.Count | Should -Be 1
    }

    It 'should include count values in output' {
        $result = Get-SvgHorizontalBar -Segments $segments
        $result | Should -Match '12'
        $result | Should -Match '8'
    }
}

Describe 'Get-SvgStackedBar' {
    BeforeAll {
        $rows = @(
            @{ Label = 'Identity'; Pass = 45; Fail = 3; Warning = 5; Review = 2; Total = 55 }
            @{ Label = 'Email'; Pass = 20; Fail = 2; Warning = 3; Review = 1; Total = 26 }
        )
    }

    It 'should return a string containing svg element' {
        $result = Get-SvgStackedBar -Rows $rows
        $result | Should -Match '<svg'
    }

    It 'should include row labels in the output' {
        $result = Get-SvgStackedBar -Rows $rows
        $result | Should -Match 'Identity'
        $result | Should -Match 'Email'
    }

    It 'should include closing svg tag' {
        $result = Get-SvgStackedBar -Rows $rows
        $result | Should -Match '</svg>'
    }

    It 'should handle a row with zero total without error' {
        $emptyRow = @(@{ Label = 'Empty'; Pass = 0; Fail = 0; Warning = 0; Review = 0; Total = 0 })
        { Get-SvgStackedBar -Rows $emptyRow } | Should -Not -Throw
    }
}

Describe 'Get-SmartSortedData' {
    It 'should return data unchanged when only one item' {
        $data = @([PSCustomObject]@{ Status = 'Pass'; CheckId = 'X'; Category = 'A'; Setting = 'B' })
        $result = Get-SmartSortedData -Data $data
        $result | Should -Not -BeNullOrEmpty
    }

    It 'should return null/empty input as-is' {
        $result = Get-SmartSortedData -Data @()
        ($null -eq $result -or @($result).Count -eq 0) | Should -Be $true
    }

    It 'should sort SecurityConfig data with Fail before Pass' {
        $data = @(
            [PSCustomObject]@{ Status = 'Pass'; CheckId = 'A'; Category = 'Cat'; Setting = 'S1' }
            [PSCustomObject]@{ Status = 'Fail'; CheckId = 'B'; Category = 'Cat'; Setting = 'S2' }
            [PSCustomObject]@{ Status = 'Warning'; CheckId = 'C'; Category = 'Cat'; Setting = 'S3' }
        )
        $result = @(Get-SmartSortedData -Data $data)
        $result[0].Status | Should -Be 'Fail'
    }

    It 'should return an array type' {
        $data = @(
            [PSCustomObject]@{ Status = 'Pass'; CheckId = 'A'; Category = 'Cat'; Setting = 'S1' }
            [PSCustomObject]@{ Status = 'Fail'; CheckId = 'B'; Category = 'Cat'; Setting = 'S2' }
        )
        $result = Get-SmartSortedData -Data $data
        $result | Should -Not -BeNullOrEmpty
        @($result).GetType().IsArray -or $result -is [System.Collections.IEnumerable] | Should -Be $true
    }

    It 'should sort Warning before Pass in SecurityConfig data' {
        $data = @(
            [PSCustomObject]@{ Status = 'Pass'; CheckId = 'A'; Category = 'Cat'; Setting = 'S1' }
            [PSCustomObject]@{ Status = 'Warning'; CheckId = 'B'; Category = 'Cat'; Setting = 'S2' }
        )
        $result = @(Get-SmartSortedData -Data $data)
        $result[0].Status | Should -Be 'Warning'
    }
}
