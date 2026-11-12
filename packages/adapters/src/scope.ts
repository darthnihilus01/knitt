import { execFileSync } from "node:child_process";
import type { Scope } from "./hooks.ts";

export function resolveScope(payload: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): Scope {
  const repoId = env.MEMORY_REPO;
  if (!repoId) throw new Error("Set MEMORY_REPO for the connected repository");
  const workspacePaths = payload.workspacePaths;
  const workspace = typeof payload.cwd === "string" ? payload.cwd :
    Array.isArray(workspacePaths) && workspacePaths.length === 1 && typeof workspacePaths[0] === "string"
      ? workspacePaths[0] : process.cwd();
  if (env.MEMORY_WORKSPACE) {
    const commonGitDir = (cwd: string) => execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd, encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (commonGitDir(workspace) !== commonGitDir(env.MEMORY_WORKSPACE)) {
      throw new Error("Wrong workspace. Open " + env.MEMORY_WORKSPACE + " to continue this handoff. No memory was recalled or captured.");
    }
  }
  let branch = env.MEMORY_BRANCH;
  if (!branch && !env.MEMORY_FEATURE) {
    branch = execFileSync("git", ["branch", "--show-current"], {
      cwd: workspace, encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  }
  const featureId = env.MEMORY_FEATURE ?? branch;
  if (!featureId) throw new Error("Detached HEAD requires an explicit MEMORY_FEATURE");
  return { repoId, featureId, ...(branch ? { branch } : {}) };
}
