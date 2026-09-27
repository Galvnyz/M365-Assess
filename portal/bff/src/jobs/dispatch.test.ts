import type { JobEnvelope, ResultEnvelope } from "@m365-assess/contracts";
import { describe, expect, it } from "vitest";
import { NO_WORKER_FOR_JOB, createJobDispatcher } from "./dispatch.js";

const envelope = (jobType: string) => ({ jobType, jobId: `job-${jobType}` }) as unknown as JobEnvelope;
const signal = new AbortController().signal;

describe("job dispatch (T-0836)", () => {
  it("runs each job type on its own runner", async () => {
    const ran: string[] = [];
    const runner = (name: string) => async (e: JobEnvelope) => (ran.push(`${name}:${e.jobId}`), {} as ResultEnvelope);
    const dispatch = createJobDispatcher({ assessment: runner("a"), remediation: runner("r") });
    await dispatch(envelope("remediation"), signal);
    await dispatch(envelope("assessment"), signal);
    expect(ran).toEqual(["r:job-remediation", "a:job-assessment"]);
  });

  it("fails a job whose type has no runner", async () => {
    await expect(createJobDispatcher({})(envelope("drift"), signal)).rejects.toMatchObject({ code: NO_WORKER_FOR_JOB });
  });
});
