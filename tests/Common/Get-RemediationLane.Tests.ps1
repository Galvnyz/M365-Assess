BeforeAll {
    . (Join-Path $PSScriptRoot '../../src/M365-Assess/Common/Get-RemediationLane.ps1')
}

Describe 'Get-RemediationLane' {

    Context 'Pass findings' {
        It 'returns empty string for any Pass finding regardless of severity' {
            Get-RemediationLane -Status 'Pass' -Severity 'critical' -Effort 'small' | Should -Be ''
            Get-RemediationLane -Status 'Pass' -Severity 'low'      -Effort 'large' | Should -Be ''
        }
    }

    Context 'Non-Fail status (Warning, Review, Info, Skipped)' {
        It 'maps critical-severity Warnings to now' {
            Get-RemediationLane -Status 'Warning' -Severity 'critical' -Effort 'medium' | Should -Be 'now'
        }
        It 'maps non-critical Warnings to later' {
            Get-RemediationLane -Status 'Warning' -Severity 'high'   -Effort 'small' | Should -Be 'later'
            Get-RemediationLane -Status 'Warning' -Severity 'medium' -Effort 'small' | Should -Be 'later'
        }
        It 'maps Review and Info similarly' {
            Get-RemediationLane -Status 'Review' -Severity 'critical' -Effort 'medium' | Should -Be 'now'
            Get-RemediationLane -Status 'Review' -Severity 'high'     -Effort 'medium' | Should -Be 'later'
            Get-RemediationLane -Status 'Info'   -Severity 'low'      -Effort 'small'  | Should -Be 'later'
        }
    }

    Context 'Fail findings -- severity + effort matrix' {
        It 'critical Fail -> now (regardless of effort)' {
            Get-RemediationLane -Status 'Fail' -Severity 'critical' -Effort 'small'  | Should -Be 'now'
            Get-RemediationLane -Status 'Fail' -Severity 'critical' -Effort 'medium' | Should -Be 'now'
            Get-RemediationLane -Status 'Fail' -Severity 'critical' -Effort 'large'  | Should -Be 'now'
        }
        It 'high Fail + small effort -> now (high-value quick win)' {
            Get-RemediationLane -Status 'Fail' -Severity 'high' -Effort 'small' | Should -Be 'now'
        }
        It 'high Fail + medium/large effort -> soon' {
            Get-RemediationLane -Status 'Fail' -Severity 'high' -Effort 'medium' | Should -Be 'soon'
            Get-RemediationLane -Status 'Fail' -Severity 'high' -Effort 'large'  | Should -Be 'soon'
        }
        It 'medium Fail + small/medium effort -> soon' {
            Get-RemediationLane -Status 'Fail' -Severity 'medium' -Effort 'small'  | Should -Be 'soon'
            Get-RemediationLane -Status 'Fail' -Severity 'medium' -Effort 'medium' | Should -Be 'soon'
        }
        It 'medium Fail + large effort -> later' {
            Get-RemediationLane -Status 'Fail' -Severity 'medium' -Effort 'large' | Should -Be 'later'
        }
        It 'low/info/none Fail -> later (regardless of effort)' {
            Get-RemediationLane -Status 'Fail' -Severity 'low'  -Effort 'small' | Should -Be 'later'
            Get-RemediationLane -Status 'Fail' -Severity 'info' -Effort 'small' | Should -Be 'later'
            Get-RemediationLane -Status 'Fail' -Severity 'none' -Effort 'small' | Should -Be 'later'
        }
    }

    Context 'Effort defaulting' {
        It "defaults Effort to 'medium' when omitted" {
            # high+medium -> soon (not now); confirms default is medium not small
            Get-RemediationLane -Status 'Fail' -Severity 'high' | Should -Be 'soon'
        }
        It "treats whitespace Effort as 'medium'" {
            Get-RemediationLane -Status 'Fail' -Severity 'medium' -Effort ' ' | Should -Be 'soon'
        }
    }

    Context 'Case insensitivity' {
        It 'normalizes severity casing' {
            Get-RemediationLane -Status 'Fail' -Severity 'CRITICAL' -Effort 'medium' | Should -Be 'now'
            Get-RemediationLane -Status 'Fail' -Severity 'High'     -Effort 'Small' | Should -Be 'now'
        }
    }
}
