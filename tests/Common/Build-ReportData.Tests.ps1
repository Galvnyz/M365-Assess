Describe 'Build-ReportData' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Common/Build-ReportData.ps1"

        # Helper: parse the JSON from "window.REPORT_DATA = {...};"
        function ConvertFrom-ReportDataJson {
            param([string]$Output)
            $json = $Output -replace '^window\.REPORT_DATA = ', '' -replace ';$', ''
            return $json | ConvertFrom-Json
        }

        # Minimal valid finding row
        function New-Finding {
            param(
                [string]$CheckId      = 'ENTRA-MFA-001.1',
                [string]$Status       = 'Fail',
                [string]$Category     = 'MFA',
                [string]$Setting      = 'MFA for all users',
                [string]$CurrentValue = 'Disabled',
                [string]$RecommendedValue = 'Enabled',
                [string]$Remediation  = 'Enable MFA',
                [string]$Section      = 'Identity',
                [string]$RiskSeverity = 'Critical',
                [hashtable]$Frameworks = @{}
            )
            [PSCustomObject]@{
                CheckId          = $CheckId
                Status           = $Status
                Category         = $Category
                Setting          = $Setting
                CurrentValue     = $CurrentValue
                RecommendedValue = $RecommendedValue
                Remediation      = $Remediation
                Section          = $Section
                RiskSeverity     = $RiskSeverity
                Frameworks       = $Frameworks
            }
        }

        # Minimal valid MFA row
        function New-MfaRow {
            param([string]$MfaStrength = 'Standard', [string]$IsAdmin = 'False')
            [PSCustomObject]@{ MfaStrength = $MfaStrength; IsAdmin = $IsAdmin }
        }
    }

    # ------------------------------------------------------------------
    Context 'JSON output wrapper' {
        It 'should return a string starting with window.REPORT_DATA =' {
            $result = Build-ReportDataJson
            $result | Should -Match '^window\.REPORT_DATA = '
        }

        It 'should return a string ending with ;' {
            $result = Build-ReportDataJson
            $result | Should -Match ';$'
        }

        It 'should produce valid JSON after stripping the wrapper' {
            $result = Build-ReportDataJson
            { ConvertFrom-ReportDataJson $result } | Should -Not -Throw
        }

        It 'should escape script end-tag in string values to prevent HTML injection' {
            $closing = '</' + 'script>'
            $escaped = '<\/' + 'script>'
            $finding = New-Finding -CurrentValue ('foo' + $closing + 'bar')
            $result = Build-ReportDataJson -AllFindings @($finding)
            $result.Contains($closing) | Should -Be $false
            $result.Contains($escaped) | Should -Be $true
        }
    }

    # ------------------------------------------------------------------
    Context 'field mapping' {
        It 'should map CurrentValue to current' {
            $f = New-Finding -CurrentValue 'some value'
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @($f))
            $d.findings[0].current | Should -Be 'some value'
        }

        It 'should map RecommendedValue to recommended' {
            $f = New-Finding -RecommendedValue 'best practice'
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @($f))
            $d.findings[0].recommended | Should -Be 'best practice'
        }

        It 'should accept Recommended (pre-renamed) field instead of RecommendedValue' {
            $f = [PSCustomObject]@{
                CheckId   = 'ENTRA-MFA-001.1'; Status = 'Pass'; Category = 'MFA'
                Setting   = 'x'; CurrentValue = 'y'; Recommended = 'z'
                Remediation = ''; Section = 'Identity'; RiskSeverity = 'High'; Frameworks = @{}
            }
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @($f))
            $d.findings[0].recommended | Should -Be 'z'
        }

        It 'should lowercase RiskSeverity into severity' {
            $f = New-Finding -RiskSeverity 'Critical'
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @($f))
            $d.findings[0].severity | Should -Be 'critical'
        }

        It 'should fall back to RegistryData for severity when RiskSeverity is absent' {
            $f = [PSCustomObject]@{
                CheckId = 'CA-MFA-ADMIN-001.1'; Status = 'Pass'; Category = 'CA'
                Setting = 'x'; CurrentValue = 'y'; RecommendedValue = 'z'
                Remediation = ''; Section = 'Conditional Access'
            }
            $registry = @{ 'CA-MFA-ADMIN-001' = @{ riskSeverity = 'High'; frameworks = @{} } }
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @($f) -RegistryData $registry)
            $d.findings[0].severity | Should -Be 'high'
        }

        It 'should default severity to medium when no RiskSeverity and no registry entry' {
            $f = [PSCustomObject]@{
                CheckId = 'UNKNOWN-001.1'; Status = 'Info'; Category = 'X'
                Setting = 'x'; CurrentValue = 'y'; RecommendedValue = 'z'
                Remediation = ''; Section = 'Other'
            }
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @($f))
            $d.findings[0].severity | Should -Be 'medium'
        }

        It 'should strip the .N sub-number suffix before domain derivation' {
            $f = New-Finding -CheckId 'ENTRA-MFA-001.3'
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @($f))
            $d.findings[0].domain | Should -Be 'Entra ID'
        }

        It 'should include all required finding fields' {
            $f = New-Finding
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @($f))
            $row = $d.findings[0]
            $row.PSObject.Properties.Name | Should -Contain 'checkId'
            $row.PSObject.Properties.Name | Should -Contain 'status'
            $row.PSObject.Properties.Name | Should -Contain 'severity'
            $row.PSObject.Properties.Name | Should -Contain 'domain'
            $row.PSObject.Properties.Name | Should -Contain 'section'
            $row.PSObject.Properties.Name | Should -Contain 'category'
            $row.PSObject.Properties.Name | Should -Contain 'setting'
            $row.PSObject.Properties.Name | Should -Contain 'current'
            $row.PSObject.Properties.Name | Should -Contain 'recommended'
            $row.PSObject.Properties.Name | Should -Contain 'remediation'
            $row.PSObject.Properties.Name | Should -Contain 'frameworks'
            $row.PSObject.Properties.Name | Should -Contain 'effort'
        }

        It 'should default effort to medium when no registry entry' {
            $f = New-Finding
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @($f))
            $d.findings[0].effort | Should -Be 'medium'
        }

        It 'should read effort from the registry entry when present' {
            $f = New-Finding -CheckId 'ENTRA-MFA-001.1'
            $registry = @{ 'ENTRA-MFA-001' = @{ riskSeverity = 'Critical'; frameworks = @{}; effort = 'small' } }
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @($f) -RegistryData $registry)
            $d.findings[0].effort | Should -Be 'small'
        }

        It 'should default effort to medium when registry entry lacks the field' {
            $f = New-Finding -CheckId 'ENTRA-MFA-001.1'
            $registry = @{ 'ENTRA-MFA-001' = @{ riskSeverity = 'High'; frameworks = @{} } }
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @($f) -RegistryData $registry)
            $d.findings[0].effort | Should -Be 'medium'
        }

        It 'should propagate references array from registry with url and title' {
            $f = New-Finding -CheckId 'CA-LEGACYAUTH-001.1'
            $url = 'https://learn.microsoft.com/en-us/entra/identity/conditional-access/block-legacy-authentication'
            $registry = @{ 'CA-LEGACYAUTH-001' = @{ riskSeverity = 'Critical'; frameworks = @{}; references = @(@{ url = $url; title = 'Docs' }) } }
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @($f) -RegistryData $registry)
            $d.findings[0].references | Should -HaveCount 1
            $d.findings[0].references[0].url | Should -Be $url
            $d.findings[0].references[0].title | Should -Be 'Docs'
        }

        It 'should emit empty references when registry has no references' {
            $f = New-Finding -CheckId 'CA-LEGACYAUTH-001.1'
            $registry = @{ 'CA-LEGACYAUTH-001' = @{ riskSeverity = 'Critical'; frameworks = @{} } }
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @($f) -RegistryData $registry)
            # Empty @() serializes as null in ConvertTo-Json; either null or empty array is acceptable
            $d.findings[0].references.Count | Should -Be 0
        }
    }

    # ------------------------------------------------------------------
    Context 'domain derivation' {
        It 'maps CA-* to Conditional Access' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @(New-Finding -CheckId 'CA-MFA-001.1'))
            $d.findings[0].domain | Should -Be 'Conditional Access'
        }

        It 'maps ENTRA-ENTAPP-* to Enterprise Apps (not Entra ID)' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @(New-Finding -CheckId 'ENTRA-ENTAPP-001.1'))
            $d.findings[0].domain | Should -Be 'Enterprise Apps'
        }

        It 'maps ENTRA-* (non-ENTAPP) to Entra ID' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @(New-Finding -CheckId 'ENTRA-MFA-001.1'))
            $d.findings[0].domain | Should -Be 'Entra ID'
        }

        It 'maps EXO-* to Exchange Online' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @(New-Finding -CheckId 'EXO-AUTH-001.1'))
            $d.findings[0].domain | Should -Be 'Exchange Online'
        }

        It 'maps DNS-* to Exchange Online' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @(New-Finding -CheckId 'DNS-SPF-001.1'))
            $d.findings[0].domain | Should -Be 'Exchange Online'
        }

        It 'maps INTUNE-* to Intune' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @(New-Finding -CheckId 'INTUNE-COMP-001.1'))
            $d.findings[0].domain | Should -Be 'Intune'
        }

        It 'maps DEFENDER-* to Defender' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @(New-Finding -CheckId 'DEFENDER-ANTIPHISH-001.1'))
            $d.findings[0].domain | Should -Be 'Defender'
        }

        It 'maps SPO-* to SharePoint & OneDrive' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @(New-Finding -CheckId 'SPO-SHARING-001.1'))
            $d.findings[0].domain | Should -Be 'SharePoint & OneDrive'
        }

        It 'maps TEAMS-* to Teams' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @(New-Finding -CheckId 'TEAMS-GUEST-001.1'))
            $d.findings[0].domain | Should -Be 'Teams'
        }

        It 'maps PURVIEW-* to Purview / Compliance' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @(New-Finding -CheckId 'PURVIEW-AUD-001.1'))
            $d.findings[0].domain | Should -Be 'Purview / Compliance'
        }

        It 'maps COMPLIANCE-* to Purview / Compliance' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @(New-Finding -CheckId 'COMPLIANCE-DLP-001.1'))
            $d.findings[0].domain | Should -Be 'Purview / Compliance'
        }

        It 'maps DLP-* to Purview / Compliance' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @(New-Finding -CheckId 'DLP-POLICY-001.1'))
            $d.findings[0].domain | Should -Be 'Purview / Compliance'
        }

        It 'maps POWERBI-* to Power BI' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @(New-Finding -CheckId 'POWERBI-TENANT-001.1'))
            $d.findings[0].domain | Should -Be 'Power BI'
        }

        It 'maps PBI-* to Power BI' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @(New-Finding -CheckId 'PBI-EXPORT-001.1'))
            $d.findings[0].domain | Should -Be 'Power BI'
        }

        It 'maps FORMS-* to Forms' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @(New-Finding -CheckId 'FORMS-SHARE-001.1'))
            $d.findings[0].domain | Should -Be 'Forms'
        }

        It 'maps AD-* to Active Directory' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @(New-Finding -CheckId 'AD-SYNC-001.1'))
            $d.findings[0].domain | Should -Be 'Active Directory'
        }

        It 'maps SOC2-* to SOC 2' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @(New-Finding -CheckId 'SOC2-CC1-001.1'))
            $d.findings[0].domain | Should -Be 'SOC 2'
        }

        It 'maps VO-* to Value Opportunity' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @(New-Finding -CheckId 'VO-LIC-001.1'))
            $d.findings[0].domain | Should -Be 'Value Opportunity'
        }

        It 'maps unknown prefixes to Other' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @(New-Finding -CheckId 'XYZ-UNKNOWN-001.1'))
            $d.findings[0].domain | Should -Be 'Other'
        }
    }

    # ------------------------------------------------------------------
    Context 'mfaStats' {
        It 'should count Phishing-Resistant correctly' {
            $rows = @(
                New-MfaRow 'Phishing-Resistant'
                New-MfaRow 'Phishing-Resistant'
                New-MfaRow 'Standard'
            )
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -SectionData @{ mfa = $rows })
            $d.mfaStats.phishResistant | Should -Be 2
        }

        It 'should count Standard correctly' {
            $rows = @(New-MfaRow 'Standard'; New-MfaRow 'Standard')
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -SectionData @{ mfa = $rows })
            $d.mfaStats.standard | Should -Be 2
        }

        It 'should count Weak correctly' {
            $rows = @(New-MfaRow 'Weak')
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -SectionData @{ mfa = $rows })
            $d.mfaStats.weak | Should -Be 1
        }

        It 'should count None correctly' {
            $rows = @(New-MfaRow 'None'; New-MfaRow '')
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -SectionData @{ mfa = $rows })
            $d.mfaStats.none | Should -Be 2
        }

        It 'should set total to total user count' {
            $rows = @(New-MfaRow 'Pass'; New-MfaRow 'None'; New-MfaRow 'Standard')
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -SectionData @{ mfa = $rows })
            $d.mfaStats.total | Should -Be 3
        }

        It 'should count admin users' {
            $rows = @(
                New-MfaRow 'Standard' 'True'
                New-MfaRow 'Phishing-Resistant' 'True'
                New-MfaRow 'None' 'False'
            )
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -SectionData @{ mfa = $rows })
            $d.mfaStats.admins | Should -Be 2
        }

        It 'should count admins without MFA' {
            $rows = @(
                New-MfaRow 'None' 'True'
                New-MfaRow 'Standard' 'True'
                New-MfaRow 'None' 'False'
            )
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -SectionData @{ mfa = $rows })
            $d.mfaStats.adminsWithoutMfa | Should -Be 1
        }

        It 'should produce all-zero mfaStats when mfa key is absent' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson)
            $d.mfaStats.total | Should -Be 0
        }
    }

    # ------------------------------------------------------------------
    Context 'domainStats' {
        It 'should group findings by domain and count statuses' {
            $findings = @(
                New-Finding -CheckId 'ENTRA-MFA-001.1' -Status 'Fail'
                New-Finding -CheckId 'ENTRA-PWD-001.1' -Status 'Pass'
                New-Finding -CheckId 'ENTRA-SEC-001.1' -Status 'Warning'
            )
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings $findings)
            $d.domainStats.'Entra ID'.fail    | Should -Be 1
            $d.domainStats.'Entra ID'.pass    | Should -Be 1
            $d.domainStats.'Entra ID'.warn    | Should -Be 1
            $d.domainStats.'Entra ID'.total   | Should -Be 3
        }

        It 'should separate domains correctly' {
            $findings = @(
                New-Finding -CheckId 'ENTRA-MFA-001.1' -Status 'Fail'
                New-Finding -CheckId 'CA-MFA-001.1'    -Status 'Pass'
            )
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings $findings)
            $d.domainStats.'Entra ID'.total             | Should -Be 1
            $d.domainStats.'Conditional Access'.total   | Should -Be 1
        }

        It 'should count Review and Info status' {
            $findings = @(
                New-Finding -CheckId 'EXO-AUTH-001.1' -Status 'Review'
                New-Finding -CheckId 'EXO-AUTH-002.1' -Status 'Info'
            )
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings $findings)
            $d.domainStats.'Exchange Online'.review | Should -Be 1
            $d.domainStats.'Exchange Online'.info   | Should -Be 1
        }

        It 'should produce empty domainStats when AllFindings is empty' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson)
            @($d.domainStats.PSObject.Properties).Count | Should -Be 0
        }
    }

    # ------------------------------------------------------------------
    Context 'whiteLabel flag' {
        It 'should set whiteLabel false by default' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson)
            $d.whiteLabel | Should -Be $false
        }

        It 'should set whiteLabel true when switch is passed' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -WhiteLabel)
            $d.whiteLabel | Should -Be $true
        }
    }

    # ------------------------------------------------------------------
    Context 'xlsxFileName' {
        It 'should embed xlsxFileName in the output' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -XlsxFileName 'Contoso_Report.xlsx')
            $d.xlsxFileName | Should -Be 'Contoso_Report.xlsx'
        }

        It 'should default xlsxFileName to empty string' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson)
            $d.xlsxFileName | Should -Be ''
        }
    }

    # ------------------------------------------------------------------
    Context 'null safety — missing SectionData keys' {
        It 'should produce empty tenant array when tenant key absent' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson)
            @($d.tenant).Count | Should -Be 0
        }

        It 'should produce empty score array when score key absent' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson)
            @($d.score).Count | Should -Be 0
        }

        It 'should produce empty ca array when ca key absent' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson)
            @($d.ca).Count | Should -Be 0
        }

        It 'should produce empty dns array when dns key absent' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson)
            @($d.dns).Count | Should -Be 0
        }

        It 'should produce empty admin-roles array when admin-roles key absent' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson)
            $d.'admin-roles' | Should -BeNullOrEmpty
        }

        It 'should always include top-level keys in output' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson)
            $keys = $d.PSObject.Properties.Name
            $keys | Should -Contain 'tenant'
            $keys | Should -Contain 'users'
            $keys | Should -Contain 'score'
            $keys | Should -Contain 'mfaStats'
            $keys | Should -Contain 'findings'
            $keys | Should -Contain 'domainStats'
            $keys | Should -Contain 'frameworks'
            $keys | Should -Contain 'licenses'
            $keys | Should -Contain 'dns'
            $keys | Should -Contain 'ca'
            $keys | Should -Contain 'summary'
            $keys | Should -Contain 'whiteLabel'
            $keys | Should -Contain 'xlsxFileName'
        }
    }

    # ------------------------------------------------------------------
    Context 'frameworks passthrough' {
        It 'should produce empty frameworks array when FrameworkDefs not supplied' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson)
            @($d.frameworks).Count | Should -Be 0
        }

        It 'should map frameworkId to id and label to full' {
            $defs = @(
                @{ frameworkId = 'cis-m365-v6'; label = 'CIS Microsoft 365 v6.0.1' }
                @{ frameworkId = 'cmmc';         label = 'CMMC 2.0' }
            )
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -FrameworkDefs $defs)
            @($d.frameworks).Count | Should -Be 2
            $d.frameworks[0].id   | Should -Be 'cis-m365-v6'
            $d.frameworks[0].full | Should -Be 'CIS Microsoft 365 v6.0.1'
            $d.frameworks[1].id   | Should -Be 'cmmc'
            $d.frameworks[1].full | Should -Be 'CMMC 2.0'
        }
    }

    # ------------------------------------------------------------------
    Context 'summary' {
        It 'should set summary.Items to the count of findings' {
            $findings = @(New-Finding; New-Finding -CheckId 'CA-MFA-001.1')
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings $findings)
            $d.summary[0].Items | Should -Be 2
        }
    }

    # ------------------------------------------------------------------
    Context 'SectionData passthrough' {
        It 'should include tenant OrgDisplayName in output' {
            $tenant = [PSCustomObject]@{ OrgDisplayName='Contoso'; TenantId='abc'; DefaultDomain='contoso.com'; CreatedDateTime='2020-01-01' }
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -SectionData @{ tenant = @($tenant) })
            $d.tenant[0].OrgDisplayName | Should -Be 'Contoso'
        }

        It 'should include license rows with License, Assigned, Total' {
            $lic = [PSCustomObject]@{ License='Microsoft 365 E5'; Assigned=10; Total=25 }
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -SectionData @{ licenses = @($lic) })
            $d.licenses[0].License   | Should -Be 'Microsoft 365 E5'
            $d.licenses[0].Assigned  | Should -Be 10
            $d.licenses[0].Total     | Should -Be 25
        }

        It 'should include dns rows with Domain and SPF' {
            $dns = [PSCustomObject]@{ Domain='contoso.com'; SPF='v=spf1 -all'; DMARC='v=DMARC1'; DMARCPolicy='reject'; DKIM='Configured'; DKIMStatus='Enabled' }
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -SectionData @{ dns = @($dns) })
            $d.dns[0].Domain | Should -Be 'contoso.com'
            $d.dns[0].SPF    | Should -Be 'v=spf1 -all'
        }

        It 'should include ca rows with DisplayName and State' {
            $ca = [PSCustomObject]@{ DisplayName='Require MFA'; State='enabled' }
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -SectionData @{ ca = @($ca) })
            $d.ca[0].DisplayName | Should -Be 'Require MFA'
            $d.ca[0].State       | Should -Be 'enabled'
        }
    }

    Context 'Evidence field passthrough' {
        It 'serializes evidence object to JSON string in findings output' {
            $finding = New-Finding
            $finding | Add-Member -NotePropertyName Evidence -NotePropertyValue ([PSCustomObject]@{ IsSecurityDefaultsEnabled = $true })
            $registry = @{ 'ENTRA-MFA-001' = [PSCustomObject]@{ riskSeverity = 'Critical'; effort = 'small' } }
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @($finding) -RegistryData $registry)
            $d.findings[0].evidence | Should -Not -BeNullOrEmpty
            $parsed = $d.findings[0].evidence | ConvertFrom-Json
            $parsed.IsSecurityDefaultsEnabled | Should -Be $true
        }

        It 'evidence field is null when not set on finding' {
            $finding = New-Finding
            $registry = @{ 'ENTRA-MFA-001' = [PSCustomObject]@{ riskSeverity = 'Critical'; effort = 'small' } }
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @($finding) -RegistryData $registry)
            $d.findings[0].evidence | Should -BeNullOrEmpty
        }

        It 'evidence JSON string is parseable when present' {
            $finding = New-Finding
            $finding | Add-Member -NotePropertyName Evidence -NotePropertyValue ([PSCustomObject]@{
                PolicyCount = 3; PolicyNames = @('Policy A', 'Policy B', 'Policy C')
            })
            $registry = @{ 'ENTRA-MFA-001' = [PSCustomObject]@{ riskSeverity = 'High'; effort = 'medium' } }
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -AllFindings @($finding) -RegistryData $registry)
            { $d.findings[0].evidence | ConvertFrom-Json } | Should -Not -Throw
            $ev = $d.findings[0].evidence | ConvertFrom-Json
            $ev.PolicyCount | Should -Be 3
        }
    }

    Context 'adHybrid shaping' {
        It 'should set adHybrid to null when ad-hybrid section data is absent' {
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson)
            $d.adHybrid | Should -BeNullOrEmpty
        }

        It 'should populate adHybrid when hybrid sync row is present' {
            $hybrid = [PSCustomObject]@{
                OnPremisesSyncEnabled   = 'True'
                LastDirSyncTime         = '2026-04-01T00:00:00Z'
                SyncType                = 'AADConnect'
                PasswordHashSyncEnabled = 'True'
            }
            $sec1 = [PSCustomObject]@{ RiskLevel = 'High'; FindingName = 'Kerberoastable account' }
            $sec2 = [PSCustomObject]@{ RiskLevel = 'Low';  FindingName = 'Stale user' }
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -SectionData @{
                'ad-hybrid'   = @($hybrid)
                'ad-security' = @($sec1, $sec2)
            })
            $d.adHybrid                  | Should -Not -BeNullOrEmpty
            $d.adHybrid.syncEnabled      | Should -Be $true
            $d.adHybrid.syncType         | Should -Be 'AADConnect'
            $d.adHybrid.pwHashSync       | Should -Be $true
            $d.adHybrid.securityFindings | Should -Be 2
            $d.adHybrid.highRiskFindings | Should -Be 1
            $d.adHybrid.entraOnly        | Should -Be $false
        }

        It 'should fall back to Entra tenant data when ad-hybrid absent and sync is enabled' {
            $tenant = [PSCustomObject]@{
                OrgDisplayName                     = 'Contoso'
                TenantId                           = 'test-tenant-id'
                OnPremisesSyncEnabled              = 'True'
                OnPremisesLastSyncDateTime         = '2026-04-15T12:00:00Z'
                OnPremisesLastPasswordSyncDateTime = '2026-04-15T12:05:00Z'
                OnPremisesProvisioningErrorCount   = '2'
            }
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -SectionData @{ 'tenant' = @($tenant) })
            $d.adHybrid             | Should -Not -BeNullOrEmpty
            $d.adHybrid.syncEnabled | Should -Be $true
            $d.adHybrid.pwHashSync  | Should -Be $true
            $d.adHybrid.syncErrorCount | Should -Be 2
            $d.adHybrid.entraOnly   | Should -Be $true
        }

        It 'should not create Entra fallback when sync is disabled in tenant data' {
            $tenant = [PSCustomObject]@{
                OrgDisplayName            = 'Contoso'
                TenantId                  = 'test-tenant-id'
                OnPremisesSyncEnabled     = 'False'
            }
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -SectionData @{ 'tenant' = @($tenant) })
            $d.adHybrid | Should -BeNullOrEmpty
        }

        It 'should return null pwHashSync when sync is enabled but LastPasswordSyncDateTime is absent' {
            # Cloud Sync or recently-enabled PHS may not populate this timestamp;
            # null signals the UI to show amber "Verify" rather than red "Disabled"
            $tenant = [PSCustomObject]@{
                OrgDisplayName                     = 'Contoso'
                TenantId                           = 'test-tenant-id'
                OnPremisesSyncEnabled              = 'True'
                OnPremisesLastSyncDateTime         = '2026-04-15T12:00:00Z'
                OnPremisesLastPasswordSyncDateTime = ''
                OnPremisesProvisioningErrorCount   = '0'
            }
            $d = ConvertFrom-ReportDataJson (Build-ReportDataJson -SectionData @{ 'tenant' = @($tenant) })
            $d.adHybrid.pwHashSync | Should -BeNullOrEmpty
        }
    }
}
