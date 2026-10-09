# Pages MCP 0.1.0

Foundation only: a stdio MCP connection with an empty tool list. Local configuration
validation does not authenticate a Pages user. No business operation is available.

Requires Node.js >=24; Node 24 LTS is the tested runtime. Copy the single
`pages-mcp-v0.1.0.js` bundle outside every package tree that declares
`"type": "module"`, then run `node /path/to/pages-mcp-v0.1.0.js`. No checkout,
`package.json`, `node_modules` or dependency installation is needed at runtime.
The bundle is CommonJS, includes its JavaScript runtime dependencies and leaves
Node built-ins external. Verify its SHA-256 against the accompanying evidence.

Provide exactly these configuration variables through your MCP client's environment:

- `PAGES_URL`: absolute instance base URL, optionally with a deployment prefix.
  HTTPS is required; HTTP is allowed for `localhost`, `127.0.0.1` and `[::1]`.
  User credentials, queries, fragments and surrounding whitespace are rejected.
- `PAGES_TOKEN`: nonempty opaque Bearer credential using the RFC 6750 character
  set, without whitespace. This checks header compatibility only; no token is
  issued, verified or persisted in A9.1.

Missing or invalid settings fail before stdio opens, with a nonzero exit code and
a fixed diagnostic on stderr. stdout carries only MCP messages. Closing stdin
ends the connection and releases the SDK transport. Startup does not contact Pages.
The SDK's `serveStdio` entry supports legacy initialization and current discovery.

From the repository, install and validate this independent package:

```sh
pnpm --dir mcp install --frozen-lockfile
pnpm --dir mcp check
pnpm --dir mcp build
```

The package has its own manifest, lockfile, TypeScript configuration and build.
Its dependency-age policy matches the repository's ten-day minimum. The official
server SDK is pinned to 2.2.0 (published 2026-09-28), rather than younger releases.
The manifest version supplies both the bundle filename and MCP `serverInfo.version`;
the Pages API version is separately fixed at `1`.

`src/pages-client.ts` provides the HTTP(S) adapter for the shared operation
envelope in `../definition/PagesAgentApi.ts`. It uses only a Bearer header,
rejects redirects, applies a five-second request budget and suppresses remote
error contents. No tool calls it in this phase; the unused adapter is omitted
from the executable bundle. The only Pages endpoint is `POST /api/v1/agents`:

| Request                                             | Status | Stable error code    |
| --------------------------------------------------- | ------ | -------------------- |
| Missing or malformed Bearer header                  | 401    | `AUTH_REQUIRED`      |
| Syntactically present, unverified Bearer credential | 503    | `AUTH_NOT_READY`     |
| Other request method                                | 405    | `METHOD_NOT_ALLOWED` |

Every response has `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`:

```json
{
  "apiVersion": "1",
  "error": {
    "code": "AUTH_NOT_READY",
    "message": "Agent authentication is not available yet.",
    "retryable": false
  }
}
```

Authentication precedes body parsing: no operation dispatch, successful response,
protected data, cookie fallback or database access exists at this boundary.
The denial-only route remains JSON during pending setup. Token verification,
business tools, OAuth, HTTP MCP transport and release automation require later work.
The repository's lint and coverage gates include the package source and focused tests.
