<#
.SYNOPSIS
    Reports DLP policies, DLP rules, and sensitivity labels from Microsoft Purview.
.DESCRIPTION
    Retrieves DLP compliance policies, their associated rules, and sensitivity labels
    from the Microsoft Purview compliance portal. Produces a unified report showing
    each item type, name, enabled/priority state, and relevant configuration details.

    Useful for compliance assessments, data protection reviews, and verifying that
    DLP and information protection controls are properly configured for the tenant.

    Handles tenants where Purview is not available or not licensed by skipping
    unavailable cmdlets gracefully.

    Requires ExchangeOnlineManagement module and an active Purview/Compliance
    connection (Connect-IPPSSession).
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Purview
    PS> .\Security\Get-DlpPolicyReport.ps1

    Displays all DLP policies, rules, and sensitivity labels in the tenant.
.EXAMPLE
    PS> .\Security\Get-DlpPolicyReport.ps1 -OutputPath '.\dlp-report.csv'

    Exports DLP policies, rules, and sensitivity labels to CSV.
.EXAMPLE
    PS> .\Security\Get-DlpPolicyReport.ps1 -Verbose

    Displays the report with verbose processing details, including skip messages
    for unavailable features.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$results = [System.Collections.Generic.List[PSCustomObject]]::new()

# --- DLP Compliance Policies ---
Write-Verbose "Retrieving DLP compliance policies..."
try {
    $dlpPolicies = Get-DlpCompliancePolicy -ErrorAction Stop

    if (-not $dlpPolicies -or @($dlpPolicies).Count -eq 0) {
        Write-Verbose "No DLP compliance policies found."
    }
    else {
        foreach ($policy in @($dlpPolicies)) {
            # Build a locations summary from the workload-specific location properties
            $locations = [System.Collections.Generic.List[string]]::new()

            if ($policy.ExchangeLocation -and @($policy.ExchangeLocation).Count -gt 0) {
                $locations.Add("Exchange")
            }
            if ($policy.SharePointLocation -and @($policy.SharePointLocation).Count -gt 0) {
                $locations.Add("SharePoint")
            }
            if ($policy.OneDriveLocation -and @($policy.OneDriveLocation).Count -gt 0) {
                $locations.Add("OneDrive")
            }
            if ($policy.TeamsLocation -and @($policy.TeamsLocation).Count -gt 0) {
                $locations.Add("Teams")
            }
            if ($policy.EndpointDlpLocation -and @($policy.EndpointDlpLocation).Count -gt 0) {
                $locations.Add("Endpoints")
            }

            $locationSummary = if ($locations.Count -gt 0) {
                $locations -join ', '
            }
            else {
                'None'
            }

            $mode = if ($policy.Mode) { $policy.Mode } else { 'N/A' }
            $enabled = if ($null -ne $policy.Enabled) { $policy.Enabled } else { $mode -ne 'Disable' }

            $details = "Mode=$mode; Locations=$locationSummary"

            $results.Add([PSCustomObject]@{
                ItemType = 'DlpPolicy'
                Name     = $policy.Name
                Enabled  = $enabled
                Priority = if ($null -ne $policy.Priority) { $policy.Priority } else { 'N/A' }
                Details  = $details
            })
        }
        Write-Verbose "Found $(@($dlpPolicies).Count) DLP compliance policies."
    }
}
catch {
    if ($_.Exception.Message -match 'is not recognized') {
        Write-Warning "Get-DlpCompliancePolicy not available. Skipping DLP policies."
    }
    else {
        Write-Warning "Failed to retrieve DLP compliance policies: $_"
    }
}

