import { z } from "zod";

/** Identifies exact loopback hosts for MCP HTTP and OAuth redirect validation. */
export function isLoopbackUrl(url: URL): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

/** Public DCR only: exact redirect matching, no remote metadata retrieval or client secrets. */
export const oauthClientSchema = z.object({
  client_name: z.string().trim().min(1).max(100),
  redirect_uris: z
    .array(
      z.url().refine((text) => {
        const url = new URL(text);
        return (
          !url.hash &&
          !url.username &&
          !url.password &&
          (url.protocol === "https:" ||
            (url.protocol === "http:" && isLoopbackUrl(url)))
        );
      }),
    )
    .min(1)
    .max(10),
  token_endpoint_auth_method: z.literal("none").default("none"),
  grant_types: z
    .array(z.enum(["authorization_code", "refresh_token"]))
    .min(1)
    .max(2)
    .refine(
      (grants) =>
        grants.includes("authorization_code") &&
        new Set(grants).size === grants.length,
    )
    .transform(() => ["authorization_code"])
    .default(["authorization_code"]),
  response_types: z.array(z.literal("code")).length(1).default(["code"]),
  scope: z.literal("pages").optional(),
});

/** Validated public client registration metadata. */
export type OAuthClientMetadata = z.infer<typeof oauthClientSchema>;

/** Server-owned, bounded authorization parameters retained until explicit consent. */
export const oauthRequestSchema = z.object({
  client_id: z.string().min(1).max(100),
  redirect_uri: z.string().min(1).max(2048),
  response_type: z.literal("code"),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  code_challenge_method: z.literal("S256"),
  state: z.string().min(1).max(1024),
  resource: z.string().max(2048),
  scope: z.literal("pages").default("pages"),
});

/** Validated authorization request; it never contains an access credential. */
export type OAuthAuthorizationRequest = z.infer<typeof oauthRequestSchema>;

/** Persistence contract for a short-lived code, with its resource and PKCE binding. */
export const oauthCodeSchema = z.object({
  clientId: z.string(),
  userId: z.string(),
  redirectUri: z.string(),
  codeChallenge: z.string(),
  resource: z.string(),
});

/** Parameters associated with a hashed, single-use authorization code. */
export type OAuthCodeParameters = z.infer<typeof oauthCodeSchema>;
