# Permission definitions for Grant-M365AssessConsent
# These data tables define the exact permissions required by Invoke-M365Assessment.

# ==============================================================================
# GRAPH API PERMISSIONS
# Source: $sectionScopeMap from all sections, deduplicated
# ==============================================================================

$script:RequiredGraphPermissions = @(
    # -- Tenant ----------------------------------------------------------------
    @{ Name = 'Organization.Read.All';                   Sections = 'Tenant, Licensing, Hybrid'              ; Reason = 'Tenant org details, verified domains, hybrid config' }
    @{ Name = 'Domain.Read.All';                         Sections = 'Tenant, Identity, Hybrid'               ; Reason = 'All domains registered in the tenant' }
    @{ Name = 'Group.Read.All';                          Sections = 'Tenant, Inventory'                      ; Reason = 'All groups including Microsoft 365 and security groups' }
    # -- Identity --------------------------------------------------------------
    @{ Name = 'User.Read.All';                           Sections = 'Tenant, Identity, Licensing, Inventory' ; Reason = 'User profiles, sign-in activity, license assignments' }
    @{ Name = 'AuditLog.Read.All';                       Sections = 'Identity'                               ; Reason = 'Sign-in logs and directory audit events' }
    @{ Name = 'UserAuthenticationMethod.Read.All';       Sections = 'Identity'                               ; Reason = 'MFA and passwordless authentication methods per user' }
    @{ Name = 'RoleManagement.Read.Directory';           Sections = 'Identity'                               ; Reason = 'Entra directory role assignments and PIM eligibility' }
    @{ Name = 'Policy.Read.All';                         Sections = 'Tenant, Identity'                       ; Reason = 'Conditional Access, auth methods, token lifetime, password policies' }
    @{ Name = 'Application.Read.All';                    Sections = 'Identity'                               ; Reason = 'App registrations, service principals, OAuth permission grants' }
    @{ Name = 'Directory.Read.All';                      Sections = 'Identity'                               ; Reason = 'Devices, admin units, role templates' }
    # -- Intune ----------------------------------------------------------------
    @{ Name = 'DeviceManagementManagedDevices.Read.All'; Sections = 'Intune'                                 ; Reason = 'Managed device inventory and compliance state' }
    @{ Name = 'DeviceManagementConfiguration.Read.All';  Sections = 'Intune, Security'                       ; Reason = 'Configuration profiles, compliance policies, Multi-Admin Approval policies' }
    @{ Name = 'DeviceManagementRBAC.Read.All';           Sections = 'Security'                               ; Reason = 'Intune RBAC role definitions and assignments (scope tag audit)' }
    @{ Name = 'DeviceManagementApps.Read.All';           Sections = 'Security'                               ; Reason = 'Intune audit events including device wipe/retire/delete actions' }
    # -- Security --------------------------------------------------------------
    @{ Name = 'SecurityEvents.Read.All';                 Sections = 'Security'                               ; Reason = 'Secure Score, improvement actions, security alerts' }
    # -- Collaboration ---------------------------------------------------------
    @{ Name = 'SharePointTenantSettings.Read.All';       Sections = 'Collaboration'                          ; Reason = 'SharePoint and OneDrive tenant-level settings' }
    @{ Name = 'TeamSettings.Read.All';                   Sections = 'Collaboration'                          ; Reason = 'Teams tenant-level settings and policies' }
    @{ Name = 'TeamworkAppSettings.Read.All';            Sections = 'Collaboration'                          ; Reason = 'Teams app permission and setup policies' }
    @{ Name = 'OrgSettings-Forms.Read.All';             Sections = 'Collaboration'                          ; Reason = 'Microsoft Forms tenant-level settings' }
    @{ Name = 'MailboxSettings.Read';                   Sections = 'Email'                                  ; Reason = 'Mailbox-level settings (forwarding, audit, locale) via Graph' }
    # -- Inventory -------------------------------------------------------------
    @{ Name = 'Team.ReadBasic.All';                      Sections = 'Inventory'                              ; Reason = 'Enumerate all Teams' }
    @{ Name = 'TeamMember.Read.All';                     Sections = 'Inventory'                              ; Reason = 'Teams membership details' }
    @{ Name = 'Channel.ReadBasic.All';                   Sections = 'Inventory'                              ; Reason = 'Teams channels' }
    @{ Name = 'Reports.Read.All';                        Sections = 'Inventory'                              ; Reason = 'Microsoft 365 usage reports' }
    @{ Name = 'Sites.Read.All';                          Sections = 'Inventory'                              ; Reason = 'SharePoint site enumeration and metadata' }
)

# ==============================================================================
# EXCHANGE ONLINE ROLE GROUPS
#
# Cloud-only EXO tenants do NOT have "View-Only Recipients" or
# "View-Only Configuration" -- those only exist in on-premises / hybrid Exchange.
# In Exchange Online, "View-Only Organization Management" covers the equivalent
# read-only access for mailboxes, recipients, transport rules, and connectors.
#
# "Security Reader" is intentionally excluded here -- it is ambiguous (exists in
# both EXO and Entra ID) and causes a "matches multiple entries" error. The
# Entra ID "Security Reader" directory role is assigned in the Compliance step
# below, which is the correct surface for Defender/security policy reads.
# ==============================================================================

$script:RequiredExoRoleGroups = @(
    @{
        RoleGroup = 'View-Only Organization Management'
        Sections  = 'Email, Security, Inventory'
        Reason    = 'Read-only access to mailboxes, recipients, transport rules, connectors, and EOP/Defender policies. Replaces the on-prem-only "View-Only Recipients" and "View-Only Configuration" groups in cloud EXO.'
    }
    @{
        RoleGroup = 'Compliance Management'
        Sections  = 'Security'
        Reason    = 'Read access to compliance-related EXO configuration (journal rules, message tracking, transport compliance rules).'
    }
)

# ==============================================================================
# PURVIEW / COMPLIANCE ENTRA DIRECTORY ROLES
#
# These are Entra ID built-in directory roles, NOT Security & Compliance
# PowerShell role groups. They must be assigned via Graph
# (New-MgDirectoryRoleMemberByRef), not Connect-IPPSSession.
#
# Role template GUIDs are stable across all tenants (built-in roles).
# ==============================================================================

$script:RequiredComplianceRoles = @(
    @{
        DisplayName  = 'Compliance Administrator'
        TemplateId   = '17315797-102d-40b4-93e0-432062caca18'
        Sections     = 'Security'
        Reason       = 'Read access to Purview compliance configuration -- DLP policies, audit, retention, sensitivity labels.'
    }
    @{
        DisplayName  = 'Security Reader'
        TemplateId   = '5d6b6bb7-de71-4623-b4af-96380a352509'
        Sections     = 'Security'
        Reason       = 'Read access to Microsoft Defender and security-related settings, alerts, and policies.'
    }
    @{
        DisplayName  = 'Global Reader'
        TemplateId   = 'f2ef992c-3afb-46b9-b7cf-a126ee74c451'
        Sections     = 'Security, Compliance'
        Reason       = 'Broad read-only access across Microsoft 365 services including Purview, covering gaps not addressed by the above roles.'
    }
)
