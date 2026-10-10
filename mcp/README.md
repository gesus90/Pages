# Pages MCP 0.1.0

One bundle serves local clients over stdio and shared instances over Streamable
HTTP behind an HTTPS reverse proxy. Authentication is a personal token for stdio
and Pages OAuth for HTTP. The package exposes exactly one read-only function,
`list_project_names`; further business tools belong to later stages. Releases are
published from `mcp-vMAJOR.MINOR.PATCH` tags (see Releases below).

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
`--port 8998` and `--host 127.0.0.1`. Set `PAGES_URL` to the Pages authorization
server's origin. HTTP mode ignores `PAGES_TOKEN`. The listener serves `/mcp` and binds
only a loopback address: `127.0.0.1` by default on port 8998. `--host` accepts
exactly `127.0.0.1`, `::1` or `localhost`; any other value (for example `0.0.0.0`) is
a startup error that names the option and never echoes its value. The port is free
to choose, and the options may appear in any order. Plain HTTP is therefore
loopback-only; remote clients always use HTTPS through a reverse proxy.

### Remote operation behind an HTTPS reverse proxy

TLS ends at a trusted reverse proxy on the same machine; the proxy forwards to the
loopback listener. Do not publish the listener on a non-loopback address, do not
forward it with a plain TCP/port mapping, and never put tokens into URLs or logs.

- Public URL: `https://mcp.example.com/mcp`, the same value passed as `--resource`
  and configured in Pages as `PAGES_MCP_RESOURCE`. The certificate must match that
  name and be trusted by the clients; a DNS name with a valid certificate is
  recommended. The `/.well-known/oauth-protected-resource` paths are served by the
  same listener and must be forwarded too.
- Target: `127.0.0.1:8998` (or the chosen loopback `--host`/`--port`).
- The proxy must pass `Host` unchanged (the listener rejects any other Host with 403) and must pass `Authorization` unchanged. Origin is checked and no CORS
  wildcard is offered; query strings on `/mcp` are rejected.

```nginx
server {
    listen 443 ssl;
    server_name mcp.example.com;
    # ssl_certificate and ssl_certificate_key for mcp.example.com

    location / {
        proxy_pass http://127.0.0.1:8998;
        proxy_set_header Host $http_host;
        proxy_set_header Authorization $http_authorization;
        proxy_http_version 1.1;
    }
}
```

Known limitation: Pages itself behind a TLS-terminating proxy. Pages builds request
URLs from the connection it sees (plain HTTP behind the proxy), and React Router
answers a browser form post with 400 when the `Origin` scheme (https) differs from
that URL. Until Pages offers a trusted-proxy or allowed-origin setting, this blocks
the Pages login and the OAuth consent page when the public Pages URL is HTTPS; it
does not affect the MCP listener. Verified only on a local loopback topology.

Without a Bearer credential `/mcp` answers 401 JSON with `Cache-Control: no-store`.
OpenClaw 2026.9.8 allows private or loopback targets only for the origin of the
configured MCP URL and blocks an authorization server on another private origin
(A9.3-E12). Public HTTPS names are not private; run Pages OAuth and the MCP
resource under public HTTPS names, or serve both below one origin.

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
mode: an administrator in role mode sees every active project through
`projects.names.list`. Existing Pages UI policy remains unchanged. Non-admin
identities see what the existing project read rules allow (department scope, role
binding, `allProjects`). All unimplemented business operations are denied server-side.

## Tool: `list_project_names`

The bundle exposes one tool, `list_project_names`, without arguments. It is read-only
(`readOnlyHint`) and returns a text content block holding a JSON array of project
names, for example `["Alpha plan","Shared project"]`. `tools/list` shows the tool only
when Pages offers it to the verified identity; every list and call verifies the
credential anew. Any Pages failure (invalid, expired or revoked credential, unreachable
Pages) becomes the fixed error "Pages authorization failed." without project data.
Unknown tool names and any argument are rejected with a protocol error.

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
dispatches two operations:

- `verify` returns `{apiVersion:"1", identity:{userId,isAdmin,permissions}, tools:["projects.names.list"]}`;
  `tools` lists the business operations Pages currently offers to that identity.
- `projects.names.list` (parameters `{}`) returns `{apiVersion:"1", projectNames:[...]}`:
  only the names of the active projects its owner may read, in Pages' project order.
  No identifiers, descriptions or content are returned.

Stable failures use `{apiVersion:"1", error:{code,message,retryable:false}}`:
`AUTH_REQUIRED`, `AUTH_INVALID`, `AUTH_UNAVAILABLE`, `INVALID_REQUEST`, `FORBIDDEN`,
`METHOD_NOT_ALLOWED`. Every response includes no-store and nosniff headers.

## Client examples

