# Get-CaReportOnly.ps1 — EPIC-015 Conditional Access Report-Only Evaluation worker (SPEC §3.5, §6; T-0289).
#
# Live Graph reads only: policies and sign-in evaluation signals are never mirrored to disk.
# Reads report-only policies (state = 'enabledForReportingButNotEnforced') and sign-in logs.
# Summarises sign-in impact: would-block (reportOnlyFailure), would-grant (reportOnlySuccess),
# affected users, affected applications, and sample evaluation events.
# The worker is read-only: only GET requests are issued.

function Read-CaReportOnlyJob {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "job envelope not found at '$Path'"
    }

    $raw = Get-Content -LiteralPath $Path -Raw
    $json = $raw | ConvertFrom-Json
    if (-not $json.tenantId) {
        throw "job envelope '$Path' is missing mandatory 'tenantId'"
    }

    return @{
        TenantId = [string]$json.tenantId
        PolicyId = if ($json.policyId) { [string]$json.policyId } else { '' }
        Top      = if ($json.top) { [int]$json.top } else { 100 }
    }
}

function Get-CaReportOnly {
    <#
    .SYNOPSIS
        Evaluates report-only Conditional Access policy impact from live Graph signals.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter()]
        [string]$PolicyId = '',

        [Parameter()]
        [int]$Top = 100
    )

    # 1. Fetch Conditional Access policies
    $policiesResp = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/identity/conditionalAccess/policies' -ErrorAction Stop
    $rawPolicies = @()
    if ($policiesResp -and $policiesResp['value']) {
        $rawPolicies = @($policiesResp['value'])
    }
    elseif ($policiesResp -and $policiesResp.value) {
        $rawPolicies = @($policiesResp.value)
    }

    # Filter to report-only policies (enabledForReportingButNotEnforced)
    $reportOnlyPolicies = @()
    foreach ($p in $rawPolicies) {
        $state = if ($p['state']) { [string]$p['state'] } else { [string]$p.state }
        if ($state -eq 'enabledForReportingButNotEnforced') {
            $policyUniqueId = if ($p['id']) { [string]$p['id'] } else { [string]$p.id }
            if ([string]::IsNullOrWhiteSpace($PolicyId) -or $policyUniqueId -eq $PolicyId) {
                $reportOnlyPolicies += $p
            }
        }
    }

    # 2. Fetch Sign-in logs (auditLogs/signIns)
    $rawSignIns = @()
    try {
        $signInsResp = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/auditLogs/signIns?`$top=$Top" -ErrorAction Stop
        if ($signInsResp -and $signInsResp['value']) {
            $rawSignIns = @($signInsResp['value'])
        }
        elseif ($signInsResp -and $signInsResp.value) {
            $rawSignIns = @($signInsResp.value)
        }
    }
    catch {
        Write-Warning "Could not query sign-in logs: $_"
    }

    # 3. Correlate sign-in evaluations per report-only policy
    $policyResults = @()
    $totalEvaluatedOverall = 0
    $totalWouldBlockOverall = 0

    foreach ($policy in $reportOnlyPolicies) {
        $targetPolicyId = if ($policy['id']) { [string]$policy['id'] } else { [string]$policy.id }
        $pName = if ($policy['displayName']) { [string]$policy['displayName'] } else { [string]$policy.displayName }

        # Controls summary
        $grant = if ($policy['grantControls']) { $policy['grantControls'] } else { $policy.grantControls }
        $builtIn = if ($grant -and $grant['builtInControls']) { @($grant['builtInControls']) } elseif ($grant -and $grant.builtInControls) { @($grant.builtInControls) } else { @() }
        $controlsSummary = if ($builtIn -contains 'block') {
            'Block'
        }
        elseif ($builtIn.Count -gt 0) {
            "Grant: " + ($builtIn -join ", ")
        }
        else {
            'Session controls'
        }

        $wouldBlockCount = 0
        $wouldGrantCount = 0
        $notAppliedCount = 0
        $userMap = @{}
        $appMap = @{}
        $sampleEvents = @()

        foreach ($si in $rawSignIns) {
            $appliedList = if ($si['appliedConditionalAccessPolicies']) { @($si['appliedConditionalAccessPolicies']) } elseif ($si.appliedConditionalAccessPolicies) { @($si.appliedConditionalAccessPolicies) } else { @() }

            foreach ($applied in $appliedList) {
                $appliedId = if ($applied['id']) { [string]$applied['id'] } else { [string]$applied.id }
                if ($appliedId -ne $targetPolicyId) { continue }

                $result = if ($applied['result']) { [string]$applied['result'] } else { [string]$applied.result }
                $upn = if ($si['userPrincipalName']) { [string]$si['userPrincipalName'] } else { [string]$si.userPrincipalName }
                $app = if ($si['appDisplayName']) { [string]$si['appDisplayName'] } else { [string]$si.appDisplayName }
                $ip = if ($si['ipAddress']) { [string]$si['ipAddress'] } else { [string]$si.ipAddress }
                $dt = if ($si['createdDateTime']) { [string]$si['createdDateTime'] } else { [string]$si.createdDateTime }
                $siId = if ($si['id']) { [string]$si['id'] } else { [string]$si.id }

                $locObj = if ($si['location']) { $si['location'] } else { $si.location }
                $city = if ($locObj -and $locObj['city']) { [string]$locObj['city'] } elseif ($locObj -and $locObj.city) { [string]$locObj.city } else { '' }
                $country = if ($locObj -and $locObj['countryOrRegion']) { [string]$locObj['countryOrRegion'] } elseif ($locObj -and $locObj.countryOrRegion) { [string]$locObj.countryOrRegion } else { '' }
                $locationStr = if ($city -and $country) { "$city, $country" } elseif ($country) { $country } else { 'Unknown' }

                if ($result -eq 'reportOnlyFailure') {
                    $wouldBlockCount++
                    if ($upn) {
                        if (-not $userMap.ContainsKey($upn)) { $userMap[$upn] = 0 }
                        $userMap[$upn]++
                    }
                    if ($app) {
                        if (-not $appMap.ContainsKey($app)) { $appMap[$app] = 0 }
                        $appMap[$app]++
                    }

                    if ($sampleEvents.Count -lt 25) {
                        $sampleEvents += [pscustomobject]@{
                            id                = $siId
                            createdDateTime   = $dt
                            userPrincipalName = $upn
                            appDisplayName    = $app
                            ipAddress         = $ip
                            location          = $locationStr
                            result            = 'reportOnlyFailure'
                            wouldBlock        = $true
                        }
                    }
                }
                elseif ($result -eq 'reportOnlySuccess') {
                    $wouldGrantCount++
                    if ($sampleEvents.Count -lt 25) {
                        $sampleEvents += [pscustomobject]@{
                            id                = $siId
                            createdDateTime   = $dt
                            userPrincipalName = $upn
                            appDisplayName    = $app
                            ipAddress         = $ip
                            location          = $locationStr
                            result            = 'reportOnlySuccess'
                            wouldBlock        = $false
                        }
                    }
                }
                elseif ($result -eq 'reportOnlyNotApplied') {
                    $notAppliedCount++
                }
            }
        }

        $totalEvaluated = $wouldBlockCount + $wouldGrantCount + $notAppliedCount
        $totalEvaluatedOverall += $totalEvaluated
        $totalWouldBlockOverall += $wouldBlockCount

        $affectedUsersList = @()
        foreach ($u in $userMap.Keys) {
            $affectedUsersList += [pscustomobject]@{
                userPrincipalName = $u
                failCount         = $userMap[$u]
            }
        }

        $affectedAppsList = @()
        foreach ($a in $appMap.Keys) {
            $affectedAppsList += [pscustomobject]@{
                appDisplayName = $a
                failCount      = $appMap[$a]
            }
        }

        $policyResults += [pscustomobject]@{
            policyId        = $targetPolicyId
            policyName      = $pName
            state           = 'enabledForReportingButNotEnforced'
            controlsSummary = $controlsSummary
            totalEvaluated  = $totalEvaluated
            wouldBlockCount = $wouldBlockCount
            wouldGrantCount = $wouldGrantCount
            notAppliedCount = $notAppliedCount
            affectedUsers   = @($affectedUsersList | Sort-Object -Property failCount -Descending)
            affectedApps    = @($affectedAppsList | Sort-Object -Property failCount -Descending)
            sampleEvents    = @($sampleEvents)
        }
    }

    return [pscustomobject]@{
        tenantId            = $TenantId
        reportOnlyPolicies  = @($policyResults)
        summary             = [pscustomobject]@{
            totalReportOnlyPolicies = $policyResults.Count
            totalEvaluated          = $totalEvaluatedOverall
            totalWouldBlock         = $totalWouldBlockOverall
        }
    }
}
