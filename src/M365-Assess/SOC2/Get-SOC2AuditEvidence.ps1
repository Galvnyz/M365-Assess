<#
.SYNOPSIS
    Collects SOC 2 audit evidence from Microsoft 365 activity logs.
.DESCRIPTION
    Queries Microsoft Graph audit logs and sign-in logs to collect evidence that
    demonstrates active monitoring and incident response for SOC 2 compliance.
    Covers both Security and Confidentiality trust principles.

    Evidence includes failed sign-in attempts, risky sign-in detections, alert
    response activity, privileged role changes, sharing events, and DLP policy
    matches over the last 30 days.

    All operations are strictly read-only (Graph GET requests only).

    DISCLAIMER: This tool assists with SOC 2 readiness assessment. It does not
    constitute a SOC 2 audit or certification.

    Requires Microsoft Graph connection with: AuditLog.Read.All,
    SecurityEvents.Read.All, IdentityRiskEvent.Read.All
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.PARAMETER EvidenceWindowDays
    Number of days to look back for evidence. Defaults to 30.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'AuditLog.Read.All','SecurityEvents.Read.All'
    PS> .\SOC2\Get-SOC2AuditEvidence.ps1

    Displays SOC 2 audit evidence summary.
.EXAMPLE
    PS> .\SOC2\Get-SOC2AuditEvidence.ps1 -OutputPath '.\soc2-evidence.csv' -EvidenceWindowDays 60

    Exports 60-day evidence window to CSV.
.NOTES
    Author:  Daren9m
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath,

    [Parameter()]
    [ValidateRange(1, 365)]
    [int]$EvidenceWindowDays = 30
)

$ErrorActionPreference = 'Stop'

# Verify Graph connection
if (-not (Assert-GraphConnection)) { return }

$results = [System.Collections.Generic.List[PSCustomObject]]::new()
$startDate = (Get-Date).AddDays(-$EvidenceWindowDays).ToString('yyyy-MM-ddTHH:mm:ssZ')

# Note: Evidence queries use $top=100 as a representative sample. For high-volume
# tenants this may not capture all events. The EventCount reflects the sample size.
# For full-population evidence, export via Microsoft Purview Audit (Premium) or
# the continuous monitoring automation described in the Daily Monitoring Strategy.

# Helper to add evidence summary
function Add-EvidenceSummary {
    param(
        [string]$TrustPrinciple,
        [string]$TSCReference,
        [string]$EvidenceId,
        [string]$EvidenceType,
        [int]$EventCount,
        [string]$TimeWindow,
        [string]$Summary,
        [string]$Status,
        [string]$SampleEvents = ''
    )
    $results.Add([PSCustomObject]@{
        TrustPrinciple = $TrustPrinciple
        TSCReference   = $TSCReference
        EvidenceId     = $EvidenceId
        EvidenceType   = $EvidenceType
        EventCount     = $EventCount
        TimeWindow     = $TimeWindow
        Summary        = $Summary
        Status         = $Status
        SampleEvents   = $SampleEvents
    })
}

$timeWindowLabel = "Last $EvidenceWindowDays days (since $($startDate.Substring(0,10)))"

