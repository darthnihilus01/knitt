import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";

export function createOAuthVerifier(options: {
  issuer: string; resource: URL; subjects: string[]; jwks?: URL; getKey?: JWTVerifyGetKey;
}): OAuthTokenVerifier {
  if (!options.subjects.length) throw new Error("Configure at least one allowed OAuth subject");
  if (!options.getKey && !options.jwks) throw new Error("The OAuth provider must publish a JWKS endpoint");
  const getKey = options.getKey ?? createRemoteJWKSet(options.jwks!);
  return {
    async verifyAccessToken(token) {
      try {
        const { payload } = await jwtVerify(token, getKey, {
          issuer: options.issuer, audience: options.resource.href, algorithms: ["RS256", "ES256"],
        });
        if (!payload.sub || !options.subjects.includes(payload.sub) || typeof payload.exp !== "number") throw new Error("Identity or expiry missing");
        const scopes = typeof payload.scope === "string" ? payload.scope.split(/\s+/) : [];
        return {
          token, clientId: typeof payload.azp === "string" ? payload.azp : payload.sub,
          scopes, expiresAt: payload.exp, resource: options.resource,
          extra: { ownerId: createHash("sha256").update(options.issuer + "\0" + payload.sub).digest("hex") },
        };
      } catch { throw new InvalidTokenError("Access token is invalid for this connector"); }
    },
  };
}
