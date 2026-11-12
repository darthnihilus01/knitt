"""Prepare or apply repository-scoped Antigravity and Codex connections."""
import argparse
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tomllib

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--workspace", type=Path, default=Path.cwd())
parser.add_argument("--app-root", type=Path, default=Path(__file__).resolve().parents[1])
parser.add_argument("--node", required=True)
parser.add_argument("--repo-id", required=True)
parser.add_argument("--apply", action="store_true")
parser.add_argument("--client", choices=["both", "codex", "antigravity"], default="both")
parser.add_argument("--feature-id")
parser.add_argument("--database", type=Path)
args = parser.parse_args()
workspace = args.workspace.resolve()
app = args.app_root.resolve()
node = str(Path(args.node).resolve())
runner = str(app / "packages/adapters/src/cli.ts")
server = str(app / "apps/server/src/main.ts")
database = str(args.database.resolve() if args.database else app / ".memory/events.sqlite")
if not workspace.is_dir() or not Path(node).is_file() or not Path(server).is_file():
    sys.exit("Workspace, Node executable and memory application must exist")
if not 0 < len(args.repo_id) <= 256:
    sys.exit("repo-id must contain between 1 and 256 characters")

def hook(client, action):
    feature = ["MEMORY_FEATURE=" + args.feature_id] if args.feature_id else []
    return shlex.join(["env", *feature, "MEMORY_REPO=" + args.repo_id,
        "MEMORY_WORKSPACE=" + str(workspace), "MEMORY_DB=" + database, "MEMORY_QUEUE=" + str(app / ".memory/queue" / client),
        node, runner, action, client])

def handler(client, action):
    return {"type": "command", "command": hook(client, action), "timeout": 10}

def existing(relative):
    path = workspace / relative
    return path.read_text() if path.exists() else None

def json_file(relative):
    text = existing(relative)
    value = json.loads(text) if text is not None else {}
    if not isinstance(value, dict):
        raise ValueError(str(relative) + " must contain a JSON object")
    return value

def is_ours(item):
    return isinstance(item, dict) and runner in item.get("command", "")

def dump(data):
    return json.dumps(data, indent=2) + "\n"

try:
    changes = {}
    if args.client in ["both", "antigravity"]:
        antigravity = json_file(".agents/hooks.json")
        previous = antigravity.get("shared-memory")
        if previous and not all(is_ours(h) for event in ["SessionStart", "Stop"] for h in previous.get(event, [])):
            raise ValueError("An unrelated Antigravity shared-memory hook already exists")
        antigravity["shared-memory"] = {
            "SessionStart": [handler("antigravity", "recall")],
            "Stop": [handler("antigravity", "capture")],
        }
        changes[".agents/hooks.json"] = dump(antigravity)

        mcp = json_file(".agents/mcp_config.json")
        servers = mcp.setdefault("mcpServers", {})
        connection = {"command": node, "args": [server], "cwd": str(workspace), "env": {"MEMORY_DB": database, "MEMORY_REPO": args.repo_id, **({"MEMORY_FEATURE": args.feature_id} if args.feature_id else {})}}
        if "shared-memory" in servers and servers["shared-memory"].get("args") != [server]:
            raise ValueError("An unrelated Antigravity shared-memory server already exists")
        servers["shared-memory"] = connection
        changes[".agents/mcp_config.json"] = dump(mcp)

    if args.client in ["both", "codex"]:
        codex = json_file(".codex/hooks.json")
        hooks = codex.setdefault("hooks", {})
        for event, action in [("SessionStart", "recall"), ("Stop", "capture")]:
            groups = []
            for group in hooks.get(event, []):
                remaining = [h for h in group.get("hooks", []) if not is_ours(h)]
                if remaining:
                    groups.append({**group, "hooks": remaining})
            groups.append({"hooks": [handler("codex", action)]})
            hooks[event] = groups
        changes[".codex/hooks.json"] = dump(codex)

        original = existing(".codex/config.toml") or ""
        start, end = "# BEGIN shared-agent-memory", "# END shared-agent-memory"
        if start in original and end in original:
            begin, rest = original.split(start, 1)
            _, tail = rest.split(end, 1)
            original = begin.rstrip() + tail
        elif "shared-memory" in tomllib.loads(original).get("mcp_servers", {}):
            raise ValueError("An unmanaged Codex shared-memory server already exists")
        block = (
            start + "\n[mcp_servers.shared-memory]\ndefault_tools_approval_mode = \"writes\"\n"
            + "command = " + json.dumps(node) + "\n"
            + "args = " + json.dumps([server]) + "\n"
            + "cwd = " + json.dumps(str(workspace)) + "\n"
            + "env = { MEMORY_DB = " + json.dumps(database) + ", MEMORY_REPO = " + json.dumps(args.repo_id)
            + (", MEMORY_FEATURE = " + json.dumps(args.feature_id) if args.feature_id else "") + " }\n" + end + "\n"
        )
        new_toml = original.rstrip() + "\n\n" + block
        tomllib.loads(new_toml)
        changes[".codex/config.toml"] = new_toml

    for relative, content in changes.items():
        print(("update " if existing(relative) != content else "unchanged ") + str(workspace / relative))
    if args.apply:
        private = workspace / ".memory"
        private.mkdir(mode=0o700, exist_ok=True)
        backup = private / "connection-backup.json"
        if not backup.exists():
            with backup.open("x") as f:
                os.chmod(backup, 0o600)
                json.dump({relative: existing(relative) for relative in changes}, f, indent=2)
        written = []
        before = {relative: existing(relative) for relative in changes}
        try:
            for relative, content in changes.items():
                if before[relative] == content:
                    continue
                path = workspace / relative
                path.parent.mkdir(exist_ok=True)
                temporary = path.with_suffix(path.suffix + ".shared-memory-tmp")
                temporary.write_text(content)
                os.chmod(temporary, 0o600)
                os.replace(temporary, path)
                written.append(relative)
        except Exception:
            for relative in reversed(written):
                path = workspace / relative
                if before[relative] is None:
                    path.unlink()
                else:
                    path.write_text(before[relative])
            raise
        git_dir = subprocess.run(["git", "-C", str(workspace), "rev-parse", "--absolute-git-dir"], capture_output=True, text=True)
        if git_dir.returncode == 0:
            exclude = Path(git_dir.stdout.strip()) / "info/exclude"
            exclude.parent.mkdir(exist_ok=True)
            ignored = exclude.read_text() if exclude.exists() else ""
            entries = ["/.memory/", *["/" + name for name in changes]]
            additions = [entry for entry in entries if entry not in ignored.splitlines()]
            if additions:
                with exclude.open("a") as f:
                    f.write("\n# Local shared-agent-memory connection\n" + "\n".join(additions) + "\n")
        print("Installed. Review Codex hooks in /hooks or Settings > Hooks. Start fresh agent sessions.")
    else:
        print("Preview only. Add --apply to install these repository-scoped entries.")
except (ValueError, OSError, TypeError, KeyError) as error:
    sys.exit(str(error))
