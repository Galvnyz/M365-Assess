// Local development: build the contracts, db, and BFF packages, then run the BFF and the
// Next.js dev server together. Ctrl+C stops both.
//
// The BFF runs with M365_BFF_DEV_IDENTITY (every request is a local admin, since portal
// sign-in is not built yet) and keeps its database under portal/.dev-data. Any M365_BFF_*
// variable already set in the environment wins. The web UI proxies /v1 to the BFF.
//
// BFF code changes need a restart; web changes reload live.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORTAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(PORTAL, ".dev-data");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const build = spawnSync(npm, ["run", "build", "-w", "contracts", "-w", "db", "-w", "bff"], {
  cwd: PORTAL,
  stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status ?? 1);

mkdirSync(DATA, { recursive: true });
const bffEnv = {
  M365_BFF_DEV_IDENTITY: "admin",
  M365_BFF_STORAGE_PATH: DATA,
  M365_BFF_ARTIFACT_PATH: path.join(DATA, "artifacts"),
  ...process.env,
};
const port = bffEnv.M365_BFF_PORT ?? "8080";

const children = [
  spawn(process.execPath, ["dist/index.js"], { cwd: path.join(PORTAL, "bff"), env: bffEnv, stdio: "inherit" }),
  spawn(npm, ["run", "dev"], {
    cwd: path.join(PORTAL, "web"),
    env: { M365_BFF_URL: `http://127.0.0.1:${port}`, ...process.env },
    stdio: "inherit",
  }),
];

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
for (const child of children) child.on("exit", (code) => stop(code ?? 0));
