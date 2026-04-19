# ------------------------------------------------------------------
# Helper: Assert-GraphConnection — verify Graph SDK is connected
# Returns $true if connected, $false (with Write-Error) if not.
# Used by collectors to fail fast with a consistent message.
# ------------------------------------------------------------------
function Assert-GraphConnection {
    [CmdletBinding()]
    [OutputType([bool])]
    param()

    try {
        $context = Get-MgContext
        if (-not $context) {
            Write-Error "Not connected to Microsoft Graph. Run Connect-Service -Service Graph first."
            return $false
        }
    }
    catch {
        Write-Error "Not connected to Microsoft Graph. Run Connect-Service -Service Graph first."
        return $false
    }
    return $true
}

function Test-GraphTokenValid {
    [CmdletBinding()]
    [OutputType([bool])]
    param()
    try {
        $ctx = Get-MgContext
        return ($null -ne $ctx -and $null -ne $ctx.TenantId)
    }
    catch {
        return $false
    }
}

function Export-AssessmentCsv {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$Data,

        [Parameter(Mandatory)]
        [string]$Label
    )

    if ($Data.Count -eq 0) {
        return 0
    }

    $Data | Export-Csv -Path $Path -NoTypeInformation -Encoding UTF8
    Write-Verbose "$Label`: Exported $($Data.Count) items to $Path"
    return $Data.Count
}

# ------------------------------------------------------------------
# Helper: Write-AssessmentLog — timestamped log file entries
# ------------------------------------------------------------------
function Write-AssessmentLog {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateSet('INFO', 'WARN', 'ERROR')]
        [string]$Level,

        [Parameter(Mandatory)]
        [string]$Message,

        [Parameter()]
        [string]$Detail,

        [Parameter()]
        [string]$Section,

        [Parameter()]
        [string]$Collector
    )

    if (-not $script:logFilePath) { return }

    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'
    $prefix = "[$ts] [$Level]"
    if ($Section) { $prefix += " [$Section]" }
    if ($Collector) { $prefix += " [$Collector]" }

    $logLine = "$prefix $Message"
    Add-Content -Path $script:logFilePath -Value $logLine -Encoding UTF8

    if ($Detail) {
        $detailLines = $Detail -split "`n" | ForEach-Object { "    $_" }
        foreach ($line in $detailLines) {
            Add-Content -Path $script:logFilePath -Value $line -Encoding UTF8
        }
    }
}

# ------------------------------------------------------------------
# Helper: Get-RecommendedAction — match error to guidance
# ------------------------------------------------------------------
function Get-RecommendedAction {
    [CmdletBinding()]
    param([string]$ErrorMessage)

    $actionPatterns = @(
        @{ Pattern = 'WAM|broker|RuntimeBroker'; Action = 'WAM broker issue. Try -UseDeviceCode (choose your browser profile), -UserPrincipalName admin@tenant.onmicrosoft.com, certificate auth (-ClientId/-CertificateThumbprint), or -SkipConnection with a pre-existing session.' }
        @{ Pattern = '401|Unauthorized'; Action = 'Re-authenticate or ensure admin consent has been granted for the required scopes.' }
        @{ Pattern = '403|Forbidden|Insufficient privileges'; Action = 'Grant the required Graph/API permissions to the app registration or user account.' }
        @{ Pattern = 'not recognized|not found|not installed'; Action = 'Ensure the required PowerShell module is installed and the service is connected.' }
        @{ Pattern = 'not connected'; Action = 'Connect to the required service before running this section. Check connection errors above.' }
        @{ Pattern = 'timeout|timed out'; Action = 'Network timeout. Check connectivity and retry.' }
    )

    foreach ($entry in $actionPatterns) {
        if ($ErrorMessage -match $entry.Pattern) {
            return $entry.Action
        }
    }
    return 'Review the error details in _Assessment-Log.txt and retry.'
}

