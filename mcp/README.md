# Pages MCP 0.1.0

The Pages adapter implements the Model Context Protocol (MCP), which lets external
clients discover and call tools through a common protocol. It connects those
clients to an existing Pages instance under the personal identity that approved
the connection. Pages authenticates the credential and checks current access
rights on the server for every request.

## Architecture and transport

```text
MCP client
    ↓ stdio: stdin/stdout
Local Pages MCP process
    ↓ authenticated requests
Pages Agent API
    ↓
Pages services → repositories → database
```

**Stdio is the only supported MCP transport.** The client launches the local
process and exchanges MCP messages through its stdin and stdout. stdout is
reserved for the protocol; diagnostics and credential-command messages go to
stderr. The adapter has no direct database access and opens no network listener.

`PAGES_URL` identifies the Pages web application and API, not an MCP endpoint.
Pages API requests and browser pairing links need network access to Pages.
Start without arguments, or use the credential commands; any other start argument
fails before credential lookup or any Pages request.

## Supported functions

The adapter supports project discovery and management, wiki reading, search,
page creation and field changes, bounded passage reads and exact range patches
of wiki text and ticket descriptions, comments, asset upload preparation, wiki and
structured import preview/application, tickets, milestones, assignments, tags
and links. Agent workspaces, the local directories that agents work in, can be
listed and read, and registered, changed and unregistered by those who manage the
project. User agents, the agents people create on the Pages agent page, can be
listed, read, created and changed by their owner, together with the models that
may be given to them. Agent plans can be listed, read, created and changed in
their structure and parameters by their owner, and the account's own runs of a
plan and their reports can be listed and read. Personal administrators can also read administration information and
change existing roles, accounts and memberships within the offered operations,
and permanently delete a whole project after a confirmation.

