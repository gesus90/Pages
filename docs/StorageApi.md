# Storage interface for files and folders (PAGE-270)

[Documentation index](README.md) · [Access rights](#rights) ·
[Google Drive sign-in](#google-drive-sign-in-page-170) ·
[File area](#storage-google-drive-file-area-page-188)

Pages Storage manages the files and folders of the Google Drive the instance
is connected to (system settings → Google Drive, PAGE-170). Besides the
Storage page, the server offers one documented, authenticated HTTP interface
for external clients and Pica:

```text
GET  /storage-api/v1/<operation>?<parameters>
POST /storage-api/v1/<operation>   (JSON, or multipart/form-data for uploads)
```

It is implemented by `app/routes/storage-api-v1.ts` and
`backend/service/google/GoogleDriveFileService.ts` (reader, writer,
confirmations). A separate MCP client is not part of PAGE-270.

## Rights

- An active administrator in admin mode may use all operations. PAGE-323
  also grants **Storage writing per folder** to roles, departments or groups.
  Current members (human or agent accounts) may list/read, create subfolders,
  upload and save versions in that folder and its descendants without admin
  mode. Missing rights return `403 forbidden` before any content read or write.
  Copy, rename, move, trash, restore, permanent deletion, batch, quota and global
  search remain administrative. Provider scopes remain an additional boundary.
- Every call takes a freshly confirmed access of the instance connection
  (`about.get`); Google then decides with the rights of the connected account.
  The interface never returns a token, a credential or a sharing link, and
  references grant nothing.
- The Google account is the one of the instance. Folder grants are bound to
  its permission ID and stable folder IDs, never names or a session checkout.
- The session cookie authenticates the call (`SameSite=Lax`); changing calls
  are `POST` only.

## Pages MCP API (PAGE-299)

The paired-device API exposes the same reader and writer at
`/api/mcp/v1/storage/<operation>`. It is a resource route in both the API and
SPA forwarding tables. Unknown paths below this namespace (including its
bare root) return JSON `404 not_found` after authentication and authorization,
never an HTML success document. A missing or invalid bearer token returns
`401 invalid_token`, even with a valid browser cookie. Wrong methods return
JSON `405 invalid_request` with `Allow`.

### Contract basis and compatibility boundary

The separate Pages MCP checkout is outside this workspace and was not read.
The MCP catalog exposed to this implementation session contains no Storage
schemas. Following the ticket's fallback, this contract is derived from the
existing Storage interface, the native `PicaStorageContracts.ts` descriptions
and the established MCP device API's direct JSON/error convention. It is
**not a verified copy of the separate client's schema**. The previously reported
HTTP 200 responses alone do not identify their runtime cause or implicate
Google Drive. The source does establish that the MCP Storage resource was
missing; an unmatched GET can take the static app document fallback.

Concrete decisions that a client must follow or compare against its contract:

- Read operations use `GET`; all changes use `POST`. The operation names,
  parameters and result fields in the tables below apply, except `batch`,
  which is deliberately not offered on MCP. `resolve-path`, `create-folder`,
  `delete-permanently` and `trash` are aliases of `resolve_path`,
  `create_folder`, `delete_permanently` and `delete` respectively.
- Successful JSON is the **direct result object**, plus `simulation`, without
  the session API's `ok`/`result` envelope. For example, stat returns
  `{ entry, path, simulation }`, creation/upload/update/move/rename/restore/trash
  return the entry's fields plus `simulation`, copy returns
  `{ entry, copiedCount, simulation }`, and quota returns its four byte fields
  plus `simulation`. `confirm` returns the confirmation's fields directly.
- List/search return `entries`, `nextPageToken`, `nextCursor` (the same opaque
  cursor, or `null` at the end) and `simulation`; list also returns `folder`.
  Send the cursor unchanged with the same listing/search parameters on the
  next call. `cursor` aliases `pageToken`, `limit` aliases `pageSize` (1–1000),
  and `folder` aliases search's `folderRef`. `pageToken`, `pageSize` and
  `folderRef` take precedence when both spellings are supplied.
  Invalid sizes/types or cursor lengths above 2048 are rejected, never silently
  restarted. References remain the existing stable Drive IDs, not session IDs.
- Errors are `{ error: "<code>", ...details, simulation }`, using the HTTP
  statuses and safe detail fields in the error table below. Authentication
  errors use the standard device API `{ error: "invalid_token" }`.
  Confirmation errors carry the full `confirmation` (target, scope, expiry
  and one-use token); conflicts carry `conflicts`, ambiguity `candidates` and
  unsupported exports `exportFormats`. No provider response, credential or
  file content is included. JSON responses use `no-store` and `nosniff`.

### Current account and folder rights (PAGE-323)

Paired-device authentication checks the current active account and password
requirements. Every operation then uses `googleDriveFileService.forAccount`:
`StorageAccessService` resolves persisted account facts, current role,
department/group memberships and live folder ancestry. Agent accounts never
become administrators. Capabilities name `grantedFolders`; use those references
for subsequent calls. Unscoped list/search, trash and quota remain restricted.
The account-bound facade is shared by the cookie API, MCP and native Pica tools;
callers cannot override the acting account. Revocation applies to the next call.

Successful file operations are written to `storage_activity` with actor ID and
name, operation and reference, without bytes, tokens or input parameters.
The UI history and `/storage-api/access?view=history` show the account's own
activity; active administrators see all activity. The settings at
`/settings/system` configure grants through `/storage-api/access`.
See [Team setup](wiki/PAGE-323.md) for the A-Team configuration.

### File transfers and destructive changes

- Upload/update accept multipart `file` (filename and MIME type default from
  the file), or raw bytes with metadata in the query and MIME type in
  `Content-Type`. The file limit is **64 MiB**, with an additional 64 KiB
  multipart envelope allowance. Both announced length and streamed bytes are
  bounded before parsing. The final decoded file limit is checked as well.
  This path buffers bounded bytes; it is not a resumable upload.
- Small JSON uploads/updates accept `content`, `encoding` (`text` or strict
  padded `base64`) and `mimeType` alongside the normal metadata. Text whitespace
  is preserved. The **whole JSON body** is limited to 64 KiB; use multipart
  for larger files or raw JSON file bytes. Other changing calls also require
  a JSON body of at most 64 KiB.
- Download returns a bearer-authenticated **binary attachment stream**, not
  JSON, a public URL or a session-only download link. It reuses the existing
  sandboxed attachment response with `X-Pages-Storage-Ref`; Google documents
  require an explicit supported export MIME type. Read stays limited to
  1 MiB of supported text. No caller-provided URL is fetched.
- The existing writer and its shared confirmation store enforce all conflict,
  overwrite, folder-scope and revision rules described below. Send
  `confirmation` from a displayed preview only for the identical intended
  operation. MCP does not offer the session UI's unconfirmed batch path.
  File trash remains reversible without a token; folder trash needs its scope
  preview, and content replacement and permanent deletion always need a token.
  Restarting the server invalidates pending confirmations. There is no new
  idempotency journal for Drive mutations; reconcile uncertain responses by
  stat/list instead of blindly replaying writes.

### Isolated implementation evidence

The PAGE-299 function exercise ran an API development server on the free
loopback port 45267 with a private home/configuration, its own temporary
PostgreSQL instance, a setup-created synthetic administrator, normal device
pairing and `PAGES_GOOGLE_DRIVE_SIMULATION=1` (`NODE_ENV=development`). No
production account or real Google connection was used. These are simulated
observations, **not live Drive or external-client verification**:

| Todo | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1   | All listed operations answered direct JSON or a binary attachment; capabilities/quota/list returned 200. Unknown root/nested/prototype-named paths returned JSON 404, wrong method 405, cookie-only authentication 401.                                                                                                                                                                                                                                                                                       |
| T2   | List (80 per page) and search (100 per page) each returned all 230 distinct paging entries in three calls. A resolved path was reused by ref; rename/move retained the ref. Ambiguity/conflict returned 409, missing entries 404, invalid search/ref/cursor 400, binary read and unsupported Google exports 422.                                                                                                                                                                                              |
| T3   | The synthetic account in persisted admin mode received 200; the same device token in persisted role mode received 403, then 200 after the ordinary UI restored admin mode. Direct isolated policy exercises refused inactive, non-admin, agent, missing, mismatched and throwing contexts. Update/overwrite required 428 previews; changed versions, changed folder scope and spent tokens returned 409; fresh confirmations allowed updates, folder trash/restore and separate permanent deletion.           |
| T4   | Raw and multipart binary upload succeeded; the eight downloaded bytes matched exactly. The generated 300 MiB download delivered an initial chunk and was cancelled without collecting the file. JSON above 64 KiB and raw upload above 64 MiB returned 413, including a chunked request without Content-Length. Supported Google PDF export returned 200, unsupported export 422. The session API still returned its original 200 `ok/result` envelope; Pica and its service implementation were not changed. |
| T5   | This section records methods, aliases, schemas, transfer limits, errors, confirmation flow and persisted UI rights, including the unavailable external-client contract and the simulation/live distinction.                                                                                                                                                                                                                                                                                                   |

The targeted source files were formatted, linted and checked for TypeScript
diagnostics in isolation (zero findings). Per the
assignment, no new automated tests/infrastructure were added and the full
check/lint/unit suites remain the central QA's responsibility. Later live
Drive and separate MCP-client acceptance can compare this documented fallback
contract; neither a Google login nor deployment is a prerequisite for this
implementation exercise.

## References

`ref` is Drive's file identifier. It names one concrete object, stays the same
after a rename or a move and can be stored and reused directly in a later
call. `root` is My Drive. `shared-drives` lists the shared drives (only for
`list`). A reference is no public link and bypasses no right: an object the
account cannot see answers `not_found`.

Readable paths start with `/`: `/Projekte/Pages/notizen.md` in My Drive,
`/shared-drives/<Name>/…` in a shared drive. `stat` and `resolve_path` return
them; `…/` stands for parents the account cannot see. `.` and `..` are refused
(`invalid_path`); paths never leave the Drive tree.

## Answers

Every JSON answer carries `simulation` (see below):

```json
{ "ok": true, "simulation": false, "result": { … } }
{ "ok": false, "simulation": false, "error": { "code": "name_conflict", "conflicts": [ … ] } }
```

A `StorageEntry` (`definition/GoogleDriveFiles.ts`):

| Field                 | Meaning                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| `ref`                 | Stable reference (Drive id).                                              |
| `name`, `mimeType`    | As Drive names them.                                                      |
| `isFolder`            | Folder or not.                                                            |
| `isGoogleDocument`    | Google Docs, Sheets, Slides or Drawings: no bytes, only exports.          |
| `isTrashed`           | In the trash (itself or with a folder above it).                          |
| `isExplicitlyTrashed` | Put in the trash itself; only such entries can be restored.               |
| `modifiedAt`          | ISO time of the last change.                                              |
| `sizeBytes`           | Size; `null` for folders and Google documents.                            |
| `parentRef`           | First parent folder; `null` for a root.                                   |
| `driveRef`            | Shared drive, `null` in My Drive.                                         |
| `version`             | Drive's change counter; confirmations are bound to it.                    |
| `webViewLink`         | Google's own page of the entry (sign-in at Google), `null` in simulation. |
| `exportFormats`       | Formats `read`/`download` accept for a Google document.                   |

## Operations

### Reading (`GET`)

| Operation      | Parameters                                                                                           | Result                                                                                                                                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list`         | `ref` (default `root`, or `shared-drives`), `pageToken`, `pageSize` (1–1000, default 100), `trash=1` | `{ folder, entries, nextPageToken }`; `trash=1` lists the entries put in the trash themselves (`folder` is `null`). Folders first, natural name order.                                                                           |
| `search`       | `query` (1–200 characters, name contains), `folder`, `pageToken`, `pageSize`                         | `{ entries, nextPageToken }`, outside the trash.                                                                                                                                                                                 |
| `stat`         | `ref`                                                                                                | `{ entry, path }`, also for an entry in the trash.                                                                                                                                                                               |
| `resolve_path` | `path`                                                                                               | `{ entry, path }`; a step several entries share answers `ambiguous_path` with `candidates`.                                                                                                                                      |
| `read`         | `ref`, `format` (Google documents)                                                                   | `{ entry, mimeType, text }`: UTF-8 text of at most 1 MiB. Google documents default to `text/plain` (Docs, Slides), `text/csv` (Sheets), `image/svg+xml` (Drawings). Binary files answer `unsupported_operation`; use `download`. |
| `download`     | `ref`, `format` (required for Google documents)                                                      | The bytes, **streamed** (no size limit) as `attachment` with `Content-Disposition`, `X-Content-Type-Options: nosniff` and a sandboxing CSP. Google documents only in one of their `exportFormats`.                               |
| `quota`        | –                                                                                                    | `{ usageBytes, usageInDriveBytes, usageInTrashBytes, limitBytes }` (`about.get`).                                                                                                                                                |
| `capabilities` | –                                                                                                    | `{ canRead, canWrite, canRequestWriteAccess, maxUploadBytes, maxReadBytes, pageSizeLimit, operations, exportFormats, isSimulation }`.                                                                                            |

Supported export formats (`backend/google/GoogleDriveFormats.ts`): Docs –
`text/plain`, `text/markdown`, `text/html`, `application/pdf`, DOCX; Sheets –
`text/csv`, `application/pdf`, XLSX; Slides – `text/plain`, `application/pdf`,
PPTX; Drawings – `image/svg+xml`, `image/png`, `application/pdf`. Other Google
types (forms, sites, shortcuts …) answer `unsupported_operation`.

### Changing (`POST`)

JSON body (at most 64 KiB) unless noted. `onConflict` is `fail` (default),
`keep_both` or, for `upload` only, `overwrite`.

| Operation            | Body                                                                                              | Result / behavior                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_folder`      | `parentRef` (default `root`), `name`, `onConflict`                                                | The new folder.                                                                                                                                                                                                                               |
| `upload`             | multipart: `file`, `parentRef`, `name` (default file name), `onConflict`, `confirmation`          | The new file. At most **64 MiB** (`too_large` before the body is held). `overwrite` replaces the one same-named file only with a confirmation (`overwrite`).                                                                                  |
| `update`             | multipart: `file`, `ref`, `confirmation`                                                          | Replaces the bytes of a file; **always** needs a confirmation (`update`). Not for folders or Google documents.                                                                                                                                |
| `copy`               | `ref`, `targetParentRef` (default the original's folder), `name` (default original), `onConflict` | `{ entry, copiedCount }`. Folders are copied entry by entry (Drive copies no folders), at most 500 entries, else `too_large`.                                                                                                                 |
| `move`               | `ref`, `targetParentRef`, `onConflict`                                                            | The moved entry; the reference stays. A folder cannot move into itself (`invalid_request`).                                                                                                                                                   |
| `rename`             | `ref`, `name`, `onConflict`                                                                       | The renamed entry; the reference stays.                                                                                                                                                                                                       |
| `delete`             | `ref`, `confirmation`                                                                             | Moves to the **trash**. Files at once; a folder first answers `confirmation_required` with its scope.                                                                                                                                         |
| `restore`            | `ref`                                                                                             | Takes an entry out of the trash. `not_trashed` when it is not there; an entry trashed only with its folder answers `unsupported_operation` (restore the folder). Equal names are allowed in Drive, so a restore never replaces another entry. |
| `delete_permanently` | `ref`, `confirmation`                                                                             | Deletes for good, a folder with its whole tree, **always** after a confirmation. `{ ref, name, scope }`.                                                                                                                                      |
| `confirm`            | `ref`, `action` (`delete`, `delete_permanently`, `update`, `overwrite`)                           | Issues a confirmation up front (for example before uploading a large replacement).                                                                                                                                                            |

Names are trimmed, 1–255 characters, without `/`, control characters, `.`
or `..`.

#### `batch` (PAGE-272)

Body: `action` (`copy`, `move` or `delete`), `sourceRef` (the folder the
entries lie in), `refs` (a JSON array of 1–100 distinct references) and, for
`copy` and `move`, `targetParentRef`. The Storage page uses it for its menu
bar and context menu.

- Every entry must lie directly in `sourceRef`; others are refused with
  `invalid_reference`. Roots and the shared-drive list are never entries.
- The entries run one after another through the single operations; a refused
  entry does not stop the others. The answer is
  `{ action, succeeded, failures: [{ ref, code }] }`. After
  `connection_unavailable`, `provider_unreachable` or
  `provider_scope_missing` the remaining entries are reported with the same
  code without asking Drive again.
- `copy` and `move` use `keep_both`. Folders are not copied (`is_folder`),
  as Google Drive cannot copy folders; they can be moved.
- `delete` moves to the trash without a confirmation per folder: the view
  confirms the whole selection first and the trash is reversible.
  Permanent deletion is not part of `batch`.
- An invalid body answers `invalid_request`; missing write access,
  connection problems and an unusable `sourceRef` fail the whole call.

### No silent overwriting

Drive allows equal names in one folder, Pages does not create them silently:
`create_folder`, `upload`, `copy`, `move` and `rename` answer
`409 name_conflict` with the existing entries in `conflicts` when the target
folder already holds the name. `keep_both` picks a free name such as
`bericht (2).pdf`. Replacing content happens only through `update` or
`upload` with `overwrite`, both after a confirmation.

### Confirmations

A destructive action without `confirmation` answers
`428 confirmation_required` with `error.confirmation`:

```json
{
  "token": "…",
  "action": "delete_permanently",
  "target": { "ref": "…", "name": "Archiv", "isFolder": true, … },
  "scope": { "folderCount": 3, "fileCount": 41, "totalBytes": 1048576, "isTruncated": false },
  "expiresAt": "2026-11-09T12:00:00.000Z"
}
```

Show target and `scope` (folders only; `isTruncated` when more than 2000
entries were counted), then repeat the same call with `confirmation=<token>`.
The token lives only on the server, is bound to the account, the action, the
object and its state at the time it was shown (Drive `version`, change time,
trash state and the counted folder scope), expires after ten minutes and is
spent by the first use. Another action, object, account, a changed object or
a spent token answers `409 confirmation_invalid` with a fresh confirmation to
show again.

## Errors

| Code                     | HTTP | Meaning                                                                                                                                                                                                        |
| ------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forbidden`              | 403  | No Pages right for the folder or operation.                                                                                                                                                                    |
| `invalid_request`        | 400  | Missing or invalid parameter, unreadable body, unknown operation.                                                                                                                                              |
| `invalid_reference`      | 400  | `ref` is no possible Drive id.                                                                                                                                                                                 |
| `invalid_path`           | 400  | Path not absolute, too deep, or with `.`/`..`.                                                                                                                                                                 |
| `not_found`              | 404  | Missing file, deleted object or stale reference, or not visible to the account.                                                                                                                                |
| `trashed`                | 410  | The object is in the trash (restore it first).                                                                                                                                                                 |
| `not_trashed`            | 409  | `restore` of an object outside the trash.                                                                                                                                                                      |
| `not_folder`/`is_folder` | 409  | A folder was expected, or a file.                                                                                                                                                                              |
| `ambiguous_path`         | 409  | A path step matches several entries (`candidates`).                                                                                                                                                            |
| `name_conflict`          | 409  | The name is taken in the target folder (`conflicts`).                                                                                                                                                          |
| `confirmation_required`  | 428  | Confirm first (`confirmation`).                                                                                                                                                                                |
| `confirmation_invalid`   | 409  | Token unknown, spent, expired, for another object/action, or the object changed (`confirmation`).                                                                                                              |
| `unsupported_operation`  | 422  | Not possible for this object, such as a binary `read`, an unsupported export format (`exportFormats`), changing a Google document's bytes.                                                                     |
| `too_large`              | 413  | Above `limitBytes`, or a folder copy above 500 entries.                                                                                                                                                        |
| `provider_forbidden`     | 403  | Google refuses this object to the connected account (`insufficientFilePermissions`).                                                                                                                           |
| `provider_scope_missing` | 403  | The granted Google scopes do not allow changes; `consentPath` leads to the write consent.                                                                                                                      |
| `connection_unavailable` | 503  | No usable connection: `connectionState` (`not_configured`, `disconnected`, `reauthorization_required`, `unavailable`) and `connectionProblem` (for example `access_revoked` for an expired or revoked access). |
| `provider_unreachable`   | 502  | Drive did not answer or answered unreadably.                                                                                                                                                                   |
| `failed`                 | 500  | Unexpected server error (logged with a request id, no details in the answer).                                                                                                                                  |

Errors never contain tokens, file contents or Google's raw answer.

## Google write access and consent

Every sign-in asks for `drive.file`, `drive.readonly` (read-only browsing)
and, since PAGE-272, the full `drive` scope as well. Google's granular consent
lets the person decline `drive`; changing existing files needs it, so the
interface checks the granted scopes on every changing call and answers
`provider_scope_missing` with `consentPath`
(`/settings/system?googleDriveAccess=write`). There, the Google Drive card
offers **Sign in again with full Drive access**, also while the connection
works: a targeted, incremental consent (`include_granted_scopes=true`) that
adds `drive`. Without it Storage still browses, and its menu bar keeps the
changing actions disabled.

- Declined in Google's dialog: the callback reports `denied`; the stored
  connection stays unchanged.
- Consent given without the write scope: `write_declined`; nothing is stored,
  the existing connection keeps working.
- Another Google account chosen: `account_mismatch`; nothing is stored.

The live Google sign-in and the real consent are an operator acceptance after
deployment.

## Pica (PAGE-271)

Pica uses the same reader and writer as this interface through native tools
(`backend/service/chat/admin/PicaStorage*.ts`): `storage_capabilities`,
`storage_quota`, `storage_list`, `storage_search`, `storage_stat`,
`storage_resolve_path`, `storage_read`, `storage_download`, `storage_upload`,
`storage_update`, `storage_copy`, `storage_move`, `storage_rename`,
`storage_trash`, `storage_restore`, `storage_create_folder` and
`storage_delete_permanently`.

- Every tool is available to ordinary human and agent accounts. The shared
  account facade checks folder grants per call and returns `FORBIDDEN` for an
  unavailable folder or administrative action; no blanket `ADMIN_REQUIRED`.
  `storage_capabilities` names available roots and operations. The connected
  Google account still needs the corresponding provider scopes.
- Results carry the entries with their `ref`, which Pica keeps for later calls
  instead of searching again. Errors carry the code (`NOT_FOUND`,
  `NAME_CONFLICT`, `PROVIDER_SCOPE_MISSING`, …) and an explanation.
- `storage_download` checks the download and returns `downloadPath`, an
  address of this interface the signed-in person opens; the bytes never reach
  the model.
- A confirmation token never reaches the model. Pica shows target, action and
  scope; Pages keeps the token and spends it only when the person explicitly
  approves that exact action in a later message and Pica repeats the identical call. A change of the object in between is
  refused and shown again.

## Simulated Google Drive (development)

`PAGES_GOOGLE_DRIVE_SIMULATION=1` replaces Google with an in-memory Drive
(`backend/google/GoogleDriveSimulation*.ts`) that answers at the `GoogleFetch`
seam of the Drive clients in the format of the Drive API v3. It is meant for
development and checks; no automated tests are built on it.

- With `NODE_ENV=production` the setting is **ignored** and the ignoring is
  logged (`google_drive.simulation_ignored`).
- No request goes to Google: the simulation never calls the real `fetch` and
  refuses every other address; there is no OAuth flow and no credential.
  `createGoogleDriveServices` uses a simulated connection that counts as
  connected without a sign-in.
- Answers carry `"simulation": true` and the header
  `X-Pages-Storage-Simulation: 1`; the Storage page and the settings card
  show a simulation notice.
- Content returns to the starting state with every restart: a folder tree,
  several file types, Google documents, a 300 MiB file (streamed, generated),
  a folder of 230 entries, name conflicts, trash entries and one shared drive
  (`Team-Ablage`).
- Drive behavior: folders cannot be copied directly (`403 cannotCopyFile`),
  equal names are allowed, trashed entries leave the normal listing and can be
  restored, `addParents`/`removeParents` move.
- `PAGES_GOOGLE_DRIVE_SIMULATION_SCENARIO`: `full` (default), `read_only`
  (only the read scope, changes refused), `item_forbidden` (entries whose name
  starts with `gesperrt` answer 403), `unreachable` (Drive does not answer).

## Examples

```sh
# List My Drive, then a page of a folder
curl -b "pages_session=…" "$PAGES/storage-api/v1/list?ref=root"
curl -b "pages_session=…" "$PAGES/storage-api/v1/list?ref=<ref>&pageSize=200&pageToken=<token>"

# Resolve a path and read the file by its reference later
curl -b "pages_session=…" "$PAGES/storage-api/v1/resolve_path?path=/Projekte/Pages/notizen.md"
curl -b "pages_session=…" "$PAGES/storage-api/v1/read?ref=<ref>"

# Upload without overwriting
curl -b "pages_session=…" -F parentRef=<folder> -F file=@bericht.pdf "$PAGES/storage-api/v1/upload"

# Delete permanently: first call returns the confirmation, second call uses it
curl -b "pages_session=…" -H 'content-type: application/json' -d '{"ref":"<ref>"}' "$PAGES/storage-api/v1/delete_permanently"
curl -b "pages_session=…" -H 'content-type: application/json' -d '{"ref":"<ref>","confirmation":"<token>"}' "$PAGES/storage-api/v1/delete_permanently"
```

## Google Drive sign-in (PAGE-170)

Under **Settings → System** the **Storage** card connects one Google Drive account
to the instance. It offers only the sign-in, a truthful status and the errors
that belong to it. The file area that uses this connection is the **Storage**
navigation entry (PAGE-188, see the file-area section below).

### Set up the Google OAuth client (once per instance)

A Google account password is not an OAuth client and is never entered in Pages.
An administrator of the Google Cloud project creates the client:

1. In the [Google Cloud console](https://console.cloud.google.com/) choose or
   create the project of the instance and enable the **Google Drive API**
   (APIs & Services → Library).
2. **OAuth consent screen / Google Auth Platform:** user type *External* (or
   *Internal* for a Workspace organization), app name, support address. Add the
   scopes `https://www.googleapis.com/auth/drive.file` and, for the folder
   navigation of Storage, `https://www.googleapis.com/auth/drive.readonly`
   (PAGE-188), nothing else.
3. **Clients:** create an OAuth client of the type *Web application* with the
   authorized redirect URIs of every address Pages is reached at, exactly and
   without wildcards:
   `https://<public address>/settings-api/google-drive/callback` (the HTTPS
   `publicUrl`) and `http://127.0.0.1:<port>/settings-api/google-drive/callback`
   (the `port` of Pages, `3000` by default). `localhost` is no substitute for
   `127.0.0.1`. The card lists both addresses while the client is missing.
4. Set these environment variables on the Pages server (for a systemd instance
   in `/etc/pages/<instance>/runtime.env`) and restart Pages:

| Variable                           | Value                                      |
| ---------------------------------- | ------------------------------------------ |
| `PAGES_GOOGLE_DRIVE_CLIENT_ID`     | Client ID (`….apps.googleusercontent.com`) |
| `PAGES_GOOGLE_DRIVE_CLIENT_SECRET` | Client secret                              |

Allowed origins are fixed by the configuration: `http://127.0.0.1:<port>` and
the HTTPS origin of `publicUrl` of `config.toml` (else `PAGES_PUBLIC_URL`). The
sign-in uses the origin the administrator is on, so the local and the remote
address work with one instance and one client, without switching a setting. A
request on any other origin (another host name, `localhost`, plain HTTP on a
public name) cannot start or finish a sign-in. `Host` and `X-Forwarded-*` never
add an origin. Behind a reverse proxy the proxy has to pass the public `Host`
and be listed in `trustedProxies` so that its `X-Forwarded-Proto: https` is
believed; otherwise the request reads as `http://<public host>` and is refused.
The attempt keeps the redirect URI it started with until the code exchange, and
only a callback on that same origin finishes it. A loopback address means the
machine of the browser, so the local way needs Pages reachable there, for
example through an SSH port forward.

### Sign-in, storage and account binding

- Only an administrator in the admin mode sees the card and may sign in. The
  sign-in uses Google's authorization code flow with PKCE, `access_type=offline`
  and `prompt=consent`. Its one-time `state` lives 15 minutes, is stored only as
  a hash and is bound to the administrator who started it; the callback needs
  a Pages session of that administrator in the admin mode.
- The instance holds one connection. The refresh token is stored encrypted with
  the instance key (the key of the agent connection secrets) and bound to its
  row; access tokens stay in process memory. Nothing exposes the connection or
  a token to other accounts, the browser, a log or an address.
- The connected account is identified by its Drive `permissionId`, which Drive
  itself reports after the sign-in. A renewal that reports another account marks
  the connection for a new sign-in. A new sign-in replaces the connection.

### Proof, renewal and limits

- Every visit of the card asks the server, which runs `about.get` with the
  fields `user(permissionId,emailAddress)`: read-only, no file, no content.
  **Connected** appears only when that request succeeded just now.
- An expired access token is renewed with the stored refresh token, without a
  Google sign-in, also after a reload, a new Pages sign-in or a restart. Each
  renewal writes the log event `google_drive.access_token_renewed` and
  `last_refreshed_at` in `google_drive_connection`; each confirmed request
  writes `last_verified_at`.
- Google can end the access at any time: the account owner revokes it, the
  token is unused for six months, or the account exceeds the refresh token
  limit per client. **While the OAuth app is in the publishing status
  *Testing* with user type *External*, Google lets refresh tokens expire after
  7 days.** A lasting connection needs
  the status *In production* (or an *Internal* Workspace app); `drive.file` is a
  non-sensitive scope and needs no Google security assessment for that.
  `drive.readonly` is a restricted scope: an unverified client in production
  shows Google's warning and its user limit during the consent, which is enough
  for the one administrator account of an instance.
- When Google refuses the stored access (`invalid_grant`, a `401` after a
  renewal, a missing scope), the card shows **Sign in again** with the reason.
  A rejected client, a disabled Drive API or an unreachable Google shows a
  concrete error and never **Connected**.

## Storage: Google Drive file area (PAGE-188)

The **Storage** entry of the global navigation opens the Google Drive of the
existing connection above. It adds no sign-in, no token storage and no settings
card of its own; a missing, expired or unconfirmed connection is explained in
one sentence with a link to **Settings → System**.

- **Pages rights:** the instance uses the Google account an administrator
  connected. Current folder grants also admit non-admin accounts to selected
  folders and their descendants (PAGE-323); see [Rights](#rights).
- **Google rights:** every request takes a freshly confirmed access of the
  connection (`about.get` proves the bound `permissionId`, the access token is
  renewed with the stored refresh token when needed) and asks the official Drive
  API v3 (`files.get`, `files.list`, `drives.list`, `drives.get`, `about.get`)
  for navigation. The writer operations described above use the same connection.
  Google decides with the rights and granted scopes of the bound account.
  The access token goes only into the `Authorization` header; answers, addresses
  and logs carry no token. Files open on Google's own page.
- **Scopes:** with `drive.file` alone Google shows only files Pages created or
  opened, never the existing folder tree. The sign-in therefore also asks for
  `drive.readonly`; Storage reads the granted scopes of the stored connection
  and, without a read scope, says so and points to a new sign-in under
  **Settings → System**. A connection made before PAGE-188 needs that new
  sign-in for the folder navigation. Shared drives are offered only with a read
  scope.
- **Navigation:** path from My Drive or a shared drive down to the folder, each
  step clickable; folders first, then files, 200 per page with "Load more".
  `/storage?folder=<id>` is an explicit target and is never redirected; plain
  `/storage` opens the start folder, else My Drive.
- **Folder change (PAGE-279):** opening a folder, a path step, My Drive, the
  shared drives or the start folder changes only the address and the file card.
  Frame, header, quota and toolbar stay in place; the frame's data is not read
  again for it. Until the new folder arrives, the card shows the former one
  dimmed and inert with a loading status, and uploads are off. A late answer
  or page of a replaced folder is dropped and its request ended. A failed
  request removes the former folder and lets the frame check session and
  rights again.
- **Start folder:** chosen in a compact folder dialog and saved per account in
  `storage_start_folder` with the Drive identifier, the shared drive, the
  readable name and path and the `permissionId` of the connection. It is a
  navigation preference only, no share, limit or upload target. It is opened by
  identifier: a rename keeps it and is reported; a deleted, trashed or no longer
  accessible folder, or one saved for another Google account, is explained with
  a new choice instead of opening another folder.
- **Quota:** `about.get` `storageQuota.usage` and `limit` of the Google account,
  the use across all Google services, not the size of a folder. Without a limit
  Storage says "no limit reported"; an exceeded limit stays in the text while
  the bar stops at 100 %. For addresses outside `gmail.com`/`googlemail.com`
  the limit may be a Workspace pool of the organization, so share and free
  storage are not calculated there. A failed request shows "not available",
  never zero.
- **Layout:** the card fills the space beside the navigation and keeps about
  85 px above the Pica launcher (tablet and desktop), also while the list
  scrolls. The multicolored Drive logo beside the path is Google's own product
  logo, see `assets/google-drive/NOTICE.txt`.
- **Further operations:** upload, versions, rename, move, trash and deletion
  are documented in the API sections above. The original PAGE-188 read-only
  scope is historical; it does not describe the current writer or folder grants.
  This file area does not move existing ticket or wiki attachments.
