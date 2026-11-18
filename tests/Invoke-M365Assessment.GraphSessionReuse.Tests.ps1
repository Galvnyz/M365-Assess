BeforeAll {
    $script:scriptPath = [System.IO.Path]::GetFullPath("$PSScriptRoot/../src/M365-Assess/Invoke-M365Assessment.ps1")
    $script:ast = [System.Management.Automation.Language.Parser]::ParseFile(
        $script:scriptPath, [ref]$null, [ref]$null
    )
    $script:params = $script:ast.FindAll(
        { param($node) $node -is [System.Management.Automation.Language.ParameterAst] },
        $true
    )
}

Describe 'Invoke-M365Assessment - Graph session reuse parameters' {
    It 'declares -AdditionalGraphScopes as [string[]]' {
        $param = $script:params | Where-Object { $_.Name.VariablePath.UserPath -eq 'AdditionalGraphScopes' }
        $param | Should -Not -BeNullOrEmpty
        $param.StaticType.FullName | Should -Be 'System.String[]'
    }

    It 'declares -KeepGraphConnection as [switch]' {
        $param = $script:params | Where-Object { $_.Name.VariablePath.UserPath -eq 'KeepGraphConnection' }
        $param | Should -Not -BeNullOrEmpty
        $param.StaticType.FullName | Should -Be 'System.Management.Automation.SwitchParameter'
    }

    It 'documents both parameters in comment-based help' {
        $help = $script:ast.GetHelpContent()
        $help.Parameters.Keys | Should -Contain 'ADDITIONALGRAPHSCOPES'
        $help.Parameters.Keys | Should -Contain 'KEEPGRAPHCONNECTION'
    }
}

Describe 'Invoke-M365Assessment -AdditionalGraphScopes (dry run)' -Tag 'DryRun' {
    BeforeAll {
        . $script:scriptPath
    }

    It 'adds the extra scopes to the requested Graph scope list' {
        $output = Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' -Section Tenant -DryRun -NonInteractive -AdditionalGraphScopes 'Printer.Read.All', 'CloudPC.Read.All' 6>&1 |
            ForEach-Object { "$_" }
        ($output | Where-Object { $_ -match '^\s+Printer\.Read\.All$' }) | Should -Not -BeNullOrEmpty
        ($output | Where-Object { $_ -match '^\s+CloudPC\.Read\.All$' }) | Should -Not -BeNullOrEmpty
    }

    It 'does not request the extra scopes when the parameter is omitted' {
        $output = Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' -Section Tenant -DryRun -NonInteractive 6>&1 |
            ForEach-Object { "$_" }
        ($output | Where-Object { $_ -match '^\s+Printer\.Read\.All$' }) | Should -BeNullOrEmpty
    }
}
