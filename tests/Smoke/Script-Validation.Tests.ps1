BeforeDiscovery {
    $repoRoot = Resolve-Path "$PSScriptRoot/../.."
    $scriptFiles = Get-ChildItem -Path $repoRoot -Filter '*.ps1' -Recurse |
        Where-Object {
            $_.FullName -notmatch '[\\/]tests[\\/]' -and
            $_.FullName -notmatch '[\\/]\.claude[\\/]' -and
            $_.FullName -notmatch '[\\/]docs[\\/]'
        } |
        ForEach-Object {
            @{
                Name     = $_.FullName.Replace($repoRoot.Path, '').TrimStart('\', '/')
                FullName = $_.FullName
            }
        }

    $helpScripts = Get-ChildItem -Path $repoRoot -Filter '*.ps1' -Recurse |
        Where-Object {
            $_.FullName -notmatch '[\\/]tests[\\/]' -and
            $_.FullName -notmatch '[\\/]\.claude[\\/]' -and
            $_.FullName -notmatch '[\\/]docs[\\/]' -and
            $_.FullName -notmatch '[\\/]assets[\\/]' -and
            $_.FullName -notmatch '[\\/]controls[\\/]'
        } |
        Where-Object {
            (Get-Content $_.FullName -Raw) -match '\.SYNOPSIS'
        } |
        ForEach-Object {
            @{
                Name     = $_.FullName.Replace($repoRoot.Path, '').TrimStart('\', '/')
                FullName = $_.FullName
            }
        }

    $collectorFiles = Get-ChildItem -Path $repoRoot -Recurse -Include '*SecurityConfig.ps1', '*RetentionConfig.ps1' |
        Where-Object {
            $_.FullName -notmatch '[\\/]tests[\\/]' -and
            $_.FullName -notmatch '[\\/]\.claude[\\/]'
        } |
        ForEach-Object {
            @{
                Name     = $_.FullName.Replace($repoRoot.Path, '').TrimStart('\', '/')
                FullName = $_.FullName
            }
        }
}

Describe 'Script Syntax Validation' {
    It '<Name> parses without syntax errors' -ForEach $scriptFiles {
        $content = Get-Content -Path $FullName -Raw
        $parseErrors = $null
        [System.Management.Automation.Language.Parser]::ParseInput($content, [ref]$null, [ref]$parseErrors)
        $parseErrors | Should -BeNullOrEmpty -Because "$Name should have no parse errors"
    }
}

Describe 'Script Help Validation' {
    It '<Name> has a non-empty synopsis' -ForEach $helpScripts {
        $help = Get-Help $FullName -ErrorAction SilentlyContinue
        $help.Synopsis | Should -Not -BeNullOrEmpty -Because "$Name should have help documentation"
    }
}

Describe 'Backtick Line Continuations' {
    It '<Name> has no backtick line continuations' -ForEach $collectorFiles {
        $violations = Select-String -Path $FullName -Pattern '`\s*$'
        $violations | Should -BeNullOrEmpty -Because "backtick line continuations are prohibited; use splatting instead"
    }
}
