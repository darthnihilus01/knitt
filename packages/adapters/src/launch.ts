export function codexLaunch(workspace: string, selection?: { featureId: string; title: string }) {
  return {
    command: "codex",
    env: selection ? { MEMORY_LAUNCH_FEATURE: selection.featureId, MEMORY_LAUNCH_TITLE: selection.title } : {},
    args: [
      "--no-daemon", "--cd", workspace,
      "Continue the imported Antigravity conversation. Verify this repository and the correct branch before making changes. If the task needs a different checkout, report its path and wait for it to be opened.",
    ],
  };
}

export function displayCommand(command: string, args: string[]) {
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  return [command, ...args].map(quote).join(" ");
}