# ------------------------------------------------------------------
# Helper: Export-IssueReport — write _Assessment-Issues.log
# ------------------------------------------------------------------
function Export-IssueReport {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$Issues,

        [Parameter()]
        [string]$TenantName,

        [Parameter()]
        [string]$OutputPath,

        [Parameter()]
        [string]$Version
    )

    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add('=' * 80)
    $lines.Add('  M365 Assessment Issue Report')
    if ($Version) { $lines.Add("  Version:   v$Version") }
    $lines.Add("  Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
    if ($TenantName) { $lines.Add("  Tenant:    $TenantName") }
    if ($OutputPath) { $lines.Add("  Output:    $OutputPath") }
    $lines.Add('=' * 80)
    $lines.Add('')

    $total = $Issues.Count
    $idx = 0
    foreach ($issue in $Issues) {
        $idx++
        $lines.Add("--- Issue $idx / $total " + ('-' * 50))
        $lines.Add("Severity:    $($issue.Severity)")
        $lines.Add("Section:     $($issue.Section)")
        $lines.Add("Collector:   $($issue.Collector)")
        $lines.Add("Description: $($issue.Description)")
        $lines.Add("Error:       $($issue.ErrorMessage)")
        $lines.Add("Action:      $($issue.Action)")
        $lines.Add('-' * 72)
        $lines.Add('')
    }

    $errorCount = ($Issues | Where-Object { $_.Severity -eq 'ERROR' }).Count
    $warnCount = ($Issues | Where-Object { $_.Severity -eq 'WARNING' }).Count
    $infoCount = ($Issues | Where-Object { $_.Severity -eq 'INFO' }).Count

    $lines.Add('=' * 80)
    $lines.Add("  Summary: $errorCount errors, $warnCount warnings, $infoCount info")
    $lines.Add('=' * 80)

    Set-Content -Path $Path -Value ($lines -join "`n") -Encoding UTF8
}

# ------------------------------------------------------------------
# Console display helpers (colorblind-friendly palette)
# ------------------------------------------------------------------
function Show-AssessmentHeader {
    [CmdletBinding()]
    param([string]$TenantName, [string]$OutputPath, [string]$LogPath, [string]$Version)

    $e     = [char]27
    $reset = "${e}[0m"

    # M365 (rows 0-8) then ASSESS (rows 9-17) — gradient neon magenta → teal across all 18
    [string[]]$art = @(
        ' ____________/\\\\____________/\\\\_____/\\\\\\\\\\_____________/\\\\\___/\\\\\\\\\\\\\\\____________',
        '  ___________\/\\\\\\________/\\\\\\___/\\\///////\\\________/\\\\////___\/\\\///////////_____________',
        '   ___________\/\\\//\\\____/\\\//\\\__\///______/\\\______/\\\///________\/\\\________________________',
        '    ___________\/\\\\///\\\/\\\/_\/\\\_________/\\\//_____/\\\\\\\\\\\_____\/\\\\\\\\\\\\_______________',
        '     ___________\/\\\__\///\\\/___\/\\\________\////\\\___/\\\\///////\\\___\////////////\\\_____________',
        '      ___________\/\\\____\///_____\/\\\___________\//\\\_\/\\\______\//\\\_____________\//\\\____________',
        '       ___________\/\\\_____________\/\\\__/\\\______/\\\__\//\\\______/\\\___/\\\________\/\\\____________',
        '        ___________\/\\\_____________\/\\\_\///\\\\\\\\\/____\///\\\\\\\\\/___\//\\\\\\\\\\\\\/_____________',
        '         ___________\///______________\///____\/////////________\/////////______\/////////////_______________',
        '_____/\\\\\\\\\________/\\\\\\\\\\\_______/\\\\\\\\\\\____/\\\\\\\\\\\\\\\_____/\\\\\\\\\\\_______/\\\\\\\\\\\___',
        ' ___/\\\\\\\\\\\\\____/\\\/////////\\\___/\\\/////////\\\_\/\\\///////////____/\\\/////////\\\___/\\\/////////\\\_',
        '  __/\\\/////////\\\__\//\\\______\///___\//\\\______\///__\/\\\______________\//\\\______\///___\//\\\______\///__',
        '   _\/\\\_______\/\\\___\////\\\___________\////\\\_________\/\\\\\\\\\\\_______\////\\\___________\////\\\_________',
        '    _\/\\\\\\\\\\\\\\\______\////\\\___________\////\\\______\/\\\///////___________\////\\\___________\////\\\______',
        '     _\/\\\/////////\\\_________\////\\\___________\////\\\___\/\\\_____________________\////\\\___________\////\\\___',
        '      _\/\\\_______\/\\\__/\\\______\//\\\___/\\\______\//\\\__\/\\\______________/\\\______\//\\\___/\\\______\//\\\__',
        '       _\/\\\_______\/\\\_\///\\\\\\\\\\\/___\///\\\\\\\\\\\/___\/\\\\\\\\\\\\\\\_\///\\\\\\\\\\\/___\///\\\\\\\\\\\/___ ',
        '        _\///________\///____\///////////_______\///////////_____\///////////////____\///////////_______\///////////_____'
    )

    Write-Host ''
    $n = $art.Count
    for ($i = 0; $i -lt $n; $i++) {
        $t = if ($n -gt 1) { $i / ($n - 1) } else { 0 }
        $r = [int]([math]::Round(255 * (1 - $t)))
        $g = [int]([math]::Round(200 * $t))
        $b = [int]([math]::Round(220 - 20 * $t))
        Write-Host "${e}[38;2;${r};${g};${b}m$($art[$i])${reset}"
    }
    Write-Host ''
    if ($TenantName) {
        $tenantLine = $TenantName
        if ($tenantLine.Length -gt 52) { $tenantLine = $tenantLine.Substring(0, 49) + '...' }
        Write-Host "  Target   $tenantLine" -ForegroundColor White
    }
    if ($Version) {
        Write-Host "  Version  v$Version" -ForegroundColor DarkGray
    }
    if ($OutputPath) {
        Write-Host "  Output   $OutputPath" -ForegroundColor DarkGray
    }
    if ($LogPath) {
        Write-Host "  Log      $LogPath" -ForegroundColor DarkGray
    }
    Write-Host ''
}

