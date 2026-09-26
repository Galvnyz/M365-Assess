# Invoke-BecCheck.ps1 — EPIC-011 BEC compromise review (SPEC §3.2, §4.5 US-6).
#
# Runs the 11-check compromise review live against Graph: mailbox rules,
# recently added users, new applications, mailbox permission changes, sent
# messages, MFA devices, password changes, trusted and blocked senders,
# Intune devices, sign-in locations, and sharing links. Every check carries
# its evidence and a remediate action; checks whose backing API is unreachable
# return state unknown with a reason instead of failing the review.
#
# Read-only by design: Invoke-BecCheck issues GET requests only and never
# remediates — remediation is Invoke-BecFindingRemediation, one finding at a
# time after explicit confirmation (§11.3: the portal never auto-remediates).
# Findings remediate through the EPIC-006 contract (T-0107): -Confirmed is
# required, every apply captures before/after, and every apply emits one audit
# record through -WriteAudit. The Graph session is connected by the supervisor
# after materializing the tenant credential in-process; this file never
# touches secrets.

function Get-BecCheckNames {
    <#
    .SYNOPSIS
        Returns the 11 BEC review check names in evaluation order.
    .DESCRIPTION
        The single source of truth shared by the worker, the BFF catalogue,
        and the tests. Mirrors BEC_CHECKS in portal/bff/src/routes/bec.ts.
    .EXAMPLE
        Get-BecCheckNames
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param()

    return @('mailboxRules', 'recentUsers', 'newApplications', 'mailboxPermissions', 'sentMessages', 'mfaDevices', 'passwordChanges', 'mailFlow', 'intuneDevices', 'signinLocations', 'sharingLinks')
}

function New-BecCheckResult {
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [string]$Check,

        [Parameter(Mandatory)]
        [ValidateSet('clear', 'review', 'finding', 'unknown')]
        [string]$State,

        [Parameter()]
        [object]$Detail = @{},

        [Parameter()]
        [object[]]$Evidence = @(),

        [Parameter()]
        [object]$Remediation = $null
    )

    return [pscustomobject]@{
        check       = $Check
        state       = $State
        detail      = $Detail
        evidence    = @($Evidence)
        remediation = $Remediation
    }
}

function New-BecRemediation {
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [string]$Action,

        [Parameter(Mandatory)]
        [bool]$Automated,

        [Parameter(Mandatory)]
        [string]$Label,

        [Parameter()]
        [string[]]$Steps = @()
    )

    return [pscustomobject]@{
        action    = $Action
        automated = $Automated
        label     = $Label
        steps     = @($Steps)
    }
}

