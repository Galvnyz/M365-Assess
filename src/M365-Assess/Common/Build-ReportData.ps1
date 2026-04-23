function Get-CheckDomain {
    <#
    .SYNOPSIS
        Maps a base CheckId prefix to the React report domain label.
    #>
    param([string]$CheckId)
    switch -Wildcard ($CheckId) {
        'CA-*'           { return 'Conditional Access' }
        'ENTRA-ENTAPP-*' { return 'Enterprise Apps' }
        'ENTRA-*'        { return 'Entra ID' }
        'EXO-*'          { return 'Exchange Online' }
        'DNS-*'          { return 'Exchange Online' }
        'INTUNE-*'       { return 'Intune' }
        'DEFENDER-*'     { return 'Defender' }
        'SPO-*'          { return 'SharePoint & OneDrive' }
        'TEAMS-*'        { return 'Teams' }
        'PURVIEW-*'      { return 'Purview / Compliance' }
        'DLP-*'          { return 'Purview / Compliance' }
        'COMPLIANCE-*'   { return 'Purview / Compliance' }
        'POWERBI-*'      { return 'Power BI' }
        'PBI-*'          { return 'Power BI' }
        'FORMS-*'        { return 'Forms' }
        'AD-*'           { return 'Active Directory' }
        'AZ-*'           { return 'Azure' }
        'SOC2-*'         { return 'SOC 2' }
        'VO-*'           { return 'Value Opportunity' }
        default          { return 'Other' }
    }
}