function Show-SectionHeader {
    [CmdletBinding()]
    param([string]$Name)

    $label = " $Name "
    $lineLength = 56
    $remaining = $lineLength - $label.Length - 3
    if ($remaining -lt 3) { $remaining = 3 }
    $line = "---${label}" + ('-' * $remaining)
    Write-Host "  $line" -ForegroundColor Cyan
}

function Show-CollectorResult {
    [CmdletBinding()]
    param(
        [string]$Label,
        [string]$Status,
        [int]$Items,
        [double]$DurationSeconds,
        [string]$ErrorMessage
    )

    $symbol = switch ($Status) {
        'Complete' { [char]0x2713 }
        'Skipped'  { [char]0x25CB }
        'Failed'   { [char]0x2717 }
        default    { '-' }
    }
    $color = switch ($Status) {
        'Complete' { 'Cyan' }
        'Skipped'  { 'DarkGray' }
        'Failed'   { 'Magenta' }
        default    { 'White' }
    }

    $labelPadded = $Label.PadRight(26)

    $detail = switch ($Status) {
        'Complete' { '{0,5} items   {1,5:F1}s' -f $Items, $DurationSeconds }
        'Skipped' {
            if ($ErrorMessage) {
                $shortErr = if ($ErrorMessage.Length -gt 28) { $ErrorMessage.Substring(0, 25) + '...' } else { $ErrorMessage }
                "skipped $([char]0x2014) $shortErr"
            }
            else { 'skipped' }
        }
        'Failed' {
            if ($ErrorMessage) {
                $shortErr = if ($ErrorMessage.Length -gt 28) { $ErrorMessage.Substring(0, 25) + '...' } else { $ErrorMessage }
                "failed  $([char]0x2014) $shortErr"
            }
            else { 'failed' }
        }
        default { '' }
    }

    Write-Host "    $symbol $labelPadded $detail" -ForegroundColor $color
}