function Get-BecMailboxRules {
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UserId
    )

    $rules = @(Invoke-MgGraphRequest -Method GET -Uri "/v1.0/users/$UserId/mailFolders/inbox/messageRules")
    $suspicious = [System.Collections.Generic.List[object]]::new()
    foreach ($rule in @($rules.value)) {
        if ($null -eq $rule) {
            continue
        }
        $actions = $rule.actions
        $forwarding = $false
        if ($null -ne $actions) {
            if ($null -ne $actions.forwardTo -or $null -ne $actions.forwardAsAttachmentTo) {
                $forwarding = $true
            }
        }
        $deleting = $actions.delete -eq $true
        if ($forwarding -or $deleting) {
            $suspicious.Add([pscustomobject]@{
                id          = [string]$rule.id
                displayName = [string]$rule.displayName
                forwarding  = $forwarding
                deleting    = $deleting
            })
        }
    }
    if (@($suspicious).Count -gt 0) {
        return New-BecCheckResult -Check 'mailboxRules' -State 'finding' `
            -Detail @{ suspiciousRuleCount = @($suspicious).Count } `
            -Evidence @($suspicious) `
            -Remediation (New-BecRemediation -Action 'removeInboxRule' -Automated $true -Label 'Remove the forwarding/deletion rule')
    }
    return New-BecCheckResult -Check 'mailboxRules' -State 'clear' `
        -Detail @{ ruleCount = @(@($rules.value)).Count } `
        -Remediation (New-BecRemediation -Action 'removeInboxRule' -Automated $true -Label 'Remove a rule if one appears')
}

function Get-BecRecentUsers {
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param()
    $cutoff = (Get-Date).ToUniversalTime().AddDays(-7).ToString('yyyy-MM-ddTHH:mm:ssZ')
    $response = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/users?`$filter=createdDateTime ge $cutoff&`$select=id,displayName,userPrincipalName,createdDateTime&`$top=25"
    $newcomers = @($response.value | ForEach-Object {
        [pscustomobject]@{ displayName = [string]$_.displayName; userPrincipalName = [string]$_.userPrincipalName }
    })
    if ($newcomers.Count -gt 0) {
        return New-BecCheckResult -Check 'recentUsers' -State 'review' `
            -Detail @{ newUserCount = $newcomers.Count } `
            -Evidence @($newcomers | Select-Object -First 10) `
            -Remediation (New-BecRemediation -Action 'manual-review' -Automated $false -Label 'Confirm each new account with the tenant owner' -Steps @('Confirm each new account with the tenant owner', 'Disable anything unrecognized'))
    }
    return New-BecCheckResult -Check 'recentUsers' -State 'clear' -Detail @{ newUserCount = 0 }
}

function Get-BecNewApplications {
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UserId
    )
    $response = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/users/$UserId/oauth2PermissionGrants"
    $grants = @($response.value | ForEach-Object {
        [pscustomobject]@{ clientId = [string]$_.clientId; scope = [string]$_.scope }
    })
    $privileged = @($grants | Where-Object { [string]$_.scope -match 'Mail\.Send|Mail\.ReadWrite|full_access_as_app|Directory\.ReadWrite\.All' })
    if ($privileged.Count -gt 0) {
        return New-BecCheckResult -Check 'newApplications' -State 'finding' `
            -Detail @{ privilegedGrantCount = $privileged.Count } `
            -Evidence @($privileged) `
            -Remediation (New-BecRemediation -Action 'revokeSessions' -Automated $true -Label 'Revoke sessions, then remove consent in Entra')
    }
    if ($grants.Count -gt 0) {
        return New-BecCheckResult -Check 'newApplications' -State 'review' `
            -Detail @{ grantCount = $grants.Count } `
            -Evidence @($grants | Select-Object -First 10) `
            -Remediation (New-BecRemediation -Action 'manual-review' -Automated $false -Label 'Review consented applications in Entra' -Steps @('Review consented applications in Entra', 'Remove consent for anything unrecognized'))
    }
    return New-BecCheckResult -Check 'newApplications' -State 'clear' -Detail @{ grantCount = 0 }
}

function Get-BecMailboxPermissions {
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UserId
    )
    $exo = Get-Command -Name 'Get-MailboxPermission' -ErrorAction SilentlyContinue
    if ($null -eq $exo) {
        return New-BecCheckResult -Check 'mailboxPermissions' -State 'unknown' `
            -Detail @{ reason = 'mailbox delegation requires an Exchange Online session' } `
            -Remediation (New-BecRemediation -Action 'manual-review' -Automated $false -Label 'Review delegates in Exchange Online' -Steps @('Review mailbox delegates in Exchange Online', 'Remove any unrecognized FullAccess grant'))
    }
    $grants = @(Get-MailboxPermission -Identity $UserId | Where-Object { $_.IsInherited -eq $false -and $_.User -ne 'NT AUTHORITY\SELF' })
    $evidence = @($grants | ForEach-Object {
        [pscustomobject]@{ user = [string]$_.User; accessRights = @($_.AccessRights) }
    })
    if ($evidence.Count -gt 0) {
        return New-BecCheckResult -Check 'mailboxPermissions' -State 'review' `
            -Detail @{ delegateCount = $evidence.Count } `
            -Evidence @($evidence) `
            -Remediation (New-BecRemediation -Action 'manual-review' -Automated $false -Label 'Remove unrecognized delegates in Exchange Online' -Steps @('Remove unrecognized delegates in Exchange Online'))
    }
    return New-BecCheckResult -Check 'mailboxPermissions' -State 'clear' -Detail @{ delegateCount = 0 }
}