# ------------------------------------------------------------------
# E-01: Failed Sign-in Attempts (CC7.2 — Security)
# ------------------------------------------------------------------
try {
    Write-Verbose "E-01: Querying failed sign-in events..."
    $failedSignIns = Invoke-MgGraphRequest -Method GET `
        -Uri "/v1.0/auditLogs/signIns?`$filter=createdDateTime ge $startDate and status/errorCode ne 0&`$top=100&`$orderby=createdDateTime desc" `
        -ErrorAction Stop
    $events = if ($failedSignIns -and $failedSignIns['value']) { @($failedSignIns['value']) } else { @() }
    $sampleCapped = $events.Count -ge 100

    $summary = if ($events.Count -eq 0) {
        'No failed sign-in attempts detected'
    } else {
        $topUsers = @($events | Group-Object -Property { $_['userPrincipalName'] } | Sort-Object -Property Count -Descending | Select-Object -First 3)
        $topUserSummary = ($topUsers | ForEach-Object { "$($_.Name): $($_.Count)" }) -join '; '
        $capNote = if ($sampleCapped) { ' (sample capped at 100; actual count may be higher)' } else { '' }
        "Top users with failures: $topUserSummary$capNote"
    }

    $sampleData = ($events | Select-Object -First 3 | ForEach-Object {
        "$($_['createdDateTime']): $($_['userPrincipalName']) - $($_['status']['failureReason'])"
    }) -join ' | '

    Add-EvidenceSummary -TrustPrinciple 'Security' -TSCReference 'CC7.2' -EvidenceId 'E-01' `
        -EvidenceType 'Failed Sign-in Attempts' -EventCount $events.Count `
        -TimeWindow $timeWindowLabel -Summary $summary -Status 'Collected' `
        -SampleEvents $sampleData
}
catch {
    Write-Warning "E-01: Failed to query sign-in logs: $_"
    Add-EvidenceSummary -TrustPrinciple 'Security' -TSCReference 'CC7.2' -EvidenceId 'E-01' `
        -EvidenceType 'Failed Sign-in Attempts' -EventCount 0 `
        -TimeWindow $timeWindowLabel -Summary "Error: $_" -Status 'Error'
}

# ------------------------------------------------------------------
# E-02: Risky Sign-in Detections (CC7.2 — Security)
# ------------------------------------------------------------------
try {
    Write-Verbose "E-02: Querying risky sign-in detections..."
    $riskDetections = Invoke-MgGraphRequest -Method GET `
        -Uri "/v1.0/identityProtection/riskDetections?`$filter=activityDateTime ge $startDate&`$top=100&`$orderby=activityDateTime desc" `
        -ErrorAction Stop
    $events = if ($riskDetections -and $riskDetections['value']) { @($riskDetections['value']) } else { @() }
    $sampleCapped = $events.Count -ge 100

    $summary = if ($events.Count -eq 0) {
        'No risky sign-in detections in the evidence window'
    } else {
        $riskTypes = @($events | Group-Object -Property { $_['riskEventType'] } | Sort-Object -Property Count -Descending | Select-Object -First 3)
        $riskSummary = ($riskTypes | ForEach-Object { "$($_.Name): $($_.Count)" }) -join '; '
        $capNote = if ($sampleCapped) { ' (sample capped at 100)' } else { '' }
        "Risk types detected: $riskSummary$capNote"
    }

    $sampleData = ($events | Select-Object -First 3 | ForEach-Object {
        "$($_['activityDateTime']): $($_['userPrincipalName']) - $($_['riskEventType']) ($($_['riskLevel']))"
    }) -join ' | '

    Add-EvidenceSummary -TrustPrinciple 'Security' -TSCReference 'CC7.2' -EvidenceId 'E-02' `
        -EvidenceType 'Risky Sign-in Detections' -EventCount $events.Count `
        -TimeWindow $timeWindowLabel -Summary $summary -Status 'Collected' `
        -SampleEvents $sampleData
}
catch {
    Write-Warning "E-02: Failed to query risk detections (may require P2 license): $_"
    $status = if ("$_" -match 'Forbidden|403|license') { 'NotLicensed' } else { 'Error' }
    Add-EvidenceSummary -TrustPrinciple 'Security' -TSCReference 'CC7.2' -EvidenceId 'E-02' `
        -EvidenceType 'Risky Sign-in Detections' -EventCount 0 `
        -TimeWindow $timeWindowLabel -Summary "Unavailable: $_ (Requires Entra ID P2 license)" -Status $status
}

