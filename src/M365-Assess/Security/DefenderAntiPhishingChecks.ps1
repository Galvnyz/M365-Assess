# -------------------------------------------------------------------
# Defender -- Anti-Phishing Checks
# Extracted from Get-DefenderSecurityConfig.ps1 (#257)
# Runs in shared scope: $settings, $checkIdCounter, Add-Setting,
#   Test-PresetPolicy, $script:presetPolicyNames
# -------------------------------------------------------------------
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseDeclaredVarsMoreThanAssignments', '')]
param()

# ------------------------------------------------------------------
# 1. Anti-Phishing Policies
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking anti-phishing policies..."
    $antiPhishPolicies = Get-AntiPhishPolicy -ErrorAction Stop

    foreach ($policy in @($antiPhishPolicies)) {
        $policyLabel = if ($policy.IsDefault) { 'Default' } else { $policy.Name }
        $presetTier = Test-PresetPolicy -PolicyName $policy.Name

        # Preset-managed policies enforce known-good values
        if ($presetTier) {
            $settingParams = @{
                Category         = 'Anti-Phishing'
                Setting          = "Policy ($policyLabel)"
                CurrentValue     = "Managed by $presetTier preset security policy"
                RecommendedValue = 'Preset security policy active'
                Status           = 'Pass'
                CheckId          = 'DEFENDER-ANTIPHISH-001'
                Remediation      = 'No action needed -- settings enforced by preset security policy.'
            }
            Add-Setting @settingParams
            continue
        }

        # Phishing threshold
        $threshold = $policy.PhishThresholdLevel
        $mailboxIntelligence = [bool]$policy.EnableMailboxIntelligence
        $settingParams = @{
            Category         = 'Anti-Phishing'
            Setting          = "Phishing Threshold ($policyLabel)"
            CurrentValue     = "$threshold"
            RecommendedValue = '2+ (Aggressive)'
            Status           = if ([int]$threshold -ge 2) { 'Pass' } else { 'Fail' }
            CheckId          = 'DEFENDER-ANTIPHISH-001'
            Remediation      = 'Run: Set-AntiPhishPolicy -Identity <PolicyName> -PhishThresholdLevel 2. Security admin center > Anti-phishing > Edit policy > Set threshold to 2 (Aggressive) or higher.'
            Evidence         = [PSCustomObject]@{
                PolicyName                = $policy.Name
                PhishThresholdLevel       = [int]$threshold
                EnableMailboxIntelligence = $mailboxIntelligence
            }
        }
        Add-Setting @settingParams

        # Impersonation protection (Defender P1+ only)
        if ($null -ne $policy.EnableMailboxIntelligenceProtection) {
            $mailboxIntel = $policy.EnableMailboxIntelligenceProtection
            $settingParams = @{
                Category         = 'Anti-Phishing'
                Setting          = "Mailbox Intelligence Protection ($policyLabel)"
                CurrentValue     = "$mailboxIntel"
                RecommendedValue = 'True'
                Status           = if ($mailboxIntel) { 'Pass' } else { 'Warning' }
                CheckId          = 'DEFENDER-ANTIPHISH-001'
                Remediation      = 'Run: Set-AntiPhishPolicy -Identity <PolicyName> -EnableMailboxIntelligenceProtection $true. Security admin center > Anti-phishing > Impersonation > Enable Mailbox intelligence protection.'
            }
            Add-Setting @settingParams
        }

        if ($null -ne $policy.EnableTargetedUserProtection) {
            $targetedUser = $policy.EnableTargetedUserProtection
            $settingParams = @{
                Category         = 'Anti-Phishing'
                Setting          = "Targeted User Protection ($policyLabel)"
                CurrentValue     = "$targetedUser"
                RecommendedValue = 'True'
                Status           = if ($targetedUser) { 'Pass' } else { 'Warning' }
                CheckId          = 'DEFENDER-ANTIPHISH-001'
                Remediation      = 'Run: Set-AntiPhishPolicy -Identity <PolicyName> -EnableTargetedUserProtection $true -TargetedUsersToProtect @{Add="user@domain.com"}. Security admin center > Anti-phishing > Impersonation > Add users to protect.'
            }
            Add-Setting @settingParams
        }

        if ($null -ne $policy.EnableTargetedDomainsProtection) {
            $targetedDomain = $policy.EnableTargetedDomainsProtection
            $settingParams = @{
                Category         = 'Anti-Phishing'
                Setting          = "Targeted Domain Protection ($policyLabel)"
                CurrentValue     = "$targetedDomain"
                RecommendedValue = 'True'
                Status           = if ($targetedDomain) { 'Pass' } else { 'Warning' }
                CheckId          = 'DEFENDER-ANTIPHISH-001'
                Remediation      = 'Run: Set-AntiPhishPolicy -Identity <PolicyName> -EnableTargetedDomainsProtection $true. Security admin center > Anti-phishing > Impersonation > Add domains to protect.'
            }
            Add-Setting @settingParams
        }

        # Honor DMARC policy
        if ($null -ne $policy.HonorDmarcPolicy) {
            $honorDmarc = $policy.HonorDmarcPolicy
            $settingParams = @{
                Category         = 'Anti-Phishing'
                Setting          = "Honor DMARC Policy ($policyLabel)"
                CurrentValue     = "$honorDmarc"
                RecommendedValue = 'True'
                Status           = if ($honorDmarc) { 'Pass' } else { 'Fail' }
                CheckId          = 'DEFENDER-ANTIPHISH-001'
                Remediation      = 'Run: Set-AntiPhishPolicy -Identity <PolicyName> -HonorDmarcPolicy $true. Security admin center > Anti-phishing > Enable Honor DMARC record policy.'
            }
            Add-Setting @settingParams
        }

        # Spoof intelligence
        $spoofIntel = $policy.EnableSpoofIntelligence
        $settingParams = @{
            Category         = 'Anti-Phishing'
            Setting          = "Spoof Intelligence ($policyLabel)"
            CurrentValue     = "$spoofIntel"
            RecommendedValue = 'True'
            Status           = if ($spoofIntel) { 'Pass' } else { 'Fail' }
            CheckId          = 'DEFENDER-ANTIPHISH-001'
            Remediation      = 'Run: Set-AntiPhishPolicy -Identity <PolicyName> -EnableSpoofIntelligence $true. Security admin center > Anti-phishing > Spoof > Enable spoof intelligence.'
        }
        Add-Setting @settingParams

        # Safety tips
        if ($null -ne $policy.EnableFirstContactSafetyTips) {
            $firstContact = $policy.EnableFirstContactSafetyTips
            $settingParams = @{
                Category         = 'Anti-Phishing'
                Setting          = "First Contact Safety Tips ($policyLabel)"
                CurrentValue     = "$firstContact"
                RecommendedValue = 'True'
                Status           = if ($firstContact) { 'Pass' } else { 'Warning' }
                CheckId          = 'DEFENDER-ANTIPHISH-001'
                Remediation      = 'Run: Set-AntiPhishPolicy -Identity <PolicyName> -EnableFirstContactSafetyTips $true. Security admin center > Anti-phishing > Safety tips > Enable first contact safety tips.'
            }
            Add-Setting @settingParams
        }

        # Only assess default policy in detail to avoid duplicate noise
        if (-not $policy.IsDefault) { continue }
    }
}
catch {
    Write-Warning "Could not retrieve anti-phishing policies: $_"
}