function Get-BecSentMessages {
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UserId
    )
    $cutoff = (Get-Date).ToUniversalTime().AddDays(-1).ToString('yyyy-MM-ddTHH:mm:ssZ')
    $response = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/users/$UserId/mailFolders/sentitems/messages?`$filter=createdDateTime ge $cutoff&`$select=subject,createdDateTime&`$top=50"
    $sent = @($response.value)
    $evidence = @($sent | Select-Object -First 5 | ForEach-Object {
        [pscustomobject]@{ subject = [string]$_.subject; createdDateTime = [string]$_.createdDateTime }
    })
    if ($sent.Count -ge 50) {
        return New-BecCheckResult -Check 'sentMessages' -State 'finding' `
            -Detail @{ sentLast24h = $sent.Count } `
            -Evidence @($evidence) `
            -Remediation (New-BecRemediation -Action 'revokeSessions' -Automated $true -Label 'Revoke sessions to stop further sending')
    }
    if ($sent.Count -ge 10) {
        return New-BecCheckResult -Check 'sentMessages' -State 'review' `
            -Detail @{ sentLast24h = $sent.Count } `
            -Evidence @($evidence) `
            -Remediation (New-BecRemediation -Action 'revokeSessions' -Automated $true -Label 'Revoke sessions if the volume is unexpected')
    }
    return New-BecCheckResult -Check 'sentMessages' -State 'clear' -Detail @{ sentLast24h = $sent.Count }
}

function Get-BecMfaDevices {
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UserId
    )
    $response = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/users/$UserId/authentication/methods"
    $methods = @($response.value | Where-Object { [string]$_.'@odata.type' -ne '#microsoft.graph.passwordAuthenticationMethod' })
    $cutoff = (Get-Date).ToUniversalTime().AddDays(-7)
    $recent = @($methods | Where-Object {
        $created = [string]$_.createdDateTime
        $created -ne '' -and ([datetime]$created).ToUniversalTime() -ge $cutoff
    })
    $evidence = @($methods | ForEach-Object {
        [pscustomobject]@{ type = [string]$_.'@odata.type'; createdDateTime = [string]$_.createdDateTime }
    })
    if ($methods.Count -eq 0) {
        return New-BecCheckResult -Check 'mfaDevices' -State 'finding' `
            -Detail @{ methodCount = 0 } `
            -Remediation (New-BecRemediation -Action 'revokeSessions' -Automated $true -Label 'Revoke sessions, then register MFA with the user')
    }
    if ($recent.Count -gt 0) {
        return New-BecCheckResult -Check 'mfaDevices' -State 'review' `
            -Detail @{ recentMethodCount = $recent.Count } `
            -Evidence @($evidence) `
            -Remediation (New-BecRemediation -Action 'revokeSessions' -Automated $true -Label 'Revoke sessions if the new method is unexpected')
    }
    return New-BecCheckResult -Check 'mfaDevices' -State 'clear' -Detail @{ methodCount = $methods.Count }
}

function Get-BecPasswordChanges {
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UserId
    )
    $user = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/users/$UserId?`$select=lastPasswordChangeDateTime"
    $changed = [string]$user.lastPasswordChangeDateTime
    if ($changed.Trim().Length -eq 0) {
        return New-BecCheckResult -Check 'passwordChanges' -State 'unknown' `
            -Detail @{ reason = 'last password change is not reported for this user' }
    }
    $cutoff = (Get-Date).ToUniversalTime().AddDays(-1)
    if (([datetime]$changed).ToUniversalTime() -ge $cutoff) {
        return New-BecCheckResult -Check 'passwordChanges' -State 'review' `
            -Detail @{ lastPasswordChangeDateTime = $changed } `
            -Evidence @([pscustomobject]@{ lastPasswordChangeDateTime = $changed }) `
            -Remediation (New-BecRemediation -Action 'revokeSessions' -Automated $true -Label 'Revoke sessions if the change was not made by the user')
    }
    return New-BecCheckResult -Check 'passwordChanges' -State 'clear' -Detail @{ lastPasswordChangeDateTime = $changed }
}

function Get-BecMailFlow {
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UserId
    )
    $exo = Get-Command -Name 'Get-MailboxJunkEmailConfiguration' -ErrorAction SilentlyContinue
    if ($null -eq $exo) {
        return New-BecCheckResult -Check 'mailFlow' -State 'unknown' `
            -Detail @{ reason = 'sender allow/block lists require an Exchange Online session' } `
            -Remediation (New-BecRemediation -Action 'manual-review' -Automated $false -Label 'Review trusted and blocked senders in Exchange Online' -Steps @('Review trusted and blocked senders in Exchange Online'))
    }
    $config = Get-MailboxJunkEmailConfiguration -Identity $UserId
    $trusted = @($config.TrustedSendersAndDomains) + @($config.TrustedPublishers)
    $blocked = @($config.BlockedSendersAndDomains)
    if ($trusted.Count -gt 0) {
        return New-BecCheckResult -Check 'mailFlow' -State 'review' `
            -Detail @{ trustedCount = $trusted.Count; blockedCount = $blocked.Count } `
            -Evidence @($trusted | Select-Object -First 10 | ForEach-Object { [pscustomobject]@{ trustedSender = [string]$_ } }) `
            -Remediation (New-BecRemediation -Action 'manual-review' -Automated $false -Label 'Remove unrecognized trusted senders in Exchange Online' -Steps @('Remove unrecognized trusted senders in Exchange Online'))
    }
    return New-BecCheckResult -Check 'mailFlow' -State 'clear' -Detail @{ trustedCount = 0; blockedCount = $blocked.Count }
}

