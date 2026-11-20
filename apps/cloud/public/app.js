const root = document.getElementById("app");
const notice = document.getElementById("notice");
const views = {
  contexts: "My contexts",
  shared: "Shared with me",
  people: "People",
  inbox: "Inbox",
  settings: "Settings",
  admin: "Admin",
  history: "My contexts",
};
const viewDescriptions = {
  contexts: "Pick up where you left off, in any coding agent.",
  shared: "Reviewed context from the people you work with.",
  people: "Find collaborators and manage your connections.",
  inbox: "Review invitations before sharing access.",
  settings: "Your account, connected agents, and sync controls.",
  admin: "Understand who’s joining and how Knitt is being used.",
  history: "Your conversation, with its original context.",
};
const revokeNotice =
  "Revoking access stops future retrieval through Knitt. Content already loaded may remain in the recipient’s chat or local storage.";
let identity;
let generation = 0;
let noticeTimer;
let formSequence = 0;

const ICONS = {
  layers: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="nav-icon"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>',
  shared: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="nav-icon"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/></svg>',
  people: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="nav-icon"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  inbox: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="nav-icon"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
  settings: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="nav-icon"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
  terminal: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>',
};

function el(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function group(className, ...children) {
  const box = el("div", undefined, className);
  box.append(...children.filter(Boolean));
  return box;
}
function renderIcon(markup) {
  const span = el("span", undefined, "icon-slot");
  try {
    if (typeof DOMParser !== "undefined") {
      const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
      if (doc && doc.documentElement) span.append(doc.documentElement);
    } else if (span.innerHTML !== undefined) {
      span.innerHTML = markup;
    }
  } catch {}
  return span;
}
function message(text) {
  if (!notice) return;
  clearTimeout(noticeTimer);
  notice.textContent = text;
  notice.hidden = false;
  noticeTimer = setTimeout(() => {
    notice.hidden = true;
  }, 6500);
}
async function api(path, method = "GET", body) {
  const headers = { Accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";
  if (method !== "GET" && identity?.csrfToken)
    headers["X-CSRF-Token"] = identity.csrfToken;
  const res = await fetch("/api/" + path, {
    method,
    headers,
    body: body && JSON.stringify(body),
    cache: "no-store",
  });
  const data = res.status === 204 ? {} : await res.json();
  if (!res.ok) {
    const error = new Error(
      typeof data.error === "string"
        ? data.error
        : "Request failed. Please try again.",
    );
    error.status = res.status;
    throw error;
  }
  return data;
}
function action(text, callback, cls = "") {
  const button = el("button", text, cls);
  button.type = "button";
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      await callback();
    } catch (error) {
      message(error.message);
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  });
  return button;
}
function field(label, initial = "") {
  const input = el("input");
  input.setAttribute("aria-label", label);
  input.placeholder = label;
  input.value = initial;
  return input;
}
function form(input, submitText, handler) {
  const f = el("form");
  const submit = el("button", submitText, "primary");
  const errorMessage = el("p", "", "form-error");
  errorMessage.id = "form-error-" + ++formSequence;
  errorMessage.hidden = true;
  errorMessage.setAttribute("role", "alert");
  input.setAttribute("aria-describedby", errorMessage.id);
  input.required = true;
  f.append(input, submit, errorMessage);
  f.onsubmit = async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    errorMessage.hidden = true;
    input.removeAttribute("aria-invalid");
    try {
      await handler(input.value.trim());
    } catch (error) {
      errorMessage.textContent = error.message;
      errorMessage.hidden = false;
      input.setAttribute("aria-invalid", "true");
    } finally {
      submit.disabled = false;
    }
  };
  return f;
}
function section(title, ...children) {
  return group("section", el("h3", title), ...children);
}
function confirmAction(title, description, label, callback) {
  const dialog = el("dialog");
  dialog.setAttribute("aria-label", title);
  dialog.append(
    el("h2", title),
    el("p", description),
    group(
      "actions",
      action("Cancel", () => dialog.close(), "btn-ghost"),
      action(
        label,
        async () => {
          dialog.close();
          await callback();
        },
        label.toLowerCase().includes("delete") ||
          label.toLowerCase().includes("revoke") ||
          label.toLowerCase().includes("disconnect")
          ? "danger"
          : "primary",
      ),
    ),
  );
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
function link(title, href, cls = "btn") {
  const a = el("a", title, cls);
  a.href = href;
  return a;
}
function brand() {
  const mark = el("img");
  mark.src = "/mark.svg?v=thread-1";
  mark.alt = "";
  mark.width = 34;
  mark.height = 34;
  const name = el("span", "knit", "brand-wordmark");
  return group("brand", mark, name);
}
function siteHeader() {
  return group("site-header", brand(), el("span", "Conversation memory, across agents.", "header-tagline"), action("Connect agents ↗", connect, "header-cta"));
}
function siteFooter() {
  return group("site-footer", group("actions", link("My contexts", route("contexts"), "footer-link"), link("Shared with me", route("shared"), "footer-link"), link("People", route("people"), "footer-link"), link("Account & support", route("settings"), "footer-link")), el("p", "Knitt Cloud · Shared conversation memory for coding agents."), el("small", "Choose what you sync. Choose who you share it with."));
}
function entry(...children) {
  const panel = group("entry", group("form-box", ...children));
  root.replaceChildren(group("landing", siteHeader(), panel, siteFooter()));
}
function providerLink(name, target) {
  const provider = name.toLowerCase();
  const button = link(
    "",
    "/auth/" + provider + "/start" + target,
    "provider " + provider,
  );
  const icon = el("img");
  icon.src = "/" + provider + ".svg";
  icon.alt = "";
  button.append(icon, el("span", "Continue with " + name));
  return button;
}
function signIn() {
  const target = "?returnTo=" + encodeURIComponent(location.pathname + location.search + (location.hash || ""));
  entry(
    el("span", "YOUR WORK, CONTINUED", "eyebrow"),
    el("h1", "Pick up the thread."),
    el("p", "One place for your coding conversations. Sign in to continue across agents and share context with your team."),
    group(
      "providers",
      providerLink("Google", target),
      providerLink("GitHub", target),
    ),
    ...(location.pathname === "/pair" ? [] : [action("Connect coding agents", connect, "btn-ghost")]),
    el("small", "You choose which projects sync to Knitt. Signing in won’t upload your conversations.", "auth-note"),
  );
}
function username() {
  const input = field("Username");
  input.pattern = "[a-z0-9][a-z0-9_]{2,31}";
  input.maxLength = 32;
  entry(
    el("h1", "Choose your username"),
    el(
      "p",
      "Friends can find you by this name. Use 3–32 lowercase letters, numbers, or underscores. Start with a letter or number.",
    ),
    form(input, "Save username", async (value) => {
      await api("me/username", "PUT", { username: value });
      await boot();
    }),
  );
}
async function pairing() {
  const code = new URLSearchParams(location.search).get("code") || "";
  const { name } = await api(
    "device-pairings/preview?code=" + encodeURIComponent(code),
  );
  entry(
    el("h1", "Connect local Knitt"),
    el(
      "p",
      "Approve this installation only if you started the login on this device.",
    ),
    el("strong", name),
    el("p", code),
    action(
      "Approve installation",
      async () => {
        await api("device-pairings/approve", "POST", { userCode: code });
        entry(
          el("h1", "Installation approved"),
          el("p", "Return to your agent to finish setting up Knitt."),
          link("Open dashboard", "/", "primary"),
        );
      },
      "primary",
    ),
    link("Cancel", "/", "btn-ghost"),
  );
}
function connect(finishSync = false) {
  const dialog = el("dialog", undefined, "agent-setup");
  dialog.setAttribute("aria-label", "Connect coding agents");
  const prompt = el("textarea");
  prompt.readOnly = true;
  prompt.rows = 4;
  prompt.value = finishSync
    ? "Set up Knitt cloud sync for my current project. Show me the history preview before uploading."
    : "Run npx @tinchu0/knitt@latest plugin from this Git project to connect my coding agents.";
  prompt.setAttribute("aria-label", "Setup prompt");
  const status = el("p");
  status.setAttribute("role", "status");
  const steps = el("ol", undefined, "agent-setup-steps");
  steps.append(
    el("li", "Restart your connected agents and review their trust prompts."),
    el("li", "Ask your agent: “Set up Knitt for this project.”"),
    el("li", "Approve account pairing in your browser, then approve sync for this project in the agent."),
  );
  const copy = action("Copy setup prompt", async () => {
    try {
      await navigator.clipboard.writeText(prompt.value);
      copy.textContent = "Copied!";
      status.textContent = "Copied. Paste it into your coding agent.";
      setTimeout(() => { copy.textContent = "Copy setup prompt"; }, 2000);
    } catch {
      prompt.focus();
      prompt.select();
      status.textContent = "Copy the selected text and paste it into your coding agent.";
    }
  }, "primary");
  dialog.append(
    el("h2", finishSync ? "Finish project sync" : "Connect your coding agents"),
    el("p", finishSync
      ? "Open the project you want to sync in your coding agent and paste this prompt. Review the history preview and approve uploads there. If Knitt tools are unavailable, connect your coding agents first."
      : "Open your Git project in a coding agent and paste this prompt into the chat. Knitt detects your installed agents. Setup needs Node.js 24+ and Git."),
    ...(finishSync ? [action("Connect coding agents first", () => { dialog.close(); connect(); }, "btn-ghost")] : []),
    prompt,
    group("actions", copy, action("Close", () => dialog.close(), "btn-ghost")),
    status,
    el("h3", "After setup"),
    steps,
    el("p", "Use /knit in your agent to resume a conversation."),
  );
  document.body.append(dialog);
  dialog.onclose = () => dialog.remove();
  dialog.showModal();
}
const syncLabels = {
  syncing: "Syncing",
  active: "Sync enabled",
  enabled: "Sync enabled",
  up_to_date: "Up to date",
  reconnect_required: "Reconnect required",
  waiting: "Waiting for first sync",
  paused: "Paused",
  disconnected: "Disconnected",
  offline: "Sync error · offline or import failed",
  error: "Sync error",
  reconnect: "Reconnect required",
};
function syncLabel(status) {
  return syncLabels[status] || status || "Setup required";
}
function installationSyncLabel(item) {
  if (item.status !== "active") return syncLabel(item.status);
  if (
    item.runtimeStatus &&
    item.lastSeenAt &&
    Date.now() - Date.parse(item.lastSeenAt) < 90_000
  )
    return syncLabel(item.runtimeStatus);
  return item.lastSyncAt
    ? "Sync enabled · waiting for installation"
    : "Waiting for first sync";
}
async function projectCards(main, controls = false) {
  const { projects } = await api("private/projects");
  for (const project of projects) {
    const consentApproved = (project.installations || []).some(
      (i) => i.status === "active" || i.status === "paused",
    );
    const card = group(
      "card project-card",
      group(
        "project-header",
        group("project-title-group", el("h2", project.title)),
        group(
          "project-badges",
          el("span", syncLabel(project.status), "status-pill status-" + (project.status || "active")),
          el(
            "span",
            "Project consent: " +
              (consentApproved
                ? "Approved for connected installations"
                : "Setup required"),
            "badge " + (consentApproved ? "badge-approved" : "badge-pending"),
          ),
        ),
      ),
    );
    if (project.lastSyncAt)
      card.append(
        el(
          "small",
          "Last successful sync " +
            new Date(project.lastSyncAt).toLocaleString(),
          "project-sync-meta",
        ),
      );
    for (const installation of project.installations || []) {
      const instBox = group(
        "section installation-box",
        group(
          "installation-header",
          el("strong", installation.name),
          el("span", installationSyncLabel(installation), "status-pill"),
        ),
        ...(installation.pendingCount
          ? [
              el(
                "small",
                installation.pendingCount + " messages waiting to sync",
                "queue-badge",
              ),
            ]
          : []),
        ...(controls
          ? [
              group(
                "actions",
                ...(installation.status === "paused"
                  ? [
                      action(
                        "Resume sync",
                        () =>
                          change(
                            "private/projects/" + path(project.id) + "/control",
                            "POST",
                            {
                              action: "resume",
                              deviceId: installation.deviceId,
                            },
                          ),
                        "primary btn-sm",
                      ),
                    ]
                  : installation.status === "active" ||
                      installation.status === "enabled" ||
                      installation.status === "syncing"
                    ? [
                        action(
                          "Pause sync",
                          () =>
                            confirmAction(
                              "Pause sync?",
                              "New uploads from this installation will pause. Your cloud history stays available.",
                              "Pause sync",
                              () =>
                                change(
                                  "private/projects/" +
                                    path(project.id) +
                                    "/control",
                                  "POST",
                                  {
                                    action: "pause",
                                    deviceId: installation.deviceId,
                                  },
                                ),
                            ),
                          "btn-sm",
                        ),
                      ]
                    : []),
                ...(installation.status !== "disconnected"
                  ? [
                      action(
                        "Disconnect project",
                        () =>
                          confirmAction(
                            "Disconnect this project?",
                            "This installation will stop uploading this project. Existing local and cloud history is retained. Reconnecting requires approval inside the agent.",
                            "Disconnect",
                            () =>
                              change(
                                "private/projects/" +
                                  path(project.id) +
                                  "/control",
                                "POST",
                                {
                                  action: "disconnect",
                                  deviceId: installation.deviceId,
                                },
                              ),
                          ),
                        "btn-sm danger",
                      ),
                    ]
                  : []),
              ),
            ]
          : []),
      );
      card.append(instBox);
    }
    main.append(card);
  }
  return projects;
}
function relativeActivity(value) {
  const date=Date.parse(value);if(!Number.isFinite(date))return "unknown";
  const minutes=Math.max(0,Math.floor((Date.now()-date)/60000));
  return minutes<1?"just now":minutes<60?minutes+"m ago":minutes<1440?Math.floor(minutes/60)+"h ago":Math.floor(minutes/1440)+"d ago";
}
async function personalHistories(main) {
  const projectId = new URLSearchParams(location.search).get("projectId");
  if (projectId) main.append(link("Show all projects", "/#contexts", "btn-ghost btn-sm"));
  let cursor;
  const conversations = [];
  do {
    const page = await api(
      "private/conversations" + (projectId || cursor ? "?" + new URLSearchParams({
        ...(projectId ? {projectId} : {}), ...(cursor ? {cursor} : {}),
      }) : ""),
    );
    conversations.push(...page.conversations);
    cursor = page.nextCursor;
  } while (cursor);
  if (!conversations.length) return false;
  conversations.sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
  main.append(
    searchable(
      conversations.map((c) => ({ ...c, label: c.title + " " + (c.summary || "") + " " + c.origin + " " + c.projectTitle })),
      (c) => {
        const a = link("", route("history", c.id), "row chat-row");
        const originName = (c.origin || "agent").toLowerCase();
        const header = group(
          "chat-row-header",
          group(
            "chat-agent-tags",
            el("span", c.origin || "agent", "agent-pill agent-" + originName),
            ...(c.titleSource === "fallback" ? [el("span", "Fallback title · source sidebar name unavailable", "badge badge-fallback")] : []),
          ),
          el("span", relativeActivity(c.modified || c.updatedAt), "chat-time"),
        );
        const title = el("strong", c.title, "chat-title");
        const summary = el("p", c.summary || "No message preview available", "chat-summary");
        const meta = el(
          "small",
          (c.projectTitle ? c.projectTitle + " · " : "") + c.origin +
            " · " +
            c.eventCount +
            " messages · Active " + relativeActivity(c.modified || c.updatedAt) + " · Last synced " +
            new Date(c.updatedAt).toLocaleString(),
          "chat-meta",
        );
        a.append(header, title, summary, meta);
        return a;
      },
      "Search your conversations…",
    ),
  );
  return true;
}
async function history(main, { id, version, before }) {
  const query = new URLSearchParams();
  if (version) query.set("cutoff", version);
  if (before) query.set("before", before);
  const data = await api(
    "private/conversations/" + path(id) + "/context?" + query,
  );
  main.append(
    link("Back to my contexts", route("contexts"), "btn btn-ghost"),
    el("h2", data.conversation.title),
  );
  for (const event of data.events)
    main.append(
      group("card", el("small", event.role), el("div", event.text, "content")),
    );
  if (data.nextBefore !== null && data.nextBefore !== undefined)
    main.append(
      action("Older messages", () => {
        location.hash = route(
          "history",
          id,
          String(data.cutoff),
          String(data.nextBefore),
        );
      }, "btn-ghost"),
    );
}
const path = (value) => encodeURIComponent(value);
function route(view, id, version, before) {
  return "#" + [view, id, version, before].filter(Boolean).map(path).join("/");
}
function current() {
  const [key, id, version, before] = location.hash
    .slice(1)
    .split("/")
    .map(decodeURIComponent);
  return {
    view: Object.hasOwn(views, key) ? key : "contexts",
    id,
    version,
    before,
  };
}
async function change(endpoint, method, body, feedback) {
  await api(endpoint, method, body);
  await dashboard();
  if (feedback) message(feedback);
}
function invitationActions(invitation, owner) {
  const { id, status } = invitation;
  const actions = owner
    ? status === "pending"
      ? ["withdraw"]
      : status === "accepted"
        ? ["revoke"]
        : []
    : status === "pending"
      ? ["accept", "decline"]
      : status === "accepted"
        ? ["leave"]
        : [];
  return group(
    "actions",
    ...actions.map((verb) =>
      action(verb[0].toUpperCase() + verb.slice(1), () => {
        const commit = () =>
          change(
            "invitations/" + path(id) + "/" + verb,
            "POST",
            {},
            "Invitation updated.",
          );
        if (verb === "revoke")
          return confirmAction(
            "Revoke access?",
            revokeNotice,
            "Revoke access",
            commit,
          );
        return commit();
      }, verb === "accept" ? "primary btn-sm" : verb === "revoke" || verb === "decline" ? "danger btn-sm" : "btn-sm"),
    ),
  );
}
function searchable(rows, build, placeholder) {
  const input = field(placeholder);
  input.type = "search";
  const items = group("items");
  const count = el("small", "", "search-count");
  count.setAttribute("role", "status");
  const render = () => {
    const term = input.value.trim().toLowerCase();
    const matches = term ? rows.filter((row) =>
      row.label.toLowerCase().includes(term),
    ) : rows;
    items.replaceChildren(...matches.map(build));
    count.textContent = term ? matches.length + " of " + rows.length + " results" : rows.length + " available";
    if (!matches.length) items.append(group("search-empty", el("strong", "No results for “" + input.value.trim() + "”"), el("p", "Try another name, project, or keyword.", "subtle"), action("Clear search", () => { input.value = ""; render(); input.focus?.(); }, "btn-ghost btn-sm")));
  };
  input.oninput = render;
  render();
  return group("list", group("search-toolbar", input, count), items);
}
function contextRow(c, view, selected) {
  const a = link(
    "",
    route(view, c.id),
    "row" + (selected === c.id ? " active" : ""),
  );
  a.append(
    el("strong", c.title),
    el(
      "small",
      [
        c.ownerUsername && "@" + c.ownerUsername,
        c.sourceAgent,
        c.latestVersionNumber && "v" + c.latestVersionNumber,
      ]
        .filter(Boolean)
        .join(" · "),
    ),
  );
  return a;
}
async function contexts(main, { view, id, version }) {
  const owned = view === "contexts";
  const [all, invites] = await Promise.all([
    api("contexts"),
    api(owned ? "invitations" : "inbox"),
  ]);
  let hasPrivate = false;
  if (owned && !id) {
    main.append(group("sync-setup-actions",
      action("Add or finish project sync", () => connect(true), "btn-ghost"),
      el("p", "Only approved projects appear here. Finish setup inside your coding agent to sync another project.", "subtle"),
    ));
    const sync = el("details", undefined, "sync-disclosure");
    const summary = el("summary");
    const projectList = group("sync-projects");
    const projects = await projectCards(projectList, true);
    const installations = projects.flatMap(project => project.installations || []);
    const pending = installations.reduce((count, installation) => count + (installation.pendingCount || 0), 0);
    const needsAttention = pending > 0 || projects.some(project => !(project.installations || []).length) || installations.some(installation =>
      installation.status !== "active" || !installation.lastSyncAt ||
      ["offline", "error", "waiting", "syncing", "reconnect", "reconnect_required"].includes(installation.runtimeStatus));
    summary.append(el("strong", "Project sync"), el("span", projects.length + " projects · @" + identity.account.username, "subtle"));
    if (needsAttention) {
      summary.append(el("span", pending ? pending + " messages waiting to sync" : "An installation needs attention", "sync-warning"));
      sync.open = true;
    }
    sync.append(summary, projectList);
    if (projects.length) main.append(sync);
    hasPrivate = await personalHistories(main);
  }
  const rows = all.contexts.filter((c) => Boolean(c.owned) === owned);
  if (!rows.length) {
    if (hasPrivate) return;
    main.append(
      group(
        "empty",
        el(
          "h2",
          owned ? "Continue your work with Knitt" : "No shared contexts yet",
        ),
        el(
          "p",
          owned
            ? "Your local chats haven’t synced yet. Finish setup inside your coding agent."
            : "Accept a context invitation to see it here.",
        ),
        owned
          ? action("Connect coding agents", connect, "primary")
          : link("Open inbox", route("inbox")),
      ),
    );
    return;
  }
  const pane = group(
    "pane",
    searchable(
      rows.map((c) => ({ ...c, label: c.title + " " + c.ownerUsername })),
      (c) => contextRow(c, view, id),
      "Search contexts…",
    ),
  );
  main.append(pane);
  const c = rows.find((row) => row.id === id);
  if (!c) return;
  const versions = (await api("contexts/" + path(id) + "/versions")).versions;
  const selected = version || c.latestVersionId;
  const detail = group(
    "detail",
    link("Back to list", route(view), "btn btn-ghost mobile-back"),
    el("h2", c.title),
  );
  pane.append(detail);
  if (selected) {
    const data = (await api("versions/" + path(selected))).version;
    if (data.contextId !== c.id)
      throw new Error("Version belongs to a different context.");
    const picker = el("select");
    picker.setAttribute("aria-label", "Published version");
    for (const item of versions) {
      const opt = el("option", "Version " + item.number);
      opt.value = item.id;
      picker.append(opt);
    }
    picker.value = selected;
    picker.onchange = () => {
      location.hash = route(view, id, picker.value);
    };
    detail.append(
      group(
        "actions",
        picker,
        el(
          "small",
          [
            data.source.agent,
            data.source.repository,
            data.source.branch,
            data.source.commit,
          ]
            .filter(Boolean)
            .join(" · "),
        ),
      ),
      section("Checkpoint", el("div", data.checkpoint, "content")),
    );
    if (data.excerpts.length)
      detail.append(
        section(
          "Selected excerpts",
          ...data.excerpts.map((e) => el("blockquote", e.text)),
        ),
      );
  }
  const access = invites.invitations.filter(
    (i) => i.contextId === id && ["pending", "accepted"].includes(i.status),
  );
  if (owned) {
    if (selected)
      detail.append(
        section(
          "Share this version",
          form(field("Username or verified email"), "Invite", (recipient) => {
            confirmAction(
              "Share with " + recipient + "?",
              "Access starts at version " +
                versions.find((v) => v.id === selected)?.number +
                " and includes later publications. " +
                revokeNotice,
              "Send invitation",
              () =>
                change(
                  "contexts/" + path(id) + "/invitations",
                  "POST",
                  { recipient, startVersionId: selected },
                  "Invitation sent.",
                ),
            );
          }),
        ),
      );
    detail.append(
      section(
        "People with access",
        ...(access.length
          ? access.map((i) =>
              group(
                "card",
                el("strong", i.recipient),
                el("p", i.status + " · from version " + i.startVersionNumber),
                invitationActions(i, true),
              ),
            )
          : [el("p", "Only you.", "subtle")]),
      ),
      section(
        "Manage context",
        form(field("Context title", c.title), "Rename", (title) =>
          change(
            "contexts/" + path(id),
            "PATCH",
            { title },
            "Context renamed.",
          ),
        ),
        action(
          "Delete context",
          () =>
            confirmAction(
              "Delete " + c.title + "?",
              "This removes all published versions and shares from Knitt Cloud.",
              "Delete context",
              async () => {
                await api("contexts/" + path(id), "DELETE");
                location.hash = route(view);
              },
            ),
          "danger",
        ),
      ),
    );
  } else {
    detail.append(
      section(
        "Resume in your agent",
        el(
          "p",
          "Open /knit in a connected coding agent. Choose Shared with me, then this context and version.",
        ),
        ...access.map((i) => invitationActions(i, false)),
      ),
    );
  }
}
async function people(main) {
  const [{ contacts }, { contexts: all }, { invitations: sent }] =
    await Promise.all([api("contacts"), api("contexts"), api("invitations")]);
  main.append(
    form(field("Exact Knitt username"), "Add friend", (username) =>
      change("contacts", "POST", { username }, "Friend request sent."),
    ),
  );
  for (const c of contacts.filter((c) =>
    ["accepted", "pending"].includes(c.status),
  )) {
    const card = group(
      "card",
      el("h2", "@" + c.username),
      el("small", c.status),
    );
    main.append(card);
    if (c.status === "accepted") {
      const exchanged = all.filter(
        (item) =>
          item.ownerUsername === c.username ||
          sent.some(
            (i) =>
              i.contextId === item.id &&
              i.status === "accepted" &&
              i.recipient === c.username,
          ),
      );
      for (const item of exchanged)
        card.append(contextRow(item, item.owned ? "contexts" : "shared"));
    }
    const verbs =
      c.status === "accepted"
        ? ["remove"]
        : c.direction === "incoming"
          ? ["accept", "decline"]
          : ["withdraw"];
    card.append(
      group(
        "actions",
        ...verbs.map((v) =>
          action(
            v[0].toUpperCase() + v.slice(1),
            () => change("contacts/" + path(c.id) + "/" + v, "POST", {}),
            v === "accept" ? "primary btn-sm" : v === "remove" || v === "decline" ? "danger btn-sm" : "btn-sm",
          ),
        ),
      ),
    );
  }
}
async function inbox(main) {
  const [{ invitations }, { contacts }] = await Promise.all([
    api("inbox"),
    api("contacts"),
  ]);
  const pending = invitations.filter((i) => i.status === "pending");
  const friends = contacts.filter(
    (c) => c.status === "pending" && c.direction === "incoming",
  );
  if (!pending.length && !friends.length)
    main.append(group("empty", el("h2", "Your inbox is clear"), el("p", "No pending invitations or friend requests at this time.")));
  for (const i of pending)
    main.append(
      group(
        "card",
        el("h2", i.title),
        el(
          "p",
          "@" +
            i.senderUsername +
            " invited you, starting at version " +
            i.startVersionNumber +
            ".",
        ),
        invitationActions(i, false),
      ),
    );
  for (const c of friends)
    main.append(
      group(
        "card",
        el("h2", "Friend request"),
        el("p", "@" + c.username),
        group(
          "actions",
          ...["accept", "decline"].map((v) =>
            action(
              v[0].toUpperCase() + v.slice(1),
              () => change("contacts/" + path(c.id) + "/" + v, "POST", {}),
              v === "accept" ? "primary btn-sm" : "danger btn-sm",
            ),
          ),
        ),
      ),
    );
}
async function settings(main) {
  const { devices } = await api("devices");
  await projectCards(main, true);
  main.append(
    group(
      "card",
      el("h2", "Sign-in methods"),
      el("p", identity.account.email),
      ...["google", "github"].map((provider) => {
        const name = provider === "google" ? "Google" : "GitHub";
        return identity.providers.includes(provider)
          ? el("p", name + " connected")
          : action("Link " + name, async () => {
              const { url } = await api("me/link/" + provider, "POST", {});
              location.assign(url);
            }, "primary btn-sm");
      }),
    ),
    group(
      "card",
      el("h2", "Connected installations"),
      action("Connect coding agents", connect, "btn-ghost btn-sm"),
      ...devices.map((d) =>
        group(
          "section",
          el("strong", d.name),
          el("p", "Connected " + new Date(d.createdAt).toLocaleDateString()),
          action("Revoke installation", () =>
            confirmAction(
              "Revoke " + d.name + "?",
              "Revoking stops future retrieval and uploads from this installation. Local and retained cloud history stays available. The installation will need to sign in again.",
              "Revoke",
              () => change("devices/" + path(d.id), "DELETE"),
            ),
          "danger btn-sm"),
        ),
      ),
    ),
    group(
      "card",
      el("h2", "Account"),
      action("Sign out", async () => {
        await api("logout", "POST", {});
        location.replace("/");
      }, "danger"),
    ),
  );
}
async function admin(main) {
  if (!identity?.isAdmin) {
    main.append(group("empty", el("span", "RESTRICTED AREA", "eyebrow"), el("h2", "This account doesn’t have admin access"), el("p", "Sign in with an authorized account, or ask the site owner to enable access for this account."), link("Account settings", route("settings"), "primary"), link("Back to my contexts", route("contexts"), "btn-ghost")));
    return;
  }
  const { overview } = await api("admin/overview");
  main.append(el("p", "Account growth and usage across Knitt Cloud. Recent signups appear first.", "admin-intro"));
  const stats = group("admin-stats");
  for (const [key, label] of Object.entries({ totalUsers: "Total users", signupsThisWeek: "Signups · last 7 days", pendingOnboarding: "Pending onboarding", connectedDevices: "Connected installations", publishedContexts: "Published contexts", syncedConversations: "Synced conversations" })) {
    stats.append(group("card admin-stat", el("span", label), el("strong", overview[key].toLocaleString())));
  }
  const search = field("Search email, username or account ID");
  search.type = "search";
  search.maxLength = 200;
  function select(label, options) {
    const input = el("select");
    input.setAttribute("aria-label", label);
    for (const [value, text] of options) {
      const option = el("option", text);
      option.value = value;
      input.append(option);
    }
    return input;
  }
  const provider = select("Sign-in provider", [["", "All providers"], ["google", "Google"], ["github", "GitHub"]]);
  const onboarding = select("Onboarding status", [["", "All users"], ["complete", "Onboarding complete"], ["pending", "Pending onboarding"]]);
  const controls = el("form", undefined, "admin-filters");
  const submit = el("button", "Search", "primary");
  submit.type = "submit";
  const content = group("admin-results");
  content.setAttribute("aria-live", "polite");
  let page = 1, requestNumber = 0;
  async function load() {
    const ticket = ++requestNumber;
    content.setAttribute("aria-busy", "true");
    try {
      const params = new URLSearchParams({ q: search.value.trim(), provider: provider.value, onboarding: onboarding.value, page: String(page) });
      const data = await api("admin/users?" + params);
      if (ticket !== requestNumber) return;
      const table = el("table", undefined, "admin-table");
      table.append(el("caption", "Registered users, newest first", "sr-only"));
      const header = el("tr");
      for (const title of ["User", "Signed up", "Providers", "Onboarding", "Installations", "Contexts", "Synced chats", "Last installation activity"]) {
        const cell = el("th", title);
        cell.scope = "col";
        header.append(cell);
      }
      const head = el("thead"); head.append(header); table.append(head);
      const body = el("tbody");
      for (const user of data.users) {
        const row = el("tr"), name = el("td");
        const accountId = el("details", undefined, "account-id");
        accountId.append(el("summary", "Account ID"), el("code", user.id));
        name.append(el("strong", user.username ? "@" + user.username : "Username not set"), el("span", user.email), el("small", user.emailVerified ? "Verified email" : "Email not verified", user.emailVerified ? "verified-label" : "subtle"), accountId);
        row.append(name);
        for (const value of [new Date(user.createdAt).toLocaleString(), user.providers.join(" · ") || "Legacy account", user.username ? "Complete" : "Pending", user.connectedDevices, user.publishedContexts, user.syncedConversations, user.lastDeviceActivity ? new Date(user.lastDeviceActivity).toLocaleString() : "No installation activity"]) row.append(el("td", String(value)));
        body.append(row);
      }
      table.append(body);
      const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
      const previous = action("Previous", async () => { page--; await load(); }, "btn-ghost");
      const next = action("Next", async () => { page++; await load(); }, "btn-ghost");
      previous.disabled = page <= 1;
      next.disabled = page >= pages;
      const scroll = group("admin-table-wrap", table);
      scroll.tabIndex = 0;
      scroll.setAttribute("role", "region");
      scroll.setAttribute("aria-label", "Users table. Scroll horizontally to see all columns.");
      content.replaceChildren(el("p", data.total.toLocaleString() + " matching users", "result-count"), ...(data.users.length ? [el("p", "Scroll the table to see usage and activity →", "table-scroll-hint"), scroll] : [group("search-empty", el("strong", "No users match these filters"), el("p", "Clear a filter or search for a different email.", "subtle"))]), group("actions admin-pagination", previous, el("span", "Page " + page + " of " + pages), next));
    } catch (error) {
      if (ticket === requestNumber) content.replaceChildren(el("p", error.message), action("Try again", load, "primary"));
    } finally {
      if (ticket === requestNumber) content.removeAttribute("aria-busy");
    }
  }
  controls.onsubmit = async (event) => { event.preventDefault(); page = 1; await load(); };
  provider.addEventListener("change", async () => { page = 1; await load(); });
  onboarding.addEventListener("change", async () => { page = 1; await load(); });
  controls.append(search, provider, onboarding, submit, action("Clear filters", async () => { search.value = ""; provider.value = ""; onboarding.value = ""; page = 1; await load(); }, "btn-ghost"), action("Refresh", async () => { await dashboard(); }, "btn-ghost"));
  main.append(stats, group("card", el("h2", "Registered users"), controls, content), el("small", "Installation activity records device API use; it does not track browser visits. Connected installations have unexpired credentials."));
  await load();
}
async function dashboard() {
  const ticket = ++generation;
  const active = current();
  const navbar = el("nav");
  navbar.setAttribute("aria-label", "Workspace");
  for (const [key, title] of Object.entries(views).filter(
    ([key]) => key !== "history" && (key !== "admin" || identity?.isAdmin),
  )) {
    const a = link("", route(key), "");
    const iconMarkup = ICONS[key === "contexts" ? "layers" : key === "admin" ? "people" : key];
    if (iconMarkup) a.append(renderIcon(iconMarkup));
    a.append(el("span", title));
    if (
      key === active.view ||
      (key === "contexts" && active.view === "history")
    )
      a.setAttribute("aria-current", "page");
    navbar.append(a);
  }
  const initials = identity?.account?.username
    ? identity.account.username.slice(0, 2).toUpperCase()
    : "KN";
  const avatar = el("div", initials, "account-avatar");
  const usernameLabel = el("span", "@" + (identity?.account?.username || "user"));
  const accountBox = group("account", avatar, usernameLabel);
  accountBox.append(link("Settings", route("settings"), "account-settings"));

  const main = group(
    "workspace",
    group(
      "bar",
      group("page-heading", el("span", active.view === "admin" ? "ADMINISTRATION" : "WORKSPACE", "eyebrow"), el("h1", views[active.view]), el("p", viewDescriptions[active.view], "page-description")),
      ...(active.view === "contexts"
        ? [action("Connect coding agents", connect, "primary")]
        : []),
    ),
  );
  main.id = "workspace";
  main.className += " view-" + active.view;
  main.tabIndex = -1;
  main.setAttribute("aria-busy", "true");
  const shell = group(
    "shell",
    siteHeader(),
    group(
      "sidebar",
      el("h2", "Workspace", "directory-title"),
      navbar,
      group("connect-callout", el("h3", "A different agent. The same thread."), el("p", "Bring your coding conversations together. Choose the projects you sync and the context you share."), action("Connect coding agents", connect, "primary")),
      accountBox,
    ),
    main,
    siteFooter(),
  );
  root.replaceChildren(shell);
  document.title = views[active.view] + " · Knitt";
  const loading = el("p", "Loading " + views[active.view].toLowerCase() + "…", "loading view-loading");
  loading.setAttribute("role", "status");
  main.append(loading);
  try {
    if (active.view === "people") await people(main);
    else if (active.view === "inbox") await inbox(main);
    else if (active.view === "settings") await settings(main);
    else if (active.view === "admin") await admin(main);
    else if (active.view === "history") await history(main, active);
    else await contexts(main, active);
  } catch (error) {
    if (ticket !== generation) return;
    if (error.status === 401) {
      identity = null;
      signIn();
      return;
    }
    main.append(
      group("card", el("p", error.message), action("Try again", dashboard, "primary")),
    );
  } finally {
    loading.remove?.();
    main.removeAttribute("aria-busy");
  }
}
async function boot() {
  try {
    identity = await api("me");
    if (!identity.account.username) username();
    else if (location.pathname === "/pair") await pairing();
    else await dashboard();
  } catch (error) {
    if (error.status === 401) signIn();
    else
      entry(
        el("h1", "Unable to open Knitt"),
        el("p", error.message),
        action("Try again", boot, "primary"),
        link("Go to dashboard", "/", "btn-ghost"),
      );
  } finally {
    root.removeAttribute("aria-busy");
  }
}
document.getElementById("skip-content")?.addEventListener("click", (event) => {
  event.preventDefault();
  (document.getElementById("workspace") || root).focus?.();
});
window.addEventListener("hashchange", () => {
  if (identity?.account.username) dashboard();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) boot();
});
boot();
