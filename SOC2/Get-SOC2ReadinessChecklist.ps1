<#
.SYNOPSIS
    Generates a SOC 2 Common Criteria readiness checklist for items that cannot be automated.
.DESCRIPTION
    Produces a checklist of organizational, procedural, and governance controls required
    by the AICPA SOC 2 Common Criteria (CC1-CC5, CC8-CC9) that apply to every SOC 2
    engagement regardless of which trust principles are selected.

    These controls require documented policies, human attestation, and organizational
    processes that cannot be verified through M365 API queries alone. This checklist
    ensures organizations are aware of all requirements beyond the automated technical
    checks performed by the Security and Confidentiality control scripts.

    Also includes guidance on supplementary evidence that can be sourced from existing
    M365-Assess collectors (Secure Score, App Registrations, Defender policies).

    All operations are strictly read-only — this script generates a static checklist
    and does not query any APIs.

    DISCLAIMER: This tool assists with SOC 2 readiness assessment. It does not
    constitute a SOC 2 audit or certification.
.PARAMETER OutputPath
    Optional path to export checklist as CSV.
.EXAMPLE
    PS> .\SOC2\Get-SOC2ReadinessChecklist.ps1

    Displays the SOC 2 readiness checklist.
.EXAMPLE
    PS> .\SOC2\Get-SOC2ReadinessChecklist.ps1 -OutputPath '.\soc2-checklist.csv'

    Exports the checklist to CSV for tracking.
.NOTES
    Author:  Daren9m
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath
)

$results = [System.Collections.Generic.List[PSCustomObject]]::new()

function Add-ChecklistItem {
    param(
        [string]$Category,
        [string]$TSCReference,
        [string]$Requirement,
        [string]$Description,
        [string]$EvidenceType,
        [string]$Guidance,
        [string]$M365Relevance = 'None',
        [string]$Priority = 'Required'
    )
    $results.Add([PSCustomObject]@{
        Category      = $Category
        TSCReference  = $TSCReference
        Requirement   = $Requirement
        Description   = $Description
        EvidenceType  = $EvidenceType
        Guidance      = $Guidance
        M365Relevance = $M365Relevance
        Priority      = $Priority
        Status        = 'Not Assessed'
    })
}

# ======================================================================
# CC1 — Control Environment
# ======================================================================
Add-ChecklistItem -Category 'CC1 — Control Environment' -TSCReference 'CC1.1' `
    -Requirement 'Management Commitment to Security' `
    -Description 'Board or management demonstrates commitment to security through documented oversight activities' `
    -EvidenceType 'Policy / Meeting Minutes' `
    -Guidance 'Provide board or leadership meeting minutes showing security is a recurring agenda item. Document management assertions about security commitments.'

Add-ChecklistItem -Category 'CC1 — Control Environment' -TSCReference 'CC1.2' `
    -Requirement 'Board Oversight of Security Program' `
    -Description 'Governance body exercises oversight of the security program' `
    -EvidenceType 'Meeting Minutes / Charter' `
    -Guidance 'Document the governance structure. For SMBs without a board, document which role(s) have security oversight responsibility.'

Add-ChecklistItem -Category 'CC1 — Control Environment' -TSCReference 'CC1.3' `
    -Requirement 'Organizational Structure and Authority' `
    -Description 'Organization structure supports security objectives with clear lines of authority' `
    -EvidenceType 'Org Chart / Role Descriptions' `
    -Guidance 'Provide an organizational chart showing security-relevant roles. Document who has authority over security decisions.'

