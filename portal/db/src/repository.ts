// Repository contract — the boundary every feature depends on (ADR-0015).
// This file names no storage engine and contains no SQL.

export type TenantSource = "direct" | "gdap";
export type TenantStatus = "active" | "excluded" | "error";
export type TenantGroupKind = "static" | "dynamic";
export type RunTrigger = "manual" | "schedule" | "api";
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "partial" | "cancelled";

export const VALID_RUN_STATUSES: readonly RunStatus[] = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "partial",
  "cancelled",
] as const;

export class InvalidRunStatusError extends Error {
  readonly code = "run.invalid_status";
  constructor(status: string) {
    super(`invalid run status '${status}'; expected one of ${VALID_RUN_STATUSES.join(", ")}`);
    this.name = "InvalidRunStatusError";
  }
}

export function isValidRunStatus(status: unknown): status is RunStatus {
  return typeof status === "string" && VALID_RUN_STATUSES.includes(status as RunStatus);
}

export function assertValidRunStatus(status: unknown): asserts status is RunStatus {
  if (!isValidRunStatus(status)) {
    throw new InvalidRunStatusError(String(status));
  }
}
export type JobState = "queued" | "running" | "done" | "failed";
export type FindingStatus = "Pass" | "Fail" | "Warning" | "Review" | "Info" | "Skipped";
export type Severity = "Critical" | "High" | "Medium" | "Low" | "Info";
export type RemediationMode = "manual" | "automated";
export type AuditActorType = "user" | "apiClient" | "system";
export type AuditSource = "request" | "schedule" | "remediation";
export type AuditResult = "success" | "failure";

export interface Tenant {
  id: string;
  displayName: string | null;
  defaultDomain: string | null;
  initialDomain: string | null;
  source: TenantSource;
  status: TenantStatus;
  excluded: boolean;
  excludeReason: string | null;
  excludeDate: string | null;
  environment: string;
  lastRunAt: string | null;
  errorCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface TenantCredential {
  id: string;
  tenantId: string;
  authMethod: string;
  clientId: string;
  secretRef: string;
  thumbprint: string | null;
  environment: string;
  expiresOn: string | null;
  lastValidated: string | null;
  createdAt: string;
  updatedAt: string;
}

// Credential references (EPIC-001 SPEC.md §4.4): the job envelope and the child
// context carry only this reference, never secret material. The worker-side
// Resolve-TenantCredential (portal/workers/M365Portal.Workers/) resolves it
// against the credential store inside the child process. Pure helpers only —
// no Repository member, so existing implementations are unaffected.
export type CredentialRef = string & { readonly __brand: "CredentialRef" };

export class CredentialRefError extends Error {
  readonly code = "credential.invalid_ref";

