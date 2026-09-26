// PIM Entra ID P2 license gate classifier (EPIC-013 SPEC §3.1, §9, §11.4; T-0242).
//
// Explains the Entra ID P2 requirement instead of failing when PIM is unavailable
// (adopting CIPP's license-missing pattern).

export const ENTRA_ID_P2_NAME = "Entra ID P2";

export const P2_SERVICE_PLANS = new Set([
  "AAD_PREMIUM_P2",
  "ENTRA_P2",
  "IDENTITY_GOVERNANCE",
  "AAD_PREMIUM_P2_ENTERPRISE",
]);

export const P2_SKU_NAMES = new Set([
  "SPE_E5",
  "M365_E5",
  "ENTERPRISEPACK_E5",
  "EMS_E5",
  "AAD_PREMIUM_P2",
  "MICROSOFT_IDENTITY_GOVERNANCE",
]);

export interface PimLicenseGateResult {
  readonly supported: boolean;
  readonly status: "licensed" | "license-missing";
  readonly requiredLicense: string;
  readonly message: string | null;
  readonly documentationUrl?: string;
}

export function evaluatePimLicenseGate(
  tenantLicensesOrPlans: readonly string[],
): PimLicenseGateResult {
  const upperList = tenantLicensesOrPlans.map((item) =>
    item.trim().toUpperCase(),
  );

  const hasP2 = upperList.some((item) => {
    if (P2_SERVICE_PLANS.has(item)) return true;
    if (P2_SKU_NAMES.has(item)) return true;
    if (item.includes("P2") || item.includes("E5")) return true;
    return false;
  });

  if (hasP2) {
    return {
      supported: true,
      status: "licensed",
      requiredLicense: ENTRA_ID_P2_NAME,
      message: null,
    };
  }

  return {
    supported: false,
    status: "license-missing",
    requiredLicense: ENTRA_ID_P2_NAME,
    message:
      "Privileged Identity Management (PIM) requires Microsoft Entra ID P2 (or Microsoft 365 E5) licenses. Without Entra ID P2, eligible role assignments, JIT activation, and role settings templates cannot be configured for this tenant.",
    documentationUrl:
      "https://learn.microsoft.com/entra/id-governance/pim-overview",
  };
}
