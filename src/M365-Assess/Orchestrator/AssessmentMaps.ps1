function Get-AssessmentMaps {
    [CmdletBinding()]
    param()

$sectionServiceMap = @{
    'Tenant'        = @('Graph')
    'Identity'      = @('Graph')
    'Licensing'     = @('Graph')
    'Email'         = @('ExchangeOnline')
    'Intune'        = @('Graph')
    'Security'      = @('Graph', 'ExchangeOnline', 'Purview')
    'Collaboration' = @('Graph')
    'PowerBI'       = @()
    'Hybrid'           = @('Graph')
    'Inventory'        = @('Graph', 'ExchangeOnline')
    'ActiveDirectory'  = @()
    'SOC2'             = @('Graph', 'Purview')
    'ValueOpportunity' = @('Graph')
}

# ------------------------------------------------------------------
# Section → Graph scopes mapping
# ------------------------------------------------------------------
$sectionScopeMap = @{
    'Tenant'        = @('Organization.Read.All', 'Domain.Read.All', 'Policy.Read.All', 'User.Read.All', 'Group.Read.All')
    'Identity'      = @('User.Read.All', 'AuditLog.Read.All', 'UserAuthenticationMethod.Read.All', 'RoleManagement.Read.Directory', 'Policy.Read.All', 'Application.Read.All', 'Domain.Read.All', 'Directory.Read.All', 'Agreement.Read.All')
    'Licensing'     = @('Organization.Read.All', 'User.Read.All')
    'Intune'        = @('DeviceManagementManagedDevices.Read.All', 'DeviceManagementConfiguration.Read.All')
    'Security'      = @('SecurityEvents.Read.All')
    'Collaboration' = @('SharePointTenantSettings.Read.All', 'TeamSettings.Read.All', 'TeamworkAppSettings.Read.All', 'OrgSettings-Forms.Read.All')
    'PowerBI'       = @()
    'Hybrid'           = @('Organization.Read.All', 'Domain.Read.All')
    'Inventory'        = @('Group.Read.All', 'Team.ReadBasic.All', 'TeamMember.Read.All', 'Channel.ReadBasic.All', 'Reports.Read.All', 'Sites.Read.All', 'User.Read.All')
    'ActiveDirectory'  = @()
    'SOC2'             = @('Policy.Read.All', 'RoleManagement.Read.Directory', 'SecurityEvents.Read.All', 'SecurityAlert.Read.All', 'AuditLog.Read.All', 'User.Read.All', 'Reports.Read.All', 'Directory.Read.All')
    'ValueOpportunity' = @('Organization.Read.All')
}

# ------------------------------------------------------------------
# Section → Graph submodule mapping (imported before each section)
# ------------------------------------------------------------------
$sectionModuleMap = @{
    'Tenant'        = @('Microsoft.Graph.Identity.DirectoryManagement', 'Microsoft.Graph.Identity.SignIns')
    'Identity'      = @('Microsoft.Graph.Users', 'Microsoft.Graph.Reports',
                        'Microsoft.Graph.Identity.DirectoryManagement',
                        'Microsoft.Graph.Identity.SignIns', 'Microsoft.Graph.Applications')
    'Licensing'     = @('Microsoft.Graph.Identity.DirectoryManagement', 'Microsoft.Graph.Users')
    'Intune'        = @('Microsoft.Graph.DeviceManagement')
    'Security'      = @('Microsoft.Graph.Security')
    'Collaboration' = @()
    'PowerBI'       = @()
    'Hybrid'           = @('Microsoft.Graph.Identity.DirectoryManagement')
    'Inventory'        = @()
    'ActiveDirectory'  = @()
    'SOC2'             = @('Microsoft.Graph.Identity.SignIns', 'Microsoft.Graph.Identity.DirectoryManagement', 'Microsoft.Graph.Security')
    'ValueOpportunity' = @('Microsoft.Graph.Identity.DirectoryManagement')
}

# ------------------------------------------------------------------
# Collector definitions: Section → ordered list of collectors
# ------------------------------------------------------------------
$collectorMap = [ordered]@{
    'Tenant' = @(
        @{ Name = '01-Tenant-Info';   Script = 'Entra\Get-TenantInfo.ps1'; Label = 'Tenant Information' }
    )
    'Identity' = @(
        @{ Name = '02-User-Summary';           Script = 'Entra\Get-UserSummary.ps1';              Label = 'User Summary';              RequiredServices = @('Graph') }
        @{ Name = '03-MFA-Report';             Script = 'Entra\Get-MfaReport.ps1';                Label = 'MFA Report';                RequiredServices = @('Graph') }
        @{ Name = '04-Admin-Roles';            Script = 'Entra\Get-AdminRoleReport.ps1';           Label = 'Admin Roles';               RequiredServices = @('Graph') }
        @{ Name = '05-Conditional-Access';     Script = 'Entra\Get-ConditionalAccessReport.ps1';   Label = 'Conditional Access';        RequiredServices = @('Graph') }
        @{ Name = '06-App-Registrations';      Script = 'Entra\Get-AppRegistrationReport.ps1';     Label = 'App Registrations';         RequiredServices = @('Graph') }
        @{ Name = '07-Password-Policy';        Script = 'Entra\Get-PasswordPolicyReport.ps1';      Label = 'Password Policy';           RequiredServices = @('Graph') }
        @{ Name = '07b-Entra-Security-Config'; Script = 'Entra\Get-EntraSecurityConfig.ps1';       Label = 'Entra Security Config';     RequiredServices = @('Graph') }
        @{ Name = '07c-CA-Security-Config';    Script = 'Entra\Get-CASecurityConfig.ps1';          Label = 'CA Policy Evaluation';      RequiredServices = @('Graph') }
        @{ Name = '07d-EntApp-Security-Config'; Script = 'Entra\Get-EntAppSecurityConfig.ps1';     Label = 'Enterprise App Security';   RequiredServices = @('Graph') }
        @{ Name = '07e-Entra-SoD-Config';      Script = 'Entra\Get-EntraSoDConfig.ps1';            Label = 'Separation of Duties';      RequiredServices = @('Graph') }
        @{ Name = '07f-Entra-ToU-Config';      Script = 'Entra\Get-EntraTouConfig.ps1';            Label = 'Terms of Use';              RequiredServices = @('Graph') }
        @{ Name = '07g-Entra-PrivRemote';      Script = 'Entra\Get-EntraPrivRemoteConfig.ps1';     Label = 'Privileged Remote Access';  RequiredServices = @('Graph') }
        @{ Name = '07h-Entra-AdminRoleSep';    Script = 'Entra\Get-EntraAdminRoleSeparationConfig.ps1'; Label = 'Admin Role Separation'; RequiredServices = @('Graph') }
        @{ Name = '07i-Entra-CaRemoteDevice';  Script = 'Entra\Get-EntraCaRemoteDevicePolicy.ps1';       Label = 'CA Remote Device Policy'; RequiredServices = @('Graph') }
    )
    'Licensing' = @(
        @{ Name = '08-License-Summary'; Script = 'Entra\Get-LicenseReport.ps1'; Label = 'License Summary'; Params = @{} }
    )
    'Email' = @(
        @{ Name = '09-Mailbox-Summary';  Script = 'Exchange-Online\Get-MailboxSummary.ps1';       Label = 'Mailbox Summary' }
        @{ Name = '10-Mail-Flow';        Script = 'Exchange-Online\Get-MailFlowReport.ps1';       Label = 'Mail Flow' }
        @{ Name = '11-EXO-Email-Policies';   Script = 'Exchange-Online\Get-EmailSecurityReport.ps1';  Label = 'EXO Email Policies' }
        @{ Name = '11b-EXO-Security-Config'; Script = 'Exchange-Online\Get-ExoSecurityConfig.ps1'; Label = 'EXO Security Config' }
        # DNS Security Config is deferred — runs after all sections using prefetched DNS cache
    )
    'Intune' = @(
        @{ Name = '13-Device-Summary';       Script = 'Intune\Get-DeviceSummary.ps1';             Label = 'Device Summary' }
        @{ Name = '14-Compliance-Policies';  Script = 'Intune\Get-CompliancePolicyReport.ps1';    Label = 'Compliance Policies' }
        @{ Name = '15-Config-Profiles';      Script = 'Intune\Get-ConfigProfileReport.ps1';       Label = 'Config Profiles' }
        @{ Name = '15b-Intune-Security-Config'; Script = 'Intune\Get-IntuneSecurityConfig.ps1'; Label = 'Intune Security Config'; RequiredServices = @('Graph') }
        @{ Name = '15c-Intune-MobileEncrypt'; Script = 'Intune\Get-IntuneMobileEncryptConfig.ps1'; Label = 'Mobile Encryption'; RequiredServices = @('Graph') }
        @{ Name = '15d-Intune-PortStorage';   Script = 'Intune\Get-IntunePortStorageConfig.ps1';   Label = 'Portable Storage'; RequiredServices = @('Graph') }
        @{ Name = '15e-Intune-AppControl';    Script = 'Intune\Get-IntuneAppControlConfig.ps1';    Label = 'Application Control'; RequiredServices = @('Graph') }
        @{ Name = '15f-Intune-FIPS';          Script = 'Intune\Get-IntuneFipsConfig.ps1';          Label = 'FIPS Cryptography'; RequiredServices = @('Graph') }
        @{ Name = '15g-Intune-Inventory';     Script = 'Intune\Get-IntuneInventoryConfig.ps1';     Label = 'Device Inventory'; RequiredServices = @('Graph') }
        @{ Name = '15h-Intune-AutoDisc';      Script = 'Intune\Get-IntuneAutoDiscConfig.ps1';      Label = 'Auto Discovery'; RequiredServices = @('Graph') }
        @{ Name = '15i-Intune-RemovableMedia'; Script = 'Intune\Get-IntuneRemovableMediaConfig.ps1'; Label = 'Removable Media'; RequiredServices = @('Graph') }
        @{ Name = '15j-Intune-AlwaysOnVpn';   Script = 'Intune\Get-IntuneAlwaysOnVpnConfig.ps1';    Label = 'Always-On VPN'; RequiredServices = @('Graph') }
        @{ Name = '15k-Intune-VpnSplitTunnel'; Script = 'Intune\Get-IntuneVpnSplitTunnelConfig.ps1'; Label = 'VPN Split Tunnel'; RequiredServices = @('Graph') }
        @{ Name = '15l-Intune-WifiEap';        Script = 'Intune\Get-IntuneWifiEapConfig.ps1';         Label = 'Wi-Fi EAP'; RequiredServices = @('Graph') }
    )
    'Security' = @(
        @{ Name = '16-Secure-Score';       Script = 'Security\Get-SecureScoreReport.ps1';   Label = 'Secure Score'; HasSecondary = $true; SecondaryName = '17-Improvement-Actions'; RequiredServices = @('Graph') }
        @{ Name = '18-Defender-Policies';  Script = 'Security\Get-DefenderPolicyReport.ps1'; Label = 'Defender Policies'; RequiredServices = @('ExchangeOnline') }
        @{ Name = '18b-Defender-Security-Config'; Script = 'Security\Get-DefenderSecurityConfig.ps1'; Label = 'Defender Security Config'; RequiredServices = @('ExchangeOnline') }
        @{ Name = '19-DLP-Policies';       Script = 'Security\Get-DlpPolicyReport.ps1';     Label = 'DLP Policies'; RequiredServices = @('Purview') }
        @{ Name = '19b-Compliance-Security-Config'; Script = 'Security\Get-ComplianceSecurityConfig.ps1'; Label = 'Compliance Security Config'; RequiredServices = @('Purview') }
        @{ Name = '19c-Purview-Retention-Config'; Script = 'Purview\Get-PurviewRetentionConfig.ps1'; Label = 'Purview Retention Config'; RequiredServices = @('Purview') }
        @{ Name = '24-StrykerIncidentReadiness'; Script = 'Security\Get-StrykerIncidentReadiness.ps1'; Label = 'Stryker Incident Readiness'; RequiredServices = @('Graph') }
        @{ Name = '25-Defender-VulnScan';         Script = 'Security\Get-DefenderVulnScanConfig.ps1';    Label = 'Vulnerability Scanning'; RequiredServices = @('Graph') }
        @{ Name = '26-Defender-RealTimeScan';     Script = 'Security\Get-DefenderScanConfig.ps1';        Label = 'Real-time Scanning'; RequiredServices = @('Graph') }
        @{ Name = '27-Defender-SecureMon';        Script = 'Security\Get-DefenderSecureMonConfig.ps1';   Label = 'Security Monitoring'; RequiredServices = @('Graph') }
        @{ Name = '28-Defender-CfgDetect';        Script = 'Security\Get-DefenderCfgDetectConfig.ps1';   Label = 'Config Detection'; RequiredServices = @('Graph') }
    )
    'Collaboration' = @(
        @{ Name = '20-SharePoint-OneDrive'; Script = 'Collaboration\Get-SharePointOneDriveReport.ps1'; Label = 'SharePoint & OneDrive' }
        @{ Name = '20b-SharePoint-Security-Config'; Script = 'Collaboration\Get-SharePointSecurityConfig.ps1'; Label = 'SharePoint Security Config' }
        @{ Name = '21-Teams-Access';        Script = 'Collaboration\Get-TeamsAccessReport.ps1';         Label = 'Teams Access' }
        @{ Name = '21b-Teams-Security-Config'; Script = 'Collaboration\Get-TeamsSecurityConfig.ps1';    Label = 'Teams Security Config' }
        @{ Name = '21c-Forms-Security-Config'; Script = 'Collaboration\Get-FormsSecurityConfig.ps1'; Label = 'Forms Security Config' }
    )
    'PowerBI' = @(
        @{ Name = '22-PowerBI-Security-Config'; Script = 'PowerBI\Get-PowerBISecurityConfig.ps1'; Label = 'Power BI Security Config'; IsChildProcess = $true }
    )
    'Hybrid' = @(
        @{ Name = '23-Hybrid-Sync'; Script = 'ActiveDirectory\Get-HybridSyncReport.ps1'; Label = 'Hybrid Sync' }
    )
    'Inventory' = @(
        @{ Name = '11c-Mailbox-Permissions'; Script = 'Exchange-Online\Get-MailboxPermissionReport.ps1'; Label = 'Mailbox Permissions'; RequiredServices = @('ExchangeOnline') }
        @{ Name = '28-Mailbox-Inventory';    Script = 'Inventory\Get-MailboxInventory.ps1';    Label = 'Mailbox Inventory';    RequiredServices = @('ExchangeOnline') }
        @{ Name = '29-Group-Inventory';      Script = 'Inventory\Get-GroupInventory.ps1';      Label = 'Group Inventory';      RequiredServices = @('ExchangeOnline') }
        @{ Name = '30-Teams-Inventory';      Script = 'Inventory\Get-TeamsInventory.ps1';      Label = 'Teams Inventory';      RequiredServices = @('Graph') }
        @{ Name = '31-SharePoint-Inventory'; Script = 'Inventory\Get-SharePointInventory.ps1'; Label = 'SharePoint Inventory'; RequiredServices = @('Graph') }
        @{ Name = '32-OneDrive-Inventory';   Script = 'Inventory\Get-OneDriveInventory.ps1';   Label = 'OneDrive Inventory';   RequiredServices = @('Graph') }
    )
    'ActiveDirectory' = @(
        @{ Name = '23-AD-Domain-Report';      Script = 'ActiveDirectory\Get-ADDomainReport.ps1';      Label = 'AD Domain & Forest' }
        @{ Name = '24-AD-DC-Health';           Script = 'ActiveDirectory\Get-ADDCHealthReport.ps1';    Label = 'AD DC Health'; Params = @{ SkipDcdiag = $true } }
        @{ Name = '25-AD-Replication';         Script = 'ActiveDirectory\Get-ADReplicationReport.ps1'; Label = 'AD Replication' }
        @{ Name = '26-AD-Security';            Script = 'ActiveDirectory\Get-ADSecurityReport.ps1';    Label = 'AD Security' }
    )
    'SOC2' = @(
        @{ Name = '33-SOC2-Security-Controls';       Script = 'SOC2\Get-SOC2SecurityControls.ps1';       Label = 'SOC 2 Security Controls'; RequiredServices = @('Graph') }
        @{ Name = '34-SOC2-Confidentiality-Controls'; Script = 'SOC2\Get-SOC2ConfidentialityControls.ps1'; Label = 'SOC 2 Confidentiality Controls'; RequiredServices = @('Graph', 'Purview') }
        @{ Name = '35-SOC2-Audit-Evidence';           Script = 'SOC2\Get-SOC2AuditEvidence.ps1';           Label = 'SOC 2 Audit Evidence'; RequiredServices = @('Graph') }
        @{ Name = '36-SOC2-Readiness-Checklist';     Script = 'SOC2\Get-SOC2ReadinessChecklist.ps1';     Label = 'SOC 2 Readiness Checklist' }
    )
    'ValueOpportunity' = @(
        @{ Name = '40-License-Utilization'; Script = 'ValueOpportunity\Get-LicenseUtilization.ps1'; Label = 'License Utilization'; RequiredServices = @('Graph'); PassProjectContext = $true }
        @{ Name = '41-Feature-Adoption';    Script = 'ValueOpportunity\Get-FeatureAdoption.ps1';    Label = 'Feature Adoption'; PassProjectContext = $true }
        @{ Name = '42-Feature-Readiness';   Script = 'ValueOpportunity\Get-FeatureReadiness.ps1';   Label = 'Feature Readiness'; PassProjectContext = $true }
    )
}

# ------------------------------------------------------------------
# DNS Authentication collector (runs after Email section)
# ------------------------------------------------------------------
$dnsCollector = @{
    Name   = '12-DNS-Email-Authentication'
    Label  = 'DNS Email Authentication'
}

    @{
        SectionServiceMap = $sectionServiceMap
        SectionScopeMap   = $sectionScopeMap
        SectionModuleMap  = $sectionModuleMap
        CollectorMap      = $collectorMap
        DnsCollector      = $dnsCollector
    }
}
