"use client";

// Conditional Access Templates Page (EPIC-015 SPEC.md §3.2; T-0287).
import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { resolveTenantId, useCurrentTenantId } from "../../../../lib/useCurrentTenant";
import {
  listCaTemplates,
  createCaTemplate,
  deleteCaTemplate,
  deployCaTemplate,
  type CaTemplate,
  type CaDeployDrawerOptions,
  type CaDeployPlan,
  type CaDeployResult,
} from "../../../../lib/caApi";
import {
  CaTemplateTable,
  type CaTemplateRowAction,
} from "../../../../components/conditionalAccess/CaTemplateTable";

export default function CaTemplatesPage() {
  const searchParams = useSearchParams();
  const tenantId = resolveTenantId(searchParams.get("tenantId"), useCurrentTenantId());

  const [templates, setTemplates] = useState<CaTemplate[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTemplates = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listCaTemplates();
      setTemplates(data);
    } catch (err: any) {
      setError(err.message || "Failed to load CA templates");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const handleAction = async (action: CaTemplateRowAction, template: CaTemplate) => {
    if (action === "clone") {
      try {
        await createCaTemplate({
          name: `${template.name} (Copy)`,
          category: template.category,
          policyJson: template.policyJson,
        });
        await fetchTemplates();
      } catch (err: any) {
        alert(err.message);
      }
      return;
    }
    if (action === "delete") {
      if (!confirm(`Are you sure you want to delete template '${template.name}'?`)) return;
      try {
        await deleteCaTemplate(template.id);
        await fetchTemplates();
      } catch (err: any) {
        alert(err.message);
      }
      return;
    }
  };

  const handlePreviewPlan = async (options: CaDeployDrawerOptions): Promise<CaDeployPlan> => {
    const res = await deployCaTemplate(options.tenantId, { ...options, preview: true });
    return res as CaDeployPlan;
  };

  const handleExecuteDeploy = async (options: CaDeployDrawerOptions): Promise<CaDeployResult> => {
    const res = await deployCaTemplate(options.tenantId, { ...options, preview: false });
    return res as CaDeployResult;
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1400px", margin: "0 auto" }}>
      <CaTemplateTable
        templates={templates}
        tenantId={tenantId}
        loading={loading}
        error={error}
        onAction={handleAction}
        onPreviewPlan={handlePreviewPlan}
        onExecuteDeploy={handleExecuteDeploy}
      />
    </div>
  );
}
