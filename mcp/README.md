# Pages MCP 0.1.0

One bundle serves local clients over stdio and shared instances over Streamable
HTTP on private IPv4 addresses or behind an HTTPS reverse proxy. Authentication is
a personal token for stdio and Pages OAuth for HTTP. The package exposes project/wiki reads and authorized
asset upload preparation, single wiki-page creation and a read-only wiki import
preview. Releases are
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
to `127.0.0.1` by default on port 8998. `--host` accepts `127.0.0.1`, `::1`,
`localhost` and private IPv4 addresses in `10.0.0.0/8`, `172.16.0.0/12` or
`192.168.0.0/16`. Public addresses, wildcard addresses such as `0.0.0.0`, and
other hostnames are startup errors that name the option without echoing its value.
The port is free to choose, and the options may appear in any order. The resource
URL permits HTTP only on loopback or private IPv4 addresses; every other resource
host requires HTTPS. Public HTTPS resource URLs remain supported behind a proxy.

### Intranet-Betrieb (HTTP)

Für das Intranet kann der MCP-Dienst vorerst über HTTP an eine konkrete private
IPv4-Adresse gebunden werden. Beispiel mit Port 8998:

```sh
node /path/to/pages-mcp-v0.1.0.js --http --host 192.168.0.52 --port 8998 --resource http://192.168.0.52:8998/mcp
```

Die Adresse muss auf dem Rechner verfügbar sein. Clients verwenden die angegebene
Resource-URL einschließlich Port; der Listener prüft den Host-Header gegen Host
und Port dieser URL. Authentifizierung und OAuth bleiben unverändert.
`PAGES_URL` verlangt weiterhin HTTPS, außer auf Loopback. Auch die bestehende
Pages-OAuth-Konfiguration akzeptiert HTTP nur auf Loopback und lehnt eine private
HTTP-URL als `PAGES_MCP_RESOURCE` weiterhin ab. Diese Listener-Erweiterung allein
ermöglicht daher noch keinen vollständigen OAuth-Betrieb mit der privaten
HTTP-Resource. HTTPS für den direkten Intranet-Betrieb folgt später und ist nicht
Teil von A9.

### Remote operation behind an HTTPS reverse proxy

TLS ends at a trusted reverse proxy on the same machine; the proxy forwards to the
loopback listener. For public remote access, keep the listener on loopback, do not
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

The `list_project_names` tool takes no arguments. It is read-only
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
includes these foundation operations:

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
the placeholder hosts would be archived. The README's fixed intranet example is
an allowed documentation placeholder.

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

## Assets and single-page creation (A9.6)

`prepare_asset_upload` calls `assets.upload.prepare` with `{fileName}`. It returns
`{ticket, header:"X-Pages-Upload-Ticket", uploadPath:"/api/v1/agent-assets", expiresAt,
mediaLimitBytes, fileLimitBytes}`. POST the raw bytes to that path on the configured
Pages instance, preserving any deployment prefix. Send the ticket only in the
named header, without an Authorization header or query string. Tickets are
one-use, expire after five minutes and are invalid after a Pages restart. Failed
uploads need a new ticket. The binary client uses a separate five-minute budget;
JSON calls keep their five-second budget and 64-KiB request limit, except import
application, which has a thirty-second budget.

The endpoint rechecks the originating personal credential or OAuth consent and
current account rights before and after streaming. A minted ticket can outlive
the technical delegation credential while its originating consent remains active.
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
for a project root, `icon:null` for no icon and `assetIds:[]` for no attachments.
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
Both write tools are offered only with the current write capability. Internal
notifications contain only type and ID and are published after commit.

## Wiki import preview (A9.7)

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

## Wiki import application (A9.8)

`apply_wiki_import` calls `wiki.import.apply` with
`{operationId,fingerprint,projectId,parentId,manifest,assets?}`. Repeat the exact
content package used for `plan_wiki_import` and its fingerprint. The first start
checks that fingerprint against current target state in the run transaction.
Use a new operation ID and a fresh plan for each package or subsequent import.
A stale fingerprint returns `CONFLICT` without creating a run or pages.

Reuse the same operation ID and input after a lost response, timeout or interrupted
run. Index/file/asset list order is immaterial. The owner-scoped A9.6 operation key
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
unexpired A9.6 asset IDs to a loaded source. Each source may appear once. Upload
with `prepare_asset_upload` first and use its stable `/agent-assets/<id>` links
in Markdown. Page, attachments, operation result, source mapping, item and counters
share one source transaction. A rollback removes copied attachment bytes and
preserves staged assets. Markdown remains exact; relative link rewriting belongs
to a later import operation.

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
and are never recreated implicitly. A9.7's read-only preview still diagnoses
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

The A9.7 package limits and 64-KiB request / 1-MiB response limits remain in force.
Apply has a thirty-second MCP budget. A timeout does not undo committed sources:
repeat with the same operation ID. A9.8 unit and integration tests cover recovery,
concurrent imports, source conflicts, current authorization and atomic rollback,
including attachment bytes. The changed executable TypeScript files have 100%
statement, branch, function and line coverage per file in the focused A9.8 run;
migration and transfer behavior and this documented contract are tested separately.

