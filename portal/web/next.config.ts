// Next.js config for the portal web UI.
//
// The pages call the BFF with relative /v1 paths; in development those are proxied to
// the BFF (M365_BFF_URL, default http://127.0.0.1:8080). The report theme and shell CSS
// live in src/M365-Assess/assets, outside this package, so the build root is the repo.
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BFF_URL = process.env["M365_BFF_URL"] ?? "http://127.0.0.1:8080";

const config: NextConfig = {
  turbopack: { root: REPO_ROOT },
  outputFileTracingRoot: REPO_ROOT,
  // Next would otherwise write AGENTS.md and CLAUDE.md into this package.
  agentRules: false,
  async rewrites() {
    return [{ source: "/v1/:path*", destination: `${BFF_URL}/v1/:path*` }];
  },
};

export default config;
