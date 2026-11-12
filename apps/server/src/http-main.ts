import { readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { discoverAuthorizationServerMetadata } from "@modelcontextprotocol/sdk/client/auth.js";
import { OAuthMetadataSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
import { createOAuthVerifier } from "./web-auth.ts";
import { createGateway } from "./http-gateway.ts";

const httpsUrl = z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.hash && !url.search;
}, "Use an HTTPS URL without credentials, query or fragment");
const serverProfile = z.object({
  repoId: z.string().min(1).max(256), workspace: z.string().min(1), database: z.string().min(1),
  publicUrl: httpsUrl, issuer: httpsUrl, allowedSubjects: z.array(z.string().min(1)).min(1),
});
try {
  const { values } = parseArgs({ options: { profile: { type: "string" }, port: { type: "string", default: "8787" } } });
  if (!values.profile) throw new Error("Pass --profile from npm run connect -- --client chatgpt");
  const profile = serverProfile.parse(JSON.parse(readFileSync(values.profile, "utf8")).server);
  const resource = new URL(profile.publicUrl);
  if (resource.pathname !== "/mcp") throw new Error("Public MCP URL must end with /mcp");
  const discovered = await discoverAuthorizationServerMetadata(profile.issuer);
  if (!discovered || discovered.issuer !== profile.issuer) throw new Error("OAuth discovery must return the configured issuer");
  const metadata = OAuthMetadataSchema.parse(discovered);
  if (!metadata.code_challenge_methods_supported?.includes("S256")) throw new Error("OAuth provider must support PKCE S256");
  const jwks = new URL(z.object({ jwks_uri: httpsUrl }).parse(discovered).jwks_uri);
  mkdirSync(dirname(profile.database), { recursive: true, mode: 0o700 });
  const verifier = createOAuthVerifier({ issuer: profile.issuer, resource, subjects: profile.allowedSubjects, jwks });
  const app = createGateway({ resource, repoId: profile.repoId, workspace: profile.workspace, database: profile.database, metadata, verifier });
  const port = z.coerce.number().int().min(1).max(65535).parse(values.port);
  const listener = app.listen(port, "127.0.0.1", () => {
    console.log("Authenticated MCP gateway listening on 127.0.0.1:" + port);
    console.log("Configure your HTTPS proxy to forward " + resource.href + " and its metadata/picker routes to this server.");
  });
  process.on("SIGINT", () => { listener.close(); });
  process.on("SIGTERM", () => { listener.close(); });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