function Get-BecIntuneDevices {
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UserId
    )
    $response = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/users/$UserId/managedDevices?`$select=deviceName,complianceState,managedDeviceOwnerType,enrolledDateTime,operatingSystem&`$top=25"
    $devices = @($response.value)
    $noncompliant = @($devices | Where-Object { [string]$_.complianceState -eq 'noncompliant' })
    if ($noncompliant.Count -gt 0) {
        $evidence = @($noncompliant | ForEach-Object {
            [pscustomobject]@{ deviceName = [string]$_.deviceName; complianceState = [string]$_.complianceState }
        })
        return New-BecCheckResult -Check 'intuneDevices' -State 'finding' `
            -Detail @{ noncompliantCount = $noncompliant.Count } `
            -Evidence @($evidence) `
            -Remediation (New-BecRemediation -Action 'revokeSessions' -Automated $true -Label 'Revoke sessions from the noncompliant device')
    }
    $cutoff = (Get-Date).ToUniversalTime().AddDays(-7)
    $freshPersonal = @($devices | Where-Object {
        [string]$_.managedDeviceOwnerType -eq 'personal' -and [string]$_.enrolledDateTime -ne '' -and ([datetime][string]$_.enrolledDateTime).ToUniversalTime() -ge $cutoff
    })
    if ($freshPersonal.Count -gt 0) {
        return New-BecCheckResult -Check 'intuneDevices' -State 'review' `
            -Detail @{ recentPersonalCount = $freshPersonal.Count } `
            -Evidence @($freshPersonal | ForEach-Object { [pscustomobject]@{ deviceName = [string]$_.deviceName } }) `
            -Remediation (New-BecRemediation -Action 'manual-review' -Automated $false -Label 'Confirm the new personal enrollment with the user' -Steps @('Confirm the new personal enrollment with the user'))
    }
    return New-BecCheckResult -Check 'intuneDevices' -State 'clear' -Detail @{ deviceCount = $devices.Count }
}

function Get-BecSigninLocations {
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UserId
    )
    $response = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/auditLogs/signIns?`$filter=userId eq '$UserId'&`$select=createdDateTime,ipAddress,location&`$top=50"
    $entries = @($response.value)
    $countries = @($entries | ForEach-Object { [string]$_.location.countryOrRegion } | Where-Object { $_ -ne '' } | Sort-Object -Unique)
    $evidence = @($entries | Select-Object -First 10 | ForEach-Object {
        [pscustomobject]@{ createdDateTime = [string]$_.createdDateTime; ipAddress = [string]$_.ipAddress; country = [string]$_.location.countryOrRegion }
    })
    if ($countries.Count -ge 2) {
        return New-BecCheckResult -Check 'signinLocations' -State 'finding' `
            -Detail @{ countryCount = $countries.Count; countries = @($countries) } `
            -Evidence @($evidence) `
            -Remediation (New-BecRemediation -Action 'revokeSessions' -Automated $true -Label 'Revoke sessions and confirm travel with the user')
    }
    if ($entries.Count -gt 0) {
        return New-BecCheckResult -Check 'signinLocations' -State 'clear' `
            -Detail @{ signinCount = $entries.Count; countries = @($countries) }
    }
    return New-BecCheckResult -Check 'signinLocations' -State 'unknown' `
        -Detail @{ reason = 'no sign-in records were returned for this user' }
}