Add-ChecklistItem -Category 'CC1 — Control Environment' -TSCReference 'CC1.4' `
    -Requirement 'Security Awareness Training' `
    -Description 'Personnel complete security awareness training and acknowledge acceptable use policies' `
    -EvidenceType 'Training Records / Policy Acknowledgments' `
    -Guidance 'Maintain training completion records with dates. Track policy acknowledgment signatures. Auditors will sample employees to verify.' `
    -M365Relevance 'Partial — training can be delivered via Teams/SharePoint; completion tracked externally'

Add-ChecklistItem -Category 'CC1 — Control Environment' -TSCReference 'CC1.4' `
    -Requirement 'Background Checks for Personnel' `
    -Description 'Background checks are performed for personnel with access to sensitive systems' `
    -EvidenceType 'HR Records' `
    -Guidance 'Document the background check policy including which roles require checks. Maintain records of completed checks (pass/fail, not details).'

Add-ChecklistItem -Category 'CC1 — Control Environment' -TSCReference 'CC1.5' `
    -Requirement 'Personnel Accountability' `
    -Description 'Individuals are held accountable for their security responsibilities' `
    -EvidenceType 'Policy / Job Descriptions' `
    -Guidance 'Include security responsibilities in job descriptions. Document disciplinary procedures for security policy violations.'

# ======================================================================
# CC2 — Communication and Information
# ======================================================================
Add-ChecklistItem -Category 'CC2 — Communication and Information' -TSCReference 'CC2.1' `
    -Requirement 'Information Security Policy' `
    -Description 'A documented information security policy exists and is communicated to all personnel' `
    -EvidenceType 'Policy Document / Distribution Evidence' `
    -Guidance 'Create a comprehensive information security policy. Provide evidence of distribution (email, SharePoint, intranet). Track acknowledgments.' `
    -Priority 'Required'

Add-ChecklistItem -Category 'CC2 — Communication and Information' -TSCReference 'CC2.2' `
    -Requirement 'Internal Security Communication' `
    -Description 'Security policies, changes, and responsibilities are communicated to internal stakeholders' `
    -EvidenceType 'Email / Intranet / Training Materials' `
    -Guidance 'Document how security information is communicated. Retain copies of security bulletins, policy change announcements, and onboarding materials.'

Add-ChecklistItem -Category 'CC2 — Communication and Information' -TSCReference 'CC2.3' `
    -Requirement 'External Communication of Security' `
    -Description 'Security commitments and obligations are communicated to external parties' `
    -EvidenceType 'Contracts / Privacy Notices / SLAs' `
    -Guidance 'Review customer contracts for security provisions. Maintain an external-facing privacy notice. Document security-related SLA commitments.'

Add-ChecklistItem -Category 'CC2 — Communication and Information' -TSCReference 'CC2.2' `
    -Requirement 'System Description Document' `
    -Description 'A system description document describes boundaries, components, data flows, and infrastructure' `
    -EvidenceType 'System Description Document' `
    -Guidance 'This is a mandatory artifact in every SOC 2 report. Document: system boundaries, infrastructure components, software, people, data flows, and third-party connections.' `
    -Priority 'Required'

# ======================================================================
# CC3 — Risk Assessment
# ======================================================================
Add-ChecklistItem -Category 'CC3 — Risk Assessment' -TSCReference 'CC3.1' `
    -Requirement 'Formal Risk Assessment Process' `
    -Description 'The organization conducts formal risk assessments with documented methodology' `
    -EvidenceType 'Risk Assessment Document' `
    -Guidance 'Create a risk register with likelihood/impact ratings. Use a standard framework (NIST, ISO 27005). Review annually at minimum.' `
    -Priority 'Required'

Add-ChecklistItem -Category 'CC3 — Risk Assessment' -TSCReference 'CC3.2' `
    -Requirement 'Fraud Risk Consideration' `
    -Description 'Risk assessment considers the potential for fraud including management override' `
    -EvidenceType 'Risk Assessment Document' `
    -Guidance 'Include insider threat and privilege abuse scenarios in the risk register. Document controls that mitigate fraud risk (segregation of duties, access reviews).'

Add-ChecklistItem -Category 'CC3 — Risk Assessment' -TSCReference 'CC3.3' `
    -Requirement 'Risk Assessment of Changes' `
    -Description 'Significant changes to infrastructure or operations trigger risk reassessment' `
    -EvidenceType 'Change Records / Risk Updates' `
    -Guidance 'Document criteria for what triggers a risk reassessment. Maintain records of reassessments performed after significant changes.' `
    -M365Relevance 'Partial — Secure Score trends show configuration drift; run Get-SecureScoreReport.ps1 to track'

Add-ChecklistItem -Category 'CC3 — Risk Assessment' -TSCReference 'CC3.4' `
    -Requirement 'Microsoft Secure Score Monitoring' `
    -Description 'Track Microsoft Secure Score trends as supplementary risk indicator' `
    -EvidenceType 'Automated — Secure Score Report' `
    -Guidance 'Run the existing Get-SecureScoreReport.ps1 collector regularly. Trend data demonstrates ongoing risk awareness to auditors.' `
    -M365Relevance 'Direct — existing collector produces this evidence' `
    -Priority 'Recommended'

# ======================================================================
# CC4 — Monitoring Activities
# ======================================================================
Add-ChecklistItem -Category 'CC4 — Monitoring Activities' -TSCReference 'CC4.1' `
    -Requirement 'Ongoing Control Monitoring' `
    -Description 'Controls are monitored on an ongoing basis to verify they continue to operate effectively' `
    -EvidenceType 'Monitoring Reports / Review Records' `
    -Guidance 'Document the monitoring cadence for each control. SOC 2 Security/Confidentiality checks in this tool provide point-in-time evidence; schedule regular runs and retain results.' `
    -M365Relevance 'Partial — schedule this assessment tool to run regularly; see Daily Monitoring Strategy doc'