# --- DLP Compliance Rules ---
Write-Verbose "Retrieving DLP compliance rules..."
try {
    $dlpRules = Get-DlpComplianceRule -ErrorAction Stop

    if (-not $dlpRules -or @($dlpRules).Count -eq 0) {
        Write-Verbose "No DLP compliance rules found."
    }
    else {
        foreach ($rule in @($dlpRules)) {
            # Build a conditions summary
            $conditionParts = [System.Collections.Generic.List[string]]::new()

            if ($rule.ContentContainsSensitiveInformation) {
                $sensitiveTypes = @($rule.ContentContainsSensitiveInformation)
                $typeNames = foreach ($st in $sensitiveTypes) {
                    if ($st.Name) { $st.Name } elseif ($st.name) { $st.name } else { 'SensitiveInfo' }
                }
                $conditionParts.Add("SensitiveInfo=($($typeNames -join ', '))")
            }

            if ($rule.ParentPolicyName) {
                $conditionParts.Add("Policy=$($rule.ParentPolicyName)")
            }

            if ($rule.BlockAccess) {
                $conditionParts.Add("BlockAccess=$($rule.BlockAccess)")
            }

            if ($rule.NotifyUser) {
                $notifyUsers = if ($rule.NotifyUser -is [System.Collections.IEnumerable] -and $rule.NotifyUser -isnot [string]) {
                    ($rule.NotifyUser | ForEach-Object { $_.ToString() }) -join ', '
                }
                else {
                    [string]$rule.NotifyUser
                }
                $conditionParts.Add("NotifyUser=$notifyUsers")
            }

            $conditionSummary = if ($conditionParts.Count -gt 0) {
                $conditionParts -join '; '
            }
            else {
                'No conditions specified'
            }

            $enabled = if ($null -ne $rule.Disabled) { -not $rule.Disabled } else { $true }

            $results.Add([PSCustomObject]@{
                ItemType = 'DlpRule'
                Name     = $rule.Name
                Enabled  = $enabled
                Priority = if ($null -ne $rule.Priority) { $rule.Priority } else { 'N/A' }
                Details  = $conditionSummary
            })
        }
        Write-Verbose "Found $(@($dlpRules).Count) DLP compliance rules."
    }
}
catch {
    if ($_.Exception.Message -match 'is not recognized') {
        Write-Warning "Get-DlpComplianceRule not available. Skipping DLP rules."
    }
    else {
        Write-Warning "Failed to retrieve DLP compliance rules: $_"
    }
}

# --- Sensitivity Labels ---
Write-Verbose "Retrieving sensitivity labels..."
try {
    $labels = Get-Label -ErrorAction Stop

    if (-not $labels -or @($labels).Count -eq 0) {
        Write-Verbose "No sensitivity labels found."
    }
    else {
        foreach ($label in @($labels)) {
            $tooltip = if ($label.Tooltip) { $label.Tooltip } else { 'No description' }
            $parentLabel = if ($label.ParentId) { "ParentId=$($label.ParentId); " } else { '' }
            $contentType = if ($label.ContentType) { "ContentType=$($label.ContentType); " } else { '' }

            $details = "${parentLabel}${contentType}Tooltip=$tooltip"

            $enabled = if ($null -ne $label.Disabled) { -not $label.Disabled } else { $true }

            $results.Add([PSCustomObject]@{
                ItemType = 'SensitivityLabel'
                Name     = $label.DisplayName
                Enabled  = $enabled
                Priority = if ($null -ne $label.Priority) { $label.Priority } else { 'N/A' }
                Details  = $details
            })
        }
        Write-Verbose "Found $(@($labels).Count) sensitivity labels."
    }
}
catch {
    if ($_.Exception.Message -match 'is not recognized') {
        Write-Warning "Get-Label not available. Skipping sensitivity labels."
    }
    else {
        Write-Warning "Failed to retrieve sensitivity labels: $_"
    }
}

# Output results
if ($results.Count -eq 0) {
    Write-Warning "No DLP policies, rules, or sensitivity labels found. Verify that the tenant has Purview features configured."
    return
}

Write-Verbose "Total items found: $($results.Count)"

if ($OutputPath) {
    $results | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported $($results.Count) DLP/label items to $OutputPath"
}
else {
    Write-Output $results
}