function Build-ReportDataJson {
    <#
    .SYNOPSIS
        Transforms M365-Assess collector output into the window.REPORT_DATA JSON for the React report.
    .DESCRIPTION
        Accepts pre-loaded assessment data and produces a JavaScript assignment statement
        (window.REPORT_DATA = {...};) safe for inline embedding in an HTML <script> block.
        All </script> substrings in JSON string values are escaped as <\/script>.
    .PARAMETER AllFindings
        Array of enriched security-config check rows (output of Build-SectionHtml.ps1's
        $allCisFindings). Each row must have: CheckId, Category, Setting, CurrentValue,
        RecommendedValue (or Recommended), Status, Remediation, Section.
        Rows with RiskSeverity and Frameworks fields are used directly; missing fields
        fall back to $RegistryData lookup.
    .PARAMETER SectionData
        Hashtable of pre-loaded section data keyed by: 'tenant', 'users', 'score', 'mfa',
        'admin-roles', 'licenses', 'dns', 'ca'. Values are arrays of PSCustomObjects or
        Import-Csv rows. Missing keys produce empty arrays in the output.
    .PARAMETER RegistryData
        Control registry hashtable (output of Import-ControlRegistry). Used for
        riskSeverity and frameworks fallback when AllFindings rows lack those fields.
    .PARAMETER WhiteLabel
        When set, REPORT_DATA.whiteLabel is true — the React app hides Galvnyz attribution.
    .PARAMETER FrameworkDefs
        Array of framework definition hashtables from Import-FrameworkDefinitions.
        Produces REPORT_DATA.frameworks as [{id, full}] for the React FrameworkQuilt
        component. When omitted, frameworks is an empty array and the React app falls
        back to its own hardcoded list.
    .PARAMETER XlsxFileName
        Relative filename of the companion XLSX (e.g., "MyClient_Assessment-Report.xlsx").
        Embedded as REPORT_DATA.xlsxFileName for the download anchor in the report.
    .EXAMPLE
        $json = Build-ReportDataJson -AllFindings $allCisFindings -SectionData $sectionData `
            -RegistryData $controlRegistry -FrameworkDefs $allFrameworks `
            -XlsxFileName 'Contoso_Assessment-Report.xlsx'
        Get-ReportTemplate -ReportDataJson $json -ReportTitle 'M365 Assessment'
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter()]
        [AllowEmptyCollection()]
        [PSCustomObject[]]$AllFindings = @(),

        [Parameter()]
        [hashtable]$SectionData = @{},

        [Parameter()]
        [hashtable]$RegistryData = @{},

        [Parameter()]
        [switch]$WhiteLabel,

        [Parameter()]
        [AllowEmptyCollection()]
        [hashtable[]]$FrameworkDefs = @(),

        [Parameter()]
        [string]$XlsxFileName = ''
    )

    # ------------------------------------------------------------------
    # 1. Map findings → REPORT_DATA.findings shape
    # ------------------------------------------------------------------
    $findings = [System.Collections.Generic.List[PSCustomObject]]::new()

    foreach ($f in $AllFindings) {
        $baseCheckId = $f.CheckId -replace '\.\d+$', ''
        $regEntry    = if ($RegistryData.ContainsKey($baseCheckId)) { $RegistryData[$baseCheckId] } else { $null }

        $severity = if ($f.PSObject.Properties['RiskSeverity'] -and $f.RiskSeverity) {
            $f.RiskSeverity.ToLower()
        } elseif ($regEntry -and $regEntry.riskSeverity) {
            $regEntry.riskSeverity.ToLower()
        } else {
            'medium'
        }

        # frameworks — array of IDs for React filtering/display
        # Source may be a hashtable (from Build-SectionHtml) or PSCustomObject (from ConvertFrom-Json)
        $fwSource = if ($f.PSObject.Properties['Frameworks'] -and $f.Frameworks) { $f.Frameworks }
                    elseif ($regEntry -and $regEntry.frameworks)                  { $regEntry.frameworks }
                    else                                                           { $null }
        $frameworks = if ($fwSource -is [hashtable])  { [string[]]($fwSource.Keys) }
                      elseif ($fwSource)               { [string[]]($fwSource.PSObject.Properties.Name) }
                      else                             { [string[]]@() }

        # fwMeta — per-framework { controlId, profiles } for Control # column and L1/L2/E3/E5 breakdown
        $fwMeta = [ordered]@{}
        if ($fwSource -is [hashtable]) {
            foreach ($fwId in $fwSource.Keys) {
                $ent = $fwSource[$fwId]
                $cid = if ($ent -is [hashtable] -and $ent.ContainsKey('controlId')) { [string]$ent['controlId'] }
                       elseif ($ent -and $ent.PSObject.Properties['controlId'])      { [string]$ent.controlId }
                       else                                                            { '' }
                $prf = if ($ent -is [hashtable] -and $ent.ContainsKey('profiles'))  { @($ent['profiles']) }
                       elseif ($ent -and $ent.PSObject.Properties['profiles'])       { @($ent.profiles) }
                       else                                                            { @() }
                $fwMeta[$fwId] = [ordered]@{ controlId = $cid; profiles = $prf }
            }
        } elseif ($fwSource) {
            foreach ($prop in $fwSource.PSObject.Properties) {
                $ent = $prop.Value
                $cid = if ($ent -and $ent.PSObject.Properties['controlId']) { [string]$ent.controlId } else { '' }
                $prf = if ($ent -and $ent.PSObject.Properties['profiles'])  { @($ent.profiles) } else { @() }
                $fwMeta[$prop.Name] = [ordered]@{ controlId = $cid; profiles = $prf }
            }
        }

        $recommended = if ($f.PSObject.Properties['RecommendedValue']) { $f.RecommendedValue }
                       elseif ($f.PSObject.Properties['Recommended'])   { $f.Recommended }
                       else                                              { '' }

        $references = if ($regEntry -and $regEntry.references -and $regEntry.references.Count -gt 0) {
                         @($regEntry.references | Select-Object url, title)
                     } else { @() }
        $impact     = if ($regEntry) { $regEntry.impact }    else { $null }
        $rationale  = if ($regEntry) { $regEntry.rationale } else { $null }
        $evidence  = if ($f.PSObject.Properties['Evidence'] -and $null -ne $f.Evidence) {
                         $f.Evidence | ConvertTo-Json -Depth 5 -Compress
                     } else { $null }

        $findings.Add([PSCustomObject]@{
            checkId      = $f.CheckId
            status       = $f.Status
            severity     = $severity
            domain       = Get-CheckDomain -CheckId $baseCheckId
            section      = $f.Section
            category     = $f.Category
            setting      = $f.Setting
            current      = $f.CurrentValue
            recommended  = $recommended
            remediation  = $f.Remediation
            effort       = if ($regEntry) { $e = if ($regEntry -is [hashtable]) { $regEntry['effort'] } else { $regEntry.effort }; if ($e) { $e } else { 'medium' } } else { 'medium' }
            frameworks   = $frameworks
            fwMeta       = $fwMeta
            intentDesign    = [bool]($f.PSObject.Properties['IntentDesign'] -and $f.IntentDesign)
            intentRationale = if ($f.PSObject.Properties['ImpactRationale'] -and $f.ImpactRationale) { [string]$f.ImpactRationale } else { $null }
            references   = $references
            impact       = $impact
            rationale    = $rationale
            evidence     = $evidence
        })
    }

    # ------------------------------------------------------------------
    # 2. Compute domainStats
    # ------------------------------------------------------------------
    $domainStats = [ordered]@{}
    foreach ($finding in $findings) {
        $d = $finding.domain
        if (-not $domainStats.Contains($d)) {
            $domainStats[$d] = [ordered]@{ pass=0; warn=0; fail=0; review=0; info=0; total=0 }
        }
        $domainStats[$d].total++
        switch ($finding.status) {
            'Pass'    { $domainStats[$d].pass++   }
            'Warning' { $domainStats[$d].warn++   }
            'Fail'    { $domainStats[$d].fail++   }
            'Review'  { $domainStats[$d].review++ }
            'Info'    { $domainStats[$d].info++   }
        }
    }

    # ------------------------------------------------------------------
    # 3. Compute mfaStats
    # ------------------------------------------------------------------
    $mfaRows = if ($SectionData.ContainsKey('mfa')) { @($SectionData['mfa']) } else { @() }

    $mfaStats = [ordered]@{
        phishResistant   = @($mfaRows | Where-Object { $_.MfaStrength -eq 'Phishing-Resistant' }).Count
        standard         = @($mfaRows | Where-Object { $_.MfaStrength -eq 'Standard' }).Count
        weak             = @($mfaRows | Where-Object { $_.MfaStrength -eq 'Weak' }).Count
        none             = @($mfaRows | Where-Object { $_.MfaStrength -eq 'None' -or -not $_.MfaStrength }).Count
        total            = $mfaRows.Count
        admins           = @($mfaRows | Where-Object { $_.IsAdmin -eq 'True' -or $_.IsAdmin -eq $true }).Count
        adminsWithoutMfa = @($mfaRows | Where-Object {
            ($_.IsAdmin -eq 'True' -or $_.IsAdmin -eq $true) -and
            ($_.MfaStrength -eq 'None' -or -not $_.MfaStrength)
        }).Count
    }

    # ------------------------------------------------------------------
    # 4. Assemble REPORT_DATA
    # ------------------------------------------------------------------
    $get = { param($key) if ($SectionData.ContainsKey($key)) { @($SectionData[$key]) } else { @() } }

    $tenantRows    = & $get 'tenant'
    $usersRows     = & $get 'users'
    $scoreRows     = & $get 'score'
    $licenseRows   = & $get 'licenses'
    $dnsRows       = & $get 'dns'
    $caRows        = & $get 'ca'
    $adminRoleRows = & $get 'admin-roles'

    $frameworkList = @($FrameworkDefs | ForEach-Object { @{ id = $_['frameworkId']; full = $_['label']; desc = $_['description']; url = $_['homepageUrl'] } })

    # ------------------------------------------------------------------
    # Mailbox summary — pivot Metric/Count rows into a single object
    # ------------------------------------------------------------------
    $mbxRows = & $get 'mailbox-summary'
    $mbxMap  = [ordered]@{}
    foreach ($r in $mbxRows) { if ($r.Metric) { $mbxMap[$r.Metric] = [int]($r.Count -replace '[^\d]', '0') } }

    # Mail flow — count items by type (only enabled connectors/rules)
    $mfRows = & $get 'mailflow'
    $mailflowStats = [ordered]@{
        transportRules     = @($mfRows | Where-Object { $_.ItemType -eq 'TransportRule' -and $_.Status -eq 'Enabled'  }).Count
        inboundConnectors  = @($mfRows | Where-Object { $_.ItemType -eq 'InboundConnector'  }).Count
        outboundConnectors = @($mfRows | Where-Object { $_.ItemType -eq 'OutboundConnector' }).Count
    }

    # Device summary — aggregate Intune-managed device counts by compliance state
    $deviceRows = & $get 'device-summary'
    $deviceStats = $null
    if ($deviceRows.Count -gt 0) {
        $deviceStats = [ordered]@{
            total         = $deviceRows.Count
            compliant     = @($deviceRows | Where-Object { $_.ComplianceState -match '^(?i)compliant$' }).Count
            nonCompliant  = @($deviceRows | Where-Object { $_.ComplianceState -match '^(?i)noncompliant$' }).Count
        }
    }

    # AD/Hybrid panel — shape hybrid sync + security data for the AdHybridPanel component
    $adHybridRows   = & $get 'ad-hybrid'
    $adSecurityRows = & $get 'ad-security'
    $adHybridData   = $null
    if ($adHybridRows.Count -gt 0) {
        $row = $adHybridRows[0]
        $highRiskCount = @($adSecurityRows | Where-Object { $_.RiskLevel -eq 'High' -or $_.RiskLevel -eq 'Critical' }).Count
        $adHybridData  = [ordered]@{
            syncEnabled      = [bool]($row.OnPremisesSyncEnabled -eq 'True')
            lastSyncTime     = if ($row.LastDirSyncTime) { [string]$row.LastDirSyncTime } else { $null }
            syncType         = if ($row.SyncType) { [string]$row.SyncType } else { $null }
            pwHashSync       = if ($row.PasswordHashSyncEnabled -eq 'True') { $true } elseif ($row.PasswordHashSyncEnabled -eq 'Unknown') { $null } else { $false }
            securityFindings = $adSecurityRows.Count
            highRiskFindings = $highRiskCount
            syncErrorCount   = 0
            entraOnly        = $false
        }
    }

    # Entra-side fallback: populate adHybridData from tenant info when AD section was not run.
    # Get-TenantInfo writes OnPremisesSyncEnabled + PHS datetime fields to 01-Tenant-Info.csv.
    if ($null -eq $adHybridData -and $tenantRows.Count -gt 0) {
        $t = $tenantRows[0]
        $hasSyncField = $t.PSObject.Properties['OnPremisesSyncEnabled']
        if ($hasSyncField -and $t.OnPremisesSyncEnabled -eq 'True') {
            $lastSync = if ($t.PSObject.Properties['OnPremisesLastSyncDateTime']) { $t.OnPremisesLastSyncDateTime } else { $null }
            $phsDate  = if ($t.PSObject.Properties['OnPremisesLastPasswordSyncDateTime']) { $t.OnPremisesLastPasswordSyncDateTime } else { $null }
            $errCount = if ($t.PSObject.Properties['OnPremisesProvisioningErrorCount']) { [int]$t.OnPremisesProvisioningErrorCount } else { 0 }
            $adHybridData = [ordered]@{
                syncEnabled      = $true
                lastSyncTime     = if ($lastSync) { [string]$lastSync } else { $null }
                syncType         = $null
                pwHashSync       = if ($null -ne $phsDate -and $phsDate -ne '') { $true } else { $null }
                securityFindings = 0
                highRiskFindings = 0
                syncErrorCount   = $errCount
                entraOnly        = $true
            }
        }
    }

    # SharePoint config — extract sharing level from the security-config collector CSV
    $spoRows = & $get 'sharepoint-config'
    $spoConfig = [ordered]@{}
    $spoShareRow = @($spoRows | Where-Object { $_.CheckId -match 'SPO-SHARING' } | Select-Object -First 1)
    if ($spoShareRow) { $spoConfig['SharingLevel'] = $spoShareRow[0].CurrentValue }
    $spoODRow    = @($spoRows | Where-Object { $_.CheckId -match 'SPO-ONEDRIVE|SPO-OD' } | Select-Object -First 1)
    if ($spoODRow) { $spoConfig['OneDriveSharingLevel'] = $spoODRow[0].CurrentValue }

    $tenantRows = @($tenantRows | ForEach-Object {
        $ageYears = $null
        if ($_.CreatedDateTime) {
            try { $ageYears = [math]::Round(((Get-Date) - [datetime]$_.CreatedDateTime).TotalDays / 365.25, 1) }
            catch { Write-Verbose "Could not parse tenant CreatedDateTime: $_" }
        }
        $_ | Select-Object OrgDisplayName, TenantId, DefaultDomain, CreatedDateTime,
            @{ N = 'tenantAgeYears'; E = { $ageYears } }
    })

    $reportData = [ordered]@{
        tenant         = @($tenantRows)
        users          = @($usersRows  | Select-Object TotalUsers, Licensed, GuestUsers, SyncedFromOnPrem, DisabledUsers, NeverSignedIn, StaleMember)
        score          = @($scoreRows  | Select-Object Percentage, AverageComparativeScore, CurrentScore, MaxScore, CreatedDateTime, MicrosoftScore, CustomerScore)
        mfaStats       = $mfaStats
        findings       = @($findings)
        domainStats    = $domainStats
        frameworks     = $frameworkList
        licenses       = @($licenseRows  | Select-Object License, Assigned, Total)
        dns            = @($dnsRows      | Select-Object Domain, SPF, DMARC, DMARCPolicy, DKIM, DKIMStatus)
        ca             = @($caRows       | Select-Object DisplayName, State)
        'admin-roles'  = @($adminRoleRows | Select-Object RoleName, MemberDisplayName)
        summary        = @($findings | Group-Object -Property Section | ForEach-Object { [ordered]@{ Section = $_.Name; Items = $_.Count } })
        whiteLabel     = [bool]$WhiteLabel
        xlsxFileName   = $XlsxFileName
        mailboxSummary = if ($mbxMap.Count) { $mbxMap } else { $null }
        mailflowStats  = if ($mfRows.Count) { $mailflowStats } else { $null }
        sharepointConfig = if ($spoConfig.Count) { $spoConfig } else { $null }
        adHybrid       = $adHybridData
        deviceStats    = $deviceStats
    }

    # ------------------------------------------------------------------
    # 5. Serialize + escape </script> in string values
    # ------------------------------------------------------------------
    $json = $reportData | ConvertTo-Json -Depth 10
    # ConvertTo-Json serializes [string[]]@() as null and single-element arrays as bare strings.
    $json = $json -replace '"frameworks":\s*null',      '"frameworks": []'
    $json = $json -replace '"profiles":\s*null',        '"profiles": []'
    $json = $json -replace '"profiles":\s*"([^"]*)"',   '"profiles": ["$1"]'
    $json = $json -replace '</script>', '<\/script>'
    return "window.REPORT_DATA = $json;"
}