## Updating imported wiki pages (A9.9)

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
Update has a thirty-second MCP budget and the A9.7 package limits. The focused
A9.9 unit and integration tests cover every changed executable TypeScript file
at 100% statements, branches, functions and lines. Type-only contracts have no
executable coverage counters.

## Single-field wiki operations (A9.10)

Four tools change exactly one thing about an existing wiki page. Every argument is
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
- **Move.** Only project pages move. Name the target project, the parent below it
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

The tools are only listed to accounts that currently hold the write right. The
focused A9.10 unit and integration tests cover every changed executable TypeScript
file at 100% statements, branches, functions and lines. Type-only contracts have
no executable coverage counters.

## Tickets and milestones (A9.11)

Two read tools and thirteen write tools let an agent plan work. Every argument is
required, unknown arguments are `INVALID_REQUEST`, and "nothing" is `null`.

| Tool                          | Pages operation               | Arguments (besides `operationId`)                                                  | Result                                       |
| ----------------------------- | ----------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------- |
| `read_ticket`                 | `ticket.read`                 | `ticketId`                                                                         | Core fields, and the statuses of the project |
| `read_milestones`             | `milestones.read`             | `projectId`                                                                        | Milestones and dependencies of the project   |
| `create_ticket`               | `ticket.create`               | `projectId`, `type`, `title`, `description`, `statusId`, `parentId`, `milestoneId` | `{ticketId, key, link, statusId}`            |
| `set_ticket_title`            | `ticket.setTitle`             | `ticketId`, `expectedTitle`, `title`                                               | `{ticketId, key, link, field, changed}`      |
| `set_ticket_description`      | `ticket.setDescription`       | `ticketId`, `expectedDescription`, `description`                                   | `{ticketId, key, link, field, changed}`      |
| `set_ticket_status`           | `ticket.setStatus`            | `ticketId`, `expectedStatusId`, `statusId`                                         | `{ticketId, key, link, field, changed}`      |
| `set_ticket_parent`           | `ticket.setParent`            | `ticketId`, `expectedParentId`, `parentId`                                         | `{ticketId, key, link, field, changed}`      |
| `create_milestone`            | `milestone.create`            | `projectId`, `name`, `description`, `startAt`, `dueAt`                             | `{milestoneId, projectId}`                   |
| `set_milestone_name`          | `milestone.setName`           | `milestoneId`, `expectedName`, `name`                                              | `{milestoneId, projectId, field, changed}`   |
| `set_milestone_description`   | `milestone.setDescription`    | `milestoneId`, `expectedDescription`, `description`                                | `{milestoneId, projectId, field, changed}`   |
| `set_milestone_status`        | `milestone.setStatus`         | `milestoneId`, `expectedStatus`, `status`                                          | `{milestoneId, projectId, field, changed}`   |
| `set_milestone_start`         | `milestone.setStartAt`        | `milestoneId`, `expectedStartAt`, `startAt`                                        | `{milestoneId, projectId, field, changed}`   |
| `set_milestone_due`           | `milestone.setDueAt`          | `milestoneId`, `expectedDueAt`, `dueAt`                                            | `{milestoneId, projectId, field, changed}`   |
| `add_milestone_dependency`    | `milestone.dependency.add`    | `projectId`, `sourceId`, `targetId`, `linkType`                                    | The dependency, `removed: false`             |
| `remove_milestone_dependency` | `milestone.dependency.remove` | `projectId`, `dependencyId`                                                        | The dependency, `removed: true`              |

`ticketId` (and a parent) is a ticket ID, a key such as `PAGE-12`, or a Pages
address such as `/tasks/PAGE-12` or `/aufgaben/PAGE-12`, with or without the
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

The write tools are only listed to accounts that currently hold the write right;
the read tools are always listed. A9.11 has unit and integration tests with
100% statements, branches, functions and lines per executable file. Type-only
contracts have no executable coverage counters.

## Structured import (A9.12)

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
  Markdown page whose key is its relative path, with the A9.7 rules for titles
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
  then wiki pages (the A9.8 rules, unchanged). Every source commits its object,
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

Limits: 100 sources, 200 links, 32 assets, and for the wiki part the A9.7 limits
(32 pages, 16 KiB each, 32 KiB together); 64 KiB request, 1 MiB response. Apply has
a thirty-second budget. A9.12 has unit and integration tests with 100%
statements, branches, functions and lines per executable file. Type-only
contracts have no executable coverage counters. The verification covers the
A9.12 files; a full-suite run is outside this verification step.

## Wiki comments (A9.13)

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
- **Delete.** `deletedComments` names the scope: the comment and all replies to
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

Limits: 64 KiB request, 1 MiB response (`PAYLOAD_TOO_LARGE` beyond). A9.13 tests verify
100% statements, branches, functions and lines per executable file; pure type
contracts have no executable coverage counters.
