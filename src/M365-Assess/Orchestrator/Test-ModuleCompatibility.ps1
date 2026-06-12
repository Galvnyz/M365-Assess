function Get-CompatibleExoModule {
    <#
    .SYNOPSIS
        Returns the newest installed ExchangeOnlineManagement version that is
        compatible with the Graph SDK in the same session, or $null.
    .DESCRIPTION
        EXO 3.8.0+ bundles an MSAL (Microsoft.Identity.Client) that conflicts
        with Graph SDK 2.x when both load in one PowerShell session — tracked
        upstream (msgraph-sdk-powershell#3576, still unfixed as of EXO 3.10.0)
        and locally as #231. Versions below 3.8.0 can be installed side-by-side
        with newer ones; this helper picks the newest compatible install so the
        connector can pin its import instead of forcing an uninstall.
    .EXAMPLE
        $exo = Get-CompatibleExoModule
        if ($exo) { Import-Module ExchangeOnlineManagement -RequiredVersion $exo.Version }
    #>
    [CmdletBinding()]
    [OutputType([object])]
    param()

    Get-Module -Name ExchangeOnlineManagement -ListAvailable -ErrorAction SilentlyContinue |
        Where-Object { $_.Version -lt [version]'3.8.0' } |
        Sort-Object -Property Version -Descending |
        Select-Object -First 1
}

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
    $exoCompatible = Get-CompatibleExoModule
    $graphModule = Get-Module -Name Microsoft.Graph.Authentication -ListAvailable -ErrorAction SilentlyContinue |
        Sort-Object -Property Version -Descending | Select-Object -First 1

    # EXO 3.8.0+ MSAL conflict (only if EXO is needed). A compatible (< 3.8.0)
    # version installed side-by-side satisfies the requirement: the connector
    # pins its import to it, and newer versions stay installed for other
    # tooling (#231). Only when NO compatible version exists do we ask for a
    # side-by-side 3.7.1 install — never an uninstall.
    if ($needsExo -and $exoModule -and $exoModule.Version -ge [version]'3.8.0') {
        if ($exoCompatible) {
            Write-AssessmentLog -Level INFO -Message "ExchangeOnlineManagement $($exoModule.Version) is MSAL-conflicting; session pins $($exoCompatible.Version) installed side-by-side" -Section 'Setup'
            Write-Host "    i ExchangeOnlineManagement $($exoCompatible.Version) will be used this session ($($exoModule.Version) stays installed for other tooling)" -ForegroundColor DarkGray
        }
        else {
            $repairActions.Add([PSCustomObject]@{
                Module          = 'ExchangeOnlineManagement'
                Issue           = "Version $($exoModule.Version) has MSAL conflicts (need <= 3.7.1 installed side-by-side)"
                Severity        = 'Required'
                Tier            = 'Downgrade'
                RequiredVersion = '3.7.1'
                InstallCmd      = 'Install-Module ExchangeOnlineManagement -RequiredVersion 3.7.1 -Scope CurrentUser -Force'
                Description     = "ExchangeOnlineManagement $($exoModule.Version) ΓÇö MSAL conflict (3.7.1 will be installed side-by-side)"
            })

            # msalruntime.dll ΓÇö Windows only, EXO 3.8.0+ (only relevant while a
            # conflicting version is the sole install)
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

            # Step 3: Tier 2 ΓÇö EXO compatible-version install (separate confirmation).
            # Side-by-side: installs 3.7.1 WITHOUT uninstalling newer versions, so
            # other tooling that needs EXO 3.8+ keeps working (#231).
            $downgradeActions = @($repairActions | Where-Object { $_.Tier -eq 'Downgrade' })
            foreach ($action in $downgradeActions) {
                Write-Host ''
                Write-Host "  ΓÜá $($action.Module) $($action.Issue)" -ForegroundColor Yellow
                Write-Host "    This installs $($action.RequiredVersion) side-by-side; newer versions stay installed." -ForegroundColor Yellow
                $response = Read-Host "  Install $($action.Module) $($action.RequiredVersion) alongside? [Y/n]"
                if ($response -match '^[Yy]?$') {
                    try {
                        Write-Host "    Installing $($action.Module) $($action.RequiredVersion)..." -ForegroundColor Cyan
                        Install-Module -Name $action.Module -RequiredVersion $action.RequiredVersion -Scope CurrentUser -Force -ErrorAction Stop
                        Write-Host "    Γ£ô $($action.Module) $($action.RequiredVersion) installed (side-by-side)" -ForegroundColor Green
                    }
                    catch {
                        Write-Host "    Γ£ù EXO $($action.RequiredVersion) install failed: $_" -ForegroundColor Red
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
            $exoCompatible = Get-CompatibleExoModule
            $graphModule = Get-Module -Name Microsoft.Graph.Authentication -ListAvailable -ErrorAction SilentlyContinue |
                Sort-Object -Property Version -Descending | Select-Object -First 1

            $stillBroken = @()
            if ($needsGraph -and -not $graphModule) {
                $stillBroken += 'Install-Module -Name Microsoft.Graph.Authentication -Scope CurrentUser -Force'
            }
            if ($needsExo -and -not $exoCompatible) {
                # Covers both "not installed at all" and "only MSAL-conflicting
                # versions installed" — the fix is the same side-by-side install.
                $stillBroken += 'Install-Module -Name ExchangeOnlineManagement -RequiredVersion 3.7.1 -Scope CurrentUser -Force'
            }
            # Re-check msalruntime.dll ΓÇö only relevant while a conflicting EXO
            # version remains the sole install
            if ($needsExo -and -not $exoCompatible -and $exoModule -and $exoModule.Version -ge [version]'3.8.0' -and ($IsWindows -or $null -eq $IsWindows)) {
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
                # EXO reports the version the session will actually pin, not the
                # highest installed (newer MSAL-conflicting versions may coexist)
                $mod = if ($modName -eq 'ExchangeOnlineManagement') {
                    Get-CompatibleExoModule
                } else {
                    Get-Module -Name $modName -ListAvailable -ErrorAction SilentlyContinue |
                        Sort-Object -Property Version -Descending | Select-Object -First 1
                }
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