Add-ChecklistItem -Category 'CC4 — Monitoring Activities' -TSCReference 'CC4.2' `
    -Requirement 'Control Deficiency Reporting' `
    -Description 'Identified control deficiencies are reported and remediated in a timely manner' `
    -EvidenceType 'Issue Tracker / Remediation Records' `
    -Guidance 'When this tool identifies Fail results, track them in a ticketing system with assigned owners, target remediation dates, and closure evidence.'

# ======================================================================
# CC5 — Control Activities
# ======================================================================
Add-ChecklistItem -Category 'CC5 — Control Activities' -TSCReference 'CC5.1' `
    -Requirement 'Segregation of Duties' `
    -Description 'Incompatible duties are segregated to reduce risk of unauthorized actions' `
    -EvidenceType 'Access Matrix / Role Documentation' `
    -Guidance 'Document which roles are incompatible. Verify that no single individual can both approve and execute privileged changes. Review Global Admin assignments (S-05 check).' `
    -M365Relevance 'Partial — admin role assignment data from Identity section'

Add-ChecklistItem -Category 'CC5 — Control Activities' -TSCReference 'CC5.2' `
    -Requirement 'Access Review Schedule' `
    -Description 'User access is reviewed periodically (at least quarterly) with documented disposition' `
    -EvidenceType 'Access Review Records' `
    -Guidance 'Configure Entra ID Access Reviews for privileged roles. Retain completion records showing reviewer, date, and disposition (certified/removed). Auditors will specifically request this.' `
    -M365Relevance 'Direct — configure via Entra ID > Identity Governance > Access Reviews' `
    -Priority 'Required'

# ======================================================================
# CC8 — Change Management
# ======================================================================
Add-ChecklistItem -Category 'CC8 — Change Management' -TSCReference 'CC8.1' `
    -Requirement 'Change Management Policy' `
    -Description 'Changes to infrastructure and applications follow a documented, controlled process' `
    -EvidenceType 'Policy Document / Change Records' `
    -Guidance 'Document the change management process: request, review, approve, test, implement, verify. Maintain a change log with approvals.' `
    -Priority 'Required'

Add-ChecklistItem -Category 'CC8 — Change Management' -TSCReference 'CC8.1' `
    -Requirement 'M365 Configuration Change Tracking' `
    -Description 'Changes to Conditional Access, DLP, mail flow, and security policies are tracked and approved' `
    -EvidenceType 'Audit Logs / Change Tickets' `
    -Guidance 'The Unified Audit Log captures CA policy changes, DLP modifications, and app consent events. Cross-reference audit log entries with change tickets to prove controlled change. Key operations: Update conditional access policy, Set-DlpCompliancePolicy, Add OAuth2PermissionGrant.' `
    -M365Relevance 'Direct — audit log evidence from E-08 (role changes) covers part of this; extend to CA/DLP change events' `
    -Priority 'Required'

Add-ChecklistItem -Category 'CC8 — Change Management' -TSCReference 'CC8.1' `
    -Requirement 'Emergency Change Procedures' `
    -Description 'Emergency changes have a documented expedited process with post-hoc review' `
    -EvidenceType 'Policy / Emergency Change Records' `
    -Guidance 'Document the emergency change procedure including who can authorize, what qualifies as emergency, and the post-implementation review requirement.'

# ======================================================================
# CC9 — Risk Mitigation
# ======================================================================
Add-ChecklistItem -Category 'CC9 — Risk Mitigation' -TSCReference 'CC9.1' `
    -Requirement 'Risk Mitigation Strategies' `
    -Description 'Identified risks are mitigated through acceptance, avoidance, sharing, or reduction' `
    -EvidenceType 'Risk Register with Treatment Plans' `
    -Guidance 'For each risk in the risk register, document the treatment decision and implementation status.'

