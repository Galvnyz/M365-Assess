"use client";

// Configuration Policies page — EPIC-016 SPEC.md §3.1; T-0303.
// Nav: Intune → Device Management → Configuration Policies.
import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { IntunePolicyListPage } from "../../../../components/intune/IntunePolicyTable";

export default function Page() {
  const searchParams = useSearchParams();
  const router = useRouter();
  return (
    <IntunePolicyListPage
      kind="configuration"
      tenantId={searchParams.get("tenantId") ?? ""}
      navigate={(href) => router.push(href)}
    />
  );
}
