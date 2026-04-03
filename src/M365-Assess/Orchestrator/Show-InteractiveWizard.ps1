function Show-InteractiveWizard {
    <#
    .SYNOPSIS
        Presents an interactive menu-driven wizard for configuring the assessment.
    .DESCRIPTION
        Walks the user through selecting sections, tenant, auth method, and output
        folder. Returns a hashtable of parameter values to drive the assessment.
    #>
    [CmdletBinding()]
    param(
        [string[]]$PreSelectedSections,
        [string]$PreSelectedOutputFolder
    )

    # Colorblind-friendly palette
    $cBorder  = 'Cyan'
    $cPrompt  = 'Yellow'
    $cNormal  = 'White'
    $cMuted   = 'DarkGray'
    $cSuccess = 'Cyan'
    $errorDisplayDelay = 1  # seconds to pause after validation errors
    $cError   = 'Magenta'

    # Section definitions with default selection state
    # Use string keys to avoid OrderedDictionary int-key vs ordinal-index ambiguity (GitHub #3)
    $sections = [ordered]@{
        '1'  = @{ Name = 'Tenant';          Label = 'Tenant Information';           Selected = $true }
        '2'  = @{ Name = 'Identity';        Label = 'Identity & Access';            Selected = $true }
        '3'  = @{ Name = 'Licensing';       Label = 'Licensing';                    Selected = $true }
        '4'  = @{ Name = 'Email';           Label = 'Email & Exchange';             Selected = $true }
        '5'  = @{ Name = 'Intune';          Label = 'Intune Devices';               Selected = $true }
        '6'  = @{ Name = 'Security';        Label = 'Security';                     Selected = $true }
        '7'  = @{ Name = 'Collaboration';   Label = 'Collaboration';                Selected = $true }
        '8'  = @{ Name = 'Hybrid';          Label = 'Hybrid Sync';                  Selected = $true }
        '9'  = @{ Name = 'PowerBI';         Label = 'Power BI';                     Selected = $true }
        '10' = @{ Name = 'Inventory';       Label = 'M&A Inventory (opt-in)';       Selected = $false }
        '11' = @{ Name = 'ActiveDirectory'; Label = 'Active Directory (RSAT)';      Selected = $false }
        '12' = @{ Name = 'SOC2';            Label = 'SOC 2 Readiness (opt-in)';     Selected = $false }
    }

    # --- Header ---
    function Show-Header {
        Clear-Host
        Write-Host ''
        Write-Host '      ███╗   ███╗ ██████╗  ██████╗ ███████╗' -ForegroundColor Cyan
        Write-Host '      ████╗ ████║ ╚════██╗ ██╔════╝ ██╔════╝' -ForegroundColor Cyan
        Write-Host '      ██╔████╔██║  █████╔╝ ██████╗  ███████╗' -ForegroundColor Cyan
        Write-Host '      ██║╚██╔╝██║  ╚═══██╗ ██╔══██╗ ╚════██║' -ForegroundColor Cyan
        Write-Host '      ██║ ╚═╝ ██║ ██████╔╝ ╚█████╔╝ ███████║' -ForegroundColor Cyan
        Write-Host '      ╚═╝     ╚═╝ ╚═════╝   ╚════╝  ╚══════╝' -ForegroundColor Cyan
        Write-Host '     ─────────────────────────────────────────' -ForegroundColor DarkCyan
        Write-Host '       █████╗ ███████╗███████╗███████╗███████╗███████╗' -ForegroundColor DarkCyan
        Write-Host '      ██╔══██╗██╔════╝██╔════╝██╔════╝██╔════╝██╔════╝' -ForegroundColor DarkCyan
        Write-Host '      ███████║███████╗███████╗█████╗  ███████╗███████╗' -ForegroundColor DarkCyan
        Write-Host '      ██╔══██║╚════██║╚════██║██╔══╝  ╚════██║╚════██║' -ForegroundColor DarkCyan
        Write-Host '      ██║  ██║███████║███████║███████╗███████║███████║' -ForegroundColor DarkCyan
        Write-Host '      ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝╚══════╝╚══════╝' -ForegroundColor DarkCyan
        Write-Host ''
        Write-Host '        ░▒▓█  M365 Environment Assessment  █▓▒░' -ForegroundColor DarkGray
        Write-Host '        ░▒▓█  by  G A L V N Y Z             █▓▒░' -ForegroundColor DarkCyan
        Write-Host ''
    }

    function Show-StepHeader {
        param([int]$Step, [int]$Total, [string]$Title)
        Write-Host "  STEP $Step of $Total`: $Title" -ForegroundColor $cPrompt
        Write-Host '  ─────────────────────────────────────────────────────────' -ForegroundColor $cMuted
        Write-Host ''
    }

    # Determine which steps to show and compute dynamic numbering
    $skipSections = $PreSelectedSections.Count -gt 0
    $skipOutput   = $PreSelectedOutputFolder -ne ''
    $totalSteps   = 4  # Tenant + Auth + Report Options + Confirmation are always shown
    if (-not $skipSections) { $totalSteps++ }
    if (-not $skipOutput)   { $totalSteps++ }
    $currentStep  = 0

    # ================================================================
    # STEP: Select Assessment Sections (skipped when -Section provided)
    # ================================================================
    if ($skipSections) {
        $selectedSections = $PreSelectedSections
    }
    else {
        $step1Done = $false
        while (-not $step1Done) {
            Show-Header
            $currentStep = 1
            Show-StepHeader -Step $currentStep -Total $totalSteps -Title 'Select Assessment Sections'
            Write-Host '  Toggle sections by number, separated by spaces (e.g. 3 or 1 5 10).' -ForegroundColor $cNormal
            Write-Host '  Press ENTER when done.' -ForegroundColor $cMuted
            Write-Host ''

            foreach ($key in $sections.Keys) {
                $s = $sections[$key]
                $marker = if ($s.Selected) { '●' } else { '○' }
                $color = if ($s.Selected) { $cNormal } else { $cMuted }
                Write-Host "  [$key] $marker $($s.Label)" -ForegroundColor $color
            }

            Write-Host ''
            Write-Host '  [S] Standard    [A] Select all    [N] Select none' -ForegroundColor $cPrompt
            Write-Host ''
            Write-Host '  > ' -ForegroundColor $cPrompt -NoNewline
            $userChoice = (Read-Host) ?? ''

            switch ($userChoice.Trim().ToUpper()) {
                'S' {
                    $optInSections = @('Inventory', 'ActiveDirectory')
                    $rebuilt = [ordered]@{}
                    foreach ($k in @($sections.Keys)) {
                        $rebuilt["$k"] = @{ Name = $sections[$k].Name; Label = $sections[$k].Label; Selected = ($sections[$k].Name -notin $optInSections) }
                    }
                    $sections = $rebuilt
                }
                'A' {
                    $rebuilt = [ordered]@{}
                    foreach ($k in @($sections.Keys)) {
                        $rebuilt["$k"] = @{ Name = $sections[$k].Name; Label = $sections[$k].Label; Selected = $true }
                    }
                    $sections = $rebuilt
                }
                'N' {
                    $rebuilt = [ordered]@{}
                    foreach ($k in @($sections.Keys)) {
                        $rebuilt["$k"] = @{ Name = $sections[$k].Name; Label = $sections[$k].Label; Selected = $false }
                    }
                    $sections = $rebuilt
                }
                '' {
                    $selectedNames = @($sections.Values | Where-Object { $_.Selected } | ForEach-Object { $_.Name })
                    if ($selectedNames.Count -eq 0) {
                        Write-Host ''
                        Write-Host '  ✗ Please select at least one section.' -ForegroundColor $cError
                        Start-Sleep -Seconds $errorDisplayDelay
                    }
                    else {
                        $step1Done = $true
                    }
                }
                default {
                    $tokens = $userChoice.Trim() -split '[,\s]+'
                    foreach ($token in $tokens) {
                        $num = 0
                        if ($token -ne '' -and [int]::TryParse($token, [ref]$num) -and $sections.Contains("$num")) {
                            $sections["$num"].Selected = -not $sections["$num"].Selected
                        }
                    }
                }
            }
        }

        $selectedSections = @($sections.Values | Where-Object { $_.Selected } | ForEach-Object { $_.Name })
    }

    # ================================================================
    # STEP: Tenant Identity
    # ================================================================
    $currentStep++
    Show-Header
    Show-StepHeader -Step $currentStep -Total $totalSteps -Title 'Tenant Identity'
    Write-Host '  Enter your tenant ID or domain' -ForegroundColor $cNormal
    Write-Host '  (e.g., contoso.onmicrosoft.com):' -ForegroundColor $cMuted
    Write-Host ''
    Write-Host '  > ' -ForegroundColor $cPrompt -NoNewline
    $tenantInput = (Read-Host) ?? ''

    # ================================================================
    # STEP: Authentication Method
    # ================================================================
    $currentStep++
    $step3Done = $false
    $authMethod = 'Interactive'
    $wizClientId = ''
    $wizCertThumb = ''
    $wizUpn = ''

    while (-not $step3Done) {
        Show-Header
        Show-StepHeader -Step $currentStep -Total $totalSteps -Title 'Authentication Method'

        Write-Host '  [1] Interactive login (browser popup)' -ForegroundColor $cNormal
        Write-Host '  [2] Device code login (choose your browser)' -ForegroundColor $cNormal
        Write-Host '  [3] Certificate-based (app-only)' -ForegroundColor $cNormal
        Write-Host '  [4] Skip connection (already connected)' -ForegroundColor $cNormal
        Write-Host ''
        Write-Host '  > ' -ForegroundColor $cPrompt -NoNewline
        $authInput = (Read-Host) ?? ''

        switch ($authInput.Trim()) {
            '1' {
                $authMethod = 'Interactive'
                Write-Host ''
                Write-Host '  Enter admin UPN for EXO/Purview (optional, press ENTER to skip):' -ForegroundColor $cNormal
                Write-Host '  > ' -ForegroundColor $cPrompt -NoNewline
                $wizUpn = (Read-Host) ?? ''
                $step3Done = $true
            }
            '2' {
                $authMethod = 'DeviceCode'
                $step3Done = $true
            }
            '3' {
                $authMethod = 'Certificate'
                Write-Host ''
                Write-Host '  Enter Application (Client) ID:' -ForegroundColor $cNormal
                Write-Host '  > ' -ForegroundColor $cPrompt -NoNewline
                $wizClientId = (Read-Host) ?? ''
                Write-Host '  Enter Certificate Thumbprint:' -ForegroundColor $cNormal
                Write-Host '  > ' -ForegroundColor $cPrompt -NoNewline
                $wizCertThumb = (Read-Host) ?? ''
                $step3Done = $true
            }
            '4' {
                $authMethod = 'Skip'
                $step3Done = $true
            }
            default {
                Write-Host '  ✗ Please enter 1, 2, 3, or 4.' -ForegroundColor $cError
                Start-Sleep -Seconds $errorDisplayDelay
            }
        }
    }

    # ================================================================
    # STEP: Output Folder (skipped when -OutputFolder provided)
    # ================================================================
    if ($skipOutput) {
        $wizOutputFolder = $PreSelectedOutputFolder
    }
    else {
        $currentStep++
        $defaultOutput = '.\M365-Assessment'
        Show-Header
        Show-StepHeader -Step $currentStep -Total $totalSteps -Title 'Output Folder'
        Write-Host '  Assessment results will be saved to:' -ForegroundColor $cNormal
        Write-Host "    $defaultOutput\" -ForegroundColor $cSuccess
        Write-Host ''
        Write-Host '  Press ENTER to accept, or type a custom path:' -ForegroundColor $cMuted
        do {
            $outputValid = $true
            Write-Host '  > ' -ForegroundColor $cPrompt -NoNewline
            $outputInput = (Read-Host) ?? ''
            if ($outputInput.Trim()) {
                if ($outputInput.Trim() -match '@') {
                    Write-Host ''
                    Write-Host '  That looks like an email address or UPN, not a folder path.' -ForegroundColor $cError
                    Write-Host "  Press ENTER to use the default ($defaultOutput), or type a valid path:" -ForegroundColor $cMuted
                    $outputValid = $false
                }
                elseif ($outputInput.Trim() -match '[<>"|?*]') {
                    Write-Host ''
                    Write-Host '  Path contains invalid characters ( < > " | ? * ).' -ForegroundColor $cError
                    Write-Host "  Press ENTER to use the default ($defaultOutput), or type a valid path:" -ForegroundColor $cMuted
                    $outputValid = $false
                }
            }
        } while (-not $outputValid)
        $wizOutputFolder = if ($outputInput.Trim()) { $outputInput.Trim() } else { $defaultOutput }
    }

    # ================================================================
    # STEP: Report Options
    # ================================================================
    $currentStep++
    $reportOptions = [ordered]@{
        '1' = @{ Name = 'ComplianceOverview'; Label = 'Compliance Overview';  Selected = $true }
        '2' = @{ Name = 'CoverPage';          Label = 'Cover Page';           Selected = $true }
        '3' = @{ Name = 'ExecutiveSummary';    Label = 'Executive Summary';    Selected = $true }
        '4' = @{ Name = 'NoBranding';          Label = 'Remove Branding';      Selected = $false }
        '5' = @{ Name = 'LimitFrameworks';     Label = 'Limit Frameworks';     Selected = $false }
        '6' = @{ Name = 'QuickScan';           Label = 'Quick Scan (Critical + High only)'; Selected = $false }
    }
    $wizFrameworkFilter = @()

    # Framework family definitions for the sub-selector
    $fwFamilies = [ordered]@{
        '1'  = @{ Family = 'CIS';       Label = 'CIS Benchmarks';                    Selected = $true }
        '2'  = @{ Family = 'NIST';      Label = 'NIST 800-53 / CSF';                 Selected = $true }
        '3'  = @{ Family = 'ISO';       Label = 'ISO 27001:2022';                    Selected = $true }
        '4'  = @{ Family = 'STIG';      Label = 'DISA STIG';                         Selected = $true }
        '5'  = @{ Family = 'PCI';       Label = 'PCI DSS v4';                        Selected = $true }
        '6'  = @{ Family = 'CMMC';      Label = 'CMMC 2.0';                          Selected = $true }
        '7'  = @{ Family = 'HIPAA';     Label = 'HIPAA Security Rule';               Selected = $true }
        '8'  = @{ Family = 'CISA';      Label = 'CISA SCuBA';                        Selected = $true }
        '9'  = @{ Family = 'SOC2';      Label = 'SOC 2 TSC';                         Selected = $true }
        '10' = @{ Family = 'FedRAMP';   Label = 'FedRAMP';                           Selected = $true }
        '11' = @{ Family = 'Essential8'; Label = 'Essential Eight';                   Selected = $true }
        '12' = @{ Family = 'MITRE';     Label = 'MITRE ATT&CK';                      Selected = $true }
        '13' = @{ Family = 'CISv8';     Label = 'CIS Controls v8';                   Selected = $true }
    }
    $fwTotalCount = $fwFamilies.Count

    $reportStepDone = $false
    while (-not $reportStepDone) {
        Show-Header
        Show-StepHeader -Step $currentStep -Total $totalSteps -Title 'Report Options'
        Write-Host '  Toggle options by number, separated by spaces.' -ForegroundColor $cNormal
        Write-Host '  Press ENTER when done.' -ForegroundColor $cMuted
        Write-Host ''

        foreach ($key in $reportOptions.Keys) {
            $opt = $reportOptions[$key]
            $marker = if ($opt.Selected) { [char]0x25CF } else { [char]0x25CB }
            $color = if ($opt.Selected) { $cNormal } else { $cMuted }
            $extra = ''
            if ($opt.Name -eq 'LimitFrameworks') {
                if ($opt.Selected) {
                    $selectedCount = @($fwFamilies.Values | Where-Object { $_.Selected }).Count
                    $extra = "  ($selectedCount of $fwTotalCount selected)"
                }
                else {
                    $extra = "  (showing all $fwTotalCount)"
                }
            }
            Write-Host "  [$key] $marker $($opt.Label)$extra" -ForegroundColor $color
        }

        Write-Host ''
        Write-Host '  > ' -ForegroundColor $cPrompt -NoNewline
        $reportChoice = (Read-Host) ?? ''

        switch ($reportChoice.Trim().ToUpper()) {
            '' { $reportStepDone = $true }
            default {
                $tokens = $reportChoice.Trim() -split '[,\s]+'
                foreach ($token in $tokens) {
                    $num = 0
                    if ($token -ne '' -and [int]::TryParse($token, [ref]$num) -and $reportOptions.Contains("$num")) {
                        $reportOptions["$num"].Selected = -not $reportOptions["$num"].Selected
                        # When Limit Frameworks is toggled on, enter the framework sub-selector
                        if ($num -eq 5 -and $reportOptions['5'].Selected) {
                            $fwSubDone = $false
                            while (-not $fwSubDone) {
                                Show-Header
                                Show-StepHeader -Step $currentStep -Total $totalSteps -Title 'Report Options > Frameworks'
                                Write-Host '  Toggle frameworks by number. Press ENTER when done.' -ForegroundColor $cNormal
                                Write-Host ''

                                foreach ($fwKey in $fwFamilies.Keys) {
                                    $fw = $fwFamilies[$fwKey]
                                    $fwMarker = if ($fw.Selected) { [char]0x25CF } else { [char]0x25CB }
                                    $fwColor = if ($fw.Selected) { $cNormal } else { $cMuted }
                                    $pad = if ([int]$fwKey -lt 10) { ' ' } else { '' }
                                    Write-Host "  $pad[$fwKey] $fwMarker $($fw.Label)" -ForegroundColor $fwColor
                                }

                                Write-Host ''
                                Write-Host '  [A] Select all    [N] Select none' -ForegroundColor $cPrompt
                                Write-Host ''
                                Write-Host '  > ' -ForegroundColor $cPrompt -NoNewline
                                $fwChoice = (Read-Host) ?? ''

                                switch ($fwChoice.Trim().ToUpper()) {
                                    '' { $fwSubDone = $true }
                                    'A' {
                                        foreach ($k in @($fwFamilies.Keys)) { $fwFamilies[$k].Selected = $true }
                                    }
                                    'N' {
                                        foreach ($k in @($fwFamilies.Keys)) { $fwFamilies[$k].Selected = $false }
                                    }
                                    default {
                                        $fwTokens = $fwChoice.Trim() -split '[,\s]+'
                                        foreach ($fwToken in $fwTokens) {
                                            $fwNum = 0
                                            if ($fwToken -ne '' -and [int]::TryParse($fwToken, [ref]$fwNum) -and $fwFamilies.Contains("$fwNum")) {
                                                $fwFamilies["$fwNum"].Selected = -not $fwFamilies["$fwNum"].Selected
                                            }
                                        }
                                    }
                                }
                            }

                            # Build the filter list from selected families
                            $wizFrameworkFilter = @($fwFamilies.Values | Where-Object { $_.Selected } | ForEach-Object { $_.Family })
                            # If all are selected, clear the filter (no filtering needed)
                            if ($wizFrameworkFilter.Count -eq $fwTotalCount) {
                                $reportOptions['5'].Selected = $false
                                $wizFrameworkFilter = @()
                            }
                            elseif ($wizFrameworkFilter.Count -eq 0) {
                                Write-Host ''
                                Write-Host '  At least one framework must be selected. Filter disabled.' -ForegroundColor $cError
                                $reportOptions['5'].Selected = $false
                                Start-Sleep -Seconds $errorDisplayDelay
                            }
                        }
                        # When toggled off, reset all families to selected
                        elseif ($num -eq 5 -and -not $reportOptions['5'].Selected) {
                            $wizFrameworkFilter = @()
                            foreach ($k in @($fwFamilies.Keys)) { $fwFamilies[$k].Selected = $true }
                        }
                    }
                }
            }
        }
    }

    # ================================================================
    # Confirmation
    # ================================================================
    Show-Header

    $sectionDisplay = $selectedSections -join ', '
    $tenantDisplay = if ($tenantInput.Trim()) { $tenantInput.Trim() } else { '(not specified)' }
    $authDisplay = switch ($authMethod) {
        'Interactive'  {
            if ($wizUpn.Trim()) { "Interactive login ($($wizUpn.Trim()))" }
            else { 'Interactive login' }
        }
        'DeviceCode'   { 'Device code login' }
        'Certificate'  { 'Certificate-based (app-only)' }
        'Skip'         { 'Pre-existing connections' }
    }

    Write-Host '  ═══════════════════════════════════════════════════════' -ForegroundColor $cBorder
    Write-Host ''
    Write-Host '  Ready to start assessment:' -ForegroundColor $cPrompt
    Write-Host ''
    Write-Host "    Sections:  $sectionDisplay" -ForegroundColor $cNormal
    Write-Host "    Tenant:    $tenantDisplay" -ForegroundColor $cNormal
    Write-Host "    Auth:      $authDisplay" -ForegroundColor $cNormal
    if ($M365Environment -ne 'commercial') {
        Write-Host "    Cloud:     $M365Environment" -ForegroundColor $cNormal
    }
    Write-Host "    Output:    $wizOutputFolder\" -ForegroundColor $cNormal

    # Report options summary
    $reportIncludes = @()
    if ($reportOptions['1'].Selected) { $reportIncludes += 'Compliance Overview' }
    if ($reportOptions['2'].Selected) { $reportIncludes += 'Cover Page' }
    if ($reportOptions['3'].Selected) { $reportIncludes += 'Executive Summary' }
    $reportExcludes = @()
    if (-not $reportOptions['1'].Selected) { $reportExcludes += 'Compliance Overview' }
    if (-not $reportOptions['2'].Selected) { $reportExcludes += 'Cover Page' }
    if (-not $reportOptions['3'].Selected) { $reportExcludes += 'Executive Summary' }
    if ($reportOptions['4'].Selected) { $reportExcludes += 'Branding' }
    $reportDisplay = if ($reportIncludes.Count -eq 3 -and $reportExcludes.Count -eq 0) { 'All sections, branded' } else { $reportIncludes -join ', ' }
    Write-Host "    Report:    $reportDisplay" -ForegroundColor $cNormal
    if ($reportExcludes.Count -gt 0) {
        Write-Host "    Skipping:  $($reportExcludes -join ', ')" -ForegroundColor $cMuted
    }
    if ($wizFrameworkFilter.Count -gt 0) {
        Write-Host "    Frameworks: $($wizFrameworkFilter -join ', ') ($($wizFrameworkFilter.Count) of $fwTotalCount)" -ForegroundColor $cNormal
    }
    Write-Host ''
    Write-Host '  Press ENTER to begin, or Q to quit.' -ForegroundColor $cPrompt
    Write-Host '  > ' -ForegroundColor $cPrompt -NoNewline
    $confirmInput = (Read-Host) ?? ''

    if ($confirmInput.Trim().ToUpper() -eq 'Q') {
        Write-Host ''
        Write-Host '  Assessment cancelled.' -ForegroundColor $cMuted
        return $null
    }

    # Build result hashtable
    $wizardResult = @{
        Section      = $selectedSections
        OutputFolder = $wizOutputFolder
    }

    # Report options
    if (-not $reportOptions['1'].Selected) { $wizardResult['SkipComplianceOverview'] = $true }
    if (-not $reportOptions['2'].Selected) { $wizardResult['SkipCoverPage'] = $true }
    if (-not $reportOptions['3'].Selected) { $wizardResult['SkipExecutiveSummary'] = $true }
    if ($reportOptions['4'].Selected) { $wizardResult['NoBranding'] = $true }
    if ($wizFrameworkFilter.Count -gt 0) { $wizardResult['FrameworkFilter'] = $wizFrameworkFilter }
    if ($reportOptions['6'].Selected) { $wizardResult['QuickScan'] = $true }

    if ($tenantInput.Trim()) {
        $wizardResult['TenantId'] = $tenantInput.Trim()
    }

    switch ($authMethod) {
        'Skip' {
            $wizardResult['SkipConnection'] = $true
        }
        'Certificate' {
            if ($wizClientId.Trim()) { $wizardResult['ClientId'] = $wizClientId.Trim() }
            if ($wizCertThumb.Trim()) { $wizardResult['CertificateThumbprint'] = $wizCertThumb.Trim() }
        }
        'DeviceCode' {
            $wizardResult['UseDeviceCode'] = $true
        }
        'Interactive' {
            if ($wizUpn.Trim()) { $wizardResult['UserPrincipalName'] = $wizUpn.Trim() }
        }
    }

    return $wizardResult
}
