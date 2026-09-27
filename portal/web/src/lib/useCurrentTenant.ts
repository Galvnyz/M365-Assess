"use client";

// The tenant chosen in the shell's tenant selector, as a React value. It is persisted by
// tenant-preference.ts (localStorage) and follows changes from any component or tab.
// The server snapshot is null so server and first client render agree (no hydration
// mismatch); the stored tenant arrives right after hydration.

import { useSyncExternalStore } from "react";
import { getCurrentTenantId, onTenantChange } from "./tenant-preference";

function subscribe(onChange: () => void): () => void {
  const unsubscribe = onTenantChange(onChange);
  // Other tabs change the preference through the storage event.
  window.addEventListener("storage", onChange);
  return () => {
    unsubscribe();
    window.removeEventListener("storage", onChange);
  };
}

export function useCurrentTenantId(): string | null {
  return useSyncExternalStore(subscribe, getCurrentTenantId, () => null);
}

/** `?tenantId=` wins over the shell selection; "" when neither names a tenant. */
export function resolveTenantId(queryTenantId: string | null | undefined, currentTenantId: string | null): string {
  return queryTenantId?.trim() || currentTenantId || "";
}
