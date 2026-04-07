BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-LocalAdmins - local computer' {
    BeforeAll {
        function global:Write-AssessmentLog { param($Message, $Level) }

        Mock Get-LocalGroupMember {
            return @(
                [PSCustomObject]@{
                    Name            = 'TESTPC\Administrator'
                    ObjectClass     = 'User'
                    PrincipalSource = 'Local'
                }
                [PSCustomObject]@{
                    Name            = 'TESTPC\LocalAdmin'
                    ObjectClass     = 'User'
                    PrincipalSource = 'Local'
                }
                [PSCustomObject]@{
                    Name            = 'CONTOSO\Domain Admins'
                    ObjectClass     = 'Group'
                    PrincipalSource = 'ActiveDirectory'
                }
            )
        }

        # Run as local computer by setting ComputerName to match COMPUTERNAME env var
        $script:result = & "$PSScriptRoot/../../src/M365-Assess/Security/Get-LocalAdmins.ps1" -ComputerName $env:COMPUTERNAME
    }

    It 'returns a non-empty array of member objects' {
        @($script:result).Count | Should -BeGreaterThan 0
    }

    It 'all results have a ComputerName property' {
        foreach ($m in @($script:result)) {
            $m.PSObject.Properties.Name | Should -Contain 'ComputerName'
        }
    }

    It 'all results have a Name property' {
        foreach ($m in @($script:result)) {
            $m.PSObject.Properties.Name | Should -Contain 'Name'
        }
    }

    It 'all results have an ObjectClass property' {
        foreach ($m in @($script:result)) {
            $m.PSObject.Properties.Name | Should -Contain 'ObjectClass'
        }
    }

    It 'all results have a PrincipalSource property' {
        foreach ($m in @($script:result)) {
            $m.PSObject.Properties.Name | Should -Contain 'PrincipalSource'
        }
    }

    It 'returns members matching the mocked group' {
        @($script:result).Count | Should -Be 3
    }

    It 'ComputerName is set on each result' {
        foreach ($m in @($script:result)) {
            $m.ComputerName | Should -Not -BeNullOrEmpty
        }
    }

    AfterAll {
        Remove-Item Function:\Write-AssessmentLog -ErrorAction SilentlyContinue
    }
}

Describe 'Get-LocalAdmins - unreachable computer' {
    BeforeAll {
        function global:Write-AssessmentLog { param($Message, $Level) }

        # Override New-CimSession and Get-CimInstance globally so the remote path fails gracefully
        function global:New-CimSession {
            param($ComputerName, $Credential)
            throw [System.Exception]::new("Cannot connect to $ComputerName")
        }

        function global:Get-CimInstance {
            param($Query, $ComputerName, $CimSession, $ErrorAction)
            throw [System.Exception]::new('CIM connection failed')
        }

        $script:errorResult = & "$PSScriptRoot/../../src/M365-Assess/Security/Get-LocalAdmins.ps1" -ComputerName 'UNREACHABLE' -WarningAction SilentlyContinue
    }

    It 'does not throw for unreachable computers' {
        {
            & "$PSScriptRoot/../../src/M365-Assess/Security/Get-LocalAdmins.ps1" -ComputerName 'UNREACHABLE' -WarningAction SilentlyContinue
        } | Should -Not -Throw
    }

    It 'returns an error entry for the unreachable computer' {
        @($script:errorResult).Count | Should -BeGreaterOrEqual 1
        $errorEntry = @($script:errorResult) | Where-Object { $_.ObjectClass -eq 'Error' }
        $errorEntry | Should -Not -BeNullOrEmpty
    }

    AfterAll {
        Remove-Item Function:\Write-AssessmentLog -ErrorAction SilentlyContinue
        Remove-Item Function:\New-CimSession -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-CimInstance -ErrorAction SilentlyContinue
    }
}
