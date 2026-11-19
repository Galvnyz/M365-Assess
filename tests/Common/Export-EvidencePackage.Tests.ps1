BeforeAll {
    . (Join-Path $PSScriptRoot '../../src/M365-Assess/Common/Get-RedactionRules.ps1')
    . (Join-Path $PSScriptRoot '../../src/M365-Assess/Common/Export-EvidencePackage.ps1')
}

Describe 'Export-EvidencePackage (D4 #788)' {

    BeforeEach {
        # Build a minimal fake assessment folder.
        $script:assessFolder = Join-Path -Path $TestDrive -ChildPath 'Assessment_test'
        New-Item -Path $script:assessFolder -ItemType Directory -Force | Out-Null

        # Summary CSV (the only file Export-EvidencePackage requires; everything else is best-effort)
        @(
            [PSCustomObject]@{ Collector = 'EXO'; FileName = 'exo-config.csv'; Items = 1; Status = 'Complete' }
        ) | Export-Csv -Path (Join-Path $script:assessFolder '_Assessment-Summary.csv') -NoTypeInformation -Encoding UTF8

        # Per-collector CSV with structured evidence
        @(
            [PSCustomObject]@{
                CheckId            = 'EXO-AUTH-001.1'
                Setting            = 'Modern Authentication Enabled'
                Status             = 'Pass'
                Category           = 'Authentication'
                CurrentValue       = 'True'
                RecommendedValue   = 'True'
                Remediation        = ''
                ObservedValue      = 'True'
                ExpectedValue      = 'True'
                EvidenceSource     = 'Get-OrganizationConfig'
                EvidenceTimestamp  = ''
                CollectionMethod   = 'Direct'
                PermissionRequired = 'Exchange Online: View-Only Configuration'
                Confidence         = '1.0'
                Limitations        = ''
            }
        ) | Export-Csv -Path (Join-Path $script:assessFolder 'exo-config.csv') -NoTypeInformation -Encoding UTF8

        # Stub HTML + XLSX so the package picks them up
        Set-Content -Path (Join-Path $script:assessFolder 'fake_Assessment-Report.html') -Value '<html><body>stub</body></html>'
        Set-Content -Path (Join-Path $script:assessFolder 'fake_Compliance-Matrix.xlsx')  -Value 'stub-bytes'
    }

    It 'writes a ZIP at the expected location' {
        $out = Join-Path $TestDrive 'package.zip'
        $result = Export-EvidencePackage -AssessmentFolder $script:assessFolder -OutputPath $out -TenantName 'test'
        $result | Should -Be $out
        Test-Path $out | Should -BeTrue
    }

    It 'includes the seven documented files plus a manifest' {
        $out = Join-Path $TestDrive 'package.zip'
        Export-EvidencePackage -AssessmentFolder $script:assessFolder -OutputPath $out -TenantName 'test' | Out-Null

        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [System.IO.Compression.ZipFile]::OpenRead($out)
        try {
            $names = @($zip.Entries | ForEach-Object { $_.FullName })
        } finally { $zip.Dispose() }

        $names | Should -Contain 'manifest.json'
        $names | Should -Contain 'executive-report.html'
        $names | Should -Contain 'compliance-matrix.xlsx'
        $names | Should -Contain 'findings.json'
        $names | Should -Contain 'permissions-summary.json'
        $names | Should -Contain 'run-metadata.json'
        $names | Should -Contain 'known-limitations.md'
        $names | Should -Contain 'README.md'
    }

    It 'manifest SHA-256 hashes match the file contents in the ZIP' {
        $out = Join-Path $TestDrive 'package.zip'
        Export-EvidencePackage -AssessmentFolder $script:assessFolder -OutputPath $out -TenantName 'test' | Out-Null

        $extract = Join-Path $TestDrive 'extract'
        if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
        New-Item -Path $extract -ItemType Directory -Force | Out-Null
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($out, $extract)

        $manifest = Get-Content (Join-Path $extract 'manifest.json') -Raw | ConvertFrom-Json
        foreach ($entry in $manifest.files) {
            $actual = (Get-FileHash -Path (Join-Path $extract $entry.path) -Algorithm SHA256).Hash.ToLower()
            $actual | Should -Be $entry.sha256
        }
    }

    It 'redaction strips UPNs from findings.json when -Redact is supplied' {
        # Add a finding with a UPN
        @(
            [PSCustomObject]@{
                CheckId            = 'TEST-001.1'
                Setting            = 'admin@contoso.com is global admin'
                Status             = 'Warning'
                Category           = 'Auth'
                CurrentValue       = 'admin@contoso.com'
                RecommendedValue   = 'least-privilege'
                Remediation        = ''
                ObservedValue      = ''
                ExpectedValue      = ''
                EvidenceSource     = ''
                EvidenceTimestamp  = ''
                CollectionMethod   = ''
                PermissionRequired = ''
                Confidence         = ''
                Limitations        = ''
            }
        ) | Export-Csv -Path (Join-Path $script:assessFolder 'admin-config.csv') -NoTypeInformation -Encoding UTF8

        $out = Join-Path $TestDrive 'package-redacted.zip'
        Export-EvidencePackage -AssessmentFolder $script:assessFolder -OutputPath $out -TenantName 'test' -Redact -TenantDisplayName 'Contoso' | Out-Null

        $extract = Join-Path $TestDrive 'extract-redacted'
        if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($out, $extract)

        $findings = Get-Content (Join-Path $extract 'findings.json') -Raw
        $findings | Should -Not -Match 'admin@contoso\.com'
        $findings | Should -Match '<user-[0-9a-f]{16}>'
    }

    It 'records redactionApplied=true in run-metadata.json when -Redact is supplied' {
        $out = Join-Path $TestDrive 'package-meta.zip'
        Export-EvidencePackage -AssessmentFolder $script:assessFolder -OutputPath $out -TenantName 'test' -Redact | Out-Null

        $extract = Join-Path $TestDrive 'extract-meta'
        if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($out, $extract)

        $meta = Get-Content (Join-Path $extract 'run-metadata.json') -Raw | ConvertFrom-Json
        $meta.redactionApplied | Should -BeTrue
        $meta.tenantName       | Should -Be '<tenant>'
    }

    Context 'when -Redact is supplied and the report has a data island' {
        BeforeEach {
            $reportHtml = @'
<!DOCTYPE html>
<html><head><title>Contoso Assessment</title><style>a::before{content:"x"}</style></head>
<body><div id="root"></div>
<script>
window.REPORT_DATA = {"tenant":{"OrgDisplayName":"Contoso","TenantId":"11111111-2222-3333-4444-555555555555"},"findings":[{"checkId":"X-001.1","current":"line one\nadmin@contoso.com from 203.0.113.7","count":3,"flag":true,"none":null,"tags":["owner@contoso.com","plain"]}]};
</script>
<script id="report-overrides">window.REPORT_OVERRIDES = null;</script>
<script>var css="a::before";</script>
</body></html>
'@
            Set-Content -Path (Join-Path $script:assessFolder 'fake_Assessment-Report.html') -Value $reportHtml -Encoding UTF8

            $out = Join-Path $TestDrive 'package-html.zip'
            Export-EvidencePackage -AssessmentFolder $script:assessFolder -OutputPath $out -TenantName 'test' -Redact -TenantDisplayName 'Contoso' | Out-Null
            $script:extract = Join-Path $TestDrive 'extract-html'
            if (Test-Path $script:extract) { Remove-Item -Recurse -Force $script:extract }
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            [System.IO.Compression.ZipFile]::ExtractToDirectory($out, $script:extract)
            $script:html = Get-Content (Join-Path $script:extract 'executive-report.html') -Raw
        }

        It 'should remove addresses, IPs, GUIDs and the tenant name from the report data' {
            $script:html | Should -Not -Match 'admin@contoso\.com'
            $script:html | Should -Not -Match 'owner@contoso\.com'
            $script:html | Should -Not -Match '203\.0\.113\.7'
            $script:html | Should -Not -Match '11111111-2222-3333-4444-555555555555'
            $script:html | Should -Not -Match 'Contoso'
        }

        It 'should leave the script bundle and styles untouched' {
            $script:html | Should -Match 'a::before\{content:"x"\}'
            $script:html | Should -Match 'var css="a::before";'
            $script:html | Should -Match 'window\.REPORT_OVERRIDES = null;'
        }

        It 'should keep the data island valid JSON with types and escapes intact' {
            $island = [regex]::Match($script:html, '(?s)window\.REPORT_DATA\s*=\s*(.*?);\s*</script>').Groups[1].Value
            $data = $island | ConvertFrom-Json
            $data.findings[0].count | Should -Be 3
            $data.findings[0].flag | Should -BeTrue
            $data.findings[0].none | Should -BeNullOrEmpty
            $data.findings[0].current | Should -Match "^line one`n<user-[0-9a-f]{16}> from <ip-[0-9a-f]{16}>$"
            $data.findings[0].tags[1] | Should -Be 'plain'
        }

        It 'should not write a raw less-than sign inside the data island' {
            $island = [regex]::Match($script:html, '(?s)window\.REPORT_DATA\s*=\s*(.*?);\s*</script>').Groups[1].Value
            $island | Should -Not -Match '<'
        }

        It 'should leave the XLSX matrix out and say so in the metadata' {
            Test-Path (Join-Path $script:extract 'compliance-matrix.xlsx') | Should -BeFalse
            $meta = Get-Content (Join-Path $script:extract 'run-metadata.json') -Raw | ConvertFrom-Json
            @($meta.redactionNotes) -join ' ' | Should -Match 'compliance-matrix\.xlsx was omitted'
        }

        It 'should list only files that are present in the manifest' {
            $manifest = Get-Content (Join-Path $script:extract 'manifest.json') -Raw | ConvertFrom-Json
            $manifest.files.path | Should -Not -Contain 'compliance-matrix.xlsx'
            $manifest.files.path | Should -Contain 'executive-report.html'
        }
    }

    Context 'when -Redact is supplied and the report data cannot be located' {
        It 'should leave the report out instead of shipping it unredacted' {
            # The BeforeEach stub report has no REPORT_DATA island.
            $out = Join-Path $TestDrive 'package-nohtml.zip'
            Export-EvidencePackage -AssessmentFolder $script:assessFolder -OutputPath $out -TenantName 'test' -Redact -WarningAction SilentlyContinue | Out-Null
            $extract = Join-Path $TestDrive 'extract-nohtml'
            if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            [System.IO.Compression.ZipFile]::ExtractToDirectory($out, $extract)

            Test-Path (Join-Path $extract 'executive-report.html') | Should -BeFalse
            $meta = Get-Content (Join-Path $extract 'run-metadata.json') -Raw | ConvertFrom-Json
            @($meta.redactionNotes) -join ' ' | Should -Match 'executive-report\.html was omitted'
        }
    }

    Context 'when two redacted packages are built from the same data' {
        It 'should produce different tokens for the same address' {
            @(
                [PSCustomObject]@{ CheckId = 'T-1.1'; Setting = 's'; Status = 'Fail'; CurrentValue = 'admin@contoso.com' }
            ) | Export-Csv -Path (Join-Path $script:assessFolder 'salt-config.csv') -NoTypeInformation -Encoding UTF8

            $tokens = foreach ($n in 1, 2) {
                $out = Join-Path $TestDrive "package-salt$n.zip"
                Export-EvidencePackage -AssessmentFolder $script:assessFolder -OutputPath $out -TenantName 'test' -Redact -WarningAction SilentlyContinue | Out-Null
                $extract = Join-Path $TestDrive "extract-salt$n"
                if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
                Add-Type -AssemblyName System.IO.Compression.FileSystem
                [System.IO.Compression.ZipFile]::ExtractToDirectory($out, $extract)
                [regex]::Match((Get-Content (Join-Path $extract 'findings.json') -Raw), '<user-[0-9a-f]{16}>').Value
            }
            $tokens[0] | Should -Not -BeNullOrEmpty
            $tokens[0] | Should -Not -Be $tokens[1]
        }
    }

    It 'rejects a non-existent assessment folder with a clear error' {
        { Export-EvidencePackage -AssessmentFolder 'C:\does\not\exist' -OutputPath (Join-Path $TestDrive 'x.zip') } |
            Should -Throw '*not found*'
    }
}
