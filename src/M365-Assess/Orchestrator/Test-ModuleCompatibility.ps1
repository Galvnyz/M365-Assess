function Test-ModuleCompatibility {
    [CmdletBinding()]
    param(
        [string[]]$Section,
        [hashtable]$SectionServiceMap,
        [switch]$NonInteractive,
        [switch]$SkipDLP
    )

    $repairActions = [System.Collections.Generic.List[PSCustomObject]]::new()

    # Determine which modules the selected sections actually require (BEFORE checking modules)
    $needsGraph   = $false
    $needsExo     = $false
    $needsPowerBI = $false
    foreach ($s in $Section) {
        $svcList = $sectionServiceMap[$s]
        if ($svcList -contains 'Graph')                                    { $needsGraph = $true }
        if ($svcList -contains 'ExchangeOnline' -or (-not $SkipDLP -and $svcList -contains 'Purview')) { $needsExo = $true }
        if ($s -eq 'PowerBI')                                               { $needsPowerBI = $true }
    }

    # Detect installed module versions
    $exoModule = Get-Module -Name ExchangeOnlineManagement -ListAvailable -ErrorAction SilentlyContinue |
        Sort-Object -Property Version -Descending | Select-Object -First 1
    $graphModule = Get-Module -Name Microsoft.Graph.Authentication -ListAvailable -ErrorAction SilentlyContinue |
        Sort-Object -Property Version -Descending | Select-Object -First 1

    # EXO 3.8.0+ MSAL conflict ΓÇö must downgrade (only if EXO is needed)
    if ($needsExo -and $exoModule -and $exoModule.Version -ge [version]'3.8.0') {
        $repairActions.Add([PSCustomObject]@{
            Module          = 'ExchangeOnlineManagement'
            Issue           = "Version $($exoModule.Version) has MSAL conflicts (need <= 3.7.1)"
            Severity        = 'Required'
            Tier            = 'Downgrade'
            RequiredVersion = '3.7.1'
            InstallCmd      = 'Uninstall-Module ExchangeOnlineManagement -AllVersions -Force; Install-Module ExchangeOnlineManagement -RequiredVersion 3.7.1 -Scope CurrentUser'
            Description     = "ExchangeOnlineManagement $($exoModule.Version) ΓÇö MSAL conflict (need <= 3.7.1)"
        })

        # msalruntime.dll ΓÇö Windows only, EXO 3.8.0+
        if ($IsWindows -or $null -eq $IsWindows) {
            $exoNetCorePath = Join-Path -Path $exoModule.ModuleBase -ChildPath 'netCore'
            $msalDllDirect = Join-Path -Path $exoNetCorePath -ChildPath 'msalruntime.dll'
            $msalDllNested = Join-Path -Path $exoNetCorePath -ChildPath 'runtimes\win-x64\native\msalruntime.dll'
            if (-not (Test-Path -Path $msalDllDirect) -and (Test-Path -Path $msalDllNested)) {
                $repairActions.Add([PSCustomObject]@{
                    Module          = 'ExchangeOnlineManagement'
                    Issue           = 'msalruntime.dll missing from load path'
                    Severity        = 'Required'
                    Tier            = 'FileCopy'
                    RequiredVersion = $null
                    InstallCmd      = "Copy-Item '$msalDllNested' '$msalDllDirect'"
                    Description     = 'msalruntime.dll ΓÇö missing from EXO module load path'
                    SourcePath      = $msalDllNested
                    DestPath        = $msalDllDirect
                })
            }
        }
    }

    # Required modules ΓÇö fatal if missing
    if ($needsGraph -and -not $graphModule) {
        $repairActions.Add([PSCustomObject]@{
            Module          = 'Microsoft.Graph.Authentication'
            Issue           = 'Not installed'
            Severity        = 'Required'
            Tier            = 'Install'
            RequiredVersion = $null
            InstallCmd      = 'Install-Module -Name Microsoft.Graph.Authentication -Scope CurrentUser -Force'
            Description     = 'Microsoft.Graph.Authentication ΓÇö not installed'
        })
    }
    if ($needsExo -and -not $exoModule) {
        $repairActions.Add([PSCustomObject]@{
            Module          = 'ExchangeOnlineManagement'
            Issue           = 'Not installed'
            Severity        = 'Required'
            Tier            = 'Install'
            RequiredVersion = '3.7.1'
            InstallCmd      = 'Install-Module -Name ExchangeOnlineManagement -RequiredVersion 3.7.1 -Scope CurrentUser -Force'
            Description     = 'ExchangeOnlineManagement ΓÇö not installed'
        })
    }

    # Recommended modules -- core assessment features, default-install
    if ($needsPowerBI -and -not (Get-Module -Name MicrosoftPowerBIMgmt -ListAvailable -ErrorAction SilentlyContinue)) {
        $repairActions.Add([PSCustomObject]@{
            Module          = 'MicrosoftPowerBIMgmt'
            Issue           = 'Not installed'
            Severity        = 'Recommended'
            Tier            = 'Install'
            RequiredVersion = $null
            InstallCmd      = 'Install-Module -Name MicrosoftPowerBIMgmt -Scope CurrentUser -Force'
            Description     = 'MicrosoftPowerBIMgmt -- enables Power BI security checks'
        })
    }

    # ImportExcel -- needed for XLSX compliance matrix export
    if (-not (Get-Module -Name ImportExcel -ListAvailable -ErrorAction SilentlyContinue)) {
        $repairActions.Add([PSCustomObject]@{
            Module          = 'ImportExcel'
            Issue           = 'Not installed'
            Severity        = 'Recommended'
            Tier            = 'Install'
            RequiredVersion = $null
            InstallCmd      = 'Install-Module -Name ImportExcel -Scope CurrentUser -Force'
            Description     = 'ImportExcel -- enables XLSX compliance matrix export'
        })
    }

    # --- No issues? Continue ---
    if ($repairActions.Count -eq 0) {
        Write-AssessmentLog -Level INFO -Message 'Module compatibility check passed' -Section 'Setup'
    }
    else {
        # --- Present summary ---
        Write-Host ''
        Write-Host '  ΓòöΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòù' -ForegroundColor Magenta
        Write-Host '  Γòæ  Module Issues Detected                                 Γòæ' -ForegroundColor Magenta
        Write-Host '  ΓòÜΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓò¥' -ForegroundColor Magenta
        foreach ($action in $repairActions) {
            if ($action.Severity -eq 'Required') {
                Write-Host "    Γ£ù $($action.Description)" -ForegroundColor Red
            }
            else {
                Write-Host "    ΓÜá $($action.Description)" -ForegroundColor Yellow
            }
        }
        Write-Host ''

        $requiredIssues = @($repairActions | Where-Object { $_.Severity -eq 'Required' })
        $recommendedIssues = @($repairActions | Where-Object { $_.Severity -eq 'Recommended' })

        if ($NonInteractive -or -not [Environment]::UserInteractive) {
            # --- Headless: log and exit/skip ---
            if ($requiredIssues.Count -gt 0) {
                foreach ($action in $requiredIssues) {
                    Write-AssessmentLog -Level ERROR -Message "Module issue: $($action.Description). Fix: $($action.InstallCmd)"
                }
                Write-Host '  Known compatible combo: Graph SDK 2.35.x + EXO 3.7.1' -ForegroundColor DarkGray
                Write-Host ''
                Write-Error "Required modules are missing or incompatible. See assessment log for install commands."
                return
            }
            # Auto-install recommended modules in NonInteractive mode
            foreach ($action in $recommendedIssues) {
                try {
                    Write-Host "    Installing $($action.Module)..." -ForegroundColor Cyan
                    $installParams = @{
                        Name        = $action.Module
                        Scope       = 'CurrentUser'
                        Force       = $true
                        ErrorAction = 'Stop'
                    }
                    if ($action.RequiredVersion) {
                        $installParams['RequiredVersion'] = $action.RequiredVersion
                    }
                    Install-Module @installParams
                    Write-AssessmentLog -Level INFO -Message "Auto-installed recommended module: $($action.Module)"
                    Write-Host "    $([char]0x2714) $($action.Module) installed" -ForegroundColor Green
                }
                catch {
                    Write-AssessmentLog -Level WARN -Message "Failed to auto-install $($action.Module): $_"
                    if ($action.Module -eq 'MicrosoftPowerBIMgmt') {
                        $Section = @($Section | Where-Object { $_ -ne 'PowerBI' })
                    }
                }
            }
        }
        else {
            # --- Interactive: offer repairs ---
            $failedRepairs = [System.Collections.Generic.List[PSCustomObject]]::new()

            # Step 1: Auto-fix FileCopy (no prompt)
            $fileCopyActions = @($repairActions | Where-Object { $_.Tier -eq 'FileCopy' })
            foreach ($action in $fileCopyActions) {
                try {
                    Copy-Item -Path $action.SourcePath -Destination $action.DestPath -Force -ErrorAction Stop
                    Write-Host "    Γ£ô Copied msalruntime.dll to EXO module load path" -ForegroundColor Green
                }
                catch {
                    Write-Host "    Γ£ù msalruntime.dll copy failed: $_" -ForegroundColor Red
                    $failedRepairs.Add($action)
                }
            }

            # Step 2: Tier 1 ΓÇö Install missing modules
            $installActions = @($repairActions | Where-Object { $_.Tier -eq 'Install' -and $_.Severity -eq 'Required' })
            if ($installActions.Count -gt 0) {
                $response = Read-Host '  Install missing modules to CurrentUser scope? [Y/n]'
                if ($response -match '^[Yy]?$') {
                    foreach ($action in $installActions) {
                        try {
                            Write-Host "    Installing $($action.Module)..." -ForegroundColor Cyan
                            $installParams = @{
                                Name        = $action.Module
                                Scope       = 'CurrentUser'
                                Force       = $true
                                ErrorAction = 'Stop'
                            }
                            if ($action.RequiredVersion) {
                                $installParams['RequiredVersion'] = $action.RequiredVersion
                            }
                            Install-Module @installParams
                            Write-Host "    Γ£ô $($action.Module) installed" -ForegroundColor Green
                        }
                        catch {
                            Write-Host "    Γ£ù $($action.Module) failed: $_" -ForegroundColor Red
                            $failedRepairs.Add($action)
                        }
                    }
                }
            }

            # Step 3: Tier 2 ΓÇö EXO downgrade (separate confirmation)
            $downgradeActions = @($repairActions | Where-Object { $_.Tier -eq 'Downgrade' })
            foreach ($action in $downgradeActions) {
                Write-Host ''
                Write-Host "  ΓÜá $($action.Module) $($action.Issue)" -ForegroundColor Yellow
                Write-Host "    This will uninstall ALL versions and install $($action.RequiredVersion)." -ForegroundColor Yellow
                $response = Read-Host '  Proceed with EXO downgrade? [Y/n]'
                if ($response -match '^[Yy]?$') {
                    try {
                        Write-Host "    Removing $($action.Module)..." -ForegroundColor Cyan
                        Uninstall-Module -Name $action.Module -AllVersions -Force -ErrorAction Stop
                        Write-Host "    Installing $($action.Module) $($action.RequiredVersion)..." -ForegroundColor Cyan
                        Install-Module -Name $action.Module -RequiredVersion $action.RequiredVersion -Scope CurrentUser -Force -ErrorAction Stop
                        Write-Host "    Γ£ô $($action.Module) $($action.RequiredVersion) installed" -ForegroundColor Green
                    }
                    catch {
                        Write-Host "    Γ£ù EXO downgrade failed: $_" -ForegroundColor Red
                        $failedRepairs.Add($action)
                    }
                }
            }

            # Recommended modules -- prompt individually with [Y/n] default
            $recInstallActions = @($repairActions | Where-Object { $_.Tier -eq 'Install' -and $_.Severity -eq 'Recommended' })
            if ($recInstallActions.Count -gt 0) {
                $skippedNames = ($recInstallActions | ForEach-Object { $_.Module }) -join ', '
                $response = Read-Host "  Install recommended modules? ($skippedNames) [Y/n]"
                if ($response -match '^[Yy]?$') {
                    foreach ($action in $recInstallActions) {
                        try {
                            Write-Host "    Installing $($action.Module)..." -ForegroundColor Cyan
                            $installParams = @{
                                Name        = $action.Module
                                Scope       = 'CurrentUser'
                                Force       = $true
                                ErrorAction = 'Stop'
                            }
                            if ($action.RequiredVersion) {
                                $installParams['RequiredVersion'] = $action.RequiredVersion
                            }
                            Install-Module @installParams
                            Write-Host "    Γ£ô $($action.Module) installed" -ForegroundColor Green
                        }
                        catch {
                            Write-Host "    Γ£ù $($action.Module) install failed: $_" -ForegroundColor Red
                        }
                    }
                }
                else {
                    # User declined -- skip affected sections/features
                    foreach ($action in $recInstallActions) {
                        if ($action.Module -eq 'MicrosoftPowerBIMgmt') {
                            $Section = @($Section | Where-Object { $_ -ne 'PowerBI' })
                            Write-AssessmentLog -Level WARN -Message "Recommended module declined: $($action.Description). Section skipped."
                        }
                        elseif ($action.Module -eq 'ImportExcel') {
                            Write-AssessmentLog -Level WARN -Message "Recommended module declined: $($action.Description). XLSX export will be skipped."
                        }
                    }
                }
            }

            # Step 4: Re-validate after repairs
            Write-Host ''
            Write-Host '  Re-validating module compatibility...' -ForegroundColor Cyan

            # Re-detect modules
            $exoModule = Get-Module -Name ExchangeOnlineManagement -ListAvailable -ErrorAction SilentlyContinue |
                Sort-Object -Property Version -Descending | Select-Object -First 1
            $graphModule = Get-Module -Name Microsoft.Graph.Authentication -ListAvailable -ErrorAction SilentlyContinue |
                Sort-Object -Property Version -Descending | Select-Object -First 1

            $stillBroken = @()
            if ($needsGraph -and -not $graphModule) {
                $stillBroken += 'Install-Module -Name Microsoft.Graph.Authentication -Scope CurrentUser -Force'
            }
            if ($needsExo -and -not $exoModule) {
                $stillBroken += 'Install-Module -Name ExchangeOnlineManagement -RequiredVersion 3.7.1 -Scope CurrentUser -Force'
            }
            if ($needsExo -and $exoModule -and $exoModule.Version -ge [version]'3.8.0') {
                $stillBroken += 'Uninstall-Module ExchangeOnlineManagement -AllVersions -Force; Install-Module ExchangeOnlineManagement -RequiredVersion 3.7.1 -Scope CurrentUser'
            }
            # Re-check msalruntime.dll after any EXO install/downgrade
            if ($needsExo -and $exoModule -and $exoModule.Version -ge [version]'3.8.0' -and ($IsWindows -or $null -eq $IsWindows)) {
                $exoNetCorePath = Join-Path -Path $exoModule.ModuleBase -ChildPath 'netCore'
                $msalDllDirect = Join-Path -Path $exoNetCorePath -ChildPath 'msalruntime.dll'
                $msalDllNested = Join-Path -Path $exoNetCorePath -ChildPath 'runtimes\win-x64\native\msalruntime.dll'
                if (-not (Test-Path -Path $msalDllDirect) -and (Test-Path -Path $msalDllNested)) {
                    $stillBroken += "Copy-Item '$msalDllNested' '$msalDllDirect'"
                }
            }

            if ($stillBroken.Count -gt 0) {
                Write-Host ''
                Write-Host '  ΓòöΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòù' -ForegroundColor Magenta
                Write-Host '  Γòæ  Unable to resolve all module issues                    Γòæ' -ForegroundColor Magenta
                Write-Host '  ΓòÜΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓò¥' -ForegroundColor Magenta
                Write-Host '    Manual steps needed:' -ForegroundColor Red
                foreach ($cmd in $stillBroken) {
                    Write-Host "    ΓÇó $cmd" -ForegroundColor Red
                }
                Write-Host ''
                Write-Host '  Run these commands and try again.' -ForegroundColor DarkGray
                Write-Host '  Known compatible combo: Graph SDK 2.35.x + EXO 3.7.1' -ForegroundColor DarkGray
                Write-Host ''
                Write-AssessmentLog -Level ERROR -Message "Module repair incomplete: $($stillBroken -join '; ')"
                Write-Error "Required modules are still missing or incompatible. See above for manual steps."
                return
            }

            Write-Host '  Γ£ô All module issues resolved' -ForegroundColor Green

            # Show installed module versions
            $versionTable = @()
            $modChecks = @('Microsoft.Graph.Authentication', 'ExchangeOnlineManagement', 'MicrosoftPowerBIMgmt', 'ImportExcel')
            foreach ($modName in $modChecks) {
                $mod = Get-Module -Name $modName -ListAvailable -ErrorAction SilentlyContinue |
                    Sort-Object -Property Version -Descending | Select-Object -First 1
                $versionTable += [PSCustomObject]@{
                    Module  = $modName
                    Version = if ($mod) { $mod.Version.ToString() } else { '(not installed)' }
                }
            }
            $versionTable | Format-Table -AutoSize | Out-String | ForEach-Object { Write-Host $_.TrimEnd() }
            Write-Host ''
        }
    }

    return @{ Passed = $true; Section = $Section }
}
