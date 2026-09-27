"use client";

// Portal sidebar navigation (02-ui-design.md §5.1), using the report shell's nav classes.
// Lists every top-level page; detail, edit, and create pages are reached from their lists.
// Not yet filtered by RBAC permissions or feature flags (EPIC-038).

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";

export interface NavItem {
  readonly href: string;
  readonly label: string;
}

export interface NavGroup {
  readonly label: string;
  readonly items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Fleet dashboard" },
      { href: "/dashboard/custom", label: "Custom dashboard" },
    ],
  },
  {
    label: "Tenants",
    items: [
      { href: "/tenants", label: "Tenants" },
      { href: "/tenant-groups", label: "Tenant groups" },
      { href: "/variables", label: "Variables" },
      { href: "/gdap", label: "GDAP" },
    ],
  },
  {
    label: "Assessments",
    items: [
      { href: "/runs", label: "Runs" },
      { href: "/reports", label: "Reports" },
      { href: "/reports/builder", label: "Report builder" },
      { href: "/remediation", label: "Remediation" },
      { href: "/remediation/history", label: "Remediation history" },
    ],
  },
  {
    label: "Standards & drift",
    items: [
      { href: "/standards", label: "Standards" },
      { href: "/standards/alignment", label: "Standards alignment" },
      { href: "/drift", label: "Drift" },
      { href: "/drift/report", label: "Drift report" },
      { href: "/baselines", label: "Baselines" },
    ],
  },
  {
    label: "Identity",
    items: [
      { href: "/users", label: "Users" },
      { href: "/users/reports", label: "User reports" },
      { href: "/offboarding", label: "Offboarding" },
      { href: "/identity/groups", label: "Groups" },
      { href: "/identity/groups/usage", label: "Group usage" },
      { href: "/identity/group-templates", label: "Group templates" },
      { href: "/mfa-report", label: "MFA report" },
      { href: "/auth-methods", label: "Authentication methods" },
      { href: "/roles", label: "Roles" },
      { href: "/jit-admins", label: "JIT admins" },
    ],
  },
  {
    label: "Conditional Access",
    items: [
      { href: "/tenant/conditional-access/policies", label: "Policies" },
      { href: "/tenant/conditional-access/templates", label: "Templates" },
      { href: "/tenant/conditional-access/report-only", label: "Report-only" },
      { href: "/tenant/conditional-access/coverage", label: "Coverage" },
    ],
  },
  {
    label: "Intune",
    items: [
      { href: "/intune/policies/configuration", label: "Configuration" },
      { href: "/intune/policies/compliance", label: "Compliance" },
      { href: "/intune/policies/app-protection", label: "App protection" },
      { href: "/intune/policies/compare", label: "Compare" },
      { href: "/intune/templates", label: "Templates" },
      { href: "/intune/assignment-filters", label: "Assignment filters" },
    ],
  },
  {
    label: "Automation",
    items: [
      { href: "/scheduler", label: "Scheduler" },
      { href: "/scripts", label: "Scripts" },
      { href: "/diagnostics", label: "Diagnostics" },
    ],
  },
];

/** The item whose href is the longest prefix of `pathname` is active. */
export function activeHref(pathname: string, groups: readonly NavGroup[] = NAV_GROUPS): string | null {
  let best: string | null = null;
  for (const { items } of groups) {
    for (const { href } of items) {
      const matches = pathname === href || pathname.startsWith(`${href}/`);
      if (matches && (best === null || href.length > best.length)) best = href;
    }
  }
  return best;
}

export function AppNav(): ReactElement {
  const active = activeHref(usePathname() ?? "");
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true" />
        <div>
          <div className="brand-name">M365-Assess</div>
          <div className="brand-sub">Portal</div>
        </div>
      </div>
      <nav>
        {NAV_GROUPS.map((group) => (
          <div className="nav-section" key={group.label}>
            <div className="nav-label">{group.label}</div>
            {group.items.map((item) => (
              <Link key={item.href} href={item.href} className={item.href === active ? "nav-item active" : "nav-item"}>
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
