BeforeAll {
    . "$PSScriptRoot/../../src/M365-Assess/Common/Complete-AssessmentArtifacts.ps1"
    . "$PSScriptRoot/../../src/M365-Assess/Common/Export-EvidencePackage.ps1"
    function Write-AssessmentLog {
        param($Level, $Message)
        Add-Content -LiteralPath $script:artifactLog -Value "[$Level] $Message"
    }
    Mock Write-Host { }
    Mock Write-Warning { }
}

Describe 'Complete-AssessmentArtifacts' {
    BeforeEach {
        $script:folder = Join-Path -Path $TestDrive -ChildPath ([guid]::NewGuid().ToString())
        $null = New-Item -Path $script:folder -ItemType Directory
        $script:artifactLog = Join-Path -Path $script:folder -ChildPath '_Assessment-Log.txt'
        Set-Content -LiteralPath $script:artifactLog -Value 'Disconnected from Graph and Exchange.'
        Set-Content -LiteralPath (Join-Path $script:folder 'checks-config.csv') -Value 'CheckId,Status
TEST-001,Pass'
        $script:metadata = [ordered]@{ toolName='M365-Assess'; toolVersion='2.14.0'; tenantNameSlug='fixture' }
    }

    It 'hashes the final log and every delivered artifact accurately' {
        $path = Complete-AssessmentArtifacts -AssessmentFolder $script:folder -Provenance $script:metadata
        $manifest = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        $manifest.outputArtifacts.Count | Should -Be 2
        Get-Content -LiteralPath $script:artifactLog -Raw | Should -Match 'Service cleanup complete'
        foreach ($entry in $manifest.outputArtifacts) {
            $file = Join-Path -Path $script:folder -ChildPath $entry.name
            $entry.sha256 | Should -Be (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
            $entry.bytes | Should -Be (Get-Item -LiteralPath $file).Length
        }
        $manifest.outputArtifacts.name | Should -Not -Contain '_Assessment-Provenance.json'
    }

    It 'keeps hashes valid after optional evidence packaging' {
        $path = Complete-AssessmentArtifacts -AssessmentFolder $script:folder -Provenance $script:metadata -EvidencePackage
        @(Get-ChildItem -Path $TestDrive -Filter '*EvidencePackage*.zip').Count | Should -Be 1
        foreach ($entry in (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json).outputArtifacts) {
            $entry.sha256 | Should -Be (Get-FileHash -LiteralPath (Join-Path $script:folder $entry.name) -Algorithm SHA256).Hash
        }
    }

    It 'reports a package failure without invalidating the sealed log' {
        Mock Export-EvidencePackage { throw 'Fixture packaging failure' }
        $path = Complete-AssessmentArtifacts -AssessmentFolder $script:folder -Provenance $script:metadata -EvidencePackage
        Should -Invoke Write-Warning -Times 1 -ParameterFilter { $Message -like '*Fixture packaging failure*' }
        $entry = (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json).outputArtifacts | Where-Object name -eq '_Assessment-Log.txt'
        $entry.sha256 | Should -Be (Get-FileHash -LiteralPath $script:artifactLog -Algorithm SHA256).Hash
    }

    It 'does not produce a partial manifest when an artifact cannot be hashed' {
        Mock Get-FileHash { throw 'Fixture unreadable artifact' }
        { Complete-AssessmentArtifacts -AssessmentFolder $script:folder -Provenance $script:metadata } | Should -Throw '*Fixture unreadable artifact*'
        Join-Path -Path $script:folder -ChildPath '_Assessment-Provenance.json' | Should -Not -Exist
    }

    It 'runs after the orchestrator disconnects its services' {
        $path = "$PSScriptRoot/../../src/M365-Assess/Invoke-M365Assessment.ps1"
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$null)
        $commands = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true)
        $seal = $commands | Where-Object { $_.GetCommandName() -eq 'Complete-AssessmentArtifacts' }
        @($seal).Count | Should -Be 1
        foreach ($disconnect in $commands | Where-Object { $_.GetCommandName() -in @('Disconnect-MgGraph', 'Disconnect-ExchangeOnline') }) {
            $disconnect.Extent.EndOffset | Should -BeLessThan $seal.Extent.StartOffset
        }
    }
}
