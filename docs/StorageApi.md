# Storage interface for files and folders (PAGE-270)

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

- Only an **active administrator in the admin mode** may call the interface
  (the right of the system settings). Pages checks it on **every** call, before
  a body is read; an administrator in the role mode gets `403 forbidden` at
  once.
- Every call takes a freshly confirmed access of the instance connection
  (`about.get`); Google then decides with the rights of the connected account.
  The interface never returns a token, a credential or a sharing link, and
  references grant nothing.
- The Google account is the one of the instance; nothing is shared per user.
- The session cookie authenticates the call (`SameSite=Lax`); changing calls
  are `POST` only.

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
| `forbidden`              | 403  | No Pages right: not an active administrator in the admin mode.                                                                                                                                                 |
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

- The person must be an active administrator in the admin mode; Pages checks
  that before and after every call. Pica has no rights of its own: the
  connected Google account decides as for this interface. Every person sees
  `storage_capabilities`, so a missing right is explained (`ADMIN_REQUIRED`);
  the other tools are administrator tools.
- Results carry the entries with their `ref`, which Pica keeps for later calls
  instead of searching again. Errors carry the code (`NOT_FOUND`,
  `NAME_CONFLICT`, `PROVIDER_SCOPE_MISSING`, …) and an explanation.
- `storage_download` checks the download and returns `downloadPath`, an
  address of this interface the signed-in person opens; the bytes never reach
  the model.
- A confirmation token never reaches the model. Pica shows target, action and
  scope with the person's confirmation word; Pages keeps the token and spends
  it only when the person replied with that word alone in a later message and
  Pica repeats the identical call. A change of the object in between is
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