  constructor(ref: string) {
    super(`credential reference '${ref}' is not of the form tenants/{tenantId}/credential`);
    this.name = "CredentialRefError";
  }
}

export function formatCredentialRef(tenantId: string): CredentialRef {
  return `tenants/${tenantId}/credential` as CredentialRef;
}

export function parseCredentialRef(ref: string): { tenantId: string } {
  const match = /^tenants\/([^/]+)\/credential$/.exec(ref);
  const tenantId = match?.[1];
  if (!tenantId) {
    throw new CredentialRefError(ref);
  }
  return { tenantId };
}

export function isCredentialRefForTenant(ref: string, tenantId: string): boolean {
  try {
    return parseCredentialRef(ref).tenantId === tenantId;
  } catch {
    return false;
  }
}

export interface TenantGroup {
  id: string;
  name: string;
  kind: TenantGroupKind;
  filter: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface TenantGroupMember {
  groupId: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantVariable {
  id: string;
  tenantId: string | null;
  name: string;
  value: string;
  isSecret: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GdapRelationship {
  tenantId: string;
  relationshipEnd: string | null;
  delegatedPrivilegeStatus: string | null;
  cpvConsentState: string | null;
  lastSynced: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  tenantId: string;
  parentRunId: string | null;
  trigger: RunTrigger;
  sections: string[];
  options: Record<string, unknown> | null;
  startedAt: string | null;
  finishedAt: string | null;
  status: RunStatus;
  artifactPath: string | null;
  summaryCounts: Record<string, unknown> | null;
  provenance: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunSection {
  id: string;
  runId: string;
  tenantId: string;
  section: string;
  collector: string | null;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Finding {
  id: string;
  runId: string;
  tenantId: string;
  checkId: string;
  controlName: string | null;
  category: string | null;
  collector: string | null;
  status: FindingStatus;
  severity: Severity | null;
  currentValue: string | null;
  recommendedValue: string | null;
  evidence: Record<string, unknown> | null;
  frameworkRefs: string[];
  remediationMode: RemediationMode | null;
  createdAt: string;
  updatedAt: string;
}

export interface Job {
  id: string;
  type: string;
  tenantId: string | null;
  payload: Record<string, unknown> | null;
  state: JobState;
  attempts: number;
  progress: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  actorUserId: string | null;
  actorType: AuditActorType;
  tenantId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  result: AuditResult;
  error: string | null;
  source: AuditSource;
  correlationId: string | null;
  createdAt: string;
}

export type OffboardingJobState = "planned" | "running" | "completed" | "failed";
export type OffboardingStepState = "pending" | "running" | "succeeded" | "failed" | "skipped";
export type LinkRemovalJobState = "planned" | "running" | "completed" | "failed";

export interface OffboardingJob {
  id: string;
  tenantId: string;
  userIds: string[];
  options: Record<string, unknown>;
  state: OffboardingJobState;
  createdAt: string;
  createdBy: string;
}

export interface OffboardingStep {
  jobId: string;
  order: number;
  action: string;
  state: OffboardingStepState;
  result: Record<string, unknown> | null;
  error: string | null;
  appliedAt: string | null;
}

export interface LinkRemovalJob {
  id: string;
  tenantId: string;
  linkIds: string[];
  state: LinkRemovalJobState;
  results: Record<string, unknown> | null;
  createdAt: string;
  createdBy: string;
}

export type TenantInput = Omit<
  Tenant,
  | "createdAt"
  | "updatedAt"
  | "deletedAt"
  | "environment"
  | "excludeReason"
  | "excludeDate"
  | "lastError"
> &
  Partial<
    Pick<
      Tenant,
      | "createdAt"
      | "updatedAt"
      | "deletedAt"
      | "environment"
      | "excludeReason"
      | "excludeDate"
      | "lastError"
    >
  >;
export type TenantCredentialInput = Omit<TenantCredential, "createdAt" | "updatedAt"> &
  Partial<Pick<TenantCredential, "createdAt" | "updatedAt">>;
export type TenantGroupInput = Omit<TenantGroup, "createdAt" | "updatedAt" | "deletedAt"> &
  Partial<Pick<TenantGroup, "createdAt" | "updatedAt" | "deletedAt">>;
export type TenantGroupMemberInput = Omit<TenantGroupMember, "createdAt" | "updatedAt"> &
  Partial<Pick<TenantGroupMember, "createdAt" | "updatedAt">>;
export type TenantVariableInput = Omit<TenantVariable, "createdAt" | "updatedAt"> &
  Partial<Pick<TenantVariable, "createdAt" | "updatedAt">>;
export type GdapRelationshipInput = Omit<GdapRelationship, "createdAt" | "updatedAt"> &
  Partial<Pick<GdapRelationship, "createdAt" | "updatedAt">>;
export type RunInput = Omit<Run, "createdAt" | "updatedAt"> &
  Partial<Pick<Run, "createdAt" | "updatedAt" | "parentRunId" | "options">>;

export interface RunRetentionOptions {
  /** Maximum age of runs to retain in days. */
  retentionDays?: number;
  /** Explicit ISO timestamp or Date cutoff; runs older than this cutoff are pruned. */
  olderThan?: string | Date;
}

export interface RunRetentionResult {
  prunedRunsCount: number;
}
export type RunSectionInput = Omit<RunSection, "createdAt" | "updatedAt"> &
  Partial<Pick<RunSection, "createdAt" | "updatedAt">>;
export type FindingInput = Omit<Finding, "createdAt" | "updatedAt"> &
  Partial<Pick<Finding, "createdAt" | "updatedAt">>;
export type JobInput = Omit<Job, "createdAt" | "updatedAt"> &
  Partial<Pick<Job, "createdAt" | "updatedAt">>;
export type AuditEventInput = Omit<AuditEvent, "createdAt"> &
  Partial<Pick<AuditEvent, "createdAt">>;

export interface AuditSearch {
  id: string;
  tenantId: string;
  name: string;
  filters: Record<string, unknown>;
  saved: boolean;
  scheduleId: string | null;
  lastRunAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface AuditCoverage {
  tenantId: string;
  auditEnabled: boolean;
  lastSearchAt: string | null;
  gaps: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WebhookSubscription {
  id: string;
  tenantId: string;
  resource: string;
  expiresOn: string | null;
  state: string;
  notificationUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditExclusionWindow {
  id: string;
  tenantId: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type AuditSearchInput = Omit<AuditSearch, "createdAt" | "updatedAt" | "deletedAt"> &
  Partial<Pick<AuditSearch, "createdAt" | "updatedAt" | "deletedAt">>;
export type AuditSearchUpdate = Partial<
  Pick<AuditSearch, "name" | "filters" | "saved" | "scheduleId" | "lastRunAt">
>;
export type AuditCoverageInput = Omit<AuditCoverage, "createdAt" | "updatedAt"> &
  Partial<Pick<AuditCoverage, "createdAt" | "updatedAt">>;
export type WebhookSubscriptionInput = Omit<WebhookSubscription, "createdAt" | "updatedAt"> &
  Partial<Pick<WebhookSubscription, "createdAt" | "updatedAt">>;
export type AuditExclusionWindowInput = Omit<
  AuditExclusionWindow,
  "createdAt" | "updatedAt" | "deletedAt"
> &
  Partial<Pick<AuditExclusionWindow, "createdAt" | "updatedAt" | "deletedAt">>;
export type AuditExclusionWindowUpdate = Partial<
  Pick<AuditExclusionWindow, "startsAt" | "endsAt" | "reason">
>;

export interface OffboardingStepInput {
  order: number;
  action: string;
  state?: OffboardingStepState;
  result?: Record<string, unknown> | null;
  error?: string | null;
  appliedAt?: string | null;
}

export type OffboardingJobInput = Omit<OffboardingJob, "createdAt" | "state"> &
  Partial<Pick<OffboardingJob, "createdAt" | "state">> & {
    steps?: OffboardingStepInput[];
  };

export interface OffboardingStepUpdate {
  state?: OffboardingStepState;
  result?: Record<string, unknown> | null;
  error?: string | null;
  appliedAt?: string | null;
}

export type LinkRemovalJobInput = Omit<LinkRemovalJob, "createdAt" | "state" | "results"> &
  Partial<Pick<LinkRemovalJob, "createdAt" | "state" | "results">>;

export interface UserTemplate {
  id: string;
  name: string;
  properties: Record<string, unknown>;
  licenses: string[];
  groups: string[];
  offboardingDefaults: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type UserTemplateInput = Omit<UserTemplate, "createdAt" | "updatedAt" | "deletedAt"> &
  Partial<Pick<UserTemplate, "createdAt" | "updatedAt" | "deletedAt">>;

export interface UserTemplateUpdate {
  name?: string;
  properties?: Record<string, unknown>;
  licenses?: string[];
  groups?: string[];
  offboardingDefaults?: Record<string, unknown>;
}

export interface LinkRemovalJobUpdate {
  state?: LinkRemovalJobState;
  results?: Record<string, unknown> | null;
}

export type RemediationPlanMode = "manual" | "automated" | "mixed";
export type RemediationActionState = "planned" | "approved" | "applied" | "failed" | "skipped";

export interface RemediationPlan {
  id: string;
  tenantId: string;
  runId: string;
  findingIds: string[];
  mode: RemediationPlanMode;
  createdAt: string;
  createdBy: string;
}

export interface RemediationAction {
  id: string;
  planId: string;
  checkId: string;
  command: string;
  target: string | null;
  state: RemediationActionState;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  appliedAt: string | null;
  appliedBy: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  correlationId: string | null;
}

export interface ManualInstruction {
  checkId: string;
  portalPath: string;
  steps: string[];
  notes: string | null;
}

export interface RemediationActionInput {
  id: string;
  checkId: string;
  command: string;
  target?: string | null;
  state?: RemediationActionState;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  appliedAt?: string | null;
  appliedBy?: string | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
  correlationId?: string | null;
}

export type RemediationPlanInput = Omit<RemediationPlan, "createdAt"> &
  Partial<Pick<RemediationPlan, "createdAt">> & {
    actions?: RemediationActionInput[];
  };

export interface RemediationActionUpdate {
  state?: RemediationActionState;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  appliedAt?: string | null;
  appliedBy?: string | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
  correlationId?: string | null;
}

export type ManualInstructionInput = ManualInstruction;

export type PortalUserStatus = "active" | "disabled";
export type ScopeTargetType = "tenant" | "group" | "all";

export interface PortalUser {
  id: string;
  upn: string;
  displayName: string | null;
  status: PortalUserStatus;
  preferences: Record<string, unknown> | null;
  roleId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Role {
  id: string;
  name: string;
  include: string[];
  exclude: string[];
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserScope {
  id: string;
  userId: string;
  targetType: ScopeTargetType;
  targetId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiClient {
  id: string;
  name: string;
  secretHash: string;
  roles: string[];
  ipRanges: string[];
  rateLimit: number | null;
  enabled: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccessIPRange {
  id: string;
  cidr: string;
  scope: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionRegistryEntry {
  endpoint: string;
  permission: string;
  functionality: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SharePointSiteType = "team" | "communication";

export interface SharePointTemplate {
  id: string;
  name: string;
  siteType: SharePointSiteType;
  settings: Record<string, unknown>;
  variables: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface SiteOperation {
  id: string;
  tenantId: string;
  siteId: string;
  operation: string;
  state: string;
  by: string | null;
  at: string;
  result: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PortalUserInput = Omit<PortalUser, "createdAt" | "updatedAt"> &
  Partial<Pick<PortalUser, "createdAt" | "updatedAt">>;
export type RoleInput = Omit<Role, "createdAt" | "updatedAt"> &
  Partial<Pick<Role, "createdAt" | "updatedAt">>;
export type UserScopeInput = Omit<UserScope, "createdAt" | "updatedAt"> &
  Partial<Pick<UserScope, "createdAt" | "updatedAt">>;
export type ApiClientInput = Omit<ApiClient, "createdAt" | "updatedAt"> &
  Partial<Pick<ApiClient, "createdAt" | "updatedAt">>;
export type AccessIPRangeInput = Omit<AccessIPRange, "createdAt" | "updatedAt"> &
  Partial<Pick<AccessIPRange, "createdAt" | "updatedAt">>;
export type PermissionRegistryInput = Omit<PermissionRegistryEntry, "createdAt" | "updatedAt"> &
  Partial<Pick<PermissionRegistryEntry, "createdAt" | "updatedAt">>;
export type SharePointTemplateInput = Omit<
  SharePointTemplate,
  "createdAt" | "updatedAt" | "deletedAt" | "settings" | "variables"
> &
  Partial<
    Pick<
      SharePointTemplate,
      "settings" | "variables" | "createdAt" | "updatedAt" | "deletedAt"
    >
  >;
export type SharePointTemplateUpdate = Partial<
  Pick<SharePointTemplate, "name" | "siteType" | "settings" | "variables">
>;
export type SiteOperationInput = Omit<
  SiteOperation,
  "createdAt" | "updatedAt" | "by" | "at" | "result"
> &
  Partial<Pick<SiteOperation, "by" | "at" | "result" | "createdAt" | "updatedAt">>;
export type SiteOperationUpdate = Partial<Pick<SiteOperation, "state" | "result">>;

export type TeamVisibility = "public" | "private";

export interface TeamTemplate {
  id: string;
  name: string;
  owners: string[];
  members: string[];
  visibility: TeamVisibility;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface TeamOperation {
  id: string;
  tenantId: string;
  teamId: string;
  operation: string;
  state: string;
  by: string | null;
  at: string;
  result: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TeamTemplateInput = Omit<
  TeamTemplate,
  "createdAt" | "updatedAt" | "deletedAt" | "owners" | "members" | "settings"
> &
  Partial<
    Pick<
      TeamTemplate,
      "owners" | "members" | "settings" | "createdAt" | "updatedAt" | "deletedAt"
    >
  >;
export type TeamTemplateUpdate = Partial<
  Pick<TeamTemplate, "name" | "owners" | "members" | "visibility" | "settings">
>;
export type TeamOperationInput = Omit<
  TeamOperation,
  "createdAt" | "updatedAt" | "by" | "at" | "result"
> &
  Partial<Pick<TeamOperation, "by" | "at" | "result" | "createdAt" | "updatedAt">>;
export type TeamOperationUpdate = Partial<Pick<TeamOperation, "state" | "result">>;

export interface IncidentNote {
  id: string;
  tenantId: string;
  incidentId: string;
  body: string;
  author: string | null;
  at: string;
  createdAt: string;
  updatedAt: string;
}

export interface AlertStateChange {
  id: string;
  tenantId: string;
  alertId: string | null;
  incidentId: string | null;
  from: string;
  to: string;
  by: string | null;
  at: string;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export type IncidentNoteInput = Omit<
  IncidentNote,
  "createdAt" | "updatedAt" | "author" | "at"
> &
  Partial<Pick<IncidentNote, "author" | "at" | "createdAt" | "updatedAt">>;
export type AlertStateChangeInput = Omit<
  AlertStateChange,
  "createdAt" | "updatedAt" | "alertId" | "incidentId" | "by" | "at" | "reason"
> &
  Partial<
    Pick<
      AlertStateChange,
      "alertId" | "incidentId" | "by" | "at" | "reason" | "createdAt" | "updatedAt"
    >
  >;

export interface AlertStateChangeListOptions {
  alertId?: string;
  incidentId?: string;
}

export type LicenseChangeAction = "assign" | "remove";

export interface LicensePricing {
  skuId: string;
  tenantId: string | null;
  skuPartNumber: string | null;
  unitPrice: number;
  currency: string;
  updatedAt: string;
}

export interface LicenseChange {
  id: string;
  tenantId: string;
  userId: string;
  skuId: string;
  action: LicenseChangeAction;
  state: string;
  by: string | null;
  at: string;
}

export type LicensePricingInput = Omit<LicensePricing, "updatedAt" | "tenantId" | "skuPartNumber"> &
  Partial<Pick<LicensePricing, "updatedAt" | "tenantId" | "skuPartNumber">>;
export type LicenseChangeInput = Omit<LicenseChange, "by" | "at"> &
  Partial<Pick<LicenseChange, "by" | "at">>;

export interface LicenseChangeListOptions {
  userId?: string;
}

export interface DomainCheck {
  id: string;
  tenantId: string;
  domain: string;
  at: string;
  records: Record<string, unknown>;
  health: Record<string, unknown>;
  recommendations: string[];
}

export type DomainCheckInput = Omit<DomainCheck, "at" | "records" | "health" | "recommendations"> &
  Partial<Pick<DomainCheck, "at" | "records" | "health" | "recommendations">>;

export interface DomainCheckRangeOptions {
  from?: string;
  to?: string;
}

// Instance branding (EPIC-037 SPEC.md §5): colours, logo/cover asset
// references, watermark, footer, page numbers, presets, and per-report-type
// defaults. Only logoRef/coverRef references are stored, never blobs; the
// bytes live on the artifact tier (validated raster allow-list, SPEC §11.2).
export interface BrandingColors {
  primary: string;
  secondary: string;
}

export interface BrandingWatermark {
  enabled: boolean;
  text: string;
}

export interface BrandingFooter {
  show: boolean;
  text: string;
  coverText: string;
}

export interface BrandingPageNumbers {
  show: boolean;
}

export interface BrandingPreset {
  id: string;
  name: string;
  colors: BrandingColors;
}

export interface BrandingReportDefaults {
  primary?: string;
  secondary?: string;
  logoRef?: string | null;
  watermarkText?: string;
  footerText?: string;
  showPageNumbers?: boolean;
}

export interface BrandingConfig {
  colors: BrandingColors;
  logoRef: string | null;
  coverRef: string | null;
  watermark: BrandingWatermark;
  footer: BrandingFooter;
  pageNumbers: BrandingPageNumbers;
  presets: BrandingPreset[];
  perReportDefaults: Record<string, BrandingReportDefaults>;
  updatedAt: string;
  updatedBy: string | null;
}

export type BrandingConfigInput = Omit<BrandingConfig, "updatedAt"> &
  Partial<Pick<BrandingConfig, "updatedAt">>;

export type TemplateItemSource = "local" | "community";
export type TemplateRepoReviewState = "unreviewed" | "reviewed" | "signed";

export interface TemplateRepo {
  id: string;
  url: string;
  name: string;
  types: string[];
  writeAccess: boolean;
  builtin: boolean;
  signed: boolean;
  reviewState: TemplateRepoReviewState;
  trusted: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface TemplateLibraryItem {
  id: string;
  type: string;
  name: string;
  body: string;
  source: TemplateItemSource;
  repoId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface TemplatePackage {
  id: string;
  name: string;
  version: string;
  contents: string[];
  source: TemplateItemSource;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type TemplateRepoInput = Omit<TemplateRepo, "createdAt" | "updatedAt" | "deletedAt"> &
  Partial<Pick<TemplateRepo, "createdAt" | "updatedAt" | "deletedAt">>;
export type TemplateLibraryItemInput = Omit<
  TemplateLibraryItem,
  "createdAt" | "updatedAt" | "deletedAt"
> &
  Partial<Pick<TemplateLibraryItem, "createdAt" | "updatedAt" | "deletedAt">>;
export type TemplatePackageInput = Omit<TemplatePackage, "createdAt" | "updatedAt" | "deletedAt"> &
  Partial<Pick<TemplatePackage, "createdAt" | "updatedAt" | "deletedAt">>;

export interface TemplateRepoListOptions extends ListOptions {
  builtin?: boolean;
  trusted?: boolean;
}

export interface TemplateLibraryItemListOptions extends ListOptions {
  type?: string;
  source?: TemplateItemSource;
  repoId?: string;
}

export interface ListOptions {
  includeDeleted?: boolean;
}

export interface TenantListOptions extends ListOptions {
  status?: TenantStatus;
  source?: TenantSource;
  groupId?: string;
  search?: string;
}

export interface TenantVariableListOptions {
  tenantId?: string;
  includeGlobal?: boolean;
}

export interface JobStateUpdate {
  progress?: Record<string, unknown> | null;
  attempts?: number;
}

/**
 * The only surface feature code may depend on. Tenant-scoped reads require the
 * tenant id, rows with `deletedAt` set are hidden unless explicitly requested,
 * and audit events can only be appended (ADR-0015).
 */
export interface Repository {
  readonly schemaVersion: number;

  close(): void;

  getTenant(tenantId: string, options?: ListOptions): Promise<Tenant | undefined>;
  listTenants(options?: TenantListOptions): Promise<Tenant[]>;
  upsertTenant(input: TenantInput): Promise<Tenant>;
  softDeleteTenant(tenantId: string, options?: { now?: string }): Promise<boolean>;

  getTenantCredential(tenantId: string): Promise<TenantCredential | undefined>;
  listTenantCredentials(tenantId: string): Promise<TenantCredential[]>;
  upsertTenantCredential(input: TenantCredentialInput): Promise<TenantCredential>;

  getTenantGroup(groupId: string, options?: ListOptions): Promise<TenantGroup | undefined>;
  listTenantGroups(options?: ListOptions): Promise<TenantGroup[]>;
  upsertTenantGroup(input: TenantGroupInput): Promise<TenantGroup>;
  softDeleteTenantGroup(groupId: string, options?: { now?: string }): Promise<boolean>;

  addTenantGroupMember(input: TenantGroupMemberInput): Promise<TenantGroupMember>;
  removeTenantGroupMember(groupId: string, tenantId: string): Promise<boolean>;
  listTenantGroupMembers(groupId: string): Promise<TenantGroupMember[]>;
  listTenantGroupsForTenant(tenantId: string): Promise<TenantGroup[]>;

  getTenantVariable(variableId: string): Promise<TenantVariable | undefined>;
  listTenantVariables(options?: TenantVariableListOptions): Promise<TenantVariable[]>;
  upsertTenantVariable(input: TenantVariableInput): Promise<TenantVariable>;
  deleteTenantVariable(variableId: string): Promise<boolean>;

  getGdapRelationship(tenantId: string): Promise<GdapRelationship | undefined>;
  listGdapRelationships(): Promise<GdapRelationship[]>;
  upsertGdapRelationship(input: GdapRelationshipInput): Promise<GdapRelationship>;

  createRun(input: RunInput): Promise<Run>;
  createRunWithChildren(
    parent: RunInput,
    children: RunInput[],
  ): Promise<{ parent: Run; children: Run[] }>;
  createParentRunWithChildren(
    parent: RunInput,
    children: RunInput[],
  ): Promise<{ parent: Run; children: Run[] }>;
  getRun(tenantId: string, runId: string): Promise<Run | undefined>;
  getRunById(runId: string): Promise<Run | undefined>;
  listRuns(tenantId: string): Promise<Run[]>;
  listChildRuns(parentRunId: string): Promise<Run[]>;
  listRunsByParentId(parentRunId: string): Promise<Run[]>;
  updateRun(
    tenantId: string,
    runId: string,
    update: Partial<RunInput>,
  ): Promise<Run | undefined>;
  enforceRetention(options: RunRetentionOptions): Promise<RunRetentionResult>;
  pruneRuns(options: RunRetentionOptions): Promise<RunRetentionResult>;

  createRunSection(input: RunSectionInput): Promise<RunSection>;
  listRunSections(tenantId: string, runId: string): Promise<RunSection[]>;

  createFinding(input: FindingInput): Promise<Finding>;
  listFindings(tenantId: string, runId: string): Promise<Finding[]>;

  createJob(input: JobInput): Promise<Job>;
  getJob(jobId: string): Promise<Job | undefined>;
  listJobs(tenantId: string): Promise<Job[]>;
  updateJobState(jobId: string, state: JobState, update?: JobStateUpdate): Promise<Job | undefined>;

  createLinkRemovalJob(input: LinkRemovalJobInput): Promise<LinkRemovalJob>;
  getLinkRemovalJob(tenantId: string, jobId: string): Promise<LinkRemovalJob | undefined>;
  listLinkRemovalJobs(tenantId: string): Promise<LinkRemovalJob[]>;
  updateLinkRemovalJob(
    tenantId: string,
    jobId: string,
    update: LinkRemovalJobUpdate,
  ): Promise<LinkRemovalJob | undefined>;

  appendAuditEvent(input: AuditEventInput): Promise<AuditEvent>;
  listAuditEvents(tenantId?: string): Promise<AuditEvent[]>;

  createSharePointTemplate(input: SharePointTemplateInput): Promise<SharePointTemplate>;
  getSharePointTemplate(
    templateId: string,
    options?: ListOptions,
  ): Promise<SharePointTemplate | undefined>;
  listSharePointTemplates(options?: ListOptions): Promise<SharePointTemplate[]>;
  updateSharePointTemplate(
    templateId: string,
    update: SharePointTemplateUpdate,
  ): Promise<SharePointTemplate | undefined>;
  softDeleteSharePointTemplate(templateId: string, options?: { now?: string }): Promise<boolean>;

  createSiteOperation(input: SiteOperationInput): Promise<SiteOperation>;
  getSiteOperation(tenantId: string, operationId: string): Promise<SiteOperation | undefined>;
  listSiteOperations(tenantId: string): Promise<SiteOperation[]>;
  updateSiteOperation(
    tenantId: string,
    operationId: string,
    update: SiteOperationUpdate,
  ): Promise<SiteOperation | undefined>;

  createTeamTemplate(input: TeamTemplateInput): Promise<TeamTemplate>;
  getTeamTemplate(
    templateId: string,
    options?: ListOptions,
  ): Promise<TeamTemplate | undefined>;
  listTeamTemplates(options?: ListOptions): Promise<TeamTemplate[]>;
  updateTeamTemplate(
    templateId: string,
    update: TeamTemplateUpdate,
  ): Promise<TeamTemplate | undefined>;
  softDeleteTeamTemplate(templateId: string, options?: { now?: string }): Promise<boolean>;

  createTeamOperation(input: TeamOperationInput): Promise<TeamOperation>;
  getTeamOperation(tenantId: string, operationId: string): Promise<TeamOperation | undefined>;
  listTeamOperations(tenantId: string): Promise<TeamOperation[]>;
  updateTeamOperation(
    tenantId: string,
    operationId: string,
    update: TeamOperationUpdate,
  ): Promise<TeamOperation | undefined>;

  createIncidentNote(input: IncidentNoteInput): Promise<IncidentNote>;
  getIncidentNote(tenantId: string, noteId: string): Promise<IncidentNote | undefined>;
  listIncidentNotes(tenantId: string, incidentId: string): Promise<IncidentNote[]>;

  createAlertStateChange(input: AlertStateChangeInput): Promise<AlertStateChange>;
  getAlertStateChange(tenantId: string, changeId: string): Promise<AlertStateChange | undefined>;
  listAlertStateChanges(
    tenantId: string,
    options?: AlertStateChangeListOptions,
  ): Promise<AlertStateChange[]>;

  getBranding(): Promise<BrandingConfig | undefined>;
  upsertBranding(input: BrandingConfigInput): Promise<BrandingConfig>;
}

export class SchemaVersionError extends Error {
  readonly code = "db.unsupported_schema_version";
  readonly current: number;
  readonly expected: number;

  constructor(current: number, expected: number) {
    super(
      `database schema version ${current} is not supported by this build (expected ${expected})`,
    );
    this.name = "SchemaVersionError";
    this.current = current;
    this.expected = expected;
  }
}
