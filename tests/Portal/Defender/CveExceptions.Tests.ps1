BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:migration = Join-Path $script:repoRoot 'portal/db/migrations/0023_cve_exceptions.sql'
    $script:repository = Join-Path $script:repoRoot 'portal/bff/src/repository/cve-exceptions.ts'
    $script:routes = Join-Path $script:repoRoot 'portal/bff/src/routes/defender-cve-exceptions.ts'
}

Describe 'CveException schema and CRUD contract (T-0368)' {

    Context 'the migration' {
        It 'exists and creates the cve_exceptions table' {
            Test-Path -LiteralPath $script:migration | Should -BeTrue
            $sql = Get-Content -LiteralPath $script:migration -Raw
            $sql | Should -Match 'CREATE TABLE IF NOT EXISTS cve_exceptions'
        }

        It 'makes expiresOn mandatory' {
            $sql = Get-Content -LiteralPath $script:migration -Raw
            $sql | Should -Match 'expiresOn\s+TEXT\s+NOT\s+NULL'
        }

        It 'restricts scope to all, device, or software' {
            $sql = Get-Content -LiteralPath $script:migration -Raw
            $sql | Should -Match "scope\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'all'\s+CHECK"
            $sql | Should -Match 'scope IN'
            $sql | Should -Match 'device'
            $sql | Should -Match 'software'
        }
    }

    Context 'the repository and routes' {
        It 'exposes an expiry-aware repository' {
            Test-Path -LiteralPath $script:repository | Should -BeTrue
            $source = Get-Content -LiteralPath $script:repository -Raw
            $source | Should -Match 'isSuppressed'
            $source | Should -Match 'expiresOn'
            $source | Should -Match 'listExpired'
        }

        It 'guards CVE-exception writes with Security.Defender.ReadWrite' {
            Test-Path -LiteralPath $script:routes | Should -BeTrue
            $source = Get-Content -LiteralPath $script:routes -Raw
            $source | Should -Match 'Security\.Defender\.ReadWrite'
            $source | Should -Match 'Security\.Defender\.Read'
        }
    }
}
