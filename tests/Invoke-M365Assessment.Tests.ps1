BeforeDiscovery {
    # Nothing needed at discovery time
}

BeforeAll {
    $script:scriptPath = "$PSScriptRoot/../src/M365-Assess/Invoke-M365Assessment.ps1"
    # Normalize to absolute path
    $script:scriptPath = [System.IO.Path]::GetFullPath($script:scriptPath)
    $script:ast = [System.Management.Automation.Language.Parser]::ParseFile(
        $script:scriptPath, [ref]$null, [ref]$null
    )
}

Describe 'Invoke-M365Assessment - syntax and structure' {
    It 'script file exists' {
        Test-Path -Path $script:scriptPath | Should -Be $true
    }

    It 'parses without syntax errors' {
        $errors = $null
        [System.Management.Automation.Language.Parser]::ParseFile(
            $script:scriptPath, [ref]$null, [ref]$errors
        ) | Out-Null
        $errors | Should -BeNullOrEmpty
    }

    It 'has comment-based help with .SYNOPSIS' {
        $scriptContent = Get-Content -Path $script:scriptPath -Raw
        $scriptContent | Should -Match '\.SYNOPSIS'
    }

    It 'has comment-based help with .DESCRIPTION' {
        $scriptContent = Get-Content -Path $script:scriptPath -Raw
        $scriptContent | Should -Match '\.DESCRIPTION'
    }

    It 'has a -DryRun switch parameter' {
        $paramBlock = $script:ast.FindAll(
            { param($node) $node -is [System.Management.Automation.Language.ParameterAst] },
            $true
        )
        $dryRunParam = $paramBlock | Where-Object { $_.Name.VariablePath.UserPath -eq 'DryRun' }
        $dryRunParam | Should -Not -BeNullOrEmpty
    }

    It 'has a -SkipConnection switch parameter' {
        $paramBlock = $script:ast.FindAll(
            { param($node) $node -is [System.Management.Automation.Language.ParameterAst] },
            $true
        )
        $param = $paramBlock | Where-Object { $_.Name.VariablePath.UserPath -eq 'SkipConnection' }
        $param | Should -Not -BeNullOrEmpty
    }

    It 'has a -TenantId parameter' {
        $paramBlock = $script:ast.FindAll(
            { param($node) $node -is [System.Management.Automation.Language.ParameterAst] },
            $true
        )
        $param = $paramBlock | Where-Object { $_.Name.VariablePath.UserPath -eq 'TenantId' }
        $param | Should -Not -BeNullOrEmpty
    }

    It 'has a -Section parameter' {
        $paramBlock = $script:ast.FindAll(
            { param($node) $node -is [System.Management.Automation.Language.ParameterAst] },
            $true
        )
        $param = $paramBlock | Where-Object { $_.Name.VariablePath.UserPath -eq 'Section' }
        $param | Should -Not -BeNullOrEmpty
    }

    It 'has a -OutputFolder parameter' {
        $paramBlock = $script:ast.FindAll(
            { param($node) $node -is [System.Management.Automation.Language.ParameterAst] },
            $true
        )
        $param = $paramBlock | Where-Object { $_.Name.VariablePath.UserPath -eq 'OutputFolder' }
        $param | Should -Not -BeNullOrEmpty
    }

    It 'has a -NonInteractive switch parameter' {
        $paramBlock = $script:ast.FindAll(
            { param($node) $node -is [System.Management.Automation.Language.ParameterAst] },
            $true
        )
        $param = $paramBlock | Where-Object { $_.Name.VariablePath.UserPath -eq 'NonInteractive' }
        $param | Should -Not -BeNullOrEmpty
    }

    It 'requires PowerShell 7.0 or higher' {
        $scriptContent = Get-Content -Path $script:scriptPath -Raw
        $scriptContent | Should -Match '#Requires -Version 7'
    }
}

Describe 'Invoke-M365Assessment - parameter validation' {
    It 'DryRun is a switch type parameter' {
        $paramBlock = $script:ast.FindAll(
            { param($node) $node -is [System.Management.Automation.Language.ParameterAst] },
            $true
        )
        $dryRunParam = $paramBlock | Where-Object { $_.Name.VariablePath.UserPath -eq 'DryRun' }
        $dryRunParam | Should -Not -BeNullOrEmpty
        # Switch parameters have a [switch] type constraint or no type (defaults to object)
        $typeConstraints = $dryRunParam.Attributes | Where-Object { $_ -is [System.Management.Automation.Language.TypeConstraintAst] }
        if ($typeConstraints) {
            $typeNames = $typeConstraints | ForEach-Object { $_.TypeName.Name }
            $typeNames | Should -Contain 'switch'
        }
    }

    It 'NonInteractive is a switch type parameter' {
        $paramBlock = $script:ast.FindAll(
            { param($node) $node -is [System.Management.Automation.Language.ParameterAst] },
            $true
        )
        $param = $paramBlock | Where-Object { $_.Name.VariablePath.UserPath -eq 'NonInteractive' }
        $param | Should -Not -BeNullOrEmpty
        $typeConstraints = $param.Attributes | Where-Object { $_ -is [System.Management.Automation.Language.TypeConstraintAst] }
        if ($typeConstraints) {
            $typeNames = $typeConstraints | ForEach-Object { $_.TypeName.Name }
            $typeNames | Should -Contain 'switch'
        }
    }
}