function Get-BecSharingLinks {
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UserId
    )
    try {
        $children = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/users/$UserId/drive/root/children?`$select=id,name&`$top=25"
    }
    catch {
        return New-BecCheckResult -Check 'sharingLinks' -State 'unknown' `
            -Detail @{ reason = 'OneDrive is not provisioned or unreachable for this user' }
    }
    $anonymous = [System.Collections.Generic.List[object]]::new()
    foreach ($item in @($children.value | Select-Object -First 25)) {
        if ($null -eq $item) {
            continue
        }
        try {
            $permissions = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/users/$UserId/drive/items/$([string]$item.id)/permissions"
        }
        catch {
            continue
        }
        foreach ($grant in @($permissions.value)) {
            if ($null -ne $grant.link -and [string]$grant.link.scope -eq 'anonymous') {
                $anonymous.Add([pscustomobject]@{
                    itemName = [string]$item.name
                    linkType = [string]$grant.link.type
                })
                if ($anonymous.Count -ge 10) {
                    break
                }
            }
        }
        if ($anonymous.Count -ge 10) {
            break
        }
    }
    if (@($anonymous).Count -gt 0) {
        return New-BecCheckResult -Check 'sharingLinks' -State 'finding' `
            -Detail @{ anonymousLinkCount = @($anonymous).Count } `
            -Evidence @($anonymous) `
            -Remediation (New-BecRemediation -Action 'manual-review' -Automated $false -Label 'Remove anonymous links from OneDrive sharing' -Steps @('Remove anonymous links from OneDrive sharing', 'Revoke sessions if exfiltration is suspected'))
    }
    return New-BecCheckResult -Check 'sharingLinks' -State 'clear' -Detail @{ anonymousLinkCount = 0 }
}

function Invoke-BecCheck {
    <#
    .SYNOPSIS
        Runs the 11-check BEC compromise review live against Graph.
    .DESCRIPTION
        Evaluates every Get-BecCheckNames check for one user and returns all
        11 outcomes with evidence and remediate actions. Read-only: only GET
        requests are issued and nothing is written to the tenant. A check
        whose backing API fails returns state unknown with a reason instead
        of aborting the review.
    .PARAMETER TenantId
        Tenant the user belongs to. Carried through to the result envelope.
    .PARAMETER UserId
        The target user id or user principal name.
    .EXAMPLE
        Invoke-BecCheck -TenantId 'tenant-a' -UserId 'user-1'
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject[]])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UserId
    )

    $results = [System.Collections.Generic.List[object]]::new()
    $checks = @(
        @{ Name = 'mailboxRules'; Command = { Get-BecMailboxRules -UserId $UserId } },
        @{ Name = 'recentUsers'; Command = { Get-BecRecentUsers } },
        @{ Name = 'newApplications'; Command = { Get-BecNewApplications -UserId $UserId } },
        @{ Name = 'mailboxPermissions'; Command = { Get-BecMailboxPermissions -UserId $UserId } },
        @{ Name = 'sentMessages'; Command = { Get-BecSentMessages -UserId $UserId } },
        @{ Name = 'mfaDevices'; Command = { Get-BecMfaDevices -UserId $UserId } },
        @{ Name = 'passwordChanges'; Command = { Get-BecPasswordChanges -UserId $UserId } },
        @{ Name = 'mailFlow'; Command = { Get-BecMailFlow -UserId $UserId } },
        @{ Name = 'intuneDevices'; Command = { Get-BecIntuneDevices -UserId $UserId } },
        @{ Name = 'signinLocations'; Command = { Get-BecSigninLocations -UserId $UserId } },
        @{ Name = 'sharingLinks'; Command = { Get-BecSharingLinks -UserId $UserId } }
    )
    foreach ($check in $checks) {
        try {
            $results.Add((& $check.Command))
        }
        catch {
            $results.Add((New-BecCheckResult -Check $check.Name -State 'unknown' -Detail @{ reason = $_.Exception.Message }))
        }
    }
    return [pscustomobject]@{
        tenantId    = $TenantId
        userId      = $UserId
        checks      = @($results)
        retrievedAt = (Get-Date -Format 'o')
    }
}

