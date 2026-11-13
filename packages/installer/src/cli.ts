#!/usr/bin/env node
import { readCaptureStatuses } from "../../adapters/src/status.ts";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { join, resolve, dirname } from "node:path";
import {
  existsSync,
  readFileSync,
  accessSync,
  constants,
  rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import {
  planConnection,
  applyConnectionPlan,
  planUninstall,
  clients,
  atomicWrite,
  readConnectionState,
  type ConnectionPlan,
} from "./connections.ts";
import {
  installRuntime,
  readInstallation,
  defaultHome,
  runtimePaths,
  withInstallLock,
  activateRuntime,
  assertRuntimeCompatibility,
  packageName,
  type Project,
  type Runtime,
} from "./runtime.ts";
import { resolveRepository } from "../../adapters/src/repository.ts";
const appRoot = fileURLToPath(new URL("../../../", import.meta.url));
const packageRoot = existsSync(join(appRoot, "package.json"))
  ? appRoot
  : dirname(appRoot);
const metadata = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8"),
);
const version = metadata.version as string;

async function confirm(text: string, yes = false) {
  if (yes) return true;
  if (!process.stdin.isTTY)
    throw new Error(
      "Use --yes for noninteractive apply, or --preview to inspect without changes",
    );
  const reader = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return /^y(es)?$/i.test((await reader.question(text + " [y/N] ")).trim());
  } finally {
    reader.close();
  }
}
async function ask(prompt: string) {
  if (!process.stdin.isTTY)
    throw new Error("Pass --workspace and --client for noninteractive setup");
  const reader = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return (await reader.question(prompt)).trim();
  } finally {
    reader.close();
  }
}
function preview(plan: ConnectionPlan) {
  for (const [path, content] of Object.entries(plan.changes)) {
    if (path.includes("npm-connection")) continue;
    console.log(
      (content === null ? "remove " : "merge ") + join(plan.workspace, path),
    );
    if (content !== null && content !== plan.expected[path])
      console.log(content);
  }
}
function applyAll(plans: ConnectionPlan[], commit: () => void) {
  const done: ConnectionPlan[] = [];
  try {
    for (const plan of plans) {
      applyConnectionPlan(plan);
      done.push(plan);
    }
    commit();
  } catch (error) {
    for (const plan of done.reverse())
      for (const [path, content] of Object.entries(plan.expected)) {
        // Already-written files are restored as one transaction; unrelated concurrent
        // edits are protected by each plan's optimistic concurrency check.
        const target = join(plan.workspace, path);
        const current = existsSync(target)
          ? readFileSync(target, "utf8")
          : null;
        if (current !== plan.changes[path]) continue;
        if (content !== null) atomicWrite(join(plan.workspace, path), content);
        else rmSync(join(plan.workspace, path), { force: true });
      }
    throw error;
  }
}
function plansFor(runtime: Runtime, projects: Project[]) {
  return projects.map((project) =>
    planConnection({
      ...project,
      appRoot: runtime.appRoot,
      node: runtime.node,
    }),
  );
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      session: { type: "string" },
      workspace: { type: "string" },
      client: { type: "string", multiple: true },
      home: { type: "string" },
      package: { type: "string" },
      yes: { type: "boolean" },
      preview: { type: "boolean" },
      "capture-new-sessions": { type: "boolean" },
      version: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.version) {
    console.log(version);
    return;
  }
  const action = positionals[0];
  if (!action || values.help) {
    console.log(
      "Knitt " +
        version +
        "\nCommands: setup, doctor, update, rollback, uninstall, serve, continue\nOptions: --workspace PATH --client codex|claude-code|antigravity|claude-desktop (repeatable)\n         --capture-new-sessions --preview --yes --home PATH --package TARBALL_OR_VERSION_SPEC\nSetup configures a persistent local runtime; remote/team service is configured separately.",
    );
    return;
  }
  const home = resolve(values.home ?? defaultHome()),
    paths = runtimePaths(home);
  if (action === "continue") {
    process.env.MEMORY_DB ??= join(paths.data, "events.sqlite");
    await import("../../adapters/src/command.ts");
    return;
  }
  if (action === "serve") {
    process.env.MEMORY_DB ??= join(paths.data, "events.sqlite");
    await import("../../../apps/server/src/main.ts");
    return;
  }
  if (action === "doctor") {
    const state = readInstallation(home),
      problems: string[] = [];
    if (Number(process.versions.node.split(".")[0]) < 24)
      problems.push("Install Node.js 24+");
    try {
      execFileSync("git", ["--version"], { stdio: "ignore" });
    } catch {
      problems.push("Install Git and add it to PATH");
    }
    if (!state) problems.push("No persistent runtime installed. Run setup.");
    else {
      for (const file of [
        state.current.node,
        join(state.current.appRoot, "apps/server/src/main.js"),
      ])
        if (!existsSync(file))
          problems.push("Missing runtime path: " + file + ". Run setup again.");
      try {
        accessSync(paths.data, constants.W_OK);
      } catch {
        problems.push("Data directory is not writable: " + paths.data);
      }
      for (const project of state.projects) {
        try {
          const managed = readConnectionState(project.workspace);
          if (!Object.keys(managed.files).length)
            problems.push("Missing connector state: " + project.workspace);
          for (const [path, snapshot] of Object.entries(managed.files)) {
            const current = readFileSync(join(project.workspace, path), "utf8");
            if (current !== snapshot.after)
              problems.push(
                "Configuration changed; review before setup: " +
                  join(project.workspace, path),
              );
          }
        } catch {
          problems.push(
            "Missing or invalid project configuration: " + project.workspace,
          );
        }
      }
    }
    const capture = (state?.projects ?? [])
      .filter((p) => p.captureNewSessions)
      .map((project) => {
        const observations = project.clients
          .flatMap((client) =>
            readCaptureStatuses(
              join(
                dirname(project.database),
                "queue",
                client === "claude-code" ? "claude" : client,
              ),
            ),
          )
          .filter((s) => s.session.repoId === project.repoId);
        return {
          workspace: project.workspace,
          captureObserved: observations.length > 0,
          sessions: observations,
        };
      });
    console.log(
      JSON.stringify(
        {
          capture,
          status: problems.length ? "attention_required" : "configured",
          runtime: state?.current.version,
          problems,
          note: "Configuration check only; agent login/trust and live handoff are not verified.",
        },
        null,
        2,
      ),
    );
    if (problems.length) process.exitCode = 1;
    return;
  }
  if (!["setup", "update", "rollback", "uninstall"].includes(action))
    throw new Error("Unknown command: " + action);
  let project: Project | undefined;
  if (action === "setup") {
    const directory = values.workspace ?? (await ask("Project folder: "));
    const selected =
      values.client ??
      (await ask("Agents (comma separated: " + clients.join(", ") + "): "))
        .split(",")
        .map((v) => v.trim());
    const { workspace, repoId } = resolveRepository(resolve(directory));
    project = {
      workspace,
      repoId,
      clients: selected,
      database: join(paths.data, "events.sqlite"),
      ...(values["capture-new-sessions"] ? { captureNewSessions: true } : {}),
    };
    // Validate and show changes before installing dependencies or writing settings.
    const plan = planConnection({ ...project, appRoot });
    preview(plan);
    if (values.preview) {
      console.log("Preview only. No runtime or configuration installed.");
      return;
    }
  } else {
    const state = readInstallation(home);
    if (!state) throw new Error("No installation found. Run setup first.");
    if (action === "uninstall") {
      const target = values.workspace
        ? resolveRepository(resolve(values.workspace)).workspace
        : null;
      if (!target)
        throw new Error(
          "Pass --workspace to uninstall one project; memory data is always retained",
        );
      if (!state.projects.some((p) => p.workspace === target))
        throw new Error("Project is not managed by this installation");
      preview(planUninstall(target));
    } else
      console.log(
        action +
          " runtime for " +
          state.projects.length +
          " project(s); user memory is retained.",
      );
    if (values.preview) return;
  }
  if (!(await confirm("Apply " + action + "?", values.yes))) {
    console.log("Cancelled. No changes applied.");
    return;
  }
  await withInstallLock(home, async () => {
    const state = readInstallation(home);
    if (action === "uninstall") {
      const target = resolveRepository(resolve(values.workspace!)).workspace;
      const plan = planUninstall(target);
      applyAll([plan], () =>
        atomicWrite(
          paths.state,
          JSON.stringify(
            {
              ...state!,
              projects: state!.projects.filter((p) => p.workspace !== target),
            },
            null,
            2,
          ),
        ),
      );
      console.log(
        "Project connectors removed where unchanged. User-edited settings and all memory retained. Runtime retained for other projects.",
      );
      return;
    }
    if (project) {
      const existing = state?.projects.find(
        (p) => p.workspace === project!.workspace,
      );
      if (existing) {
        project.clients = [
          ...new Set([...existing.clients, ...project.clients]),
        ];
        if (existing.captureNewSessions) project.captureNewSessions = true;
      }
    }
    const projects = project
      ? [
          ...(state?.projects ?? []).filter(
            (p) => p.workspace !== project.workspace,
          ),
          project,
        ]
      : state!.projects;
    if (action !== "rollback" && metadata.private && !values.package)
      throw new Error(
        "This package is unpublished. Pass --package /absolute/path/to/the-built.tgz; registry installation is disabled until release.",
      );
    const runtime =
      action === "rollback"
        ? state?.previous
        : installRuntime(
            home,
            values.package ??
              packageName +
                "@" +
                (action === "update"
                  ? version.includes("-")
                    ? "next"
                    : "latest"
                  : version),
          );
    if (!runtime) throw new Error("No previous runtime available");
    assertRuntimeCompatibility(runtime, projects);
    const plans = plansFor(runtime, projects);
    applyAll(plans, () => activateRuntime(home, runtime, projects));
    console.log(
      "Installed runtime " + runtime.version + ". Data: " + paths.data,
    );
    console.log(
      "Restart connected agents and review MCP/hook trust prompts. Use /continue-chat to select your conversation.",
    );
    if (projects.some((p) => p.clients.includes("claude-desktop")))
      console.log(
        "Claude Desktop: merge the generated project .memory/connectors/claude-desktop.json fragment into Desktop MCP settings, then restart.",
      );
  });
}
try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
