import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { capture, flush, recallInstruction } from "./hooks.ts";
import type { ClientName } from "./hooks.ts";
import { captureTranscript } from "./transcript.ts";
import { MemoryStore } from "../../memory/src/store.ts";

const [action, client] = process.argv.slice(2);
try {
  if (!["claude", "codex", "antigravity"].includes(client ?? "")) throw new Error("Choose claude, codex or antigravity");
  const repoId = process.env.MEMORY_REPO;
  const featureId = process.env.MEMORY_FEATURE;
  if (!repoId || !featureId) throw new Error("Set MEMORY_REPO and MEMORY_FEATURE for the connected feature");
  const scope = { repoId, featureId, ...(process.env.MEMORY_BRANCH ? { branch: process.env.MEMORY_BRANCH } : {}) };
  if (action === "recall") {
    console.log(JSON.stringify(recallInstruction(client as ClientName, scope)));
  } else if (action === "capture" || action === "flush") {
    const directory = process.env.MEMORY_QUEUE ?? resolve(".memory/queue");
    if (action === "capture") {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of process.stdin) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) throw new Error("Hook input exceeds 1 MiB");
        chunks.push(chunk);
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
