import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMemoryServer } from "./server.ts";

const app = createMemoryServer(process.env, process.env.MEMORY_CHAT_CLIENT
  ? { ownerId: "local:" + process.env.MEMORY_CHAT_CLIENT } : {});
await app.server.connect(new StdioServerTransport());
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await app.server.close();
  app.close();
}
process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