# ------------------------------------------------------------------
# E-04: Alert Response Activity (CC7.3 — Security)
# ------------------------------------------------------------------
try {
    Write-Verbose "E-04: Querying security alert activity..."
    $alerts = Invoke-MgGraphRequest -Method GET `
        -Uri "/v1.0/security/alerts_v2?`$top=100&`$orderby=createdDateTime desc" `
        -ErrorAction Stop
    $events = if ($alerts -and $alerts['value']) { @($alerts['value']) } else { @() }
    $sampleCapped = $events.Count -ge 100

    $newAlerts = @($events | Where-Object { $_['status'] -eq 'new' })
    $resolvedAlerts = @($events | Where-Object { $_['status'] -eq 'resolved' })
    $inProgressAlerts = @($events | Where-Object { $_['status'] -eq 'inProgress' })

    $capNote = if ($sampleCapped) { ' (sample capped at 100)' } else { '' }
    $summary = if ($events.Count -eq 0) {
        'No security alerts generated (clean environment or no Defender configured)'
    } else {
        "Total: $($events.Count); New: $($newAlerts.Count); In Progress: $($inProgressAlerts.Count); Resolved: $($resolvedAlerts.Count)$capNote"
    }

    $sampleData = ($events | Select-Object -First 3 | ForEach-Object {
        "$($_['createdDateTime']): $($_['title']) [$($_['status'])]"
    }) -join ' | '

    Add-EvidenceSummary -TrustPrinciple 'Security' -TSCReference 'CC7.3' -EvidenceId 'E-04' `
        -EvidenceType 'Alert Response Activity' -EventCount $events.Count `
        -TimeWindow $timeWindowLabel -Summary $summary -Status 'Collected' `
        -SampleEvents $sampleData
}
catch {
    Write-Warning "E-04: Failed to query security alerts: $_"
    Add-EvidenceSummary -TrustPrinciple 'Security' -TSCReference 'CC7.3' -EvidenceId 'E-04' `
        -EvidenceType 'Alert Response Activity' -EventCount 0 `
        -TimeWindow $timeWindowLabel -Summary "Error: $_" -Status 'Error'
}

# ------------------------------------------------------------------
# E-08: Privileged Role Changes (CC6.3 — Security)
# ------------------------------------------------------------------
try {
    Write-Verbose "E-08: Querying privileged role change events..."
    $roleAudits = Invoke-MgGraphRequest -Method GET `
        -Uri "/v1.0/auditLogs/directoryAudits?`$filter=activityDateTime ge $startDate and category eq 'RoleManagement'&`$top=100&`$orderby=activityDateTime desc" `
        -ErrorAction Stop
    $events = if ($roleAudits -and $roleAudits['value']) { @($roleAudits['value']) } else { @() }
    $sampleCapped = $events.Count -ge 100

    $summary = if ($events.Count -eq 0) {
        'No privileged role changes in the evidence window'
    } else {
        $activities = @($events | Group-Object -Property { $_['activityDisplayName'] } | Sort-Object -Property Count -Descending | Select-Object -First 3)
        $actSummary = ($activities | ForEach-Object { "$($_.Name): $($_.Count)" }) -join '; '
        $capNote = if ($sampleCapped) { ' (sample capped at 100)' } else { '' }
        "Role management activities: $actSummary$capNote"
    }

    $sampleData = ($events | Select-Object -First 3 | ForEach-Object {
        $actor = if ($_['initiatedBy']['user']) { $_['initiatedBy']['user']['userPrincipalName'] } else { 'System' }
        "$($_['activityDateTime']): $($_['activityDisplayName']) by $actor"
    }) -join ' | '

    Add-EvidenceSummary -TrustPrinciple 'Security' -TSCReference 'CC6.3' -EvidenceId 'E-08' `
        -EvidenceType 'Privileged Role Changes' -EventCount $events.Count `
        -TimeWindow $timeWindowLabel -Summary $summary -Status 'Collected' `
        -SampleEvents $sampleData
}
catch {
    Write-Warning "E-08: Failed to query role change audits: $_"
    Add-EvidenceSummary -TrustPrinciple 'Security' -TSCReference 'CC6.3' -EvidenceId 'E-08' `
        -EvidenceType 'Privileged Role Changes' -EventCount 0 `
        -TimeWindow $timeWindowLabel -Summary "Error: $_" -Status 'Error'
}

