import { discoverConversations, importDiscovered } from "./discovery.ts";
import { createInterface } from "node:readline/promises";
import { pickConversation } from "./picker.ts";
import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  findConversations,
  selectConversation,
  importConversation,
} from "./handoff.ts";
import { MemoryStore } from "../../memory/src/store.ts";
import { resolveRepository } from "./repository.ts";
import {
  planConnection,
  applyConnectionPlan,
} from "../../installer/src/connections.ts";
import { codexLaunch, displayCommand } from "./launch.ts";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      session: { type: "string" },
      client: { type: "string" },
      conversation: { type: "string" },
      workspace: { type: "string" },
      from: { type: "string", default: "antigravity" },
      to: { type: "string", default: "codex" },
      "data-root": { type: "string", multiple: true },
      preview: { type: "boolean", default: false },
      launch: { type: "boolean", default: false },
    },
  });
  const action = positionals[0];
  if (action === "continue") {
    if (
      !values.workspace ||
      !values.session ||
      !values.client ||
      !["codex", "claude", "antigravity"].includes(values.client)
    )
      throw new Error(
        "Pass --workspace, --session and --client codex|claude|antigravity",
      );
    const { workspace, repoId } = resolveRepository(resolve(values.workspace));
    const database = process.env.MEMORY_DB;
    if (!database)
      throw new Error("Set MEMORY_DB to the connected installation database");
    const store = new MemoryStore(database, { conversationMode: true });
    try {
      const key = {
        repoId,
        client: values.client,
        nativeSessionId: values.session,
      };
      store.sessionConversation(key);
      const choices = discoverConversations(
        store,
        repoId,
        workspace,
      ).conversations.filter(
        (c) =>
          c.storedId !== store.sessionConversation(key).conversationId &&
          !(c.client === key.client && c.sourceId === key.nativeSessionId),
      );
      if (!process.stdin.isTTY)
        throw new Error("Run the continuation picker interactively");
      const reader = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      let chosen;
      try {
        chosen = await pickConversation(choices, {
          ask: (p) => reader.question(p),
          write: (t) => {
            process.stdout.write(t);
          },
        });
      } finally {
        reader.close();
      }
      if (!chosen) {
        console.log("Cancelled. Previous selection retained.");
        return;
      }
      const source = choices.find((c) => c.id === chosen!.id)!;
      const id = importDiscovered(
        store,
        repoId,
        source,
        join(dirname(database), "history-import"),
      );
      console.log(JSON.stringify(store.linkSource(key, id)));
      return;
    } finally {
      store.close();
    }
  }
  if (
    !["list", "handoff"].includes(action) ||
    values.from !== "antigravity" ||
    values.to !== "codex"
  ) {
    throw new Error(
      "Usage: npm run memory -- list [--workspace PATH] | handoff --conversation TITLE_OR_ID [--workspace PATH] [--preview]. Supported handoff: Antigravity to Codex.",
    );
  }
  const roots =
    values["data-root"] ??
    ["antigravity", "antigravity-cli", "antigravity-ide"].map((name) =>
      join(homedir(), ".gemini", name),
    );
  const conversations = findConversations(roots, values.workspace);
  if (action === "list") {
    console.log(
      JSON.stringify(
        conversations.map(({ id, title, workspace, modified }) => ({
          id,
          title,
          workspace,
          modified,
        })),
        null,
        2,
      ),
    );
    return;
  }
  let conversation;
  if (values.conversation)
    conversation = selectConversation(conversations, values.conversation);
  else {
    if (!process.stdin.isTTY)
      throw new Error(
        "User selection required. Run handoff interactively to open the chat picker, or pass an explicit --conversation.",
      );
    const reader = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      conversation = await pickConversation(conversations, {
        ask: (prompt) => reader.question(prompt),
        write: (text) => {
          process.stdout.write(text);
        },
      });
    } finally {
      reader.close();
    }
    if (!conversation) {
      console.log("Cancelled. No chat imported or selected.");
      return;
    }
  }
  const { workspace, repoId } = resolveRepository(conversation.workspace);
  const app = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  const database = process.env.MEMORY_DB ?? join(app, ".memory/events.sqlite");
  const featureId = "antigravity:" + conversation.id;
  const launch = codexLaunch(workspace, {
    featureId,
    title: conversation.title,
  });
  const destinationCommand = displayCommand("env", [
    ...Object.entries(launch.env).map(([name, value]) => name + "=" + value),
    launch.command,
    ...launch.args,
  ]);
  if (values.preview) {
    console.log(
      JSON.stringify(
        {
          action,
          title: conversation.title,
          workspace,
          repoId,
          featureId,
          destination: "codex",
          database,
          changesApplied: false,
        },
        null,
        2,
      ),
    );
    return;
  }
  mkdirSync(dirname(database), { recursive: true, mode: 0o700 });
  const store = new MemoryStore(database);
  let report;
  try {
    report = importConversation({
      conversation,
      repoId,
      store,
      directory: join(
        app,
        ".memory/handoffs",
        createHash("sha256")
          .update(repoId + featureId)
          .digest("hex"),
      ),
    });
  } finally {
    store.close();
  }
  // The destination feature binding is installed only after the history has been saved.
  applyConnectionPlan(
    planConnection({
      workspace,
      appRoot: app,
      database,
      repoId,
      clients: ["codex"],
    }),
  );
  console.log(
    JSON.stringify(
      {
        title: conversation.title,
        workspace,
        repoId,
        ...report,
        ready: true,
        destinationCommand,
      },
      null,
      2,
    ),
  );
  if (values.launch) {
    execFileSync(launch.command, launch.args, {
      cwd: workspace,
      stdio: "inherit",
      env: { ...process.env, ...launch.env },
    });
  } else {
    console.log(
      "Continue in the destination workspace with this command, or rerun handoff with --launch:",
    );
    console.log(destinationCommand);
    console.log(
      "Starting a chat in the memory-product project does not switch it to the destination workspace.",
    );
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
