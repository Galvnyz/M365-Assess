BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Test-PortConnectivity - successful connection' {
    BeforeAll {
        # Stub TcpClient to simulate a successful connection
        # The script uses New-Object System.Net.Sockets.TcpClient, so we intercept at the New-Object level
        Mock New-Object {
            param($TypeName)
            if ($TypeName -eq 'System.Net.Sockets.TcpClient') {
                $mockClient = [PSCustomObject]@{
                    Connected = $true
                }

                # Add a ConnectAsync method that returns a completed task
                $mockClient | Add-Member -MemberType ScriptMethod -Name ConnectAsync -Value {
                    param($host, $port)
                    # Return a completed task (Wait will return $true)
                    return [System.Threading.Tasks.Task]::FromResult($true)
                }

                # Add a Dispose method
                $mockClient | Add-Member -MemberType ScriptMethod -Name Dispose -Value { }

                return $mockClient
            }
        }

        $script:result = & "$PSScriptRoot/../../src/M365-Assess/Networking/Test-PortConnectivity.ps1" -ComputerName 'server01' -Port 443
    }

    It 'returns a result object' {
        $script:result | Should -Not -BeNullOrEmpty
    }

    It 'result has ComputerName property' {
        $script:result.PSObject.Properties.Name | Should -Contain 'ComputerName'
    }

    It 'result has Port property' {
        $script:result.PSObject.Properties.Name | Should -Contain 'Port'
    }

    It 'result has Status property' {
        $script:result.PSObject.Properties.Name | Should -Contain 'Status'
    }

    It 'result has Timestamp property' {
        $script:result.PSObject.Properties.Name | Should -Contain 'Timestamp'
    }

    It 'ComputerName matches the input' {
        $script:result.ComputerName | Should -Be 'server01'
    }

    It 'Port matches the input' {
        $script:result.Port | Should -Be 443
    }
}

Describe 'Test-PortConnectivity - failed connection' {
    BeforeAll {
        # Stub TcpClient to simulate a failed connection (throws on ConnectAsync)
        Mock New-Object {
            param($TypeName)
            if ($TypeName -eq 'System.Net.Sockets.TcpClient') {
                $mockClient = [PSCustomObject]@{
                    Connected = $false
                }

                $mockClient | Add-Member -MemberType ScriptMethod -Name ConnectAsync -Value {
                    param($host, $port)
                    throw [System.Net.Sockets.SocketException]::new()
                }

                $mockClient | Add-Member -MemberType ScriptMethod -Name Dispose -Value { }

                return $mockClient
            }
        }

        $script:failResult = & "$PSScriptRoot/../../src/M365-Assess/Networking/Test-PortConnectivity.ps1" -ComputerName 'unreachable-host' -Port 9999
    }

    It 'returns a result even when connection fails' {
        $script:failResult | Should -Not -BeNullOrEmpty
    }

    It 'Status is Closed when connection fails' {
        $script:failResult.Status | Should -Be 'Closed'
    }

    It 'does not throw when connection fails' {
        {
            & "$PSScriptRoot/../../src/M365-Assess/Networking/Test-PortConnectivity.ps1" -ComputerName 'unreachable-host' -Port 9999
        } | Should -Not -Throw
    }
}

Describe 'Test-PortConnectivity - multiple hosts and ports' {
    BeforeAll {
        Mock New-Object {
            param($TypeName)
            if ($TypeName -eq 'System.Net.Sockets.TcpClient') {
                $mockClient = [PSCustomObject]@{ Connected = $true }
                $mockClient | Add-Member -MemberType ScriptMethod -Name ConnectAsync -Value {
                    param($h, $p)
                    return [System.Threading.Tasks.Task]::FromResult($true)
                }
                $mockClient | Add-Member -MemberType ScriptMethod -Name Dispose -Value { }
                return $mockClient
            }
        }

        $script:multiResult = & "$PSScriptRoot/../../src/M365-Assess/Networking/Test-PortConnectivity.ps1" -ComputerName 'server01','server02' -Port 443,80
    }

    It 'returns one result per host per port combination' {
        # 2 hosts x 2 ports = 4 results
        @($script:multiResult).Count | Should -Be 4
    }

    It 'all results have required properties' {
        foreach ($r in @($script:multiResult)) {
            $r.PSObject.Properties.Name | Should -Contain 'ComputerName'
            $r.PSObject.Properties.Name | Should -Contain 'Port'
            $r.PSObject.Properties.Name | Should -Contain 'Status'
        }
    }
}
