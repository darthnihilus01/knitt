import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { capture, flush, recallInstruction } from "./hooks.ts";
import type { ClientName } from "./hooks.ts";
import { resolveScope } from "./scope.ts";
import { captureTranscript } from "./transcript.ts";
import { MemoryStore } from "../../memory/src/store.ts";

const [action, client] = process.argv.slice(2);
try {
  if (!["claude", "codex", "antigravity"].includes(client ?? "")) throw new Error("Choose claude, codex or antigravity");
  let payload: Record<string, unknown> = {};
  if (action === "capture" || action === "recall") {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) throw new Error("Hook input exceeds 1 MiB");
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (text) {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Hook input must be an object");
      payload = parsed;
    }
  }
  const scope = resolveScope(payload);
  if (action === "recall") {
    console.log(JSON.stringify(recallInstruction(client as ClientName, scope)));
  } else if (action === "capture" || action === "flush") {
    const directory = process.env.MEMORY_QUEUE ?? resolve(".memory/queue");
    if (action === "capture") {
      const transcriptPath = payload.transcript_path ?? payload.transcriptPath;
      if (typeof transcriptPath === "string" && transcriptPath) {
        console.error(JSON.stringify(captureTranscript({
          directory, client: client as ClientName, scope,
          sessionId: String(payload.session_id ?? payload.conversationId ?? ""),
          path: transcriptPath,
        })));
      } else {
        capture(directory, client as ClientName, scope, payload);
      }
    }
    const report = flush(directory, event => {
      const path = process.env.MEMORY_DB ?? resolve(".memory/events.sqlite");
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const store = new MemoryStore(path);
      try { store.save(event); } finally { store.close(); }
    });
    console.error(JSON.stringify(report));
    console.log("{}");
  } else throw new Error("Choose capture, recall or flush");
} catch (error) {
  // Hook failure must not prevent the user's coding turn.
  console.error("Shared memory: " + (error instanceof Error ? error.message : String(error)));
  console.log("{}");
}
