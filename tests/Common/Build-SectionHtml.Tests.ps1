Describe 'Build-SectionHtml.ps1 — structural contract' {
    BeforeAll {
        $script:src = "$PSScriptRoot/../../src/M365-Assess/Common/Build-SectionHtml.ps1"
        $script:content = Get-Content $script:src -Raw
    }

    It 'source file exists' {
        Test-Path $script:src | Should -Be $true
    }

    It 'sets $allCisFindings in caller scope' {
        $script:content | Should -Match '\$allCisFindings'
    }

    It 'sets $sectionData in caller scope' {
        $script:content | Should -Match '\$sectionData'
    }

    It 'loads tenant CSV (01-Tenant-Info.csv)' {
        $script:content | Should -Match '01-Tenant-Info\.csv'
    }

    It 'loads users CSV (02-User-Summary.csv)' {
        $script:content | Should -Match '02-User-Summary\.csv'
    }

    It 'loads MFA CSV (03-MFA-Report.csv)' {
        $script:content | Should -Match '03-MFA-Report\.csv'
    }

    It 'loads admin roles CSV (04-Admin-Roles.csv)' {
        $script:content | Should -Match '04-Admin-Roles\.csv'
    }

    It 'loads CA CSV (05-Conditional-Access.csv)' {
        $script:content | Should -Match '05-Conditional-Access\.csv'
    }

    It 'loads licenses CSV (08-License-Summary.csv)' {
        $script:content | Should -Match '08-License-Summary\.csv'
    }

    It 'loads secure score CSV (16-Secure-Score.csv)' {
        $script:content | Should -Match '16-Secure-Score\.csv'
    }

    It 'loads DNS CSV (12-DNS-Email-Authentication.csv)' {
        $script:content | Should -Match '12-DNS-Email-Authentication\.csv'
    }

    It 'filters onmicrosoft.com domains from DNS data' {
        $script:content | Should -Match 'onmicrosoft'
    }

    It 'uses $AssessmentFolder for CSV paths' {
        $script:content | Should -Match '\$AssessmentFolder'
    }

    It 'builds allCisFindings from summary loop' {
        $script:content | Should -Match 'foreach.*\$summary'
    }

    It 'populates Frameworks hashtable per finding' {
        $script:content | Should -Match '\$fwHash'
    }

    It 'calls Export-ComplianceMatrix.ps1 for XLSX' {
        $script:content | Should -Match 'Export-ComplianceMatrix\.ps1'
    }

    It 'does not build HTML strings (no StringBuilder for HTML output)' {
        $script:content | Should -Not -Match 'sectionHtml.*StringBuilder|StringBuilder.*sectionHtml'
        $script:content | Should -Not -Match '\$sectionHtml\s*='
        $script:content | Should -Not -Match '\$tocHtml\s*='
        $script:content | Should -Not -Match '\$complianceHtml\s*='
    }

    It 'does not call Export-ComplianceOverview' {
        $script:content | Should -Not -Match 'Export-ComplianceOverview'
    }

    It 'does not call Export-FrameworkCatalog' {
        $script:content | Should -Not -Match 'Export-FrameworkCatalog'
    }
}

