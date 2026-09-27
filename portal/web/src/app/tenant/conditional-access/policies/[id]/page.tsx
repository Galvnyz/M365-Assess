"use client";

// Conditional Access Policy Editor Page (EPIC-015 SPEC.md §3.3, §4.1; T-0284).
import React, { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { RequireTenant } from "../../../../../components/shell/RequireTenant";
import { resolveTenantId, useCurrentTenantId } from "../../../../../lib/useCurrentTenant";
import {
  listCaPolicies,
  createCaPolicy,
  editCaPolicy,
  type CaPolicyItem,
  type CaPolicyCreateInput,
  type CaPolicyEditInput,
  type CaPlan,
} from "../../../../../lib/caApi";
import { CaPolicyEditor } from "../../../../../components/conditionalAccess/CaPolicyEditor";

function CaPolicyEditorView({ tenantId }: { readonly tenantId: string }) {
  const params = useParams();
  const router = useRouter();

  const policyId = (params["id"] as string) || "new";
  const isNew = policyId === "new";

  const [policy, setPolicy] = useState<CaPolicyItem | null>(null);
  const [loading, setLoading] = useState<boolean>(!isNew);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) return;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const page = await listCaPolicies(tenantId);
        const found = page.items.find((p) => p.id === policyId);
        if (!found) {
          setError(`Policy '${policyId}' not found.`);
        } else {
          setPolicy(found);
        }
      } catch (err: any) {
        setError(err.message || "Failed to load policy.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [policyId, tenantId, isNew]);

  const handlePreviewPlan = async (payload: CaPolicyCreateInput | CaPolicyEditInput): Promise<CaPlan> => {
    if (isNew) {
      const res = await createCaPolicy(tenantId, payload as CaPolicyCreateInput, true);
      return "plan" in res ? res.plan : (res as any);
    } else {
      const res = await editCaPolicy(tenantId, policyId, payload as CaPolicyEditInput, true);
      return "plan" in res ? res.plan : (res as any);
    }
  };

  const handleSave = async (payload: CaPolicyCreateInput | CaPolicyEditInput): Promise<void> => {
    if (isNew) {
      await createCaPolicy(tenantId, payload as CaPolicyCreateInput, false);
    } else {
      await editCaPolicy(tenantId, policyId, payload as CaPolicyEditInput, false);
    }
    router.push(`/tenant/conditional-access/policies?tenantId=${encodeURIComponent(tenantId)}`);
  };

  const handleCancel = () => {
    router.push(`/tenant/conditional-access/policies?tenantId=${encodeURIComponent(tenantId)}`);
  };

  if (loading) {
    return (
      <div style={{ padding: "32px", textAlign: "center", color: "#6b7280" }}>
        Loading policy configuration...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "32px", maxWidth: "800px", margin: "0 auto" }}>
        <div style={{ padding: "16px", backgroundColor: "#fee2e2", color: "#dc2626", borderRadius: "8px" }}>
          {error}
        </div>
        <button
          style={{
            marginTop: "16px",
            padding: "8px 16px",
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            cursor: "pointer",
            background: "#ffffff",
          }}
          onClick={handleCancel}
        >
          Back to policies
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: "24px 16px" }}>
      <CaPolicyEditor
        initialPolicy={policy}
        isNew={isNew}
        onSave={handleSave}
        onPreviewPlan={handlePreviewPlan}
        onCancel={handleCancel}
      />
    </div>
  );
}

export default function CaPolicyEditorPage() {
  const searchParams = useSearchParams();
  const tenantId = resolveTenantId(searchParams.get("tenantId"), useCurrentTenantId());
  return (
    <RequireTenant tenantId={tenantId}>
      <CaPolicyEditorView tenantId={tenantId} />
    </RequireTenant>
  );
}
