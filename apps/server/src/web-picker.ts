import { randomBytes, createHash } from "node:crypto";
import { join, dirname } from "node:path";
import type { Conversation } from "../../../packages/adapters/src/handoff.ts";
import { importConversation } from "../../../packages/adapters/src/handoff.ts";
import { conversationLabel } from "../../../packages/adapters/src/picker.ts";
import { MemoryStore } from "../../../packages/memory/src/store.ts";

type Ticket = { repoId: string; ownerId: string; sessionId: string; conversations: Conversation[]; expires: number };

export class WebPicker {
  private tickets = new Map<string, Ticket>();
  private database: string;
  constructor(database: string) { this.database = database; }
  create(resource: URL, ticket: Omit<Ticket, "expires">, tokenExpires: number) {
    for (const [id, entry] of this.tickets) if (entry.expires <= Date.now()) this.tickets.delete(id);
    if (this.tickets.size >= 1000) throw new Error("Too many pending pickers");
    const id = randomBytes(32).toString("base64url");
    this.tickets.set(id, { ...ticket, expires: Math.min(Date.now() + 10 * 60_000, tokenExpires * 1000) });
    const url = new URL("/pick", resource);
    url.hash = id;
    return url.href;
  }
  private get(id: string) {
    const ticket = this.tickets.get(id);
    if (!ticket || ticket.expires <= Date.now()) { this.tickets.delete(id); throw new Error("Picker expired. Request a new picker in your chat."); }
    return ticket;
  }
  options(id: string) {
    return this.get(id).conversations.map((c, i) => ({ key: String(i), label: conversationLabel(c) }));
  }
  select(id: string, key: string) {
    const ticket = this.get(id);
    if (!/^(0|[1-9][0-9]*)$/.test(key)) throw new Error("Choose a displayed chat");
    const conversation = ticket.conversations[Number(key)];
    if (!conversation) throw new Error("Choose a displayed chat");
    const store = new MemoryStore(this.database);
    try {
      if (!store.ownsChatSession(ticket.repoId, ticket.sessionId, ticket.ownerId)) throw new Error("Session is unavailable");
      const report = importConversation({
        conversation, repoId: ticket.repoId, directory: join(dirname(this.database), "web-picker-queue", createHash("sha256").update(ticket.repoId + ticket.sessionId).digest("hex")), store,
      });
      store.selectSession(ticket.repoId, ticket.sessionId, report.featureId, conversation.title);
      this.tickets.delete(id);
      return { selected: true, title: conversation.title };
    } finally { store.close(); }
  }
  cancel(id: string) { this.get(id); this.tickets.delete(id); }
}

export const pickerHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Choose a chat</title><style>
body{font-family:Geist,Arial,sans-serif;max-width:760px;margin:48px auto;padding:0 24px;background:#fafafa;color:#222}h1{font-size:28px}label{display:block;padding:16px;margin:10px 0;background:white;border:1px solid #ddd;border-radius:8px;overflow-wrap:anywhere}input{margin-right:12px}button{padding:12px 18px;margin:16px 12px 0 0;cursor:pointer}#status{line-height:1.6}
</style><script type="module" src="/picker.js"></script></head><body><h1>Choose a chat</h1><p id="status">Loading your conversations…</p><form id="picker"><div id="choices"></div><button id="continue" disabled>Continue this chat</button><button id="cancel" type="button">Cancel</button></form></body></html>`;

export const pickerJs = `
const ticket = location.hash.slice(1);
history.replaceState(null, "", location.pathname);
const status = document.querySelector("#status");
const form = document.querySelector("#picker");
const choices = document.querySelector("#choices");
const submit = document.querySelector("#continue");

async function call(path, extra = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket, ...extra }),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "Unable to open picker");
  return data;
}

function fail(error) {
  status.textContent = error.message;
  submit.disabled = true;
}

call("/picker/options").then(data => {
  status.textContent = "Select the conversation you want to continue.";
  for (const choice of data.choices) {
    const label = document.createElement("label");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "conversation";
    radio.value = choice.key;
    radio.required = true;
    radio.addEventListener("change", () => { submit.disabled = false; });
    label.append(radio, document.createTextNode(choice.label));
    choices.append(label);
  }
}).catch(fail);

form.addEventListener("submit", async event => {
  event.preventDefault();
  const key = new FormData(form).get("conversation");
  if (typeof key !== "string") return;
  submit.disabled = true;
  try {
    const result = await call("/picker/select", { key });
    document.querySelector("h1").textContent = "Chat ready";
    status.textContent = result.title + " is selected. Return to your assistant to continue.";
    form.hidden = true;
  } catch (error) { fail(error); }
});

document.querySelector("#cancel").addEventListener("click", async () => {
  try {
    await call("/picker/cancel");
    status.textContent = "Cancelled. Nothing was selected.";
    form.hidden = true;
  } catch (error) { fail(error); }
});
`;
