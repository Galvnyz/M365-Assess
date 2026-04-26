BeforeDiscovery {
    # Resolved at discovery time so the per-fixture It -ForEach can iterate.
    $script:fixturesRootDiscovery = Join-Path $PSScriptRoot '../Fixtures'
    $script:fixtureFilesDiscovery = if (Test-Path $script:fixturesRootDiscovery) {
        Get-ChildItem $script:fixturesRootDiscovery -Recurse -Filter '*.json' -ErrorAction SilentlyContinue |
            ForEach-Object { @{ Path = $_.FullName; Name = $_.Name } }
    } else {
        @()
    }
}

BeforeAll {
    $script:fixturesRoot = Join-Path $PSScriptRoot '../Fixtures'
}

Describe 'Test fixtures convention (D5 #789)' {

    Context 'directory layout' {
        It 'should have a top-level tests/Fixtures/README.md describing the convention' {
            Test-Path (Join-Path $script:fixturesRoot 'README.md') | Should -Be $true
        }

        It 'should expose the four canonical fixture domains as subdirectories or seed files' {
            $expectedDomains = @('Graph')   # Exchange/Intune/Reports populate as collectors migrate
            foreach ($d in $expectedDomains) {
                Test-Path (Join-Path $script:fixturesRoot $d) | Should -Be $true
            }
        }
    }

    Context 'fixture content' {
        # $script:fixtureFilesDiscovery resolved in BeforeDiscovery above; iterating
        # only files under tests/Fixtures (not every JSON in the repo).

        It '<Name> should be valid JSON' -ForEach $script:fixtureFilesDiscovery {
            { Get-Content $Path -Raw | ConvertFrom-Json -ErrorAction Stop } | Should -Not -Throw
        }

        It '<Name> should not contain real-tenant identifiers' -ForEach $script:fixtureFilesDiscovery {
            # Best-effort: fixtures shouldn't ship a real tenant's GUID. Synthetic
            # GUIDs are repeating-digit (1111-, 2222-, etc.) or all-zeros. A real
            # tenant GUID has a mixed hex pattern. This check is heuristic --
            # it allows zero-GUIDs and repeating-digit GUIDs and flags anything
            # that looks like it could be from a real tenant.
            $content = Get-Content $Path -Raw
            # Allow well-known Microsoft GUIDs (Defender, Graph SP, etc.) -- these
            # are fixed cross-tenant identifiers and not PII
            $microsoftWellKnown = @(
                '00000003-0000-0000-c000-000000000000'  # Microsoft Graph
                '00000002-0000-0ff1-ce00-000000000000'  # Office 365 Exchange Online
                '00000007-0000-0ff1-ce00-000000000000'  # Office 365 SharePoint Online
            )
            # Generic Entra well-known role template IDs are fine too (they're
            # the same for every tenant; we use them in directory-roles fixtures).
            $entraWellKnown = @(
                '62e90394-69f5-4237-9190-012177145e10'  # Global Administrator
                '5d6b6bb7-de71-4623-b4af-96380a352509'  # Security Reader
                'f2ef992c-3afb-46b9-b7cf-a126ee74c451'  # Global Reader
                '17315797-102d-40b4-93e0-432062caca18'  # Compliance Administrator
            )
            # SKU IDs are public reference data
            $skuWellKnown = @(
                '06ebc4ee-1bb5-47dd-8120-11324bc54e06'  # E5 SKU
                'f30db892-07e9-47e9-837c-80727f46fd3d'  # FLOW_FREE
                '8e0c0a52-6a6c-4d40-8370-dd62790dcd70'  # THREAT_INTELLIGENCE service plan
            )
            $allowed = $microsoftWellKnown + $entraWellKnown + $skuWellKnown
            $guidPattern = '\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b'
            $matchedGuids = [regex]::Matches($content.ToLowerInvariant(), $guidPattern) | ForEach-Object { $_.Value }
            foreach ($g in $matchedGuids) {
                # Allow if: well-known, or repeating-digit pattern (synthetic), or all-zeros
                $isSynthetic = $g -match '^([0-9a-f])\1{7}-\1{4}-\1{4}-\1{4}-\1{12}$'
                $isAllZero   = $g -eq '00000000-0000-0000-0000-000000000000'
                $isAllowed   = $allowed -contains $g
                if (-not ($isSynthetic -or $isAllZero -or $isAllowed)) {
                    throw "Fixture '$Name' contains a non-synthetic GUID '$g' that may be a real tenant identifier. Replace with a synthetic value (e.g., 11111111-1111-1111-1111-111111111111) or document it in tests/Fixtures/README.md as a well-known Microsoft identifier."
                }
            }
        }
    }
}
