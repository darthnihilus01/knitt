import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { findConversations, selectConversation, importConversation } from "./handoff.ts";
import { MemoryStore } from "../../memory/src/store.ts";

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      conversation: { type: "string" }, workspace: { type: "string" },
      from: { type: "string", default: "antigravity" }, to: { type: "string", default: "codex" },
      "data-root": { type: "string", multiple: true }, preview: { type: "boolean", default: false },
    },
  });
  const action = positionals[0];
  if (!["list", "handoff"].includes(action) || values.from !== "antigravity" || values.to !== "codex") {
    throw new Error("Usage: npm run memory -- list [--workspace PATH] | handoff --conversation TITLE_OR_ID [--workspace PATH] [--preview]. Supported handoff: Antigravity to Codex.");
  }
  const roots = values["data-root"] ?? ["antigravity", "antigravity-cli", "antigravity-ide"].map(name => join(homedir(), ".gemini", name));
  const conversations = findConversations(roots, values.workspace);
  if (action === "list") {
    console.log(JSON.stringify(conversations.map(({ id, title, workspace, modified }) => ({ id, title, workspace, modified })), null, 2));
    return;
  }
  if (!values.conversation) throw new Error("Choose a conversation by its title or ID");
  const conversation = selectConversation(conversations, values.conversation);
  const workspace = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: conversation.workspace, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  let repoId: string;
  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], { cwd: workspace, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const ssh = remote.match(/^[^@]+@([^:]+):(.+)$/);
    const url = ssh ? new URL("https://" + ssh[1] + "/" + ssh[2]) : new URL(remote);
    repoId = (url.hostname + url.pathname).replace(/\.git$/, "").replace(/\/$/, "");
  } catch { repoId = "local:" + createHash("sha256").update(workspace).digest("hex"); }
  const app = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  const database = process.env.MEMORY_DB ?? join(app, ".memory/events.sqlite");
  const featureId = "antigravity:" + conversation.id;
  if (values.preview) {
    console.log(JSON.stringify({ action, title: conversation.title, workspace, repoId, featureId, destination: "codex", database, changesApplied: false }, null, 2));
    return;
  }
  mkdirSync(dirname(database), { recursive: true, mode: 0o700 });
  const store = new MemoryStore(database);
  let report;
  try {
    report = importConversation({
      conversation, repoId, store,
      directory: join(app, ".memory/handoffs", createHash("sha256").update(repoId + featureId).digest("hex")),
    });
  } finally { store.close(); }
  // The destination feature binding is installed only after the history has been saved.
  execFileSync("python3", [
    join(app, "scripts/connect.py"), "--workspace", workspace, "--app-root", app,
    "--node", process.execPath, "--repo-id", repoId, "--feature-id", featureId,
    "--database", database, "--client", "codex", "--apply",
  ], { stdio: ["ignore", "inherit", "inherit"] });
  console.log(JSON.stringify({ title: conversation.title, workspace, repoId, ...report, ready: true }, null, 2));
  console.log("Open this workspace in Codex, review its project memory hooks if prompted, and start a fresh chat with: Continue the task from the imported Antigravity conversation.");
}

try { main(); }
catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
