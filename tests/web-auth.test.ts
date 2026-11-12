import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from "jose";
import { createOAuthVerifier } from "../apps/server/src/web-auth.ts";

test("web connector validates issuer, audience, expiry and allowed identity", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const verifier = createOAuthVerifier({
    issuer: "https://identity.example", resource: new URL("https://memory.example/mcp"),
    subjects: ["owner"], getKey: createLocalJWKSet({ keys: [{ ...jwk, kid: "test" }] }),
  });
  const sign = (subject: string, audience: string, expires: number, issuer = "https://identity.example") =>
    new SignJWT({ scope: "memory:read memory:write" }).setProtectedHeader({ alg: "RS256", kid: "test" })
      .setSubject(subject).setIssuer(issuer).setAudience(audience).setExpirationTime(expires).sign(privateKey);
  const now = Math.floor(Date.now() / 1000);
  const good = await verifier.verifyAccessToken(await sign("owner", "https://memory.example/mcp", now + 60));
  assert.deepEqual(good.scopes, ["memory:read", "memory:write"]);
  assert.ok(good.extra?.ownerId);
  for (const args of [
    ["stranger", "https://memory.example/mcp", now + 60],
    ["owner", "https://wrong.example/mcp", now + 60],
    ["owner", "https://memory.example/mcp", now - 60],
    ["owner", "https://memory.example/mcp", now + 60, "https://wrong-issuer.example"],
  ] as const) {
    await assert.rejects(verifier.verifyAccessToken(await sign(args[0], args[1], args[2], args.length === 4 ? args[3] : undefined)));
  }
  await assert.rejects(verifier.verifyAccessToken("invalid"));
});
