"use client";

// Policy compare page — EPIC-016 SPEC.md §3.4; T-0810.
// Opened by the policy lists' Compare action (T-0303):
//   /intune/policies/compare?tenantId=<t>&kind=<kind>&left=<policyId>[&right=<ref>]
import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PolicyCompareView } from "../../../../components/intune/PolicyCompareView";
import {
  buildCompareOptions,
  fetchAllIntunePolicies,
  fetchAllIntuneTemplates,
  type CompareOption,
  type IntunePolicyKind,
} from "../../../../lib/intuneApi";

const KINDS: readonly IntunePolicyKind[] = ["configuration", "compliance", "app-protection"];

export default function PolicyComparePage() {
  const searchParams = useSearchParams();
  const tenantId = searchParams.get("tenantId") ?? "";
  const kind = searchParams.get("kind") as IntunePolicyKind | null;
  const left = searchParams.get("left") ?? "";
  const right = searchParams.get("right");
  const valid = Boolean(tenantId && left && kind && KINDS.includes(kind));

  const [options, setOptions] = useState<CompareOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!valid || !kind) return;
    Promise.all([fetchAllIntunePolicies(tenantId, kind), fetchAllIntuneTemplates()])
      .then(([policies, templates]) => setOptions(buildCompareOptions(kind, left, policies, templates)))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load compare options."));
  }, [valid, tenantId, kind, left]);

  if (!valid || !kind) {
    return (
      <main style={{ padding: "24px" }}>
        Choose a policy to compare from the Configuration or Compliance Policies list.
      </main>
    );
  }

  return (
    <main style={{ padding: "24px", maxWidth: "1280px", margin: "0 auto" }}>
      {error && (
        <div role="alert" style={{ color: "var(--danger, #dc2626)", fontSize: "13px" }}>
          {error}
        </div>
      )}
      {options && (
        <PolicyCompareView
          tenantId={tenantId}
          leftRef={`policy:${kind}:${left}`}
          rightOptions={options}
          initialRightRef={right}
        />
      )}
    </main>
  );
}