Start with the [tool reference](#tool-reference) below for arguments, results,
limits and permission rules. [Read tool definitions](./src/tools/registry.ts),
[write tool definitions](./src/tools/write-registry.ts) and their imported schemas
are the source contracts. The client's `tools/list` contains only implemented
tools offered by Pages to the verified identity. A listed write tool does not
prove permission to change a particular target: Pages checks that operation's
current rights when called. Hidden objects are not disclosed by lists or errors.

## Developing from the repository

The independent [package manifest](./package.json) requires **Node.js 24 or newer**
and **pnpm 10 or newer**, and pins `pnpm@11.23.0` in `packageManager`.
Node and pnpm are needed for development; running a built bundle needs only Node.

Use `mcp/` as the working directory:

```sh
cd mcp
CI=true pnpm install --frozen-lockfile
CI=true pnpm run lint
CI=true pnpm run check
CI=true pnpm run build
```

From the repository root, the equivalent commands are:

```sh
CI=true pnpm --dir mcp install --frozen-lockfile
CI=true pnpm --dir mcp run lint
CI=true pnpm --dir mcp run check
CI=true pnpm --dir mcp run build
```

Installation uses the MCP package's own manifest and lockfile. No root dependency
installation or Pages root gates are required for this workflow. `lint` checks
package sources, scripts and JavaScript configuration with no warnings allowed.
`check` runs `tsc --noEmit` and package-local `prettier --check .`, including this
README and the client examples. It does not start Pages or generate React Router
types. These are static checks; the [unit tests](#unit-tests-and-coverage) check
behavior. The separate `test:mcp` command below checks the built adapter with a
real stdio client against an explicitly isolated Pages instance.

### Unit tests and coverage

```sh
cd mcp
CI=true pnpm run test
```

`test` runs all unit tests once with V8 coverage and then exits; there is no
watch mode. The tests live in `mcp/tests/` as `*.unit.test.ts` and mirror the
source path: `tests/src/` for `src/`, `tests/scripts/` for `scripts/`. The stdio
check in `tests/stdio/` is no unit test and is not discovered. The configuration
is [vitest.config.ts](./vitest.config.ts).

The tests need no running Pages instance, network, browser or real credentials.
Pages requests (`fetch`), the credential store's file system, subprocesses,
timers and esbuild are mocked; the release packager tests write only to a
temporary directory that they remove.

Coverage covers every executable file of the package, including files that no
test imports: `src/**/*.ts`, `scripts/**/*.ts` and `build.config.ts`. Only tests,
dependencies (`node_modules/`) and generated output (`dist/`, `coverage/`) lie
outside it. The shared Pages definitions imported from `../definition/` belong
to the Pages root package and are not part of this report.

**Statements, branches, functions and lines must each reach 100 %.** The
thresholds in `vitest.config.ts` are binding: a failing test or any metric below
100 % makes `pnpm run test` exit nonzero. Coverage-ignore comments such as
`/* v8 ignore next */`, `/* v8 ignore start */` or `/* v8 ignore stop */` are not
allowed, and no production code is excluded from coverage to reach the target;
cover new code with tests instead.

The terminal prints a summary per file. The HTML report is written to
`mcp/coverage/index.html`; open it in a browser. `coverage/` is not versioned and
is recreated by every run.

### Continuous integration

The [CI workflow](../.github/workflows/ci.yml) shows two checks. **Pages check**
runs the root gates first. **MCP check** starts only after **Pages check** has
succeeded; it installs this package's dependencies and runs `pnpm run lint`,
`pnpm run check`, `pnpm run build` and `pnpm run test` with `mcp/` as the working
directory, in this order. A failing step fails the check and the workflow.

### Removing local artifacts

```sh
cd mcp
pnpm run clean
```

`clean` deletes `mcp/node_modules/` (including the Vitest cache below it), the
build output `mcp/dist/` and the coverage report `mcp/coverage/`. Missing paths
are skipped, so the command can run repeatedly. Sources, tests, configuration and
`pnpm-lock.yaml` stay, and nothing outside these three paths is touched. Install
the dependencies again before the next check, build or test run.

Depending on pnpm's `verifyDepsBeforeRun` setting, pnpm can install missing
dependencies before any script starts, including `clean`; the command still ends
with them removed. `pnpm run --config.verifyDepsBeforeRun=false clean` skips that
step.

### Bundle format and distribution

[build.config.ts](./build.config.ts) uses esbuild with `bundle: true`, Node target
`node24`, `format: "cjs"` and no code splitting. It clears `mcp/dist/` and writes
`mcp/dist/pages-mcp-v<version>.cjs`, using the version from `package.json`.
With the development manifest in this checkout, the output is
`pages-mcp-v0.1.0.cjs`; this names a build artifact and does not establish a
published release.

JavaScript dependencies are bundled into that single CommonJS file; Node
built-ins are supplied by Node. Copying the built `.cjs` file is sufficient for
runtime use: no checkout, pnpm installation, `package.json` or `node_modules` is
needed beside it.

**Keep the `.cjs` extension.** The development manifest declares `"type": "module"`,
which makes Node interpret `.js` files in that package as ES modules. `.cjs`
explicitly selects CommonJS, including inside a package with `"type": "module"`.
Renaming this bundle to `.js` can make it fail in such a directory; moving it
outside the package tree is unnecessary when its `.cjs` name is preserved.

The repository has a [release workflow](../.github/workflows/mcp-release.yml)
intended to publish version-tagged ZIP assets to the
[Pages GitHub releases](https://github.com/gesus90/Pages/releases), rather than npm.
The [release packager](./scripts/package-release.ts) reads the same
`dist/pages-mcp-v<version>.cjs` output. It uses that filename for the archive
entry, bundle checksum, shipped manifest's `main` field and client example paths.
The archive's manifest declares `"type": "commonjs"`; the `.cjs` extension also
keeps the bundle independent of the surrounding package type. The packager builds
twice in isolated working copies and rejects differing bundle checksums before
writing the archive. These are packaging rules, not evidence of a published
release or a completed reproducibility check. The setup below describes an
already built `.cjs` file; `X.Y.Z` and the absolute paths are synthetic placeholders
to replace with the file you have.

### Manual bundle acceptance

A successful build alone does not establish that Node can load the bundle.
After building, use Node.js 24 or newer to inspect the generated file directly.
From the repository root, substitute the version from `mcp/package.json`:

```sh
env -u PAGES_URL -u PAGES_TOKEN node mcp/dist/pages-mcp-vX.Y.Z.cjs > bundle-no-config.stdout.log 2> bundle-no-config.stderr.log
echo $?
env -u PAGES_URL -u PAGES_TOKEN node mcp/dist/pages-mcp-vX.Y.Z.cjs --unsupported > bundle-argument.stdout.log 2> bundle-argument.stderr.log
echo $?
```

Inspect each exit code immediately after its command with `echo $?`. Without
Pages configuration, the first command must exit nonzero with a configuration
diagnostic on stderr. It must not fail with a module-loading error such as
`require is not defined`. The second command must exit nonzero with
`Unsupported startup argument` on stderr, before configuration lookup or any
Pages request. Both stdout logs must be empty. Neither command should open a
network listener; inspect the process's listening sockets while it runs (for
example, with `ss -ltnp` on Linux).

### Stdio end-to-end acceptance

Use only an already running, explicitly isolated Pages instance with completed
setup and a personal account allowed to list project names. Set `PAGES_URL` to
that instance. Pair it separately using the browser flow below, or supply an
existing credential securely through `PAGES_TOKEN` in the process environment.
Keep credentials out of commands, files and reports. Then run from the repository
root:

```sh
CI=true pnpm --dir mcp run test:mcp
```

The script builds the versioned bundle and runs [tests/stdio/client.ts](./tests/stdio/client.ts).
[tests/stdio/server.ts](./tests/stdio/server.ts) checks instance health and launches that real
bundle as a stdio child. The client sends `initialize`, validates the server
identity, version and tools capability, sends `notifications/initialized`, lists
tools and calls only `list_project_names`. It validates the returned JSON array,
closes stdin and requires server exit code zero. Invalid responses, protocol
errors, non-protocol stdout, unavailable Pages, incomplete setup, missing or
rejected credentials and timeouts fail with a nonzero client exit code and fixed
diagnostics on stderr. Project names and raw provider responses are not logged.

The check reads the existing pairing store when `PAGES_TOKEN` is unset and passes
the credential only in the child's process environment. This prevents automatic
rotation and local-store updates during acceptance. It requests no content or
credential mutations and never opens a database directly. Pages still handles
its normal credential-use bookkeeping. This check uses no mocks or fixtures and
has no coverage gate; the unit tests are a separate suite. The script starts and stops only its own adapter
child; it does not start Pages or perform browser approval. This check does not
establish that the separate browser flow has been manually accepted.

## Connect a client over stdio

### 1. Choose a reachable Pages instance

Pages must already be set up and reachable from the computer running the adapter.
You need a personal Pages account that can sign in and approve the connection.
The examples use `PAGES_URL=http://127.0.0.1:3000`; that address reaches Pages only
when it runs on the same computer as the adapter.

`PAGES_URL` must be an absolute instance base URL, optionally with a deployment
prefix. HTTPS is accepted. HTTP is also accepted for `localhost`, `127.0.0.1`,
`[::1]` and private IPv4 addresses in 10/8, 172.16/12 and 192.168/16. Other hosts
require HTTPS. User information, query strings, fragments and surrounding
whitespace are rejected. Trailing slashes are normalized; the deployment prefix
remains part of the instance identity. Use the same normalized URL for pairing
and the client.

### 2. Pair under the operating-system account that will run the client

With the built bundle at your chosen absolute path, run:

```sh
node /absolute/path/pages-mcp-vX.Y.Z.cjs pair --url http://127.0.0.1:3000 --name "Example workstation"
```

The command displays a Pages browser link and a code on stderr, attempts to open
a browser in an interactive desktop session, and waits for approval. Sign in to
Pages with your own account, compare the browser code with the terminal code,
check the displayed account and client, and explicitly approve the connection.
Signing in alone does not grant access. The request is retained through sign-in,
language changes and any required password replacement.
The browser does not display a token to copy. The local process collects the
credential, verifies it with Pages, saves it and exits successfully.

For manual or SSH use, add `--no-browser` to the `pair` command. Open the displayed
link yourself on a device that can reach that same Pages instance. If the URL
uses loopback, it refers to the machine running the browser; for a different
machine use an instance URL reachable by both the browser and adapter instead.
The process must remain running until approval and collection finish. Pairing
requests expire after ten minutes; approval near the deadline allows at least
sixty seconds for collection. Rejection or expiry needs a new pairing request.

### 3. Keep the local credential private

The credential is stored in `credentials.json` under the current operating-system
account's configuration directory:

| Platform | Directory                                                         |
| -------- | ----------------------------------------------------------------- |
| Linux    | `$XDG_CONFIG_HOME/pages-mcp`, or `~/.config/pages-mcp` when unset |
| macOS    | `~/Library/Application Support/pages-mcp`                         |
| Windows  | `%APPDATA%/pages-mcp`                                             |

`XDG_CONFIG_HOME` and `APPDATA`, when used, must be absolute. On POSIX the directory
must belong to the current user and have mode `0700`; the file must belong to that
user and have mode `0600`. Symbolic links are refused. Writes use a cross-process
exclusive lock and atomic rename. Entries belong to the exact normalized instance
URL, including its deployment prefix. Different operating-system accounts have
separate stores; a shared account/store shares that paired Pages identity.

Run pairing and the MCP client with the same operating-system account and
configuration location. Keep the store out of source control, client JSON,
screenshots and diagnostic reports. Never print or copy its secret contents.
Credentials are not forwarded through redirects to another instance.

### 4. Configure and start the MCP client

The normal start has no subcommand or transport argument:

```sh
PAGES_URL=http://127.0.0.1:3000 node /absolute/path/pages-mcp-vX.Y.Z.cjs
```

Normally the MCP client launches this process and manages its stdio pipes.

The fixed `health-check` argument is reserved for Pages' local Tool Manager.
It initializes MCP without reading paired credentials or contacting Pages. This
mode uses only an unreachable loopback address and a synthetic credential;
environment settings cannot grant it access to instance data. It confirms the
bundle's protocol readiness, not an account's authorization. Normal startup and
all tool requests continue to verify authorization.
Use `command`, `args` and `env` in the client's local MCP server configuration:

```json
{
  "mcpServers": {
    "pages": {
      "command": "node",
      "args": ["/absolute/path/pages-mcp-vX.Y.Z.cjs"],
      "env": {
        "PAGES_URL": "http://127.0.0.1:3000"
      }
    }
  }
}
```

This is a generic configuration shape; adapt the outer keys to your client.
Replace the synthetic bundle path and version with the actual file. `node` must
be in the client's PATH; otherwise use its absolute executable path. The bundle
verifies Pages authorization before serving MCP; startup failure exits nonzero
and reports diagnostics on stderr. Keep stdout connected to the client's protocol
input. Closing stdin ends the local process.

Client-specific examples with the same paired-credential setup are available:

- [Claude CLI](./examples/clients/claude-cli.mcp.json)
- [Codex](./examples/clients/codex-config.toml)
- [OpenClaw](./examples/clients/openclaw.json)
- [OpenCode](./examples/clients/opencode.json)

See the [example setup instructions](./examples/clients/README.md) before using a client
configuration. Run `pair` separately; the client's startup arguments contain only
the bundle path.

### Explicit token override

For MCP startup, a defined `PAGES_TOKEN` takes priority over the local pairing
store, including when it is empty. An empty or malformed value fails; an invalid,
expired or revoked token does not fall back to pairing. Leave the variable unset
in the client environment for the paired setup above, including inherited values
from the process launching the client.

An intentional override must be a valid owner-bound personal credential supplied
securely in the process environment. The adapter does not automatically rotate it.
Do not hardcode a token in client configuration or commit one to the repository.
Browser sessions are not interchangeable with this personal stdio credential. The credential commands below manage the local paired
entry, even when `PAGES_TOKEN` is set; they do not manage that override.

## Credential status, rotation and removal

All credential commands accept `--url`, or use `PAGES_URL` when it is omitted.
Only `pair` accepts `--name` and `--no-browser`. Commands write human-readable
messages to stderr and never print the credential.

```sh
node /absolute/path/pages-mcp-vX.Y.Z.cjs status --url http://127.0.0.1:3000
node /absolute/path/pages-mcp-vX.Y.Z.cjs rotate --url http://127.0.0.1:3000
node /absolute/path/pages-mcp-vX.Y.Z.cjs unpair --url http://127.0.0.1:3000
```

- `status` verifies the local entry with Pages and reports its instance, name and
  expiry. It requires a reachable Pages API; it is not just an offline file read.
  Verification can honor a pending server-requested rotation.
- `rotate` requests a replacement credential from Pages, saves it locally and
  verifies it. The paired connection keeps its ID, name and original expiry.
  The previous credential works until the new one is used, at most five minutes.
  Rotation does not extend an expired connection or revive a revoked one.
- `unpair` attempts server-side revocation, then removes the matching local
  credential even if Pages cannot be reached. If revocation could not be confirmed,
  revoke the connection in Pages under **Settings → Connections** when reachable.
- Pairing again verifies and saves the new credential before attempting to revoke
  the previous local one. If that revocation fails, revoke the old connection in
  Pages as well.

Under **Settings → Connections**, the owner can inspect and revoke connections,
request rotation of a paired connection for its next verification, and set the
personal validity preference. It defaults to 30 days; approval and settings accept
whole days 1–365, or 0 for unlimited. A changed preference recalculates still-active
credentials from their creation time and affects future pairings. It can shorten
a connection's remaining lifetime; expired or revoked connections stay ended.

Pages checks validity, revocation and current account rights at startup and on
every tool list/call. On a rejected local credential, the adapter rereads the
store and retries once if another process has already rotated it. If the entry
still holds the rejected credential, it removes that entry and asks for pairing
again. A generic authorization error alone does not identify this case.

## Troubleshooting

| Symptom                                                                                      | What to check                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node cannot be found, or the bundle cannot be loaded                                         | Use Node.js 24 or newer, ensure the client can find its executable, use the real absolute bundle path and keep the `.cjs` extension. The single bundle does not need pnpm or a runtime dependency installation.                                                                   |
| Startup reports unsupported arguments                                                        | Start without options; use only the documented credential subcommands. MCP transport is stdio.                                                                                                                                                                                    |
| Pages cannot be reached, or pairing reports the wrong instance                               | Check the base URL, deployment prefix and connectivity from the adapter's machine. Loopback refers to that machine. Confirm that the address serves Pages and that setup has finished. Redirects are rejected.                                                                    |
| The instance is reachable but unhealthy                                                      | Pages exposes `/health` beneath its deployment prefix: `ok` means healthy, `setup` means setup is pending (status 200), and `unavailable` means unhealthy (status 503). Availability or health does not prove authorization. Consult Pages diagnostics for an unhealthy instance. |
| No paired credential                                                                         | Pair for the same normalized URL under the account/configuration location used by the client. Check for a defined `PAGES_TOKEN` overriding that entry.                                                                                                                            |
| The paired credential is reported as no longer valid, or Connections shows expiry/revocation | Check the owner's connection status in Pages and pair again when expiry/revocation is confirmed. Rotation cannot revive it. Never paste the credential into a report.                                                                                                             |
| `Pages authorization failed.` or the generic startup failure                                 | These messages can also cover unreachable Pages, invalid responses or other provider failures. Check reachability/health, stderr and the owner's connection status before concluding that a token has expired.                                                                    |
| `FORBIDDEN`, or a tool is unavailable                                                        | Check the current account, project/page visibility and the operation's UI permission. Tool discovery is filtered; discovery alone does not grant write rights. `NOT_FOUND` can also mean hidden content.                                                                          |
| The credential store is refused                                                              | Check ownership, exact POSIX directory/file modes and configuration paths. Symbolic links are not supported; keep the contents private.                                                                                                                                           |

## Tool reference

All tools use the same local stdio connection and authenticated Pages Agent API.
The reference below describes the implemented operation families. Use the offered
`tools/list` schemas for complete required/optional arguments and pagination
fields, and the linked source definitions when developing an integration.
Status codes mentioned below are Pages API responses. Binary asset upload paths are
Pages API paths as well.

### Pica sessions

`list_chat_sessions` (`chat.sessions.list`) takes no arguments and returns all
of the connected person's own sessions with IDs, previews and `total`.
Administrators cannot list another person's sessions.

`delete_chat_sessions` (`chat.sessions.delete`) takes `sessionIds`,
`expectedCount` and `confirmation`. Show the person the exact sessions and count
first, then require them to type exactly **LÖSCHEN**, also in English. The UI's
button confirmation does not authorize MCP deletion. `expectedCount` must equal
the number of unique IDs in this call, between 1 and 200. For all sessions, use
all IDs read from the list; split larger selections into explicit batches after
confirming their complete scope. Newly created sessions are not silently added.

The server checks every target's ownership before mutating a batch; a missing or
foreign session returns `NOT_FOUND` and deletes none of that batch. The result
contains `deleted` IDs, `failed` entries (`sessionId`, safe `error` code), and
`cleanupFailed` IDs whose session was deleted but whose file cleanup failed.
Deletion is permanent and may partially succeed. Re-read after a lost response;
do not widen the selection or infer confirmation. Read-only run credentials
receive the list, and only full-reach runs or personal credentials receive
deletion. Ticket-scoped runs never receive these session operations.

### Project name discovery

`list_project_names` takes no arguments and is read-only. It returns a text
content block containing a JSON array of visible active project names, such as
`["Example plan", "Shared project"]`. It is offered only when Pages allows
`projects.names.list` for the verified identity; every list/call verifies the
credential anew. Unknown tool names and supplied arguments are rejected with a
protocol error. A Pages authorization or provider failure returns the fixed
message `Pages authorization failed.` without project data.

### Project and wiki reads

The `list_project_names` tool returns names only. The following
read-only tools use the same stdio transport and verify current rights
on every call. Reading wiki content does not record a visit.

| Tool              | Pages operation    | Arguments                    | Result                                                                               |
| ----------------- | ------------------ | ---------------------------- | ------------------------------------------------------------------------------------ |
| `resolve_project` | `projects.resolve` | `name`                       | Exact trimmed, case-sensitive visible project ID and name                            |
| `read_project`    | `projects.read`    | `projectId`                  | ID, name, description, status, progress, start and target dates                      |
| `read_wiki_page`  | `wiki.page.read`   | `pageId`                     | ID, title, complete Markdown, revision, parent, scope, project ID, icon and cover    |
| `read_wiki_tree`  | `wiki.tree.read`   | Optional `projectId`         | At most 100 visible nodes (`id`, `title`, `parentId`), visible total and `truncated` |
| `search_wiki`     | `wiki.search`      | `text`, optional `projectId` | At most 100 visible hits (`id`, `title`, `snippet`), visible total and `truncated`   |

These operations return `{apiVersion:"1",result}`. Arguments are strict; texts and
IDs accept at most 200 Unicode characters. An optional project must itself be
visible and active. A tree parent outside the visible project is `null`; visible parents on another cursor page keep their IDs.
Search snippets contain at most 200 Unicode characters. Counts use the same
visibility policy as the nodes and snippets, including anchors and ancestors.

Ambiguous project names return `AMBIGUOUS` (409), with at most 100 visible
`error.details.candidates` containing IDs and names, sorted by ID, and `truncated`.
The client must choose explicitly. Hidden and missing targets both return
`NOT_FOUND` (404), including another person's private wiki page. Personal admins
use their administrator scope regardless of their stored UI mode; private content
continues to belong to its owner. The UI mode remains unchanged.

The complete request envelope is limited to 65,536 UTF-8 bytes, except wiki create/content calls (see wiki and project foundations below).
List response envelopes are limited to 1,048,576 UTF-8 bytes; individual wiki content has its own 1 MiB UTF-8 budget with room for JSON escaping and metadata. Oversized content
returns `PAYLOAD_TOO_LARGE` (413); Markdown is never silently truncated. Unknown
operations and invalid arguments return `INVALID_REQUEST` (400). MCP business
errors expose the stable code and visible ambiguity choices; authentication and
provider failures use a fixed diagnostic.

### Assets and single-page creation

`prepare_asset_upload` calls `assets.upload.prepare` with `{fileName}`. It returns
`{ticket, header:"X-Pages-Upload-Ticket", uploadPath:"/api/v1/agent-assets", expiresAt,
mediaLimitBytes, fileLimitBytes}`. POST the raw bytes to that path on the configured
Pages instance, preserving any deployment prefix. Send the ticket only in the
named header, without an Authorization header or query string. Tickets are
one-use, expire after five minutes and are invalid after a Pages restart. Failed
uploads need a new ticket. The binary client uses a separate five-minute budget;
JSON calls keep their five-second budget; wiki create/content calls allow 1 MiB UTF-8 content, other requests keep 64 KiB. Import application has a thirty-second budget.

For stdio uploads, the Pages endpoint rechecks the originating personal credential
and current account rights before and after streaming.
File bytes never enter MCP or Agent-API JSON. Type detection and current wiki
settings determine the streaming limit (defaults: media 500 MiB, other files/PDF
100 MiB). Oversize or incomplete uploads leave no staging object. Responses contain
`{apiVersion:"1",result:{assetId,link,fileName,contentType,size,expiresAt}}`.
Links require a Pages browser session: staged assets belong to their uploader;
linked assets follow the page visibility. Raster images can be inline; other types,
including PDF, SVG and HTML, download as `application/octet-stream` with sandbox and
nosniff. Unlinked assets become unusable after 24 hours. Cleanup runs at startup and
hourly, retries failed deletions and preserves linked assets.

`create_wiki_page` calls `wiki.page.create` with all fields explicit:
`{operationId,projectId,parentId,title,content,icon,assetIds}`. Use `parentId:null`
for a root, optionally `scope:instance` or `scope:private` with `projectId:null`, `icon:null` for no icon and `assetIds:[]` for no attachments.
At most 100 owned, staged, unexpired asset IDs can be linked. Use their stable links
in Markdown. The visible parent must belong to the explicit project; normal title,
icon and depth rules apply. Existing pages are never overwritten.

The result is `{apiVersion:"1",result:{pageId,link,assets:[{assetId,attachmentId,link}]}}`.
The owner-scoped operation key and complete input fingerprint are retained
permanently. Identical retries, including after response loss or concurrent calls,
return the same result. Changed input with the same key returns `CONFLICT` (409).
Foreign/missing/expired assets or hidden destinations return `NOT_FOUND` (404),
lack of write permission `FORBIDDEN` (403), size overflow `PAYLOAD_TOO_LARGE` (413)
and invalid input `INVALID_REQUEST` (400). No failed create leaves an operation row.
Write tools are offered to every verified account; Pages checks the operation-specific UI rights when called. Internal
notifications contain only type and ID and are published after commit.

### Wiki import preview

`plan_wiki_import` calls `wiki.import.plan` through the same authenticated JSON
API. It is read-only, including when the account has no write permission. The
result uses `{apiVersion:"1",result}`; no plan, operation key, page, revision,
visit, favorite, attachment or source mapping is saved. Assets are never fetched
or uploaded and `externalEffects` is empty. Applying a confirmed package is a
separate write operation described below.

Parameters are strict and the destination is explicit:

```json
{
  "projectId": "visible-project-id",
  "parentId": null,
  "manifest": {
    "version": "1",
    "index": [
      {
        "sourceKey": "guide/README.md",
        "title": "Guide",
        "titleSource": "h1"
      },
      {
        "sourceKey": "guide/example.md",
        "title": "example",
        "titleSource": "filename"
      }
    ],
    "files": [
      { "sourceKey": "guide/README.md", "content": "# Guide\nMarkdown" },
      { "sourceKey": "guide/example.md", "content": "Body" }
    ]
  }
}
```

First send the full index with `files:[]`. Repeat that complete index in every
content package so that cross-package structure and title conflicts remain
visible without server-side staging. Index entries contain the final title and
its origin (`explicit`, `h1` or `filename`), determined by the client from the
whole source collection. Loaded files must match the server's title derivation:
optional `files[].title` first, otherwise the first top-level CommonMark/GFM H1
outside code, otherwise the filename without `.md`. Wiki title normalization and
the 200-character limit apply. Frontmatter and headings remain Markdown content.
An index-only H1/explicit claim remains provisional until its content arrives.

Relative source keys are NFC, case-sensitive Markdown paths. Absolute paths,
dot segments, backslashes, control characters, URL encoding, query and fragment
syntax are rejected. Directories become proposed page nodes. A directory's
`README.md` or `index.md` supplies its content and derived title; without either,
it has empty content and the directory name as title. Both group files in one
directory are a conflict. A root README/index creates a new group below the
selected parent, never replaces that existing parent, and adds a level to the
tree. At most ten levels are allowed, including existing ancestors; excess depth
is reported without flattening. Existing matching pages are conflicts, never
implicitly adopted or overwritten. Title comparisons are case-sensitive after
normalizing whitespace, as in the wiki.

The preview returns `pages` with proposed keys, source mappings, title origins,
content byte counts and actions (`create`, `conflict`, `invalid`, `blocked`), plus
explicit `edges`, `errors`, `conflicts` and relative image/file `assets` from this
package. Proposed keys are not database IDs. `contentBytes:null` marks contents
not in this package; empty directories have zero bytes. `contentComplete` reports
whether every indexed source has contents, independently of `valid`, which reports
structural/content diagnostics for this package and the whole index. Children of
an unusable proposed parent are blocked. Duplicate paths are conflicts; missing
index entries or mismatched title claims are invalid requests.

Every call checks current scope and reads all visible direct destination children,
including children beyond the 100-node tree window. Missing/hidden destinations,
another person's private page, a parent from another project or a non-project
parent return `NOT_FOUND` (404) with the fixed message "Not found or no access.".
Hidden sibling names, IDs and counts do not appear. Read-only accounts receive
`FORBIDDEN` in the plan's errors for the unavailable future create, while their
visible preview remains available. A valid plan or fingerprint is not permission
to apply it.

Packages allow at most 128 index entries, 32 content files, 16,384 UTF-8 bytes per
file, 32,768 content bytes in total and 512 UTF-8 bytes per source path. The whole
serialized request remains limited to 65,536 bytes, including the index, JSON
escapes and envelope; the whole response to 1,048,576 bytes. Overflow returns
`PAYLOAD_TOO_LARGE` (413) with safe numeric `details:{constraint,limit}`. MCP keeps
only recognized constraint names and positive integer limits.

The SHA-256 `fingerprint` includes fixed manifest fields, exact Markdown bytes,
sorted index/package entries, visible ancestor revisions, direct visible sibling
IDs/titles and current write availability. Input/property/list order does not
affect it; content or relevant target-state changes do. Each package has its own
fingerprint, and a changed target requires a new plan. Nothing is persisted.

### Wiki import application

`apply_wiki_import` calls `wiki.import.apply` with
`{operationId,fingerprint,projectId,parentId,manifest,assets?}`. Repeat the exact
content package used for `plan_wiki_import` and its fingerprint. The first start
checks that fingerprint against current target state in the run transaction.
Use a new operation ID and a fresh plan for each package or subsequent import.
A stale fingerprint returns `CONFLICT` without creating a run or pages.

Reuse the same operation ID and input after a lost response, timeout or interrupted
run. Index/file/asset list order is immaterial. The owner-scoped operation key
permanently identifies this package's run; changed input with that key returns
`CONFLICT`. A completed replay returns the same run, actions, page IDs and attachment
IDs. A running replay processes only sources without a committed outcome. A new
operation ID can retry failed sources; prior successful mappings are skipped.

Only loaded Markdown files and their required empty directory ancestors are
applied. Source mappings are unique per project and case-sensitive Markdown path;
generated empty directories use reserved `directory:` keys. Keep the complete
index in every package. Import a directory's README/index content before packages
containing its children; absent group content is never replaced by an empty page.
Unrelated indexed sources are left for their own packages. Changed grouping or
placement is a conflict and does not adopt an existing page.

Optional `assets:[{sourceKey,assetIds:[...]}]` binds at most 100 owned, staged,
unexpired asset IDs to a loaded source. Each source may appear once. Upload
with `prepare_asset_upload` first and use its stable `/agent-assets/<id>` links
in Markdown. Page, attachments, operation result, source mapping, item and counters
share one source transaction. A rollback removes copied attachment bytes and
preserves staged assets. Markdown remains exact; structured import handles
relative asset link rewriting.

The result is `{apiVersion:"1",result:{runId,status,counts,items}}`. Status is
`complete` when all sources succeeded or were unchanged, otherwise `partial`.
Counts have `created`, `skipped`, `conflict` and `failed`, including required
directory nodes. Items have `sourceKey`, `targetKey`, `action`, `pageId`, `link`,
`assets` and a fixed `errorCode` or null. Each outcome is persisted independently;
an infrastructure interruption leaves the run `running` with its prior outcomes
and counters intact.

New sources create pages. An unchanged mapped source with its original target
revision and placement is `skipped`; a changed source, attachment set, target
revision or placement is `conflict`. Missing or hidden mapped targets are failures
and are never recreated implicitly. The read-only wiki import preview still diagnoses
matching existing titles; apply compares its own durable source mapping before
those title collisions, while unassociated existing pages remain conflicts.
No source overwrites page content or produces an update revision.

Credentials, account rights, project visibility and parents are checked again
before each source transaction. Existing ancestor revisions are checked against
the accepted plan. Revocation cannot grant a later source permission based on
earlier success. Saved IDs are checked for current visibility before any replay
result leaves Pages. Competing requests use the central serialized DuckDB connection
and source/item primary keys; they cannot create duplicate pages. Requests whose
plan has already become stale receive a defined `CONFLICT` and must replan.

The wiki import preview package limits and 64-KiB request / 1-MiB response limits remain in force.
Apply has a thirty-second MCP budget. A timeout does not undo committed sources:
repeat with the same operation ID.

### Updating imported wiki pages

`update_wiki_import` calls `wiki.import.update` with
`{operationId,fingerprint,projectId,parentId,manifest,updates}`. Plan the changed
content package with `plan_wiki_import` first, then repeat its exact manifest and
fingerprint. Use a new operation ID per update. `updates` holds exactly one entry
per loaded file: `{sourceKey,expectedRevision,overwrite?}`. `expectedRevision` is the
page revision you read with `read_wiki_page`; `overwrite` defaults to `false`.

Only the page mapped to a source key by `apply_wiki_import` is touched. A page
without a mapping is never found by title: the source fails with `not_imported`,
and an unrelated page of the same name stays unchanged. Placement and icon never
change; the title and Markdown follow the source.

Per source the result is one of:

- `updated`: the page was saved with a new revision (`source_changed`) or replaced
  on instruction (`overwritten`). Each update keeps the previous text as its own
  page version, so it can be restored from the version list even when the same
  account saved within ten minutes.
- `skipped` (`unchanged`): the page already shows the source. No revision is
  written. Line endings and a leading byte-order mark are ignored in this
  comparison only.
- `conflict`: nothing is written. Reasons are `stale_revision` (the page moved on
  since `expectedRevision`), `manual_change` (the page was revised in Pages after
  its import and `overwrite` is not true), `title_conflict` (a sibling already has
  the new title), `template` and `plan_conflict` (the confirmed plan reports a
  conflict for the source).
- `failed`: `not_imported`, `page_unavailable` (deleted or hidden), `invalid_source`
  or `not_permitted`.

The result is `{apiVersion:"1",result:{status,counts,items}}`. Status is `complete`
when no source conflicted or failed, otherwise `partial`. Counts have `updated`,
`skipped`, `conflict` and `failed`. Items have `sourceKey`, `targetKey`, `action`,
`reason`, `pageId`, `link`, `revision` and a fixed `errorCode` or null. The
`revision` is the page revision after the call: the new one for `updated`,
otherwise the current one, so a conflict tells you which revision to read again.

All page changes, moved baselines and the stored result of one call commit together
or not at all. An infrastructure failure rolls the whole call back; repeat it with
the same operation ID and input. A completed operation ID returns the stored result
unchanged, even though page revisions have moved on. The same ID with different
input returns `CONFLICT`. A later `apply_wiki_import` of the updated source is
`skipped`, because the stored baseline moves with every update.

Credentials, write rights and project visibility are checked again for the call.
Update has a thirty-second MCP budget and the wiki import preview package limits.

### Single-field wiki operations

The following tools change exactly one thing about an existing wiki page. Every argument is
required, and unknown arguments are `INVALID_REQUEST`.

| Tool                    | Pages operation        | Arguments (besides the common ones)     | Changes                      |
| ----------------------- | ---------------------- | --------------------------------------- | ---------------------------- |
| `set_wiki_page_title`   | `wiki.page.setTitle`   | `title`                                 | Title only                   |
| `set_wiki_page_content` | `wiki.page.setContent` | `content` (Markdown)                    | Text only                    |
| `set_wiki_page_icon`    | `wiki.page.setIcon`    | `icon` (one emoji, or `null` to remove) | Icon only                    |
| `move_wiki_page`        | `wiki.page.move`       | `projectId`, `parentId`, `beforeId`     | Place only, with the subtree |

The common arguments are `operationId`, `pageId` and `expectedRevision`. `pageId`
(and `parentId` and `beforeId`) is a page ID or a Pages address such as `/wiki/<id>`,
with or without the server and a deployment prefix in front. A title or any other
path is `INVALID_REQUEST`. `expectedRevision` is the revision you read with
`read_wiki_page`.

The result of a field change is `{pageId, link, field, revision, changed}`.
`changed` is `false` when the field already had the value; no revision, version or
event is written then. A move returns `{pageId, link, field:"location", revision,
changed, parentId, projectId, visibility}`.

- **Only the named field changes.** The other fields keep their stored values. Each
  change keeps the previous state as its own page version, so it can be restored
  from the version list even when the same account saved within ten minutes.
- **Conflict.** A page saved after `expectedRevision` returns `CONFLICT` and nothing
  is written. Read the page again and call with the new revision.
- **Visibility and rights.** A page or target the account cannot see returns
  `NOT_FOUND`. Without the write right the call returns `FORBIDDEN` and no revision
  rises. A move also needs the right to manage the page.
- **Move.** Pages in project, instance and private scope move. Name the target project (or `null` with `scope:instance` or `scope:private`), the parent below it
  (`null` for a root page) and the sibling to place the page before (`null` to
  append). A page below itself or its descendants, below a template, deeper than
  ten levels, or before a page that is no sibling is `INVALID_REQUEST`. The move
  keeps the revision, which counts changes of title, text and icon. `visibility`
  reports how the move changed who sees the page: `same`, `wider`, `narrower` or
  `different`. Milestone and epic anchors of the old project are dropped when the
  project changes.
- **Repeat.** Use a new `operationId` per intended change. Repeating the same ID with
  identical input returns the stored result without writing again, which recovers
  from a lost response even though the revision has moved on. The same ID with
  other input returns `CONFLICT`. A refused call stores nothing.

The tools are listed to every verified account; rights are enforced on each call.

`set_wiki_page_content` replaces the whole Markdown. To change one passage with a
small request, read it with `read_wiki_page_range` and use `patch_wiki_page_content`;
see [Text ranges](#text-ranges-read-a-passage-patch-a-range).

### Wiki icon and cover

`read_wiki_page` returns the visual metadata of a page with its text:

- `icon` is a single emoji, or `null` when the page has none.
- `cover` is `null`, `{"kind":"preset","preset":<name>}` with `preset` one of
  `sunrise`, `ocean`, `forest`, `dusk`, `slate` or `sand`, or
  `{"kind":"attachment","attachmentId":<id>}` for an image attachment of the page.

Both are always present, `null` when not set. A page the account cannot see returns
`NOT_FOUND` and no metadata, like its text.

| Tool                  | Pages operation      | Arguments                                           | Changes    |
| --------------------- | -------------------- | --------------------------------------------------- | ---------- |
| `set_wiki_page_icon`  | `wiki.page.setIcon`  | `operationId`, `pageId`, `expectedRevision`, `icon` | Icon only  |
| `set_wiki_page_cover` | `wiki.page.setCover` | `operationId`, `pageId`, `cover`                    | Cover only |

- **Icon.** `create_wiki_page` takes an `icon` (an emoji or `null`), `set_wiki_page_icon`
  changes it and `icon:null` removes it; `read_wiki_page` confirms the stored value after
  each call. An icon is part of the revision, so `set_wiki_page_icon` follows the rules of
  [single-field wiki operations](#single-field-wiki-operations): it needs `expectedRevision`, raises the
  revision and keeps the previous state as a page version. Anything that is not a single
  emoji is `INVALID_REQUEST`.
- **Cover.** `set_wiki_page_cover` sets, replaces or removes the cover. `cover` is
  required and takes exactly the shape `read_wiki_page` returns: a preset, an attachment
  or `null` to remove it. Switching between the kinds is one call. Every other value,
  unknown keys included, is `INVALID_REQUEST`.
- **Image attachments.** `attachmentId` must belong to the page named by `pageId`,
  be a media attachment and be a JPEG, PNG, GIF or WebP image. Take it from the
  `attachmentId` of the `create_wiki_page` result, or from a `/wiki/attachments/<id>`
  link in the page's Markdown. An unknown preset, an attachment of another page, a
  file or media of another type and an attachment that does not exist all return the same
  `INVALID_REQUEST` without detail, so a response never reveals another page's
  attachments. Deleting the attachment in Pages removes the cover.
- **Not part of the text.** A cover is visual page metadata. Setting, replacing or
  removing it changes neither the Markdown, nor the revision, nor the page versions,
  nor the modification date. It therefore takes no `expectedRevision`, never returns
  `CONFLICT` for a revision and returns the current `revision` unchanged. The result is
  `{pageId, link, field:"cover", revision, changed, cover}`; `changed` is `false` when the
  stored cover was already the requested one, and nothing is written then.
- **Rights.** Pages checks the account on every call with the rules of the interface
  (`WikiCoverService`): without the write right the call returns `FORBIDDEN`, a page
  that is missing or hidden from the account returns `NOT_FOUND`. `set_wiki_page_cover`
  is listed to every verified account, like the other write tools.
- **Repeat.** Use a new `operationId` per intended change. Repeating the same ID with
  identical input returns the stored result without writing again, even when the cover
  has changed in between. The same ID with other input, or used for another operation,
  returns `CONFLICT`. A refused call stores nothing.
- **Not offered.** `create_wiki_page` has no cover argument; set the cover with a
  second call after creating the page.

### Text ranges: read a passage, patch a range

Four tools change small parts of a long text without moving the whole text. They
exist for the wiki Markdown (`content`) and the ticket `description`, and for no
other field, table or file. The existing whole-text tools (`read_wiki_page`,
`set_wiki_page_content`, `read_ticket`, `set_ticket_description`) are unchanged.

| Tool                            | Pages operation                | Arguments                                                                                                                           | Result                                                                                                               |
| ------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `read_wiki_page_range`          | `wiki.page.readRange`          | `pageId`, `start`; optional `end`, `maxCharacters`                                                                                  | `{pageId, link, revision, text, start, end, truncated, next, lineCount, characterCount, byteCount}`                  |
| `read_ticket_description_range` | `ticket.description.readRange` | `ticketId`, `start`; optional `end`, `maxCharacters`                                                                                | `{ticketId, key, link, descriptionVersion, text, start, end, truncated, next, lineCount, characterCount, byteCount}` |
| `patch_wiki_page_content`       | `wiki.page.patchContent`       | `operationId`, `pageId`, `expectedRevision`, `start`, `end`, `expectedText`, `replacementText`; optional `includeAfter`             | `{pageId, link, field:"content", revision, changed, start, end, after?}`                                             |
| `patch_ticket_description`      | `ticket.patchDescription`      | `operationId`, `ticketId`, `expectedDescriptionVersion`, `start`, `end`, `expectedText`, `replacementText`; optional `includeAfter` | `{ticketId, key, link, field:"description", changed, descriptionVersion, start, end, after?}`                        |

`pageId` and `ticketId` are named as in the single-field tools: an ID, a ticket key
such as `WORK-12`, or a Pages address. The read tools are listed to every verified
account, the patch tools like the other write tools.

#### Positions

A position is `{line, column}`. The convention is the same for reading and
patching and is fixed:

- **Lines and columns start at 1.** The range `start` is inclusive and `end` is
  exclusive. `start` after `end` is refused; equal positions are an empty range.
- **A column counts Unicode code points** of its line: not UTF-8 bytes, not UTF-16
  code units, not screen width and not table cells. An emoji such as 😀 is one
  column, an umlaut written as one code point is one column, and a letter with a
  separate combining accent is two. Text is never normalized.
- **Line breaks** are LF, CRLF and CR. A break is stored as it is and kept as it is.
  It counts as **one** column at the end of its line, a CRLF too, so no position
  lies between its CR and LF. The position after a break is column 1 of the next
  line.
- **The last position of a line** is the one right before its break, one column
  after its last character. On the last line it is the end of the text. A column
  beyond it is `column_out_of_range`, a line beyond the last one
  `line_out_of_range`.
- **Empty last line.** A text that ends with a break has a last, empty line;
  `{line: n, column: 1}` on it is the end of the text. An empty text has one empty
  line.

| To select                | `start`                | `end`                             |
| ------------------------ | ---------------------- | --------------------------------- |
| Line 7 with its break    | `{line: 7, column: 1}` | `{line: 8, column: 1}`            |
| Line 7 without its break | `{line: 7, column: 1}` | `{line: 7, column: <length + 1>}` |
| Lines 7 to 9             | `{line: 7, column: 1}` | `{line: 10, column: 1}`           |
| Insertion point          | `{line: 7, column: 4}` | the same position                 |

#### Reading a passage

`start` and `end` of a read need `line`; `column` may be left out and is then 1.
Without `end` the read runs on from `start` for at most `maxCharacters` characters
(default 4,096, at most 16,384; a CRLF counts as one character) and reports
`truncated: true` with `next`, the position to continue from, when more text
follows. With `end`, a passage longer than `maxCharacters` is refused with
`PAYLOAD_TOO_LARGE` and `details: {constraint: "textRangeCharacters", limit}`
instead of being cut. A `maxCharacters` above 16,384 is refused the same way.

The result holds the passage as `text`, its absolute `start` and `end`, and
`lineCount`, `characterCount` and `byteCount` (UTF-8) of the whole text. The whole
text is never returned, neither as a field nor inside another object. A read of a
page records no visit.

The result also names the text state to patch against:

- **Wiki:** `revision`, the existing page revision. Pass it as `expectedRevision`.
- **Ticket:** `descriptionVersion`, 32 lower-case hex digits: the first 128 bits of
  the SHA-256 of the UTF-8 bytes of the stored description. Pages derives it from
  the stored text on every call, so it needs no stored counter and no timestamp:
  two descriptions share a version only when they are equal. Pass it as
  `expectedDescriptionVersion`.

#### Patching a range

`patch_wiki_page_content` and `patch_ticket_description` replace exactly the text
between `start` and `end`. The request carries the range, the text the range
holds now (`expectedText`), the new text (`replacementText`) and the version; the
whole text is not part of it. Both positions need `line` and `column`.

- **Replace.** `expectedText` is the current text of the range, byte for byte,
  line breaks included. `replacementText` takes its place, as sent.
- **Insert.** Use the same position for `start` and `end`, and an empty
  `expectedText`.
- **Delete.** Use an empty `replacementText`. Exactly the range is removed.
- **Nothing else changes.** Everything before and after the range stays as it is:
  Markdown, code blocks, blank lines, links, images and line endings. Nothing is
  searched, normalized, replaced globally or moved to another line. A
  `replacementText` is inserted verbatim, so write the line endings the text uses
  (for example CRLF in a CRLF page). The line structure of the result is derived
  from the whole new text, so a replacement that starts with LF directly after a
  lone CR, or ends with CR directly before an LF, joins them into one CRLF.
- **Stored as composed.** A ticket description patched this way is stored exactly
  as composed. `set_ticket_description` trims the description it receives; a patch
  does not, because trimming would change text outside the range.
- **Result.** `changed` is `false` when the result equals the stored text; then no
  revision, version, history entry or event is written. `start` and `end` delimit
  the replacement in the new text, so reading `start`..`end` afterwards returns it.
  With `includeAfter: true` that passage is returned as `after` with the shape of a
  read (`text`, `start`, `end`, `truncated`, `next`), at most 4,096 characters.
  Otherwise no text is returned: no new complete text and no diff.
- **Atomic.** The version, the expected text and the write happen in one
  transaction. The wiki saves the next revision with its own page version, the
  previous text stays restorable, and links and activity are updated like for
  every save. A ticket description change writes its history entry. Whether the
  change is published to GitHub follows the Pages setting of the project; a patch
  never forces it. No Git push is part of these tools.
- **Repeat.** As for the other write tools: the same `operationId` with identical
  input returns the stored result without writing again, so a lost response is
  recovered and nothing is inserted twice. The same `operationId` with other input
  returns `CONFLICT`. A refused call stores nothing.

#### Errors

A refused call changes nothing and never retries on another range.

| Code                | When                                                                                | `details`                                                                    |
| ------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `CONFLICT`          | Wiki: the page was saved after `expectedRevision`                                   | `currentRevision`                                                            |
| `CONFLICT`          | Ticket: the description differs from `expectedDescriptionVersion`                   | `reason: "text_changed"`                                                     |
| `CONFLICT`          | The range holds other text than `expectedText`                                      | `reason: "range_text_mismatch"`                                              |
| `CONFLICT`          | `operationId` reused with other input                                               | none                                                                         |
| `INVALID_REQUEST`   | `start` after `end`; line or column outside the text; malformed or unknown argument | `reason: "range_reversed"`, `"line_out_of_range"` or `"column_out_of_range"` |
| `PAYLOAD_TOO_LARGE` | Passage over `maxCharacters`, or `maxCharacters` over 16,384                        | `constraint: "textRangeCharacters"`, `limit`                                 |
| `PAYLOAD_TOO_LARGE` | The new Markdown would exceed 1 MiB UTF-8                                           | `constraint: "wikiContentBytes"`, `limit`                                    |
| `PAYLOAD_TOO_LARGE` | The new description would exceed 65,536 UTF-16 code units                           | `constraint: "ticketDescriptionUtf16Units"`, `limit`                         |
| `NOT_FOUND`         | Hidden or missing page or ticket, including another person's private page           | none                                                                         |
| `FORBIDDEN`         | A patch without the write right                                                     | none                                                                         |

After `CONFLICT` read the range again, review the text, and patch with the new
version. The error never contains text of the page or ticket.

#### Limits and Unicode

- A request is at most 64 KiB of JSON, so `expectedText` and `replacementText`
  together stay small. Use the patch for a passage; use `set_wiki_page_content` or
  `create_wiki_page` for a large block of new text.
- Columns count code points. The limits count differently, and the checks use
  the unit of the field: wiki Markdown **1 MiB UTF-8 bytes** (an umlaut is 2 bytes,
  an emoji 4), ticket description **65,536 UTF-16 code units** (an emoji outside the
  Basic Multilingual Plane is 2 units, although it is one column). The limits are
  checked on the composed text, before anything is written.
- A passage response is bounded by `maxCharacters`, at most 16,384 characters.

#### Rights and visibility

Reading a passage is allowed for exactly the targets the whole-text read shows
(`read_wiki_page`, `read_ticket`), and a patch needs exactly the rights of the
whole-text change (`set_wiki_page_content`, `set_ticket_description`). Rights and
visibility are resolved on every call. A hidden target returns `NOT_FOUND`, also
for a patch.

#### Example: read, patch, read back

A page of about 80 lines is long, the change is one phrase on line 42. Read the
line (the request is sent as `arguments` of the tool call; the Pages operation
envelope is shown here):

```json
{
  "operation": "wiki.page.readRange",
  "parameters": {
    "pageId": "w1",
    "start": { "line": 42 },
    "end": { "line": 43 }
  }
}
```

```json
{
  "apiVersion": "1",
  "result": {
    "pageId": "w1",
    "link": "/wiki/w1",
    "revision": 2,
    "text": "Prüfe Dienst 20 auf Erreichbarkeit und notiere den Status in der Übersicht (Variante 20).\n",
    "start": { "line": 42, "column": 1 },
    "end": { "line": 43, "column": 1 },
    "truncated": false,
    "next": null,
    "lineCount": 79,
    "characterCount": 3949,
    "byteCount": 4025
  }
}
```

Patch only the phrase. It begins at column 1 and has 34 characters, so `end` is
column 35:

```json
{
  "operation": "wiki.page.patchContent",
  "parameters": {
    "operationId": "range-1",
    "pageId": "w1",
    "expectedRevision": 2,
    "start": { "line": 42, "column": 1 },
    "end": { "line": 42, "column": 35 },
    "expectedText": "Prüfe Dienst 20 auf Erreichbarkeit",
    "replacementText": "Prüfe Dienst 20 auf Erreichbarkeit und Latenz"
  }
}
```

```json
{
  "apiVersion": "1",
  "result": {
    "pageId": "w1",
    "link": "/wiki/w1",
    "field": "content",
    "revision": 3,
    "changed": true,
    "start": { "line": 42, "column": 1 },
    "end": { "line": 42, "column": 46 }
  }
}
```

The result says where the new text stands. Read it back with the returned
positions (or pass `includeAfter: true` to the patch). Only the page text was sent
and received, never the whole page.

The same flow with the sample page above (4,025 bytes of Markdown) and, for the
ticket, a description of 3,066 bytes. The figures are the JSON bytes of the request
and response bodies measured in one manual run on a synthetic instance, not token
counts, and they depend on the text:

| Flow                                                                        | Sent and received |
| --------------------------------------------------------------------------- | ----------------- |
| Wiki, whole text: `read_wiki_page` + `set_wiki_page_content`                | 8,689 bytes       |
| Wiki, range: `read_wiki_page_range` + `patch_wiki_page_content`             | 884 bytes         |
| Wiki, range with a read back of the changed line                            | 1,340 bytes       |
| Ticket, whole text: `read_ticket` + `set_ticket_description`                | 10,455 bytes      |
| Ticket, range: `read_ticket_description_range` + `patch_ticket_description` | 1,083 bytes       |

On a page of a few lines the envelopes weigh as much as the text, and the whole-text
tools are as small.

### Tickets and milestones

The following read and write tools let an agent plan work. Every argument is
required, unknown arguments are `INVALID_REQUEST`, and "nothing" is `null`. The one
exception is `create_ticket`, whose `projectId`, `milestoneId`, `departmentId` and
`assignee` may be left out; see "Defaults of `create_ticket`" in the section
"Ticket search, hierarchy, links and assignment". The tools that find
tickets and name assignment targets are described there as well.

| Tool                          | Pages operation               | Arguments (besides `operationId`)                                                                                       | Result                                       |
| ----------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `read_ticket`                 | `ticket.read`                 | `ticketId`                                                                                                              | Core fields, and the statuses of the project |
| `read_milestones`             | `milestones.read`             | `projectId`                                                                                                             | Milestones and dependencies of the project   |
| `create_ticket`               | `ticket.create`               | `type`, `title`, `description`, `statusId`, `parentId`; optional `projectId`, `milestoneId`, `departmentId`, `assignee` | `{ticketId, key, link, statusId}`            |
| `set_ticket_title`            | `ticket.setTitle`             | `ticketId`, `expectedTitle`, `title`                                                                                    | `{ticketId, key, link, field, changed}`      |
| `set_ticket_description`      | `ticket.setDescription`       | `ticketId`, `expectedDescription`, `description`                                                                        | `{ticketId, key, link, field, changed}`      |
| `set_ticket_status`           | `ticket.setStatus`            | `ticketId`, `expectedStatusId`, `statusId`                                                                              | `{ticketId, key, link, field, changed}`      |
| `set_ticket_parent`           | `ticket.setParent`            | `ticketId`, `expectedParentId`, `parentId`                                                                              | `{ticketId, key, link, field, changed}`      |
| `create_milestone`            | `milestone.create`            | `projectId`, `name`, `description`, `startAt`, `dueAt`                                                                  | `{milestoneId, projectId}`                   |
| `set_milestone_name`          | `milestone.setName`           | `milestoneId`, `expectedName`, `name`                                                                                   | `{milestoneId, projectId, field, changed}`   |
| `set_milestone_description`   | `milestone.setDescription`    | `milestoneId`, `expectedDescription`, `description`                                                                     | `{milestoneId, projectId, field, changed}`   |
| `set_milestone_status`        | `milestone.setStatus`         | `milestoneId`, `expectedStatus`, `status`                                                                               | `{milestoneId, projectId, field, changed}`   |
| `set_milestone_start`         | `milestone.setStartAt`        | `milestoneId`, `expectedStartAt`, `startAt`                                                                             | `{milestoneId, projectId, field, changed}`   |
| `set_milestone_due`           | `milestone.setDueAt`          | `milestoneId`, `expectedDueAt`, `dueAt`                                                                                 | `{milestoneId, projectId, field, changed}`   |
| `add_milestone_dependency`    | `milestone.dependency.add`    | `projectId`, `sourceId`, `targetId`, `linkType`                                                                         | The dependency, `removed: false`             |
| `remove_milestone_dependency` | `milestone.dependency.remove` | `projectId`, `dependencyId`                                                                                             | The dependency, `removed: true`              |

`ticketId` (and a parent) is a ticket ID, a key such as `WORK-12`, or a Pages
address such as `/tasks/WORK-12` or `/aufgaben/WORK-12`, with or without the
server in front. Milestones, dependencies, statuses and projects are named by ID.
Read first: `read_ticket` returns every value a change compares against, and the
status IDs that `set_ticket_status` and `create_ticket` take.

- **Only the named field changes.** Title, description, status and parent of a
  ticket and name, description, status and dates of a milestone are separate
  calls. Every other field, and every other ticket, stays as it is. A status
  change keeps the position value of the ticket; no other ticket moves.
- **Conflict.** Every change names the value the field had when you read it. When
  the field holds another value that is not the wanted one, the call returns
  `CONFLICT` and nothing is written. When it already holds the wanted value, the
  call succeeds with `changed: false`.
- **Parents.** A parent must be visible, in the same project, not archived and of
  the type the hierarchy requires (epics below initiatives, tasks below epics,
  subtasks below tasks). A hidden or missing parent is `NOT_FOUND`; a visible one of
  the wrong type or project is `INVALID_REQUEST`. A parent you cannot see reads as
  `null` and stays when you name none.
- **Rights.** Ticket calls need the write right (`FORBIDDEN` without it); a hidden
  ticket or project is `NOT_FOUND`. Milestone calls follow the project management
  right like the milestone page: an account that only writes tickets gets
  `FORBIDDEN`.
- **GitHub.** Tickets are created locally. Whether a created or changed ticket is
  published to GitHub follows the Pages setting of its project, exactly as for
  changes on the ticket pages; a call never forces it and nothing is published
  before the change is committed. A new parent and milestone changes are not
  published.
- **Repeat.** Use a new `operationId` per intended change. Repeating the same ID with
  identical input returns the stored result without writing again, which recovers
  from a lost response. The same ID with other input returns `CONFLICT`. A refused
  call stores nothing. The stored result is shown again only while its ticket or
  project is still visible.

Read and write tools are listed to every verified account; Pages enforces the corresponding UI rights on each invocation.

### Ticket checklist

Three tools read and set the checkboxes of one ticket: one call reads the whole
checklist, one call sets a single entry and one call sets several entries
together. Pages builds the checklist
from the same data the ticket page shows: the acceptance criteria of the ticket
(`source: "criteria"`) and the task list items of its Markdown description
(`source: "description"`). Only real list items count; a `- [ ]` inside a code
block is no entry.

| Tool                         | Pages operation             | Arguments (besides `operationId`)                            | Result                                                 |
| ---------------------------- | --------------------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| `read_ticket_checklist`      | `ticket.checklist.read`     | `ticketId`                                                   | `{ticketId, key, link, revision, items}`               |
| `set_ticket_checklist_item`  | `ticket.checklist.setItem`  | `ticketId`, `itemId`, `checked`, `expectedRevision`          | `{ticketId, key, itemId, checked, changed, revision}`  |
| `set_ticket_checklist_items` | `ticket.checklist.setItems` | `ticketId`, `expectedRevision`, `items: [{itemId, checked}]` | `{ticketId, key, link, revision, items, changedCount}` |

- **Entries.** Every entry has `id`, `source`, `text`, `checked`, `order` (position
  among all entries), `depth` and `parentId` (the enclosing description entry).
  Equal texts get different ids. An id stays the same when only its checkbox
  changes; it changes when the text or the position in the hierarchy changes.
- **Revision.** `revision` grows with every change through this API and
  whenever the description or an acceptance criterion differs from the last
  read; it never goes back, even when the checklist returns to an earlier state.
  A change names the revision you read; when anything changed since then the
  call returns `CONFLICT` and nothing is written. Read again and decide anew.
- **Explicit state.** `checked` is `true` or `false`; the call never toggles. An
  entry that already has the state stays unchanged (`changed: false`). Only the
  addressed entry changes: for a description entry only the character inside its
  brackets, every other character of the description stays as it is. The result
  carries the new revision for the next call.
- **Errors and rights.** An unknown or removed id is `NOT_FOUND`, like a hidden
  ticket. Setting needs the write right (`FORBIDDEN` without it). The same
  `operationId` with identical input returns the stored result without writing
  again.

#### Read the whole checklist and set several entries at once

`read_ticket_checklist` already returns the complete structure in one call, so no
entry needs a separate read: every entry with its stable `id`, `source`, `text`,
`checked`, `order`, `depth` and `parentId`, and the `revision` a change needs.
`set_ticket_checklist_items` takes that list as its basis: copy the `id` of every
entry to change as `itemId`, give it the `checked` state it must have, and send
the `revision` you read as `expectedRevision`.

Read (`ticketId` may be an ID, a key such as `PAGE-12` or a Pages address):

```json
{ "ticketId": "PAGE-12" }
```

```json
{
  "ticketId": "6f1c…",
  "key": "PAGE-12",
  "link": "/tasks/PAGE-12",
  "revision": "4",
  "items": [
    {
      "id": "md-1e9a72c8e0003a53",
      "source": "description",
      "text": "Parent task",
      "checked": false,
      "order": 0,
      "depth": 0,
      "parentId": null
    },
    {
      "id": "md-5d2478dbc16dadff",
      "source": "description",
      "text": "Nested task",
      "checked": false,
      "order": 1,
      "depth": 1,
      "parentId": "md-1e9a72c8e0003a53"
    },
    {
      "id": "ac-3b8e…",
      "source": "criteria",
      "text": "Criterion A",
      "checked": false,
      "order": 2,
      "depth": 0,
      "parentId": null
    }
  ]
}
```

Set two entries together; the entry you leave out stays as it is:

```json
{
  "operationId": "page12-checklist-1",
  "ticketId": "PAGE-12",
  "expectedRevision": "4",
  "items": [
    { "itemId": "md-5d2478dbc16dadff", "checked": true },
    { "itemId": "ac-3b8e…", "checked": true }
  ]
}
```

The result is the complete checklist as it is now, in the shape of the read, with
the new `revision` and `changedCount` (here `2`), ready for the next change:

```json
{
  "ticketId": "6f1c…",
  "key": "PAGE-12",
  "link": "/tasks/PAGE-12",
  "revision": "5",
  "items": ["… all entries, with the new checked states …"],
  "changedCount": 2
}
```

- **Only the named entries change.** Entries you leave out, every text and every
  other field of the ticket stay as they are; for a description entry only the
  character inside its brackets changes, so the rest of the description keeps
  every character, including trailing whitespace. An entry that already has the
  state is left alone. If every named entry already has its state, nothing is
  written and `revision` stays (`changedCount: 0`). The call never toggles.
- **Atomic.** Pages validates the whole request first and applies it in one
  transaction: either every named entry reaches its state or none changes, and
  the revision grows once per call.
- **Revision.** `expectedRevision` is compared with the current revision before
  any named entry is resolved. When anything in the checklist changed since your
  read, the call returns `CONFLICT` and writes nothing: read again and decide
  anew. Never reuse an older revision.
- **Refusals.** All are `INVALID_REQUEST` with `details.reason`:
  `checklist_items_invalid` (`items` is not a list of 1 to 500 objects with
  exactly `itemId` and a boolean `checked`), `checklist_item_duplicate` (an
  `itemId` is named twice) and `checklist_item_unknown` (an `itemId` is not in the
  checklist at `expectedRevision`). A hidden ticket is `NOT_FOUND`; without the
  write right the call returns `FORBIDDEN`, exactly as for `set_ticket_checklist_item`.
- **Repeat.** The same `operationId` with identical input returns the stored
  result without writing again; changed input returns `CONFLICT`.
- **Sessions.** An agent plan node with the `tickets` reach can call
  `set_ticket_checklist_items` on its bound tickets like the single-entry tool.

### Ticket search, hierarchy, links and assignment

Four read tools find tickets and read their hierarchy, links and assignment
targets; two write tools change the typed links between two tickets. Reads need no
write right. Like every Pages tool they show only what the signed-in account may see:
hidden tickets, people, groups and departments are neither listed nor counted, and
a hidden record answers exactly like a missing one (`NOT_FOUND`, message "Not found
or no access."). A response is limited to 1 MiB UTF-8 JSON (`PAYLOAD_TOO_LARGE`).

| Tool                        | Pages operation             | Arguments                                                                                                                                                 | Result                                                                                    |
| --------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `search_tickets`            | `tickets.search`            | `projectId`; optional `text`, `type`, `statusId`, `parentId`, `milestoneId`, `departmentId`, `assigneeId`, `assigneeGroupId`, `tagIds`, `cursor`, `limit` | `{projectId, tickets, total, nextCursor}`                                                 |
| `read_ticket_tree`          | `tickets.tree.read`         | `projectId` and/or `ticketId`; optional `cursor`, `limit`                                                                                                 | `{projectId, root, path, nodes, total, nextCursor}`                                       |
| `read_ticket_links`         | `tickets.links.read`        | `ticketId`; optional `cursor`, `limit`                                                                                                                    | `{ticketId, key, links, total, nextCursor}`                                               |
| `search_assignment_targets` | `assignment.targets.search` | optional `text`, `targetType`, `projectId`, `cursor`, `limit`                                                                                             | `{targets, total, nextCursor}`                                                            |
| `add_ticket_link`           | `tickets.link.add`          | `operationId`, `ticketId`, `targetTicketId`, `linkType`                                                                                                   | `{linkId, linkType, direction, ticketId, key, linkedTicketId, linkedKey, removed: false}` |
| `remove_ticket_link`        | `tickets.link.remove`       | `operationId`, `ticketId`, `linkId`                                                                                                                       | The same fields, `removed: true`                                                          |

Changing the parent stays `set_ticket_parent`, and the assignment stays
`set_ticket_assignee` (person, group, department or none); both are described in
the sections above. Moving a ticket below another parent and changing a link are
separate operations: neither touches the other, and neither touches any field.

#### Search

`search_tickets` lists the visible, non-archived tickets of one project, ordered by
ticket number. `text` (1 to 200 characters) matches key, title and description
without regard to case; `%` and `_` in it match themselves. `type`
(`initiative`, `epic`, `task`, `subtask`), `statusId`, `parentId` (a ticket ID,
key or Pages address; only its direct children), `milestoneId`, `departmentId`,
`assigneeId` or `assigneeGroupId` (not both) and `tagIds` (tickets that carry at
least one of up to 50 tags) narrow the result, and every filter you give applies.
Without a filter the call lists the project.

A hit has `id`, `key`, `link`, `projectId`, `type`, `title`, `priority`, `statusId`,
`statusName`, `isDone`, `parentId`, `parentKey`, `milestoneId`, `milestoneName`,
`assignee`, `assigneeGroup`, `department`, `tags` and `snippet`: up to 200
characters of the description around the match, `null` when the match is elsewhere.
A hit carries no description; `read_ticket` does.

- **Paging.** `limit` is 1 to 100 (default 100). `total` counts all visible matches;
  pass `nextCursor` with the same query to continue. A cursor is bound to the
  account and the query; another query returns `INVALID_REQUEST`. Because tickets
  are ordered by number, a cursor never repeats or skips a visible match, also when
  tickets are added between two pages.
- **Hidden.** A filter must name something you see. A status, milestone,
  department, person, group, tag or parent that is hidden, belongs to another
  project or does not exist returns `NOT_FOUND`, the same for all three, so a
  filter cannot be used to probe for hidden records. A parent of another project is
  `INVALID_REQUEST`.

#### Hierarchy

`read_ticket_tree` reads initiative → epic → task → subtask. With `projectId` it
lists every visible non-archived ticket of the project. With `ticketId` it returns
that ticket as `root`, its visible ancestors as `path` (outermost first) and its
visible descendants as `nodes`; the project may then be left out, and a project that
disagrees with the ticket is `INVALID_REQUEST`. A node has `id`, `key`, `link`,
`type`, `title`, `statusId`, `statusName`, `isDone`, `parentId`, `parentKey`,
`childCount` (visible direct children) and `depth` (visible ancestors; 0 without a
visible parent). The tree is rebuilt from `parentId`; a parent on another page keeps
its ID. A parent you cannot see reads as `null`, and the path ends there.

#### Links

A link has a type and a direction: `blocks` (the ticket blocks the other),
`duplicates` (the ticket duplicates the other) and `relates_to` (no direction).
`read_ticket_links` shows each link of a ticket with `id`, `linkType`, `direction`
(`outgoing` when this ticket is the source, `incoming` when the other one is), the
other ticket (`id`, `key`, `title`, `statusKey`, `isDone`) and `createdAt`. The
same link has the same `id` on both tickets, with the opposite direction. A link to
a ticket you cannot see is neither listed nor counted.

`add_ticket_link` creates the link from `ticketId` to `targetTicketId`. A link to
the ticket itself, or to an archived ticket, is `INVALID_REQUEST`. A link that
already exists is `CONFLICT` and nothing is written; `relates_to` counts as
existing from either side. A hidden or missing ticket is `NOT_FOUND`. `remove_ticket_link` removes the link `linkId` (an `id`
from `read_ticket_links`) from either side. A link that does not exist, belongs to
other tickets or whose other ticket you cannot see is `NOT_FOUND`. Links are
Pages-only: nothing is published to GitHub.

#### Assignment targets

`search_assignment_targets` lists the persons, groups and departments you may
assign tickets to. `text` (1 to 200 characters) is part of the name, without
regard to case; `targetType` is `person`, `group` or `department` (all three when
left out); `projectId` limits persons to those who may be assigned in that project
(a hidden or missing project is `NOT_FOUND`). The call never picks one: every match
is listed with `targetType`, `id` and `name`, a person also with the `departments`
and `groups` that tell equal names apart, and `isExactMatch` is `true` when the
name equals `text`. Several exact matches are ambiguous, so ask rather than choose.
Pass the `id` to `set_ticket_assignee` or to `create_ticket`.

#### Defaults of `create_ticket`

What a call leaves out, or passes as `null`, is taken from the parent and the
signed-in account, and never invented:

| Argument       | Left out or `null`                                                        | Stated                                                                                                               |
| -------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `projectId`    | The project of the parent; one of the two is required (`INVALID_REQUEST`) | Must equal the project of the parent, else `INVALID_REQUEST`                                                         |
| `milestoneId`  | The milestone of the parent, when it has one                              | A milestone of the project; another one is `NOT_FOUND`                                                               |
| `departmentId` | The department of the parent, when it has one and you may select it       | A department you may select; a hidden or missing one is `NOT_FOUND`, a visible one you may not select is `FORBIDDEN` |
| `assignee`     | The person you are signed in as, as on the ticket pages                   | `{targetType: person\|group, targetId}` or `{targetType: none, targetId: null}` for nobody                           |

- **Whose ticket.** The assignee is the verified Pages person of the credential, not
  a service account and not the person who created the previous ticket. Several
  people can use the same package at the same time; each new ticket belongs to the
  one who created it.
- **Milestone thread.** The milestone rules of the section "Milestones, initiatives,
  tags and links" hold: a task that carries a milestone gives it to its epic
  when that has none, links its initiative, and nothing is overwritten.
- **Refusals.** A person who may not be assigned in the project is
  `INVALID_REQUEST`; a person, group or department you cannot see is `NOT_FOUND`,
  like a missing one; a visible department you may not select is `FORBIDDEN`. A
  refused call creates nothing.
- **Structured import.** `apply_structured_import` keeps stating every value: it
  takes nothing from the parent and assigns nobody by default.

#### End to end

A typical order: `search_tickets` to find the ticket, `read_ticket_tree` and
`read_ticket_links` to understand where it sits, `create_ticket` below the right
parent (or `set_ticket_parent` / `add_ticket_link` to change relations),
`search_assignment_targets` and `set_ticket_assignee` for the assignment, and
`read_ticket` to read the values back.

### Structured import

`plan_structured_import` (`import.structured.plan`, read-only) and
`apply_structured_import` (`import.structured.apply`) import projects' worth of
planning data in one manifest: milestones, tickets, wiki pages and the links
between them. The agent decides what becomes a page, a ticket or a milestone;
Pages checks the structure, shows every object before anything is written and
then applies it source by source.

```json
{
  "version": "1",
  "sources": [
    { "kind": "project", "key": "p", "projectId": "<existing project id>" },
    {
      "kind": "milestone",
      "key": "m1",
      "name": "Release 1",
      "dueAt": "2026-12-31"
    },
    { "kind": "ticket", "key": "epic", "type": "epic", "title": "Import" },
    { "kind": "ticket", "key": "task", "type": "task", "title": "Write it" },
    {
      "kind": "wiki",
      "key": "docs/guide.md",
      "content": "# Guide\n![Diagram](img/a.png)"
    }
  ],
  "links": [
    { "type": "parent", "from": "task", "to": "epic" },
    { "type": "milestone", "from": "task", "to": "m1" },
    { "type": "dependency", "from": "m2", "to": "m1", "linkType": "follows" }
  ],
  "assets": [
    { "path": "docs/img/a.png", "assetId": "<id from prepare_asset_upload>" }
  ],
  "wiki": { "project": "p", "parentId": null }
}
```

- **Sources.** `project` names an existing visible project by ID and nothing
  else; a project is never created. `milestone` and `ticket` name their project
  by key (left out when the manifest has exactly one project). `wiki` is a
  Markdown page whose key is its relative path, with the wiki import preview rules for titles
  and folders. Keys are unique per kind. `wiki` names the project and the
  parent page for all pages; `parentId: null` is the project root.
- **Links.** Only keys of the same manifest: `parent` (ticket to ticket, of the
  type the hierarchy requires), `milestone` (ticket to milestone) and
  `dependency` (milestone to milestone, with `linkType`). Both ends are in one
  project. There is no lookup by name and no link to an object outside the
  manifest; link existing objects afterwards with the single-field tools.
- **Assets.** An asset path is relative to the manifest root. A relative image or
  file link of a page is resolved against the folder of the page and, when it
  matches an asset path, rewritten to `/agent-assets/<assetId>`; the asset becomes
  an attachment of that page. Fragments and queries stay (`#page=2`). Code
  blocks, inline code, raw HTML, absolute links, anchors and links to other
  Markdown pages are never changed, and a destination with an escape or an
  entity stays as written and is reported. One asset belongs to one page.
- **Preview.** The plan lists every object with `create`, `unchanged`,
  `conflict`, `invalid` or `blocked`, the links, the relative links and where
  they will point, the assets and their state, the conflicts and the errors, and
  names the GitHub effect (publication follows the Pages setting of each
  project). Errors (missing reference, cycle, wrong parent type, unusable
  asset, missing right, invalid field) must be fixed first: a plan with errors is
  refused by apply and nothing is written. Hidden and missing projects and
  parents are `NOT_FOUND`. The SHA-256 `fingerprint` binds the manifest and the
  state it was planned against.
- **Apply.** Repeat the exact manifest and the fingerprint with a new
  `operationId`. Order: milestones, tickets with parents first, dependencies,
  then wiki pages (the wiki import application rules, unchanged). Every source commits its object,
  its mapping and its outcome together; targets a source builds on come from the
  outcomes of the same run. After a lost response, a timeout or an interruption
  repeat the call with the same `operationId` and input: committed sources are
  not applied again and the same IDs are returned. A stale fingerprint or other
  input under the same ID returns `CONFLICT`.
- **Repeat and conflicts.** A source whose key is already mapped is `skipped` when
  its target shows it (or nothing moved) and a `conflict` otherwise:
  `source_changed` (the manifest changed), `target_changed` (the object was
  changed in Pages) or `target_removed`. Nothing is overwritten. When the target
  already shows a changed source because you moved it with the single-field
  tools, the next run accepts it. A new object below an existing but conflicting
  parent is created; an object below a failed or removed one is a conflict
  with `reason: "blocked"`. Changed pages are updated with `update_wiki_import`.
- **Result.** `{runId, status, counts, items}`; each item has `kind`, `sourceKey`,
  `action` (`created`, `skipped`, `conflict`, `failed`), the target ID, the ticket
  key and link, the parent and milestone it was linked to, the attachments, a
  `reason` and a fixed `errorCode`.

Limits: 100 sources, 200 links, 32 assets, and for the wiki part the wiki import preview limits
(32 pages, 16 KiB each, 32 KiB together); 64 KiB request, 1 MiB response. Apply has
a thirty-second budget.

### Wiki comments

Five tools read and change the comments of wiki pages. They are the same
comments people write in Pages and appear there at once.

| Tool                   | Pages operation        | Arguments                                                     | Does                                             |
| ---------------------- | ---------------------- | ------------------------------------------------------------- | ------------------------------------------------ |
| `read_wiki_comments`   | `wiki.comments.read`   | `pageId`                                                      | Threads, oldest first, each with its replies     |
| `add_wiki_comment`     | `wiki.comment.add`     | `operationId`, `pageId`, `body`; optional `parentId`, `quote` | Adds a comment, or a reply to a first comment    |
| `edit_wiki_comment`    | `wiki.comment.edit`    | `operationId`, `commentId`, `body`                            | Replaces the text of a comment (its author only) |
| `resolve_wiki_comment` | `wiki.comment.resolve` | `operationId`, `commentId`, `resolved`                        | Resolves a thread, or opens it again             |
| `delete_wiki_comment`  | `wiki.comment.delete`  | `operationId`, `commentId`                                    | Deletes a comment with its replies               |

`pageId` is a page ID or a Pages address such as `/wiki/<id>`. A comment is named by
its `commentId`, which `read_wiki_comments` returns; the page follows from it.
Unknown arguments are `INVALID_REQUEST`.

- **Rights.** Seeing the page is enough to read, comment, reply and resolve, also
  without the write right. These tools are therefore offered to every verified
  account, not only to those holding the write capability. Changing a text
  belongs to its author (`canEdit`); deleting belongs to the author, the owner of
  the page and administrators, not on private pages (`canDelete`), exactly as in
  the wiki. Administrators are decided with the same MCP access context as every
  other operation. Anybody else gets `FORBIDDEN`.
- **Hidden pages.** A page or comment the account cannot see, and one that does
  not exist, both return `NOT_FOUND` for every one of the five operations.
- **Replies.** `parentId` is the ID of a first comment of the same page. A reply,
  a comment of another page, a missing comment and a comment on a hidden page are
  all `INVALID_REQUEST`. Leave `parentId` out to start a thread.
- **Quote.** `quote` is the passage of the page text the comment refers to (at
  most 500 characters); leave it out for a comment on the page. The result
  reports `isStale: true` when the passage is not in the text. The text of a
  comment has at most 5000 characters and must not be empty.
- **Author.** A comment appears under the display name of the account the
  credential belongs to. The wiki has no marker for comments written by an agent.
- **Mentions.** `@username` of an active account records a mention for that
  person, exactly as when it is typed in Pages: it appears in their area "For me"
  of the wiki when they can see the page. Nothing is sent by mail or push, and a
  private page records no mentions. Editing a comment replaces its mentions;
  deleting removes them.
- **Edit and resolve.** Setting a text or a state that is already there writes
  nothing (`changed: false`); a thread that is already resolved keeps who resolved
  it, and when. Only the first comment of a thread is resolved; resolving a
  reply is `INVALID_REQUEST`. An edited text is not kept as a version.
- **Delete.** Pass the user's exact language-specific `confirmation` (`LÖSCHEN` or `DELETE`); missing or wrong confirmation returns `CONFIRMATION_REQUIRED`. `deletedComments` names the scope: the comment and all replies to
  it. Deleting cannot be undone.
- **Repeat.** Use a new `operationId` per intended change. Repeating an ID with
  identical input returns the stored result without writing again, which recovers
  from a lost response. The same ID with other input returns `CONFLICT`. An
  operation ID belongs to the account that used it. A refused call stores
  nothing.

Results: an add returns `{commentId, pageId, link, parentId, isStale}`; an edit,
resolve or delete returns `{commentId, pageId, link, action, changed,
deletedComments}` with `action` one of `edited`, `resolved`, `reopened` and
`deleted`. A read returns `{pageId, link, threads}`; every comment has `id`,
`parentId`, `authorName`, `body`, `quote`, `isStale`, `createdAt`, `updatedAt`,
`isResolved`, `resolvedAt`, `resolvedByName`, `canEdit` and `canDelete`. Account
identifiers are not part of the result.

Limits: 64 KiB request, 1 MiB response (`PAYLOAD_TOO_LARGE` beyond).

### Wiki and project foundations

Pages authorizes every operation using current account rights and the same business
services as the UI. There is no additional MCP permission or write switch. Project
deletion is never offered. Failed changes leave neither an activity entry nor a
replay record. Project activity carries `source:ui|mcp|ai`; these MCP calls use `mcp`.

Directory and project reads are `list_departments`, `list_groups`, `list_visible_people`,
`read_wiki_outline`, `read_wiki_links`, `read_project_members`,
`read_project_activity` and `list_project_tickets`. Lists accept `limit` (1–100)
and `cursor`; continue with `nextCursor` and the same query. Counts and all entries
use current visibility on every page. Comment lists preserve the UI chronology; if a continuation comment was deleted, restart the list after `INVALID_REQUEST`. Cursors contain no global database row positions. People expose only IDs, display names,
departments and groups. Ticket reads also expose visible assignments.

Project and assignment writes are `delete_wiki_page`, `create_project`, `set_project_name`,
`set_project_description`, `set_project_status`, `set_project_dates`,
`assign_project_member`, `remove_project_member`, `set_ticket_assignee`,
`assign_ticket_to_milestone`, `delete_ticket` and `delete_milestone`.

| Tool                         | Pages operation          | Required arguments                                                                                   |
| ---------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `set_ticket_assignee`        | `ticket.setAssignee`     | `operationId`, `ticketId`, `targetType`, `targetId`, `expectedAssigneeId`, `expectedAssigneeGroupId` |
| `assign_ticket_to_milestone` | `ticket.assignMilestone` | `operationId`, `ticketId`, `milestoneId`, `expectedMilestoneId`                                      |
| `delete_ticket`              | `ticket.delete`          | `operationId`, `ticketId`, `confirmation`                                                            |
| `delete_milestone`           | `milestone.delete`       | `operationId`, `projectId`, `milestoneId`, `confirmation`                                            |

Project group assignment applies to visible eligible members of the group using
the existing person-membership model. Department assignment uses the existing
project management policy. Ticket assignees support person, group, none and
department; department changes require `expectedDepartmentId` and use the UI
department policy. Other assignment changes compare their last-read values.
Milestones receive their ticket assignments through `assign_ticket_to_milestone`.

For every deletion, first ask the user to type `LÖSCHEN` (German) or `DELETE`
(English) and pass that exact reply as `confirmation`. Never infer consent.
Wiki deletion uses the existing trash, includes descendants and reports
`recursive:true`, `affectedCount` and `disposition:trash`. Tickets and milestones
use soft archiving and the [shared archive rights](../README.md#ticket-and-milestone-archive-rights):
the role capability "Milestones" together with responsibility for the visible
target's project. Ordinary writing or assignment rights do not suffice; `write`
is not additionally required. MCP uses the existing personal-administrator
eligibility, independent of the browser's role mode. Comment deletion remains irreversible.

Wiki creation and moves support project, instance and private scope. Use
`projectId:null` with explicit `scope:instance` or `scope:private`. Wiki writes
with a revision accept `expected_revision` at the Pages API as well as the
existing `expectedRevision`; deletion advertises `expected_revision`. A stale
revision returns `CONFLICT` with `details.currentRevision`.

Wiki content accepts at most 1 MiB of UTF-8 on reads and writes. Create/content
JSON envelopes allow the corresponding escaped text plus metadata; all other
requests keep 64 KiB and list responses keep 1 MiB. Oversize contents return
`PAYLOAD_TOO_LARGE`, never truncation or content paging. Internal references
`[Title](page:<id>)` are indexed together with existing `/wiki/<id>` links;
forward and back link reads omit invisible pages.

### Milestones, initiatives, tags and links

Rights are the ones of the interface, checked by Pages on every call; this package
adds no switch and no rule. The following tools manage tags, initiative links and wiki anchors.

| Tool                          | Pages operation               | Arguments                                                 | Does                                                             |
| ----------------------------- | ----------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------- |
| `list_ticket_tags`            | `tags.list`                   | optional `cursor`, `limit`                                | The catalog of tags, ordered by name                             |
| `set_ticket_tags`             | `ticket.setTags`              | `operationId`, `ticketId`, `tagIds`, `expectedTagIds`     | Replaces the tags of a ticket with tags of the catalog           |
| `add_milestone_initiative`    | `milestone.initiative.add`    | `operationId`, `projectId`, `milestoneId`, `initiativeId` | Links an initiative with a milestone of its project              |
| `remove_milestone_initiative` | `milestone.initiative.remove` | `operationId`, `projectId`, `milestoneId`, `initiativeId` | Removes the link while nothing below the initiative uses it      |
| `set_wiki_page_anchors`       | `wiki.page.setAnchors`        | `operationId`, `pageId`, `anchors`, `expectedAnchors`     | Replaces the departments, milestones and epics a page is tied to |

- **Hierarchy.** Initiative → Epic → Task → Subtask is the parent chain
  (`create_ticket`, `set_ticket_parent`); a wrong level is `INVALID_REQUEST`. A ticket
  carries one milestone (`assign_ticket_to_milestone`). An initiative can be linked with
  several milestones: its own milestone and every `add_milestone_initiative` link count.
  `add_milestone_initiative` takes only an initiative of the project of the milestone.
- **Thread of milestones.** When a task is assigned to a milestone, in Pages as well as
  here, its epic takes the milestone if it has none, and its initiative is linked with
  it. An epic keeps a milestone it already carries, because it carries exactly one.
  Only a task starts the thread; nothing is removed by it.
- **Unlinking.** `remove_milestone_initiative` returns `CONFLICT` while an epic, task or
  subtask below the initiative still carries the milestone, hidden ones included, and
  `changed:false` when the link does not exist. It also clears the own milestone of the
  initiative when that is the one named.
- **Tags.** The tags are the labels of the catalog in Pages. `tagIds` and `expectedTagIds` hold tag IDs from `list_ticket_tags`. No tool
  creates, renames or deletes a tag; a tag outside the catalog is `INVALID_REQUEST` and
  changes nothing. `expectedTagIds` must equal the tags read last, otherwise `CONFLICT`;
  tags that someone already set to the requested value are not a conflict. A ticket
  carries no tag by default.
- **Wiki links.** `anchors` is a list of `{kind, targetId}` with `kind` one of
  `department`, `milestone` and `epic`. A tied page is visible only to people who see
  every target, exactly as in the wiki; the page service of Pages decides who may tie.
  `read_wiki_page` returns the `anchors` of a page; `read_milestones` and
  `read_ticket` (epics) return the visible `wikiPages` tied to them. Links between a
  ticket and a page are written into the text (`set_wiki_page_content` with the ticket
  key, `set_ticket_description` with the page address).
- **Reads.** `read_ticket` and `list_project_tickets` carry `tags`; an initiative
  carries `linkedMilestones`. `read_ticket` also carries `descendantCount`, the visible
  active epics, tasks and subtasks that `delete_ticket` moves to the archive with the
  ticket; name that number when you ask for the confirmation. `read_milestones` carries
  the visible `initiatives` and `wikiPages` of every milestone. What the account cannot
  see appears as neither entry, placeholder nor count.
- **Soft archiving and restoring.** The compatible names `delete_ticket` and
  `delete_milestone` preserve records instead of permanently deleting them. They
  require exact `LÖSCHEN` (German) or `DELETE` (English) confirmation in the account's
  current language. `delete_ticket` archives the ticket and its active descendants,
  preserving workflow status; `recursive:true`, `disposition:trash` and
  `affectedCount` report the newly archived tickets, including the target only if
  it was active. Already archived tickets receive no additional archive history.
  A fresh operation on a fully archived subtree returns `changed:false` and
  `affectedCount:0`. `delete_milestone` archives only the milestone
  (`affectedCount:1`, `disposition:trash`), removes its incident dependencies and
  leaves tickets, ticket assignments and initiative links unchanged. People restore
  tickets with their subtree in Pages; Pages does not automatically purge the archive.
- **Archive authorization.** Both tools use the [same server archive decision as the UI](../README.md#ticket-and-milestone-archive-rights):
  current `milestones` capability and project responsibility, or personal Pages
  administrator eligibility on MCP. Project and own ticket department visibility
  still apply; milestone visibility follows the project. Generic ticket write or
  assignment rights alone return `FORBIDDEN`. Hidden or missing targets both return
  `NOT_FOUND`; hidden descendants prevent archiving the subtree with
  `INVALID_REQUEST`. Missing or incorrect confirmation returns
  `CONFIRMATION_REQUIRED`. Rejections write no records, archive history, activity or
  operation key. `tools/list` advertises these operations without granting target
  rights; every `tools/call` rechecks current identity, target visibility and rights
  inside the Pages service. The adapter has no database or separate permission path.
- **Activity.** Changes are written to the activity of the project with the marker
  `mcp`; a change of anchors appears in the category `wiki`.
- **Repeat.** `operationId` works as for every other write: repeating it with identical
  input returns the stored result, other input returns `CONFLICT`. Archive repeats
  recheck current account validity, confirmation language, target visibility and
  archive rights before returning the stored result. Rights revoked after the first
  call therefore deny a repeat, without another write or activity entry.

### Agent workspaces

A workspace registers an existing local directory of the machine that runs Pages
for a project that has a GitHub link. Agents of Pages use it as their working
directory. These tools manage the registration only: they never read, create,
change or delete a file in the directory, and they never change the GitHub link
of the project. Pages applies the rules of the workspace page on every call and
adds no switch of its own.

| Tool               | Pages operation     | Arguments                                                                                    | Does                                                          |
| ------------------ | ------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `list_workspaces`  | `workspaces.list`   | optional `projectId`, `cursor`, `limit`                                                      | The workspaces of the projects the account can open, by name  |
| `read_workspace`   | `workspaces.read`   | `workspaceId`                                                                                | One workspace with the same fields                            |
| `create_workspace` | `workspaces.create` | `operationId`, `name`, `path`, `projectId`                                                   | Registers an existing directory for a project                 |
| `update_workspace` | `workspaces.update` | `operationId`, `workspaceId`, `expectedRevision`, one or more of `name`, `path`, `projectId` | Changes what is named; the rest keeps its value               |
| `remove_workspace` | `workspaces.remove` | `operationId`, `workspaceId`, `expectedRevision`                                             | Unregisters the workspace; directory, project and GitHub stay |

- **Entries.** `id` is stable for the life of the registration. An entry carries
  `name`, the canonical absolute `path`, `projectId` and `projectName`, `github`
  (`repoUrl`, `repoName`) taken from the project, `revision`, `isUsable` with
  `unavailableReason` (`project_unavailable`, `github_link_missing`,
  `path_invalid`, `path_unavailable`, `path_not_allowed` or `path_changed`), and
  `canManage` for the connected account. Lists carry `total` and `nextCursor`.
- **Visibility.** Only workspaces of projects the account can open are returned.
  A workspace of a hidden project answers `NOT_FOUND`, exactly like a missing one,
  and no list, count or error names it.
- **Who may change.** Pages administrators and the managers of the project: the
  project role Manager, or the role capability for projects within its scope.
  Membership and ordinary ticket rights are not enough and return `FORBIDDEN`.
  Moving a workspace needs the right on the old and the new project.
- **Project.** The project must be visible and linked to a GitHub repository.
  An unknown or hidden project is `NOT_FOUND`; a visible project without a link
  is `INVALID_REQUEST`.
- **Path.** `path` must be an absolute path of an existing directory of the Pages
  server that its account can read, write and traverse. URLs, `host:path`
  notation, network shares, relative paths, `..`, the filesystem root and the
  folders of the Pages instance are `INVALID_REQUEST`. No environment variable
  is needed; an operator can narrow the usable area with `PAGES_WORKSPACE_ROOTS`.
  A directory that another workspace registers or overlaps is `CONFLICT`.
- **Repeat and conflicts.** Writes take an `operationId`: repeating a call with
  identical parameters returns its stored result and never registers twice;
  other parameters return `CONFLICT`. `update_workspace` and `remove_workspace`
  take the `revision` read last as `expectedRevision`. A stale value returns
  `CONFLICT` with `details.currentRevision` and changes nothing. An update that
  names the stored values returns `changed:false`.
- **Removing.** A workspace that plans, agents or runs still refer to cannot be
  rebound or removed (`CONFLICT`). Removing needs no typed confirmation; the
  registration can be created again.

### User agents

A user agent is an agent definition that a person owns: a name, a Markdown
instruction with optional parameters, one of the models that administrators
released for that person, a reasoning effort, and who may use it. These tools
work on the same agents as the agent page of Pages and under its rules. They
add no right of their own, and they do not reach the agents of the
administration, runs, plans, workspaces or the deletion of an agent.

| Tool                | Pages operation      | Arguments                                                                                                                                                              | Does                                                         |
| ------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `list_agents`       | `agents.list`        | optional `cursor`, `limit`                                                                                                                                             | The agents the account owns or that are shared with it       |
| `read_agent`        | `agents.read`        | `agentId`                                                                                                                                                              | One agent with the same fields                               |
| `list_agent_models` | `agents.models.list` | none                                                                                                                                                                   | The models the account may give an agent, with their efforts |
| `create_agent`      | `agents.create`      | `operationId`, `name`, optional `instruction`, `parameters`, `directoryParameter`, `modelProfileId`, `reasoningEffort`, `sharing`                                      | Creates a private agent owned by the connected account       |
| `update_agent`      | `agents.update`      | `operationId`, `agentId`, `expectedRevision`, one or more of `name`, `instruction`, `parameters`, `directoryParameter`, `modelProfileId`, `reasoningEffort`, `sharing` | Changes what is named; the rest keeps its value              |

- **Entries.** `id` is stable. An entry carries `name`, `instruction`
  (Markdown with `{{parameter}}`, `{{parameter.path}}`, `{{parameter.link}}` and
  `{{parameter.markdown}}` placeholders), `parameters` (`name`, `type` of `text`,
  `workspace` or `wiki`, `description`, `isRequired`, `defaultValue` of the same
  type or `null`), `directoryParameter`, `run` (how a runner may work in a
  workspace: `access`, `shell`, `web`, `timeoutMinutes`; read only over MCP),
  `modelProfileId`, `model`, `reasoningEffort`, `sharing`, `ownerId`, `canEdit`,
  `isUsable` (a run could start for this account now), `hasDeletedTargets` and
  `revision`. Lists are ordered by name and carry `total` and `nextCursor`; a
  page whose entries exceed 1 MiB of JSON is `PAYLOAD_TOO_LARGE`
  (`details.constraint` `responseBytes`), so ask for a smaller `limit`.
- **Visibility.** An account sees the agents it owns and the agents shared with
  it. Lists, counts and errors never mention another agent: an agent the account
  cannot see answers `NOT_FOUND`, exactly like a missing one, and agents of the
  administration are not part of these tools. When a share ends, the agent
  disappears from the list of the people it was shared with.
- **Owner.** The owner of a new agent is the account of the credential. No
  parameter names an owner or another user; such a parameter is an unknown
  parameter and returns `INVALID_REQUEST`. Only the owner may change an agent: a
  person it is shared with gets `FORBIDDEN` from `update_agent`, because the right
  to use an agent is not the right to change it.
- **Sharing.** `sharing` replaces the whole share. `scope` is `private` (only the
  owner, the default of a new agent), `global` (every account) or `restricted`
  with `groupIds` and/or `departmentIds` (at least one id) and `operator`: `or`
  (member of any target) or `and` (member of every target). An omitted `operator`
  is `or` for a new share; when a restricted share is changed it keeps the stored
  operator, so leaving it out never widens an `and` share. Any existing group or
  department of the instance can be a target, as in the agent form;
  `list_groups` and `list_departments` list those visible to the account, and an
  unknown id is `INVALID_REQUEST` with reason `sharing_target_unavailable`. A
  private or global share names no targets and no operator. An entry shows the
  groups and departments of a share with their names, the same directory the
  agent form shows. A share never gives the right to change the agent, a model, a
  connection or a project. When a group or department of a share was deleted
  (`hasDeletedTargets`), `update_agent` needs an explicit `sharing`
  (`sharing_changes_required`) and always saves it, because saving writes the
  list without the deleted target.
- **Models.** `list_agent_models` returns only the models that administrators
  released for the account, whose connection verifies now and whose scope admits
  the account, without credentials or connection details. An entry carries
  `modelProfileId` (pass it to `create_agent` and `update_agent`), `name`, `model`,
  `reasoning` (`levels`, `automatic`, `none` or `unknown`), `reasoningEfforts` as
  the catalog lists them (empty unless `levels`), `catalogDefaultReasoningEffort`
  as the catalog names it, `defaultReasoningEffort` as Pages applies it, and
  `isDefault`. A model that lists levels needs one of them; `high` can be chosen
  only where the model lists it. A model without levels takes `reasoningEffort`
  `null`. Pages checks model and effort again whenever an agent is saved: a
  withdrawn model, a connection whose scope no longer admits the account or an
  effort the catalog no longer lists is refused with `model_unavailable` or
  `reasoning_unsupported`. Passing `modelProfileId` to an agent that cannot run
  saves it again, which pins the model's current connection.
- **Defaults.** Omitted values are never taken from a name in the adapter.
  Without `modelProfileId`, `create_agent` uses the first model of the list, the
  one the agent form of Pages starts on (`isDefault`). Without `reasoningEffort`
  it uses `medium` when the model lists it, otherwise the default the catalog
  names for that model, and nothing else. When no model is released for the
  account the call is `FORBIDDEN` with reason `default_model_unavailable`; when
  the model lists levels but none can be applied it is `INVALID_REQUEST` with
  reason `reasoning_required`. An update that passes `modelProfileId` without
  `reasoningEffort` keeps the stored effort, so pass both when the new model lists
  other efforts.
- **Definition file.** Pages writes `Agents/<agent-id>/AGENT.md` into the agent
  folder of the instance (`Agents/` next to `config.toml`, `~/.pages/Agents/` by
  default) whenever the agent is saved, from the stored definition.
  No tool chooses a path, and no tool reads, writes or deletes a file. Run files
  and run records are not part of these tools.
- **Run options.** `run` is shown but cannot be set; it keeps the value an agent
  has, or the Pages default for a new one. Change it on the agent page.
- **Repeat and conflicts.** Writes take an `operationId`: repeating a call with
  identical parameters returns its stored result (`id`, `changed`, `revision`) and
  never creates a second agent; other parameters return `CONFLICT`. The result is
  shown again only while the account still owns the agent. `update_agent` takes the
  `revision` read last as `expectedRevision`. A stale value returns `CONFLICT`
  with `details.currentRevision` and changes nothing; a request that names the
  stored values returns `changed:false` without a new revision.
- **Limits.** At most 100 agents per account, 50 parameters per agent, a name of
  200 characters and an instruction of 200,000 characters, within the request
  limit of 64 KiB of UTF-8 JSON (`PAYLOAD_TOO_LARGE`).

Error codes of these tools, with `details.reason` where Pages names one:

| Code                | `details`                         | Meaning                                                                                       |
| ------------------- | --------------------------------- | --------------------------------------------------------------------------------------------- |
| `INVALID_REQUEST`   | none                              | Unknown, missing or malformed parameter, including an owner or user parameter                 |
| `INVALID_REQUEST`   | `model_unavailable`               | The model is not released for the account, does not exist, or no longer verifies or admits it |
| `INVALID_REQUEST`   | `reasoning_unsupported`           | The model does not list the effort, or lists levels and `null` was passed                     |
| `INVALID_REQUEST`   | `reasoning_required`              | The effort was omitted and the model lists levels without a default Pages can apply           |
| `INVALID_REQUEST`   | `sharing_target_unavailable`      | A group or department of `sharing` does not exist                                             |
| `INVALID_REQUEST`   | `sharing_changes_required`        | The stored share names a deleted group or department; pass `sharing`                          |
| `INVALID_REQUEST`   | `configuration_invalid`           | Undeclared or mistyped placeholder, invalid parameter declarations or directory parameter     |
| `INVALID_REQUEST`   | `credentials_in_text`             | The name or instruction looks like a credential                                               |
| `INVALID_REQUEST`   | `parameter_reference_unavailable` | A workspace or wiki default is not available to the account                                   |
| `INVALID_REQUEST`   | `agent_limit_reached`             | The account owns 100 agents                                                                   |
| `FORBIDDEN`         | none                              | The agent is visible but the account is not its owner                                         |
| `FORBIDDEN`         | `default_model_unavailable`       | No model is released for the account, so no default exists                                    |
| `NOT_FOUND`         | none                              | The agent does not exist, is not visible, or belongs to the administration                    |
| `CONFLICT`          | `currentRevision`                 | `expectedRevision` is stale; nothing was written                                              |
| `CONFLICT`          | `agent_running`                   | A running plan holds the agent; change it after the run                                       |
| `CONFLICT`          | none                              | The `operationId` was used with other parameters                                              |
| `PAYLOAD_TOO_LARGE` | `requestBytes` or `responseBytes` | The request exceeds 64 KiB, or a read exceeds 1 MiB; ask for a smaller `limit`                |

### Agent plans

An agent plan (Ausführplan) is the graph of the plan page: start and end nodes,
agent nodes with their own work order, ticket nodes and parameter nodes, flow
connections between them and the inputs of each agent node. These tools work on
the same plans as the plan page and under its rules; they add no right of their
own. They neither start, pause, resume, stop nor delete a plan, and a plan
session (the credential of a running node) gets none of them.

| Tool                    | Pages operation          | Arguments                                                                                       | Does                                                                      |
| ----------------------- | ------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `list_plans`            | `plans.list`             | optional `text`, `projectId`, `cursor`, `limit`                                                 | The visible plans by name, with state and latest own run                  |
| `read_plan`             | `plans.read`             | `planId`                                                                                        | One plan with nodes, edges, share, revision and status                    |
| `read_plan_sources`     | `plans.sources.read`     | optional `workspaceId`                                                                          | Workspaces for new plans; with `workspaceId` the agents a node can run    |
| `list_plan_runs`        | `plans.runs.list`        | `planId`, optional `order` (`newest`, `oldest`), `cursor`, `limit`                              | The account's runs of a plan with date and status, 20 per page by default |
| `read_plan_run`         | `plans.run.read`         | `runId` (optional `planId` to check it), or `planId` with `select` `latest` or `first`          | One run with the state of every node                                      |
| `read_plan_run_reports` | `plans.run.reports.read` | as `read_plan_run`, optional `stepId`                                                           | The reports of a run, each with `runId` and `stepId`                      |
| `create_plan`           | `plans.create`           | `operationId`, `name`, `workspaceId`, optional `sharing`, `changes`                             | Creates a plan owned by the connected account, private unless shared      |
| `update_plan`           | `plans.update`           | `operationId`, `planId`, `expectedRevision`, one or more of `name`, `sharing`, `changes`        | Changes name, share or structure in one revision                          |
| `create_plan_parameter` | `plans.parameter.create` | `operationId`, `planId`, `expectedRevision`, `name`, `value`, optional `format`, `x`, `y`       | Adds one parameter node                                                   |
| `update_plan_parameter` | `plans.parameter.update` | `operationId`, `planId`, `expectedRevision`, `parameterId`, one or more of `name`, `value`, ... | Changes one parameter node                                                |
| `remove_plan_parameter` | `plans.parameter.remove` | `operationId`, `planId`, `expectedRevision`, `parameterId`                                      | Removes one parameter node and the inputs it fed                          |

- **Visibility.** A plan is visible while the account can open the project of its
  workspace and the plan is its own or shared with it (`global`, or `restricted`
  to groups and departments). A hidden plan answers `NOT_FOUND`, exactly like a
  missing one. Administrators do not see other people's private plans.
- **Owner.** Only the owner (`canEdit`) changes a plan; a person it is shared with
  gets `FORBIDDEN`. Changes take the `revision` read last as `expectedRevision`;
  a stale value returns `CONFLICT` with `details.currentRevision` and changes
  nothing. A request that matches the stored plan returns `changed:false`.
- **Structure.** `changes` is a list applied in order and saved as one revision:
  `addNode` (`start`, `end`, `agent` with `agentId` from `read_plan_sources`,
  `task` with the `taskId` of a task or subtask of the project, `parameter` with
  `name`, `value` and optional `format`), `updateNode` (fields of the node's kind,
  `x` and `y` for every node), `removeNode` (also removes its connections and the
  inputs it fed), `connect` and `disconnect` (flow `from` → `to`), `bind`
  (`kind` `source`, `result` or `literal`) and `unbind`. An `id` in `addNode`
  lets later changes of the same call refer to the node; `createdNodeIds` returns
  the ids. A new agent node gets value nodes for its defaults and its directory
  parameter, as in the editor. Pages checks the saved plan like the plan page.
  An agent node's `completion` selects the progress scope: `report` (default)
  describes todos and acceptance criteria; `todos` describes only the current
  ticket todo list, ticked live. Both scopes release successor agents and
  internal group steps after regular runner completion. Open or unknown work,
  ticket changes, unmet criteria and missing, incomplete or invalid reports are
  diagnostics (`verdict: open`), never execution failures. Technical failures,
  access denials and explicit pause/stop remain effective. Existing node copies
  need no migration or setting change. Historical failed runs stay unchanged;
  Resume continues active paused runs, while ended runs need a new explicit Play.
  `updateNode` with `{"completion": "todos"}` switches an existing node and keeps
  its configuration copy; setting `agentId` to another agent and back inside one
  `changes` list replaces that copy with the agent's current template.
- **Status.** `read_plan` returns `status`: `state` (`idle`, `running` or `paused`
  by the account's own runs), `runCount`, `latestRun`, and `isRunnable` with the
  `issues` the plan page shows before Play.
- **Runs.** Runs belong to the account that started them; other accounts' runs are
  never listed or read. Every run carries `runId`, `planId`, `planName`,
  `startedAt` (ISO 8601) and `status` (`running`, `paused`, `succeeded`, `failed`
  or `cancelled`). Reading a run or its reports also needs current access to the
  agents, workspaces, tickets and pages it used.
- **Reports.** A report belongs to one node of one run (`runId`, `stepId`) and
  carries status, start and end, the redacted result text, the error, and the
  acceptance: `verdict`, `summary`, `todos`, `criteria` with evidence,
  `decisions` and `issues`. Over 1 MiB of JSON is `PAYLOAD_TOO_LARGE`; read one
  `stepId` at a time then.
- **Errors.** `INVALID_REQUEST` names its `details.reason`: `graph_invalid` with
  `details.issues` (`nodeId`, `port`, `problem`), `parameter_value_invalid`,
  `workspace_unavailable`, `element_missing` (a named node, connection or input
  does not exist or has another kind), `element_exists` (an id, connection or
  parameter name is taken), `parameter_reference_unavailable`,
  `sharing_target_unavailable` or `credentials_in_text`.
- **Repeat.** Writes take an `operationId`: repeating a call with identical
  parameters returns its stored result and never changes twice; other
  parameters return `CONFLICT`.

### Administration

Pages offers the following tools only to current personal administrators and checks
the persisted admin eligibility again inside every operation's transaction. MCP
admin access is independent of the browser's role mode and does not change it.

| Tool                         | Pages operation              | Purpose                                                                             |
| ---------------------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| `list_admin_users`           | `admin.users.list`           | Accounts, roles, activity, departments, groups and management scope                 |
| `list_admin_departments`     | `admin.departments.list`     | Existing departments and member IDs                                                 |
| `list_admin_groups`          | `admin.groups.list`          | Existing groups and member IDs                                                      |
| `list_admin_roles`           | `admin.roles.list`           | Existing normal roles, rank, department binding and permissions                     |
| `list_admin_permissions`     | `admin.permissions.list`     | Configurable rights; reading remains an immutable basic right                       |
| `read_admin_project_members` | `admin.projectMembers.read`  | Members and departments of a project                                                |
| `read_admin_activity`        | `admin.activity.read`        | Instance-wide administration audit trail                                            |
| `set_admin_role_permissions` | `admin.roles.setPermissions` | Replace permissions of an existing role for all its holders                         |
| `assign_admin_role`          | `admin.roles.assign`         | Assign an existing normal role to a person or current members of a group/department |
| `set_admin_user_name`        | `admin.users.setName`        | Change the person's name, preserving login and email                                |
| `set_admin_user_departments` | `admin.users.setDepartments` | Replace department memberships                                                      |
| `set_admin_user_scope`       | `admin.users.setScope`       | Change explicit department/project management scope                                 |
| `update_admin_group`         | `admin.groups.update`        | Rename an existing group and replace members                                        |
| `rename_admin_department`    | `admin.departments.rename`   | Rename an existing department                                                       |

Reads use optional `cursor` and `limit` (1–100); `read_admin_project_members`
also requires `projectId`. Responses omit email addresses, password hashes and
credentials. All writes require `operationId` and the last-read expected fields
shown in the tool schema. Stale state returns `CONFLICT`; the complete batch rolls
back. An identical retry returns the stored public result after checking current
admin eligibility again. Nothing is logged or stored for rejected calls.

Groups and departments have no independent action permissions in Pages. A batch
role assignment replaces the normal role of every **current** member, at most 100
people, atomically. It creates no inherited grant and does not affect future members.
`expectedAssignments` must list exactly the current members and their last-read
roles (`[{userId, roleId}]`); read the users and membership lists first. Editing a
shared role changes all its holders, including people outside the selected group.
Personal administrator eligibility is preserved by every MCP operation.

Removing rights or memberships requires the explicit `confirmation` word of the
administrator's current interface language: `LÖSCHEN` or `DELETE`. Ask the person
and pass their reply; never infer it. Successful administration changes are recorded
with actor, operation, target, affected users, time and `source:mcp` in the
instance-wide administration activity. The mutation, audit and replay result commit
together. Admin revocation immediately prevents further admin calls and replay.

MCP has no operation for user creation, personal admin eligibility, blocking or
unblocking users, password reset, or creating/deleting groups and departments.
Unknown operations and extra parameters cannot enable these paths.

#### Permanent project deletion

Two further administrator tools read and perform the permanent deletion of one
project. They belong to the same personal-administrator boundary as the tools
above, with the rules of this section added.

| Tool                                | Pages operation                | Required arguments                         | Purpose                                                                 |
| ----------------------------------- | ------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------- |
| `read_admin_project_deletion_scope` | `admin.projects.deletionScope` | `projectId`                                | The concrete project and the extent of the data its deletion removes    |
| `delete_admin_project`              | `admin.projects.delete`        | `operationId`, `projectId`, `confirmation` | Delete the project and everything that belongs only to it, irreversibly |

**Rights.** Pages checks on every call, inside the transaction that reads or
deletes, that the account is active and a personal administrator, independent of
the browser's role mode. A project role, the right to manage projects or the
management of all projects never suffices: such an account gets `FORBIDDEN`,
nothing is read or changed, and the tools do not appear in its `tools/list`. The
check also binds the decision to the project's own departments, as for every
project action. The interface deletes projects through the same service, so both
paths apply the same rules. The tools exist for MCP clients only: the chat does
not offer them, and the credential of an agent plan run never receives the
deletion, so an unattended run cannot delete a project.

**Read first.** `read_admin_project_deletion_scope` returns
`{project, counts, detached}`. `project` names the project (`id`, `name`,
`status`, `isArchived`, `departmentNames`). `counts` lists what is removed:
`tickets` and `subtickets`, `ticketAttachments`, `ticketChecklistItems`,
`ticketLinks`, `ticketHistoryEntries`, `milestones`, `milestoneDependencies`,
`wikiPages` (the wiki trash included), `wikiComments`, `wikiAttachments`, `plans`,
`planRuns`, `workspaces`, `importRuns`, `importSources`, `members`,
`departmentAssignments`, `goals`, `events`, `activityEntries`, `githubRecords`,
`integrations` and `templates`. `detached` lists the references elsewhere that
the deletion clears while the shared objects stay: `templateAssignments`,
`wikiAnchors`, `wikiLinks` and `boardPreferences`. Show the project and these
numbers to the user before asking for the confirmation. The read changes nothing.

**Confirmation.** `delete_admin_project` needs the project ID and exactly one of
the two words `LÖSCHEN` or `DELETE` as `confirmation`. Both are valid whatever
language the account uses, and the same word is not required on a retry. Ask the
person to type the word and pass their reply; never infer consent. A missing
confirmation, any other value (`delete`, ` DELETE`, `yes`, a number) returns
`CONFIRMATION_REQUIRED`, and nothing changes. The administrator check comes first,
so a refused account learns nothing about the project.

**What is deleted.** The project and everything that belongs only to it, for
good: no archiving and no move to the trash. That is all tickets including
subtickets with their attachments, checklists, history, labels and links; all
milestones, milestone initiatives and dependencies; all wiki pages of the project
with comments, mentions, versions, attachments and favorites, including pages
already in the wiki trash; execution plans with their runs, run records, MCP
credentials and workspace reservations; registered workspaces (the directory on
disk is never touched); import records and sources; member and department
assignments, goals, events, activity, tags, the project key, icon and project
templates; and GitHub and Discord connections, deliveries and records. The stored
attachment files and the markdown files of the run records are removed after the
commit; a file that survives a failure there is no longer referenced and the
periodic sweeps remove it.

**What stays.** Shared objects are never deleted: people, groups, departments,
agents, labels, ticket templates, wiki pages of the instance or private pages,
and every other project with its data. Their references to the deleted project
are removed or emptied: ticket templates lose the project from their sharing,
instance and private wiki pages lose their anchors to its milestones and epics and
their links to its tickets and pages, saved board filters that name the project or
one of its milestones return to `all`, and projects directly below it lose their
parent. Links between a ticket of the project and a ticket of another project
are removed together with the ticket. Existing links, running plans or registered
workspaces never block the deletion.

**Running plans.** Active plan runs of the project are stopped first, outside the
deleting transaction, and the call waits until they have closed. If they do not
close within 30 seconds the call returns `CONFLICT` and nothing is deleted; repeat
it later.

**Failure and retry.** The deletion is atomic: the data, the audit entry and the
replay record commit together, and any failure rolls everything back, so no
orphaned rows or half-deleted project remain. After a lost response repeat the
call with the same `operationId` and `projectId`: Pages checks the rights and the
confirmation again and returns the stored result without touching anything,
including data of other projects. The same `operationId` for another project
returns `CONFLICT`; a new `operationId` for a project that is already gone returns
`NOT_FOUND`. Other errors: `INVALID_REQUEST` for a missing, unknown or oversized
argument, `NOT_FOUND` for an unknown project, `FORBIDDEN` for anyone but an
administrator.

**Result and audit.** A successful call returns
`{id, targetType:"project", changed:true, affectedUserIds, deleted}`.
`affectedUserIds` are the people who were assigned to the project, and `deleted`
repeats the project and the counts as they were deleted. The deletion is recorded
in the administration audit trail (`read_admin_activity`) with the actor,
`admin.projects.delete`, the project ID and `source:mcp`.

**Transports.** Stdio is the only transport of this adapter. It forwards the
tools to the Pages Agent API, whose operation catalog is the only place the
deletion is implemented: the stdio adapter, a client that calls the Agent API
directly and the interface all end in the same service.

The chat uses the existing UI administration services in **active admin mode**.
It additionally supports user creation, admin eligibility, blocking/unblocking,
password reset, group/department creation and deletion, and role management.
User creation, admin eligibility changes, blocking/unblocking, password reset and
deletion require the person's typed confirmation in the **current** message.
Rights/membership reductions also require it. One confirmation allows at most one
administration mutation or deletion. The model cannot supply confirmation itself.
Chat activity has `source:ai`. Temporary passwords are delivered once directly to
the human administrator in a separate panel display; they never enter model prompts,
stored conversations, audit or replay records. Closing the panel, switching sessions,
sending another message or dismissing the display clears it; after response loss,
use the existing password-reset workflow.