Add-ChecklistItem -Category 'CC9 — Risk Mitigation' -TSCReference 'CC9.2' `
    -Requirement 'Vendor and Third-Party Management' `
    -Description 'Third-party service providers are assessed and monitored for security compliance' `
    -EvidenceType 'Vendor Assessment Records / SOC Reports' `
    -Guidance 'Obtain Microsoft SOC 2 report (available from Service Trust Portal). Review third-party app registrations for excessive permissions. Run Get-AppRegistrationReport.ps1 to inventory OAuth apps.' `
    -M365Relevance 'Direct — existing collector inventories app registrations and permissions' `
    -Priority 'Required'

Add-ChecklistItem -Category 'CC9 — Risk Mitigation' -TSCReference 'CC9.2' `
    -Requirement 'Microsoft Complementary User Entity Controls (CUECs)' `
    -Description 'Customer responsibilities identified in Microsoft SOC 2 report are implemented' `
    -EvidenceType 'CUEC Mapping / Evidence' `
    -Guidance 'Download Microsoft SOC 2 report from Service Trust Portal. Review the CUECs section. Map each CUEC to your control implementation. Many CUECs are covered by checks in this tool (MFA, admin access, audit logging).' `
    -Priority 'Required'

# ======================================================================
# Additional Auditor Expectations
# ======================================================================
Add-ChecklistItem -Category 'Auditor Artifacts' -TSCReference 'All' `
    -Requirement 'Management Assertion Letter' `
    -Description 'Written management assertion that the system description is fairly presented and controls operate effectively' `
    -EvidenceType 'Signed Letter' `
    -Guidance 'This is provided to the auditor at engagement start. Management asserts: (1) system description is complete and accurate, (2) controls were suitably designed, (3) controls operated effectively during the observation period.' `
    -Priority 'Required'

Add-ChecklistItem -Category 'Auditor Artifacts' -TSCReference 'CC7.4' `
    -Requirement 'Incident Response Plan' `
    -Description 'A documented incident response plan exists and has been tested' `
    -EvidenceType 'IRP Document / Test Records' `
    -Guidance 'Document: roles, communication plan, escalation procedures, containment steps, recovery procedures, post-incident review. Test via tabletop exercise annually. Retain test results and lessons learned.' `
    -Priority 'Required'

Add-ChecklistItem -Category 'Auditor Artifacts' -TSCReference 'CC7.5' `
    -Requirement 'Vulnerability Management Program' `
    -Description 'Vulnerabilities are identified, assessed, and remediated in a timely manner' `
    -EvidenceType 'Scan Reports / Remediation Records' `
    -Guidance 'For M365 scope: monitor Secure Score recommendations, track Defender vulnerability alerts, document remediation timelines. Run Get-DefenderPolicyReport.ps1 to verify endpoint protection configuration.' `
    -M365Relevance 'Partial — Secure Score and Defender reports provide M365-layer vulnerability evidence'

Add-ChecklistItem -Category 'Auditor Artifacts' -TSCReference 'CC5.2' `
    -Requirement 'Control Owner Matrix' `
    -Description 'Each control has a named owner accountable for its operation and evidence collection' `
    -EvidenceType 'RACI / Owner Matrix' `
    -Guidance 'Create a matrix mapping each control ID (S-01 through C-07) to a named owner with contact info. Include non-technical controls from this checklist. Auditors will interview control owners.'

Add-ChecklistItem -Category 'Auditor Artifacts' -TSCReference 'CC6.4' `
    -Requirement 'Physical Security Controls' `
    -Description 'Physical access to facilities and equipment is restricted to authorized personnel' `
    -EvidenceType 'Physical Security Documentation' `
    -Guidance 'For cloud-only organizations: document that primary systems are hosted by Microsoft (reference their SOC 2). For offices: document physical access controls (badge access, visitor logs). This is out of scope for M365 API checks but auditors will still require it.' `
    -M365Relevance 'None — out of scope for M365 but required for SOC 2'

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
Write-Verbose "SOC 2 readiness checklist items generated: $($results.Count)"

if ($OutputPath) {
    $results | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported $($results.Count) SOC 2 readiness checklist items to $OutputPath"
}
else {
    Write-Output $results
}
