@{
    # Module manifest for M365-Assess
    # Generated: 2026-03-08

    RootModule        = 'Invoke-M365Assessment.ps1'
    ModuleVersion     = '0.8.1'
    GUID              = 'f7e3b2a1-4c5d-6e8f-9a0b-1c2d3e4f5a6b'
    Author            = 'SelvageLabs'
    CompanyName       = 'Community'
    Copyright         = '(c) 2026 SelvageLabs. All rights reserved.'
    Description       = 'Comprehensive read-only Microsoft 365 security assessment tool for IT consultants and administrators. Covers Entra ID, Exchange Online, Intune, Defender, SharePoint, Teams, Purview, Active Directory, and CISA ScubaGear baselines.'

    # Minimum PowerShell version
    PowerShellVersion = '7.0'

    # Required modules (must be installed before running)
    # Known compatible: Graph SDK 2.25+ with EXO 3.7.x
    # EXO 3.8.0+ has MSAL conflicts with Graph SDK 2.x -- do not use
    # EXO excluded from RequiredModules because ModuleVersion only supports minimum,
    # and we need a ceiling (< 3.8.0). The orchestrator handles EXO gating at runtime.
    RequiredModules   = @(
        @{ ModuleName = 'Microsoft.Graph.Authentication';               ModuleVersion = '2.25.0' }
        @{ ModuleName = 'Microsoft.Graph.Identity.DirectoryManagement'; ModuleVersion = '2.25.0' }
        @{ ModuleName = 'Microsoft.Graph.Identity.SignIns';             ModuleVersion = '2.25.0' }
    )

    # Scripts included in this module
    ScriptsToProcess  = @(
        'Common\Connect-Service.ps1'
    )

    # Files included in this module package
    FileList          = @(
        'Invoke-M365Assessment.ps1'
        'Common\Connect-Service.ps1'
        'Common\Export-AssessmentReport.ps1'
        'Entra\Get-TenantInfo.ps1'
        'Entra\Get-UserSummary.ps1'
        'Entra\Get-MfaReport.ps1'
        'Entra\Get-AdminRoleReport.ps1'
        'Entra\Get-ConditionalAccessReport.ps1'
        'Entra\Get-AppRegistrationReport.ps1'
        'Entra\Get-PasswordPolicyReport.ps1'
        'Entra\Get-EntraSecurityConfig.ps1'
        'Entra\Get-CASecurityConfig.ps1'
        'Entra\Get-LicenseReport.ps1'
        'Entra\Get-InactiveUsers.ps1'
        'Exchange-Online\Get-MailboxSummary.ps1'
        'Exchange-Online\Get-MailFlowReport.ps1'
        'Exchange-Online\Get-EmailSecurityReport.ps1'
        'Exchange-Online\Get-ExoSecurityConfig.ps1'
        'Exchange-Online\Get-DnsSecurityConfig.ps1'
        'Exchange-Online\Get-MailboxPermissionReport.ps1'
        'Intune\Get-DeviceSummary.ps1'
        'Intune\Get-CompliancePolicyReport.ps1'
        'Intune\Get-ConfigProfileReport.ps1'
        'Intune\Get-DeviceComplianceReport.ps1'
        'Intune\Get-IntuneSecurityConfig.ps1'
        'Security\Get-SecureScoreReport.ps1'
        'Security\Get-DefenderPolicyReport.ps1'
        'Security\Get-DefenderSecurityConfig.ps1'
        'Security\Get-DlpPolicyReport.ps1'
        'Security\Get-ComplianceSecurityConfig.ps1'
        'Security\Get-LocalAdmins.ps1'
        'Security\Invoke-ScubaGearScan.ps1'
        'Collaboration\Get-SharePointOneDriveReport.ps1'
        'Collaboration\Get-SharePointSecurityConfig.ps1'
        'Collaboration\Get-TeamsAccessReport.ps1'
        'Collaboration\Get-TeamsSecurityConfig.ps1'
        'ActiveDirectory\Get-HybridSyncReport.ps1'
        'ActiveDirectory\Get-ADDomainReport.ps1'
        'ActiveDirectory\Get-ADDCHealthReport.ps1'
        'ActiveDirectory\Get-ADReplicationReport.ps1'
        'ActiveDirectory\Get-ADSecurityReport.ps1'
        'ActiveDirectory\Get-StaleComputers.ps1'
        'Inventory\Get-MailboxInventory.ps1'
        'Inventory\Get-GroupInventory.ps1'
        'Inventory\Get-TeamsInventory.ps1'
        'Inventory\Get-SharePointInventory.ps1'
        'Inventory\Get-OneDriveInventory.ps1'
        'Purview\Get-AuditRetentionReport.ps1'
        'Purview\Search-AuditLog.ps1'
        'Networking\Test-PortConnectivity.ps1'
        'Windows\Get-InstalledSoftware.ps1'
    )

    # Private data / PSData for PowerShell Gallery
    PrivateData       = @{
        PSData = @{
            Tags         = @('Microsoft365', 'M365', 'Security', 'Assessment', 'EntraID', 'Exchange', 'Intune', 'Defender', 'SharePoint', 'Teams', 'ScubaGear', 'CIS')
            LicenseUri   = 'https://github.com/SelvageLabs/M365-Assess/blob/main/LICENSE'
            ProjectUri   = 'https://github.com/SelvageLabs/M365-Assess'
            ReleaseNotes = 'v0.8.1 - Polish: version sync across all scripts, CheckId Guide rewrite, dashboard fix, auth matrix, 6 CIS quick-win checks (138 automated)'
        }
    }
}
