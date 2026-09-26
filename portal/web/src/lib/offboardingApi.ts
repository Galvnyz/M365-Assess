// Typed offboarding and BEC API client (EPIC-011 SPEC.md §4.4, §4.5, §6; T-0210).
// Wraps the T-0206 offboarding run endpoints, the T-0207 BEC check/remediate
// endpoints, and the T-0208 user template endpoints behind small typed
// functions. A `fetcher` seam keeps the client testable without a live BFF.

export type MailboxAccessMode = "full" | "send-as" | "send-on-behalf";

export interface MailboxAccess {
  readonly mode: MailboxAccessMode;
  readonly automap: boolean;
}

export interface OffboardingOptions {
  readonly disableSignIn?: boolean;
  readonly removeLicenses?: boolean;
  readonly convertMailbox?: boolean;
  readonly removeGroups?: boolean;
  readonly mailboxAccess?: Partial<MailboxAccess>;
}

export type OffboardingStepState = "pending" | "running" | "succeeded" | "failed" | "skipped";

export interface OffboardingStep {
  readonly order: number;
  readonly action: string;
  readonly state: OffboardingStepState;
  readonly result: Record<string, unknown> | null;
  readonly error: string | null;
  readonly appliedAt: string | null;
}

export interface OffboardingJob {
  readonly id: string;
  readonly tenantId: string;
  readonly userIds: readonly string[];
  readonly options: Record<string, unknown>;
  readonly state: "planned" | "running" | "completed" | "failed";
  readonly createdAt: string;
  readonly createdBy: string;
}

export type BecCheckState = "clear" | "review" | "finding" | "unknown";

export interface BecCheck {
  readonly check: string;
  readonly state: BecCheckState;
  readonly detail: Record<string, unknown>;
  readonly evidence: readonly unknown[];
  readonly remediation: {
    readonly action: string;
    readonly automated: boolean;
    readonly label: string;
    readonly steps: readonly string[];
  } | null;
}

export interface BecFinding {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly check: string;
  readonly detail: Record<string, unknown>;
  readonly state: "open" | "remediated" | "dismissed";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UserTemplate {
  readonly id: string;
  readonly name: string;
  readonly properties: Record<string, unknown>;
  readonly licenses: readonly string[];
  readonly groups: readonly string[];
  readonly offboardingDefaults: Record<string, unknown>;
}

export type Fetcher = typeof fetch;

function asFetcher(fetcher?: Fetcher): Fetcher {
  return fetcher ?? fetch;
}

async function expectOk(response: Response, what: string): Promise<unknown> {
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { message?: string };
      if (body?.message) detail = body.message;
    } catch {
      // non-JSON error body; keep the status text
    }
    throw new Error(`${what} failed: ${response.status} ${detail}`);
  }
  return response.json();
}

export async function startOffboarding(
  tenantId: string,
  userIds: readonly string[],
  options: OffboardingOptions,
  fetcher?: Fetcher,
): Promise<{ job: OffboardingJob; steps: readonly OffboardingStep[] }> {
  const response = await asFetcher(fetcher)(
    `/v1/tenants/${encodeURIComponent(tenantId)}/offboarding`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIds, options }),
    },
  );
  return (await expectOk(response, "Start offboarding")) as {
    job: OffboardingJob;
    steps: readonly OffboardingStep[];
  };
}

export async function getOffboardingProgress(
  tenantId: string,
  jobId: string,
  fetcher?: Fetcher,
): Promise<{ job: OffboardingJob; steps: readonly OffboardingStep[] }> {
  const response = await asFetcher(fetcher)(
    `/v1/tenants/${encodeURIComponent(tenantId)}/offboarding/${encodeURIComponent(jobId)}`,
  );
  return (await expectOk(response, "Offboarding progress")) as {
    job: OffboardingJob;
    steps: readonly OffboardingStep[];
  };
}

export async function rerunOffboardingStep(
  jobId: string,
  order: number,
  fetcher?: Fetcher,
): Promise<{ job: OffboardingJob; step: OffboardingStep }> {
  const response = await asFetcher(fetcher)(
    `/v1/offboarding/${encodeURIComponent(jobId)}/steps/${encodeURIComponent(String(order))}/rerun`,
    { method: "POST" },
  );
  return (await expectOk(response, "Re-run offboarding step")) as {
    job: OffboardingJob;
    step: OffboardingStep;
  };
}

export async function runBecCheck(
  tenantId: string,
  userId: string,
  fetcher?: Fetcher,
): Promise<{ findings: readonly BecFinding[]; checks: readonly BecCheck[] }> {
  const response = await asFetcher(fetcher)(
    `/v1/tenants/${encodeURIComponent(tenantId)}/users/${encodeURIComponent(userId)}/bec-check`,
    { method: "POST" },
  );
  return (await expectOk(response, "BEC check")) as {
    findings: readonly BecFinding[];
    checks: readonly BecCheck[];
  };
}

export async function listBecFindings(
  tenantId: string,
  userId: string,
  fetcher?: Fetcher,
): Promise<{ findings: readonly BecFinding[] }> {
  const response = await asFetcher(fetcher)(
    `/v1/tenants/${encodeURIComponent(tenantId)}/users/${encodeURIComponent(userId)}/bec-findings`,
  );
  return (await expectOk(response, "BEC findings")) as { findings: readonly BecFinding[] };
}

export async function remediateBecFinding(
  tenantId: string,
  userId: string,
  findingId: string,
  fetcher?: Fetcher,
): Promise<{ findingId: string; state: string; finding: BecFinding }> {
  const response = await asFetcher(fetcher)(
    `/v1/tenants/${encodeURIComponent(tenantId)}/users/${encodeURIComponent(userId)}/bec-findings/${encodeURIComponent(findingId)}/remediate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    },
  );
  return (await expectOk(response, "BEC remediate")) as {
    findingId: string;
    state: string;
    finding: BecFinding;
  };
}

export async function listUserTemplates(fetcher?: Fetcher): Promise<{ templates: readonly UserTemplate[] }> {
  const response = await asFetcher(fetcher)("/v1/user-templates");
  return (await expectOk(response, "User templates")) as { templates: readonly UserTemplate[] };
}
