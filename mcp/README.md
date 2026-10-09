# Pages MCP 0.1.0

A9.2 implements personal stdio-token verification and protected HTTP with Pages
OAuth. The implemented tool catalog is empty. Business tools and release automation
belong to later stages.

Requires Node.js >=24; Node 24 LTS is the tested runtime. Copy the single
`pages-mcp-v0.1.0.js` outside every package tree declaring `"type": "module"`.
No checkout, `package.json`, `node_modules` or installation is needed at runtime.
The bundle is CommonJS, includes JavaScript dependencies, and leaves Node built-ins
external. Compare its SHA-256 with the build evidence.

## stdio

Run `node /path/to/pages-mcp-v0.1.0.js` with the following client environment:

- `PAGES_URL`: absolute instance base URL, optionally with a deployment prefix.
  HTTPS is required; HTTP is allowed for localhost, 127.0.0.1 and [::1].
  User information, query, fragment and surrounding whitespace are rejected.
- `PAGES_TOKEN`: an owner-bound personal token created through Pages. Pages verifies
  identity, expiry, revocation and current rights before startup and every tool
  list/call. A syntactically valid credential alone cannot authenticate.

Startup failures have a nonzero exit status and fixed, credential-free stderr
text. stdout is reserved for MCP. Closing stdin releases the transport and ends
the process. The pinned SDK supports both legacy initialization and current MCP.

## Protected HTTP

Start the same bundle with `--http --resource https://mcp.example.com/mcp`, optionally
`--port 8998`. Set `PAGES_URL` to the Pages authorization server's origin. HTTP mode
ignores `PAGES_TOKEN`. The listener binds only 127.0.0.1 (default port 8998).
A trusted reverse proxy must terminate HTTPS and preserve Host and Authorization.
There is no hosting configuration or deployment in A9.2.

Configure Pages with `PAGES_OAUTH_ISSUER` (the exact origin without a trailing slash)
and `PAGES_MCP_RESOURCE` (the exact public `/mcp` URL). These are public URLs, not
credentials. HTTPS is required except on loopback. Missing configuration closes
the OAuth boundary while ordinary Pages and personal stdio tokens remain usable.

The resource publishes `/.well-known/oauth-protected-resource` and
`/.well-known/oauth-protected-resource/mcp`. Anonymous/invalid requests receive a
401 Bearer challenge with `resource_metadata` and `scope="mcp:connect"`. Pages
publishes `/.well-known/oauth-authorization-server` with authorization, token and
registration endpoints. Host, Origin and query-string checks precede authentication;
no unrestricted CORS is enabled.

Public clients use Authorization Code with S256 PKCE and no client secret. CIMD URL
client identities are preferred; `POST /oauth/register` provides DCR compatibility.
Redirect URIs match exactly, use HTTPS or loopback HTTP, and contain no user
information or fragment. CIMD requires a matching `client_id`, a public HTTPS
location, pinned public DNS resolution, no redirects, and bounded JSON.

`GET /oauth/authorize` starts a process limited to 15 minutes before Pages login.
The existing Pages login returns only to the internal consent page. The user sees
client name/identity, exact MCP resource and `mcp:connect`, then explicitly approves
or denies. Approval is bound to the user, browser session and CSRF nonce.
Authorization codes are single-use, expire after at most 60 seconds, and are
bound to client, redirect URI, resource and PKCE verifier. Access tokens expire
after 600 seconds. A refresh token is issued only when `grant_types` includes
`refresh_token`; every refresh rotates it. Reusing any consumed refresh token
revokes the entire grant, including access and delegation credentials.

The MCP process submits the OAuth access credential only as `subject_token` to
`POST /oauth/delegate`, with the exact `resource`. This dedicated endpoint verifies
its issuing Pages instance, audience, lifetime, consent and identity. It returns
a separate opaque Pages-API delegation credential valid for at most 60 seconds,
never beyond the access credential's expiry. The MCP OAuth credential is never an
API Bearer credential. Every API call rechecks grant state and current user rights.
Unavailable verification fails closed; there is no positive identity/rights cache.

The personal admin property counts on the MCP path regardless of browser role
mode. Existing Pages UI policy remains unchanged. Non-admin identities retain only
current role grants. All unimplemented business operations are denied server-side.

## Owner management APIs

Browser-session APIs require same-origin JSON POSTs; credentials cannot act as
browser sessions. All credential-bearing and management responses use no-store.

| Endpoint                  | Method | Request / result                                         |
| ------------------------- | ------ | -------------------------------------------------------- |
| `/api/v1/personal-tokens` | GET    | Owner's public token summaries                           |
| `/api/v1/personal-tokens` | POST   | `{operation:"create", name, expiresAt}`                  |
| `/api/v1/personal-tokens` | POST   | `{operation:"rotate", id}` or `{operation:"revoke", id}` |
| `/api/v1/mcp-settings`    | GET    | `{durationSeconds, grants}` for the owner                |
| `/api/v1/mcp-settings`    | POST   | `{operation:"set-duration", durationSeconds}`            |
| `/api/v1/mcp-settings`    | POST   | `{operation:"revoke", id}`                               |
| `/api/v1/agents`          | POST   | Bearer + `{operation:"verify", parameters:{}}`           |

Personal token names contain 1–100 trimmed characters; `expiresAt` is a future
Unix timestamp in milliseconds or null for unlimited. Creation/rotation returns
`{token, summary}` once; lists omit both token and hash. Summaries contain owner,
name, created/expiry/revocation timestamps and effective status. Rotation revokes
the old credential atomically without overlap and retains its original expiry.
Expired/revoked tokens cannot be rotated. Only SHA-256 hashes of random 256-bit
credentials are persisted.

The HTTP grant duration defaults to 86400 seconds until configured. A positive
integer up to ten years or null for unlimited is accepted. A setting change
first expires grants under the previous rule, then changes all remaining active
grant deadlines relative to their original verification time. Shortening may
expire them immediately; longer/unlimited durations never revive expired or
revoked grants. Access-token lifetime remains independent. Personal token/settings
UI is outside this stage; the explicit OAuth consent screen is included.

`/api/v1/agents` accepts only personal stdio or API delegation credentials, never
browser cookies or MCP OAuth access tokens. It verifies before body parsing and
returns `{apiVersion:"1", identity:{userId,isAdmin,permissions}, tools:[]}` only for
`verify`. Stable failures use `{apiVersion:"1", error:{code,message,retryable:false}}`:
`AUTH_REQUIRED`, `AUTH_INVALID`, `AUTH_UNAVAILABLE`, `INVALID_REQUEST`, `FORBIDDEN`,
`METHOD_NOT_ALLOWED`. Every response includes no-store and nosniff headers.

## Package checks

```sh
pnpm --dir mcp install --frozen-lockfile
pnpm --dir mcp check
pnpm --dir mcp build
```

This independent package has its own manifest, lockfile, TypeScript configuration
and build. Dependency age remains ten days; SDK 2.2.0 is unchanged. Package version
supplies both the filename and MCP `serverInfo.version`; API version remains `1`.
Root lint and 100% per-file coverage gates include package source. The
[official authorization profile](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
and [pinned SDK HTTP entry](https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.2.0/docs/serving/http.md)
provide the protocol basis. Test clients, user/login state and metadata requests
are isolated or faked; no real account or provider credential is needed.