# ------------------------------------------------------------------
# E-05: Sharing Events Detected (C1.1 — Confidentiality)
# ------------------------------------------------------------------
try {
    Write-Verbose "E-05: Querying SharePoint sharing events via Unified Audit Log..."
    $sharingEvents = $null
    $sharingCount = 0

    # Try UAL via EXO cmdlet
    try {
        $null = Get-Command -Name Search-UnifiedAuditLog -ErrorAction Stop
        $endDate = Get-Date
        $ualStartDate = (Get-Date).AddDays(-$EvidenceWindowDays)
        $sharingEvents = @(Search-UnifiedAuditLog -StartDate $ualStartDate -EndDate $endDate `
            -Operations 'SharingSet','SharingInvitationCreated' -ResultSize 100 -ErrorAction Stop)
        $sharingCount = $sharingEvents.Count
    }
    catch {
        Write-Verbose "UAL not available via EXO; skipping sharing event evidence."
    }

    $summary = if ($null -eq $sharingEvents) {
        'Unable to query (requires EXO connection for Unified Audit Log)'
    } elseif ($sharingCount -eq 0) {
        'No sharing events detected in the evidence window'
    } else {
        "$sharingCount sharing events detected"
    }

    $status = if ($null -eq $sharingEvents) { 'Review' } else { 'Collected' }

    Add-EvidenceSummary -TrustPrinciple 'Confidentiality' -TSCReference 'C1.1' -EvidenceId 'E-05' `
        -EvidenceType 'Sharing Events Detected' -EventCount $sharingCount `
        -TimeWindow $timeWindowLabel -Summary $summary -Status $status
}
catch {
    Write-Warning "E-05: Failed to query sharing events: $_"
    Add-EvidenceSummary -TrustPrinciple 'Confidentiality' -TSCReference 'C1.1' -EvidenceId 'E-05' `
        -EvidenceType 'Sharing Events Detected' -EventCount 0 `
        -TimeWindow $timeWindowLabel -Summary "Error: $_" -Status 'Error'
}

# ------------------------------------------------------------------
# E-07: DLP Policy Matches (C1.2 — Confidentiality)
# ------------------------------------------------------------------
try {
    Write-Verbose "E-07: Querying DLP policy match events via Unified Audit Log..."
    $dlpEvents = $null
    $dlpCount = 0

    # Try UAL via EXO cmdlet
    try {
        $null = Get-Command -Name Search-UnifiedAuditLog -ErrorAction Stop
        $endDate = Get-Date
        $ualStartDate = (Get-Date).AddDays(-$EvidenceWindowDays)
        $dlpEvents = @(Search-UnifiedAuditLog -StartDate $ualStartDate -EndDate $endDate `
            -Operations 'DlpRuleMatch' -ResultSize 100 -ErrorAction Stop)
        $dlpCount = $dlpEvents.Count
    }
    catch {
        Write-Verbose "UAL not available via EXO; skipping DLP event evidence."
    }

    $summary = if ($null -eq $dlpEvents) {
        'Unable to query (requires EXO connection for Unified Audit Log)'
    } elseif ($dlpCount -eq 0) {
        'No DLP policy matches in the evidence window'
    } else {
        "$dlpCount DLP policy match events detected"
    }

    $status = if ($null -eq $dlpEvents) { 'Review' } else { 'Collected' }

    Add-EvidenceSummary -TrustPrinciple 'Confidentiality' -TSCReference 'C1.2' -EvidenceId 'E-07' `
        -EvidenceType 'DLP Policy Matches' -EventCount $dlpCount `
        -TimeWindow $timeWindowLabel -Summary $summary -Status $status
}
catch {
    Write-Warning "E-07: Failed to query DLP events: $_"
    Add-EvidenceSummary -TrustPrinciple 'Confidentiality' -TSCReference 'C1.2' -EvidenceId 'E-07' `
        -EvidenceType 'DLP Policy Matches' -EventCount 0 `
        -TimeWindow $timeWindowLabel -Summary "Error: $_" -Status 'Error'
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
if ($results.Count -eq 0) {
    Write-Warning "No SOC 2 audit evidence was collected."
    return
}

Write-Verbose "SOC 2 evidence items collected: $($results.Count)"

if ($OutputPath) {
    $results | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported $($results.Count) SOC 2 evidence items to $OutputPath"
}
else {
    Write-Output $results
}
