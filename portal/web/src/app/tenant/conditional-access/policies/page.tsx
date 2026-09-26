"use client";

// Conditional Access Policies Page (EPIC-015 SPEC.md §3.1; T-0283).
import React, { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  listCaPolicies,
  editCaPolicy,
  deleteCaPolicy,
  type CaPolicyItem,
} from "../../../../lib/caApi";
import {
  CaPolicyTable,
  type CaPolicyRowAction,
} from "../../../../components/conditionalAccess/CaPolicyTable";

export default function CaPoliciesPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tenantId = searchParams.get("tenantId") || "default-tenant";

  const [policies, setPolicies] = useState<CaPolicyItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPolicies = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listCaPolicies(tenantId);
      setPolicies([...data.items]);
    } catch (err: any) {
      setError(err.message || "Failed to load Conditional Access policies");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPolicies();
  }, [tenantId]);

  const handleAction = async (action: CaPolicyRowAction, policy: CaPolicyItem) => {
    if (action === "edit") {
      router.push(`/tenant/conditional-access/policies/${policy.id}?tenantId=${tenantId}`);
      return;
    }
    if (action === "assessCoverage") {
      router.push(`/tenant/conditional-access/coverage?tenantId=${tenantId}`);
      return;
    }
    if (action === "setReportOnly") {
      try {
        await editCaPolicy(tenantId, policy.id, {
          state: "enabledForReportingButNotEnforced",
        });
        await fetchPolicies();
      } catch (err: any) {
        alert(err.message);
      }
      return;
    }
    if (action === "enable" || action === "disable") {
      const nextState = action === "enable" ? "enabled" : "disabled";
      try {
        await editCaPolicy(tenantId, policy.id, { state: nextState });
        await fetchPolicies();
      } catch (err: any) {
        alert(err.message);
      }
      return;
    }
    if (action === "delete") {
      const confirmName = prompt(
        `Type the policy name '${policy.displayName || policy.name}' to confirm deletion:`,
      );
      if (!confirmName) return;
      try {
        await deleteCaPolicy(tenantId, policy.id, confirmName);
        await fetchPolicies();
      } catch (err: any) {
        alert(err.message);
      }
      return;
    }
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1400px", margin: "0 auto" }}>
      <CaPolicyTable
        policies={policies}
        loading={loading}
        error={error}
        onAddPolicy={() =>
          router.push(`/tenant/conditional-access/policies/new?tenantId=${tenantId}`)
        }
        onDeployFromTemplate={() =>
          router.push(`/tenant/conditional-access/templates?tenantId=${tenantId}`)
        }
        onAssessCoverage={() =>
          router.push(`/tenant/conditional-access/coverage?tenantId=${tenantId}`)
        }
        onAction={handleAction}
      />
    </div>
  );
}