function Invoke-BecFindingRemediation {
    <#
    .SYNOPSIS
        Applies one automated per-finding BEC remediation live against Graph.
    .DESCRIPTION
        Executes removeInboxRule or revokeSessions for a single finding after
        explicit confirmation, capturing before/after and emitting one audit
        record through -WriteAudit. Manual-only findings are refused: the
        caller must present their evidence, never auto-remediate. Unknown
        actions are refused with a structured error, never passed through.
    .PARAMETER TenantId
        Tenant the user belongs to. Carried through to the result envelope.
    .PARAMETER UserId
        The target user id.
    .PARAMETER Check
        The BEC check the finding came from.
    .PARAMETER Action
        Automated remediation action: removeInboxRule or revokeSessions.
    .PARAMETER Target
        Action target, e.g. the inbox rule id for removeInboxRule.
    .PARAMETER Confirmed
        Explicit per-finding approval.
    .PARAMETER Actor
        Caller identity recorded on the audit event.
    .PARAMETER CorrelationId
        Correlation id recorded on the audit event.
    .PARAMETER WriteAudit
        Seam: scriptblock (event) -> void. Defaults to a no-op.
    .EXAMPLE
        Invoke-BecFindingRemediation -TenantId 'tenant-a' -UserId 'user-1' -Check 'mailboxRules' -Action 'removeInboxRule' -Target 'rule-1' -Confirmed
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UserId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Check,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Action,

        [Parameter()]
        [string]$Target = '',

        [Parameter()]
        [switch]$Confirmed,

        [Parameter()]
        [string]$Actor = '',

        [Parameter()]
        [string]$CorrelationId = '',

        [Parameter()]
        [scriptblock]$WriteAudit = { param($AuditEvent) }
    )

    $automated = @('removeInboxRule', 'revokeSessions')
    if (-not $automated.Contains($Action)) {
        throw "users.bec_unknown_remediation: action '$Action' is not an automated BEC remediation"
    }
    if (-not $Confirmed) {
        throw "users.bec_confirm_required: remediating a BEC finding requires explicit confirmation"
    }

    try {
        $before = $null
        if ($Action -eq 'removeInboxRule') {
            if ([string]::IsNullOrWhiteSpace($Target)) {
                throw "users.bec_missing_target: removeInboxRule requires the inbox rule id"
            }
            $before = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/users/$UserId/mailFolders/inbox/messageRules/$Target"
            $null = Invoke-MgGraphRequest -Method DELETE -Uri "/v1.0/users/$UserId/mailFolders/inbox/messageRules/$Target"
        }
        elseif ($Action -eq 'revokeSessions') {
            $null = Invoke-MgGraphRequest -Method POST -Uri "/v1.0/users/$UserId/revokeSignInSessions"
        }
        $after = [pscustomobject]@{ action = $Action; check = $Check; remediatedAt = (Get-Date -Format 'o') }
        $null = & $WriteAudit @{
            tenantId      = $TenantId
            action        = "users.bec_remediate:$Action"
            userId        = $UserId
            check         = $Check
            result        = 'success'
            error         = $null
            before        = $before
            after         = $after
            actor         = $Actor
            correlationId = $CorrelationId
        }
        return [pscustomobject]@{
            userId   = $UserId
            check    = $Check
            action   = $Action
            status   = 'remediated'
            before   = $before
            after    = $after
            error    = $null
        }
    }
    catch {
        $message = $_.Exception.Message
        $null = & $WriteAudit @{
            tenantId      = $TenantId
            action        = "users.bec_remediate:$Action"
            userId        = $UserId
            check         = $Check
            result        = 'failure'
            error         = $message
            before        = $null
            after         = $null
            actor         = $Actor
            correlationId = $CorrelationId
        }
        return [pscustomobject]@{
            userId   = $UserId
            check    = $Check
            action   = $Action
            status   = 'failed'
            before   = $null
            after    = $null
            error    = $message
        }
    }
}

function Read-BecCheckJob {
    <#
    .SYNOPSIS
        Reads a T-0007 job envelope file into BEC worker parameters.
    .DESCRIPTION
        Validates the envelope schema version and tenant, then returns the
        user id and the optional single-finding remediation request. The
        envelope carries references only; secrets are never present and never
        needed here.
    .PARAMETER Path
        Path to the job envelope JSON the supervisor wrote for this run.
    .EXAMPLE
        Read-BecCheckJob -Path './run/bec-check-job.json'
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "BEC check job file not found: $Path"
    }
    $job = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
    if ($job['schemaVersion'] -ne 'v1') {
        throw "BEC check job has unsupported schemaVersion: $($job['schemaVersion'])"
    }
    $tenantId = [string]$job['tenantId']
    if ([string]::IsNullOrWhiteSpace($tenantId)) {
        throw 'BEC check job is missing required field: tenantId'
    }

    $payload = $job['payload']
    if ($payload -isnot [System.Collections.IDictionary]) {
        $payload = @{}
    }
    $userId = [string]$payload['userId']
    if ([string]::IsNullOrWhiteSpace($userId)) {
        throw 'BEC check job is missing required field: payload.userId'
    }

    return @{
        TenantId      = $tenantId
        UserId        = $userId
        Action        = [string]$payload['action']
        Target        = [string]$payload['target']
        Check         = [string]$payload['check']
        Confirmed     = $payload['confirm'] -eq $true
        Actor         = [string]$payload['actor']
        CorrelationId = [string]$job['correlationId']
    }
}