`examples/clients/` holds one file per client with placeholders only: instance URL,
bundle path and a reference to the token variable. Replace `pages.example.com`,
`mcp.example.com` and the bundle path; never commit a token.

| File                  | Client     | stdio (token from the environment) | HTTP (OAuth)                        |
| --------------------- | ---------- | ---------------------------------- | ----------------------------------- |
| `claude-cli.mcp.json` | Claude CLI | `${PAGES_TOKEN}` expansion         | `type: http`, authenticate in-app   |
| `codex-config.toml`   | Codex      | `env_vars = ["PAGES_TOKEN"]`       | `url`, then `codex mcp login`       |
| `openclaw.json`       | OpenClaw 2 | `${PAGES_TOKEN}` expansion         | `auth: oauth`, `openclaw mcp login` |
| `opencode.json`       | OpenCode   | `{env:PAGES_TOKEN}`                | `type: remote`, `opencode mcp auth` |

## Releases

Tag a commit as `mcp-vMAJOR.MINOR.PATCH` (for example `mcp-v0.2.0`). GitHub Actions
runs the same gates as the CI for pull requests and `main`, then builds the package
in an isolated working copy whose `package.json` and README carry the tag's version,
builds the bundle twice and compares both SHA-256 values, and only after all of that
publishes a GitHub Release with `pages-mcp-v<version>.zip` and
`pages-mcp-v<version>.zip.sha256`. An invalid tag or a failing check publishes
nothing, nothing is committed to `main`, and no npm package is published. The tag is
the only source of the version; the version in the repository's `mcp/package.json`
is the development default.

The archive contains one folder `pages-mcp-v<version>/` with the bundle,
`pages-mcp-v<version>.js.sha256`, a runtime `package.json` (CommonJS, so the bundle
starts next to it), this README and `examples/clients/`. No token or instance URL is
built in; the packaging script fails when a configured value or an address outside
the placeholder hosts would be archived.

```sh
sha256sum --check pages-mcp-v<version>.zip.sha256
unzip pages-mcp-v<version>.zip
node pages-mcp-v<version>/pages-mcp-v<version>.js   # configured by environment, see above
```

Locally, `node mcp/scripts/package-release.ts package mcp-vX.Y.Z <output-directory>`
produces the same archive after `pnpm --dir mcp install --frozen-lockfile`;
`node mcp/scripts/package-release.ts tag <tag>` only validates a tag.

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

## Project and wiki reads (A9.5)

The existing `list_project_names` tool still returns names only. The additional
read-only tools use the same stdio and OAuth transports and verify current rights
on every call. Reading wiki content does not record a visit.

| Tool              | Pages operation    | Arguments                    | Result                                                                               |
| ----------------- | ------------------ | ---------------------------- | ------------------------------------------------------------------------------------ |
| `resolve_project` | `projects.resolve` | `name`                       | Exact trimmed, case-sensitive visible project ID and name                            |
| `read_project`    | `projects.read`    | `projectId`                  | ID, name, description, status, progress, start and target dates                      |
| `read_wiki_page`  | `wiki.page.read`   | `pageId`                     | ID, title, complete Markdown, revision, parent, scope and project ID                 |
| `read_wiki_tree`  | `wiki.tree.read`   | Optional `projectId`         | At most 100 visible nodes (`id`, `title`, `parentId`), visible total and `truncated` |
| `search_wiki`     | `wiki.search`      | `text`, optional `projectId` | At most 20 visible hits (`id`, `title`, `snippet`), visible total and `truncated`    |

These operations return `{apiVersion:"1",result}`. Arguments are strict; texts and
IDs accept at most 200 Unicode characters. An optional project must itself be
visible and active. A tree parent outside the returned project/window is `null`.
Search snippets contain at most 200 Unicode characters. Counts use the same
visibility policy as the nodes and snippets, including anchors and ancestors.

Ambiguous project names return `AMBIGUOUS` (HTTP 409), with at most 100 visible
`error.details.candidates` containing IDs and names, sorted by ID, and `truncated`.
The client must choose explicitly. Hidden and missing targets both return
`NOT_FOUND` (404), including another person's private wiki page. Personal admins
use their administrator scope regardless of their stored UI mode; private content
continues to belong to its owner. The UI mode remains unchanged.

The complete request envelope is limited to 65,536 UTF-8 bytes before parsing.
New read response envelopes are limited to 1,048,576 UTF-8 bytes. Oversized content
returns `PAYLOAD_TOO_LARGE` (413); Markdown is never silently truncated. Unknown
operations and invalid arguments return `INVALID_REQUEST` (400). MCP business
errors expose the stable code and visible ambiguity choices; authentication and
provider failures use a fixed diagnostic. No write, asset, import or SSE operation
is added by A9.5.
