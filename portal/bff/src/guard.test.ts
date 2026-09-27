import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const IGNORED_DIRECTORIES = new Set(["node_modules", "dist", "coverage"]);

interface ForbiddenPattern {
  readonly id: string;
  readonly re: RegExp;
}

// The bare word "remediation" is deliberately not forbidden: the BFF legitimately
// names the RBAC permission `Remediation.Apply`, which is a permission identifier
// rather than a remediation command (ADR-0014's thin-BFF rule still holds).
const FORBIDDEN_PATTERNS: readonly ForbiddenPattern[] = [
  { id: "m365-sdk-import", re: /@microsoft\/microsoft-graph-client/i },
  { id: "m365-sdk-import", re: /@microsoft\/microsoft-graph-types/i },
  { id: "m365-sdk-import", re: /exchangeonlinemanagement/i },
  { id: "m365-sdk-import", re: /@azure\//i },
  { id: "m365-sdk-import", re: /@pnp\//i },
  { id: "graph-powershell-call", re: /invoke-mggraphrequest/i },
  { id: "graph-powershell-call", re: /invoke-mgrestmethod/i },
  { id: "graph-powershell-call", re: /connect-mggraph/i },
  { id: "exchange-powershell-call", re: /connect-exchangeonline/i },
  { id: "powershell-module-import", re: /import-module/i },
  { id: "collector-construct", re: /securityconfighelper/i },
  { id: "collector-construct", re: /initialize-securityconfig/i },
  { id: "collector-construct", re: /export-securityconfigreport/i },
  { id: "collector-construct", re: /add-setting/i },
  { id: "collector-construct", re: /checkid/i },
  // A Set-* cmdlet name is a tenant write; a worker entrypoint file name
  // (set-intune-policy.ps1) is how the BFF asks a worker to do one, so it is allowed.
  { id: "tenant-write-operation", re: /\bset-[a-z][a-z0-9]*(?![a-z0-9-]*\.ps1)/i },
];

export interface Violation {
  readonly file: string;
  readonly patternId: string;
  readonly match: string;
}

export function findViolations(content: string, file = "<memory>"): Violation[] {
  const violations: Violation[] = [];
  for (const { id, re } of FORBIDDEN_PATTERNS) {
    const match = re.exec(content);
    if (match !== null) {
      violations.push({ file, patternId: id, match: match[0] });
    }
  }
  return violations;
}

export function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        files.push(...collectSourceFiles(path.join(dir, entry.name)));
      }
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name)) || TEST_FILE.test(entry.name)) {
      continue;
    }
    files.push(path.join(dir, entry.name));
  }
  return files;
}

export function scanTree(dir: string): Violation[] {
  return collectSourceFiles(dir).flatMap((file) =>
    findViolations(readFileSync(file, "utf8"), path.relative(dir, file)),
  );
}

const tempDirs: string[] = [];

function tempSourceTree(fileName: string, content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "bff-guard-"));
  tempDirs.push(dir);
  writeFileSync(path.join(dir, fileName), content, "utf8");
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("thin BFF guard", () => {
  it("scans the non-test source files under portal/bff/src", () => {
    const files = collectSourceFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((file) => !TEST_FILE.test(path.basename(file)))).toBe(true);
  });

  it("passes on the BFF source tree", () => {
    const violations = scanTree(SRC_DIR);
    const detail = violations.map((v) => `${v.file}: ${v.patternId} (${v.match})`).join("; ");
    expect(violations, detail).toEqual([]);
  });
});

describe("thin BFF guard self-check", () => {
  it("fails on a deliberately added M365 SDK import", () => {
    const dir = tempSourceTree(
      "sdk-client.ts",
      'import { Client } from "@microsoft/microsoft-graph-client";\n',
    );
    expect(scanTree(dir).map((v) => v.patternId)).toContain("m365-sdk-import");
  });

  it("fails on an Invoke-MgGraphRequest-style call", () => {
    const violations = findViolations('Invoke-MgGraphRequest -Method GET -Uri "/v1.0/users"');
    expect(violations.map((v) => v.patternId)).toContain("graph-powershell-call");
  });

  it("fails on a collector Add-Setting construct", () => {
    const violations = findViolations("Add-Setting -CheckId 'CA-REPORTONLY-001' -Status Pass");
    expect(violations.map((v) => v.patternId)).toContain("collector-construct");
  });

  it("fails on a Set-* tenant write operation", () => {
    const violations = findViolations(
      "Set-Mailbox -Identity mailbox-1 -HiddenFromAddressListsEnabled $true",
    );
    expect(violations.map((v) => v.patternId)).toContain("tenant-write-operation");
  });

  it("allows naming a worker entrypoint file but not a Set-* cmdlet", () => {
    expect(findViolations('run("set-intune-policy.ps1", job)')).toEqual([]);
    expect(findViolations('run("set-assignment-filter.ps1", job)')).toEqual([]);
    expect(findViolations("Set-IntunePolicy -PolicyId x").map((v) => v.patternId)).toContain(
      "tenant-write-operation",
    );
  });

  it("allows an RBAC permission identifier that names remediation", () => {
    expect(findViolations('exclude: ["Remediation.Apply"]')).toEqual([]);
  });

  it("allows the BFF's own internal imports", () => {
    expect(findViolations('import { loadConfig } from "./config.js";')).toEqual([]);
  });
});