function Show-AssessmentSummary {
    [CmdletBinding()]
    param(
        [object[]]$SummaryResults,
        [object[]]$Issues,
        [TimeSpan]$Duration,
        [string]$AssessmentFolder,
        [int]$SectionCount,
        [string]$Version
    )

    $completeCount = @($SummaryResults | Where-Object { $_.Status -eq 'Complete' }).Count
    $skippedCount = @($SummaryResults | Where-Object { $_.Status -eq 'Skipped' }).Count
    $failedCount = @($SummaryResults | Where-Object { $_.Status -eq 'Failed' }).Count
    $totalCollectors = $SummaryResults.Count

    Write-Host ''
    Write-Host '  ░▒▓████████████████████████████████████████████████▓▒░' -ForegroundColor Cyan
    Write-Host "    Assessment Complete  $([char]0x00B7)  $($Duration.ToString('mm\:ss')) elapsed" -ForegroundColor Cyan
    Write-Host '  ░▒▓████████████████████████████████████████████████▓▒░' -ForegroundColor Cyan
    Write-Host ''
    Write-Host "    Sections: $SectionCount    Collectors: $totalCollectors" -ForegroundColor White

    $statsLine = "    $([char]0x2713) Complete: $completeCount"
    if ($skippedCount -gt 0) { $statsLine += "   $([char]0x25CB) Skipped: $skippedCount" }
    if ($failedCount -gt 0) { $statsLine += "   $([char]0x2717) Failed: $failedCount" }
    Write-Host $statsLine -ForegroundColor White

    # Issues summary
    if ($Issues -and $Issues.Count -gt 0) {
        Write-Host ''
        $issueLabel = " Issues ($($Issues.Count)) "
        $issueRemaining = 56 - $issueLabel.Length - 3
        if ($issueRemaining -lt 3) { $issueRemaining = 3 }
        $issueLine = "---${issueLabel}" + ('-' * $issueRemaining)
        Write-Host "  $issueLine" -ForegroundColor Yellow

        foreach ($issue in $Issues) {
            $sym = if ($issue.Severity -eq 'ERROR') { [char]0x2717 } else { [char]0x26A0 }
            $clr = if ($issue.Severity -eq 'ERROR') { 'Magenta' } else { 'Yellow' }
            $desc = $issue.Description
            if ($desc.Length -gt 50) { $desc = $desc.Substring(0, 47) + '...' }
            $collectorDisplay = if ($issue.Collector -and $issue.Collector -ne '(connection)') {
                "$($issue.Collector) $([char]0x2014) "
            }
            elseif ($issue.Collector -eq '(connection)') {
                "$($issue.Section) $([char]0x2014) "
            }
            else { '' }
            Write-Host "    $sym ${collectorDisplay}${desc}" -ForegroundColor $clr
        }

        Write-Host ''
        $logName = if ($script:logFileName) { $script:logFileName } else { '_Assessment-Log.txt' }
        $issueName = if ($script:issueFileName) { $script:issueFileName } else { '_Assessment-Issues.log' }
        $logRelPath = if ($AssessmentFolder) { Join-Path $AssessmentFolder $logName } else { $logName }
        $issueRelPath = if ($AssessmentFolder) { Join-Path $AssessmentFolder $issueName } else { $issueName }
        Write-Host "    Full details: $logRelPath" -ForegroundColor DarkGray
        Write-Host "    Issue report: $issueRelPath" -ForegroundColor DarkGray
    }

    # Report file references
    Write-Host ''
    $reportSuffix = if ($script:domainPrefix) { "_$($script:domainPrefix)" } else { '' }
    $reportName = "_Assessment-Report${reportSuffix}.html"
    $reportRelPath = if ($AssessmentFolder) { Join-Path $AssessmentFolder $reportName } else { $reportName }
    if (Test-Path -Path $reportRelPath -ErrorAction SilentlyContinue) {
        Write-Host "    HTML report: $reportRelPath" -ForegroundColor Cyan
    }

    if ($Version) {
        Write-Host "    M365 Assessment v$Version" -ForegroundColor DarkGray
    }
    Write-Host '  ░▒▓████████████████████████████████████████████████▓▒░' -ForegroundColor Cyan
    Write-Host ''
}

# ------------------------------------------------------------------
# Helper: Get-RegistryVersion — read version from registry.json
# ------------------------------------------------------------------
function Get-RegistryVersion {
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [string]$ProjectRoot
    )

    $registryPath = Join-Path -Path $ProjectRoot -ChildPath 'controls/registry.json'
    if (-not (Test-Path -Path $registryPath)) { return '' }
    try {
        $reg = Get-Content -Path $registryPath -Raw -ErrorAction Stop | ConvertFrom-Json
        return if ($reg.dataVersion) { $reg.dataVersion }
               elseif ($reg.schemaVersion) { $reg.schemaVersion }
               else { '' }
    }
    catch { return '' }
}