Describe 'Build-SectionHtml.ps1 — execution' {
    BeforeAll {
        $script:tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "bsh-test-$(New-Guid)"
        New-Item -ItemType Directory -Path $script:tmpDir | Out-Null

        # Write minimal summary CSV
        @'
Section,Collector,FileName,Status,Items
Identity,Get-MfaReport,03-MFA-Report.csv,Complete,2
Identity,Get-CAReport,CA-Security.csv,Complete,1
'@ | Set-Content -Path (Join-Path $script:tmpDir '_Assessment-Summary.csv')

        # Write minimal finding CSVs
        @'
CheckId,Category,Setting,CurrentValue,RecommendedValue,Status,Remediation
CA-REPORTONLY-001.1,Access,MFA Required,Disabled,Enabled,Fail,Enable MFA
'@ | Set-Content -Path (Join-Path $script:tmpDir 'CA-Security.csv')

        @'
UserPrincipalName,IsAdmin,MfaStrength
user1@test.com,False,Standard
admin@test.com,True,None
'@ | Set-Content -Path (Join-Path $script:tmpDir '03-MFA-Report.csv')

        @'
Domain,SPF,DMARC,DMARCPolicy,DKIM,DKIMStatus
contoso.onmicrosoft.com,Pass,Pass,reject,Pass,Pass
contoso.com,Pass,Pass,reject,Pass,Pass
'@ | Set-Content -Path (Join-Path $script:tmpDir '12-DNS-Email-Authentication.csv')

        # Create stub secondary CSVs
        foreach ($f in @('01-Tenant-Info.csv','02-User-Summary.csv','04-Admin-Roles.csv','05-Conditional-Access.csv','08-License-Summary.csv','16-Secure-Score.csv')) {
            'Col1' | Set-Content -Path (Join-Path $script:tmpDir $f)
        }

        # Set shared-scope variables that Build-SectionHtml.ps1 reads from caller
        $AssessmentFolder = $script:tmpDir
        $summary          = Import-Csv (Join-Path $script:tmpDir '_Assessment-Summary.csv')
        $controlRegistry  = @{}
        $allFrameworks    = @()
        $cisFrameworkId   = 'cis-m365-v6'
        $WhiteLabel       = $false
        $DriftReport      = @()
        $reportDomainPrefix = 'test'

        # Dot-source the script under test (runs in this test scope)
        . "$PSScriptRoot/../../src/M365-Assess/Common/Build-SectionHtml.ps1"
    }

    AfterAll {
        Remove-Item -Recurse -Force $script:tmpDir -ErrorAction SilentlyContinue
    }

    It 'sets $allCisFindings as a list' {
        $allCisFindings | Should -Not -BeNullOrEmpty
        $allCisFindings.GetType().FullName | Should -Match 'List'
    }

    It 'populates allCisFindings from CSV rows with CheckId' {
        @($allCisFindings).Count | Should -BeGreaterThan 0
    }

    It 'allCisFindings rows have required fields' {
        $row = $allCisFindings[0]
        $row.PSObject.Properties.Name | Should -Contain 'CheckId'
        $row.PSObject.Properties.Name | Should -Contain 'Status'
        $row.PSObject.Properties.Name | Should -Contain 'Section'
        $row.PSObject.Properties.Name | Should -Contain 'Frameworks'
    }

    It 'sets $sectionData as a hashtable' {
        $sectionData | Should -BeOfType [hashtable]
    }

    It 'sectionData contains expected section keys' {
        $sectionData.Keys | Should -Contain 'tenant'
        $sectionData.Keys | Should -Contain 'mfa'
        $sectionData.Keys | Should -Contain 'dns'
        $sectionData.Keys | Should -Contain 'ca'
        $sectionData.Keys | Should -Contain 'admin-roles'
        $sectionData.Keys | Should -Contain 'licenses'
        $sectionData.Keys | Should -Contain 'score'
    }

    It 'filters onmicrosoft.com domains from sectionData dns' {
        $dnsRows = $sectionData['dns']
        $dnsRows | Where-Object { $_.Domain -match '\.onmicrosoft\.com$' } | Should -BeNullOrEmpty
    }

    It 'includes non-onmicrosoft.com domains in sectionData dns' {
        $dnsRows = $sectionData['dns']
        @($dnsRows).Count | Should -BeGreaterThan 0
        $dnsRows[0].Domain | Should -Be 'contoso.com'
    }

    It 'mfa section data is populated from CSV' {
        @($sectionData['mfa']).Count | Should -Be 2
    }

    It 'does not set $sectionHtml or $tocHtml in scope' {
        $null -eq $sectionHtml | Should -Be $true
        $null -eq $tocHtml     | Should -Be $true
    }
}
