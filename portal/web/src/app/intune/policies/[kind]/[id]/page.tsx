"use client";

// Intune policy editor page — EPIC-016 SPEC.md §4.1; T-0304.
// /intune/policies/{kind}/{id} edits; id "new" creates (optionally ?cloneFrom=<id>).
// ?section=assignments focuses the assignments section (the list page's Assign action).
import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { IntunePolicyEditor } from "../../../../../components/intune/IntunePolicyEditor";
import type { IntunePolicyKind } from "../../../../../lib/intuneApi";

const KINDS: readonly IntunePolicyKind[] = ["configuration", "compliance", "app-protection"];

export default function IntunePolicyEditorPage() {
  const params = useParams<{ kind: string; id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const tenantId = searchParams.get("tenantId") ?? "";
  const kind = params.kind as IntunePolicyKind;

  if (!KINDS.includes(kind)) {
    return <main style={{ padding: "24px" }}>Unknown Intune policy type &apos;{params.kind}&apos;.</main>;
  }
  if (!tenantId) {
    return <main style={{ padding: "24px" }}>No tenant selected.</main>;
  }

  const listHref = `/intune/policies/${kind}?tenantId=${encodeURIComponent(tenantId)}`;
  return (
    <main style={{ padding: "24px", maxWidth: "960px", margin: "0 auto" }}>
      <IntunePolicyEditor
        kind={kind}
        tenantId={tenantId}
        policyId={params.id === "new" ? null : params.id}
        cloneFromId={searchParams.get("cloneFrom")}
        focusSection={searchParams.get("section")}
        onDone={() => router.push(listHref)}
      />
    </main>
  );
}
