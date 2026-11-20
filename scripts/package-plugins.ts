import {
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  mkdtempSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  targets,
  hostFiles,
  verifyArchive,
  copyPluginDist,
  type Host,
} from "./plugin-package-lib.ts";
const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const version = JSON.parse(
  readFileSync(join(project, "package.json"), "utf8"),
).version;
const nodeVersion = "24.18.0";
const out = resolve(
  process.env.KNITT_PLUGIN_OUTPUT ?? join(project, "plugin-artifacts"),
);
const requested = process.argv.slice(2);
const selected = requested.length
  ? requested
  : [`${process.platform}-${process.arch}`];
for (const target of selected)
  if (!(targets as readonly string[]).includes(target))
    throw new Error("Unsupported target " + target);
mkdirSync(out, { recursive: true });
const cache = join(out, ".runtime-cache");
mkdirSync(cache, { recursive: true });
async function download(name: string) {
  const path = join(cache, name);
  if (existsSync(path)) return readFileSync(path);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(
        `https://nodejs.org/dist/v${nodeVersion}/${name}`,
        {
          signal: AbortSignal.timeout(60_000),
        },
      );
      if (!response.ok)
        throw new Error(`Node download ${name}: ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      writeFileSync(path, bytes);
      return bytes;
    } catch (error) {
      if (attempt === 3) throw error;
      console.error(`Retrying Node download ${name} after attempt ${attempt}`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw new Error(`Node download failed: ${name}`);
}
const sums = (await download("SHASUMS256.txt")).toString();
for (const target of selected) {
  const windows = target.startsWith("win32");
  const platform = target.replace("win32", "win");
  // Only the binary and license are extracted. tar never writes archive paths to disk.
  const archive = `node-v${nodeVersion}-${platform}.${windows ? "zip" : "tar.xz"}`;
  const bytes = await download(archive);
  const sha256 = verifyArchive(bytes, sums, archive);
  const scratch = mkdtempSync(join(tmpdir(), "knitt-runtime-"));
  try {
    cpSync(join(project, "package.json"), join(scratch, "package.json"));
    cpSync(
      join(project, "package-lock.json"),
      join(scratch, "package-lock.json"),
    );
    execFileSync(
      "npm",
      [
        "ci",
        "--omit=dev",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--prefix",
        scratch,
      ],
      { stdio: "pipe", env: process.env },
    );
    const archivePath = join(cache, archive);
    const prefix = `node-v${nodeVersion}-${platform}`;
    const runtime = windows
      ? execFileSync("unzip", ["-p", archivePath, `${prefix}/node.exe`], {
          maxBuffer: 256 * 1024 * 1024,
        })
      : execFileSync("tar", ["-xOJf", archivePath, `${prefix}/bin/node`], {
          maxBuffer: 256 * 1024 * 1024,
        });
    const license = windows
      ? execFileSync("unzip", ["-p", archivePath, `${prefix}/LICENSE`])
      : execFileSync("tar", ["-xOJf", archivePath, `${prefix}/LICENSE`]);
    const root = join(out, target);
    mkdirSync(root, { recursive: true });
    for (const host of ["codex", "claude-code", "antigravity"] as Host[]) {
      const destination = join(root, "plugins", host, "knitt");
      rmSync(destination, { recursive: true, force: true });
      mkdirSync(destination, { recursive: true });
      for (const [name, contents] of Object.entries(
        hostFiles(host, target, version),
      )) {
        mkdirSync(resolve(destination, name, ".."), { recursive: true });
        writeFileSync(join(destination, name), contents);
      }
      mkdirSync(join(destination, "scripts"), { recursive: true });
      writeFileSync(
        join(destination, "scripts", windows ? "node.exe" : "node"),
        runtime,
      );
      chmodSync(
        join(destination, "scripts", windows ? "node.exe" : "node"),
        0o755,
      );
      writeFileSync(join(destination, "scripts", "NODE-LICENSE"), license);
      cpSync(join(project, "LICENSE"), join(destination, "LICENSE"));
      copyPluginDist(join(project, "dist"), join(destination, "dist"));
      cpSync(join(project, "plugins/skills"), join(destination, "skills"), {
        recursive: true,
      });
      cpSync(join(project, "skills/knit"), join(destination, "skills/knit"), {
        recursive: true,
      });
      writeFileSync(
        join(destination, "package.json"),
        JSON.stringify({ private: true, type: "module" }),
      );
      cpSync(join(scratch, "node_modules"), join(destination, "node_modules"), {
        recursive: true,
      });
      writeFileSync(
        join(destination, "runtime-provenance.json"),
        JSON.stringify(
          {
            nodeVersion,
            archive,
            url: `https://nodejs.org/dist/v${nodeVersion}/${archive}`,
            sha256,
            target,
          },
          null,
          2,
        ),
      );
      const artifact = join(out, `knitt-${version}-${host}-${target}.tar.gz`);
      execFileSync("tar", [
        "-czf",
        artifact,
        "-C",
        join(root, "plugins", host),
        "knitt",
      ]);
      writeFileSync(
        artifact + ".sha256",
        createHash("sha256").update(readFileSync(artifact)).digest("hex") +
          "  " +
          artifact.split("/").at(-1) +
          "\n",
      );
    }
    const codex = {
      name: "knitt-local",
      interface: { displayName: "Knitt development" },
      plugins: [
        {
          name: "knitt",
          source: { source: "local", path: "./plugins/codex/knitt" },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Productivity",
        },
      ],
    };
    mkdirSync(join(root, ".agents/plugins"), { recursive: true });
    writeFileSync(
      join(root, ".agents/plugins/marketplace.json"),
      JSON.stringify(codex, null, 2),
    );
    mkdirSync(join(root, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(root, ".claude-plugin/marketplace.json"),
      JSON.stringify(
        {
          name: "knitt-local",
          owner: { name: "Knitt" },
          plugins: [
            {
              name: "knitt",
              source: "./plugins/claude-code/knitt",
              description: "Full conversation memory",
            },
          ],
        },
        null,
        2,
      ),
    );
    console.log(`Built ${target}: ${root}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
