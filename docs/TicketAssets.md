# Ticket attachments

Ticket files belong to the Pages data directory next to the configured DuckDB
file. New files use `assets/<ticket-uuid>/<attachment-uuid>.<extension>`. Ticket
keys and original filenames never determine a storage path. The database keeps
the relative path, SHA-256, byte count, original download name and detected type.
Back up and restore the complete data directory together with the database.
Wiki, chat and generic agent-upload storage are unchanged.

The extension is selected from content signatures: JPEG, PNG, GIF, WebP, WAV,
AVI, Ogg, FLAC, MP3, WebM, MP4, PDF, SVG and HTML. Unknown content uses `.bin`.
Only recognized raster images render inline. All other content, including SVG,
HTML and PDF, downloads as `application/octet-stream`, with `nosniff` and a
sandboxed content security policy. Downloads retain the original cleaned name.
Attachment URLs remain `/aufgaben/attachments/<attachment-uuid>`.

## Upload and save

The ticket UI uploads directly to the ticket store. MCP clients preparing an
upload to an existing ticket pass `{fileName, ticketId}` to
`prepare_asset_upload`; `ticketId` is its immutable UUID. The binary response
returns the permanent attachment link and `expiresAt: null`.

An upload without a destination remains a generic staged upload, as required by
wiki creation and imports. Saving a ticket description containing the saving
person's available, unexpired `/agent-assets/<id>` links promotes those uploads
and rewrites the destinations to permanent ticket attachment links. Attachment
rows and the ticket text share one transaction. Files copied for a refused save
are removed on rollback; staged originals are removed only after the outermost
commit. If another legacy ticket still references the same staged upload, its
original stays protected until that reference is handled; promoting one ticket
never breaks another ticket. No-op saves retain the existing description revision
behavior.

External images, local image paths, `file:` addresses and images from other
storage (including wiki attachments) must be uploaded to the ticket first.
Ordinary web hyperlinks and code examples remain supported. Only root-relative
Pages attachment addresses are accepted as image destinations; absolute URLs are
not fetched or imported. Reference-style Markdown is supported. Raw HTML image
markup must be replaced with Markdown using a ticket attachment.

Reading follows ticket visibility; upload and removal retain the ticket write
permission and archived-ticket rules. Existing permanent links to attachments of
other visible tickets retain the original ticket's read and deletion policy;
there is no new copy or ownership restriction for these links. Only temporary
uploads require the saving person to own the upload. Removing an attachment or permanently
removing a ticket deletes its file and removes an empty ticket folder. Archiving
retains files so they can be restored.

## Inventory and maintenance

Administrators in admin mode can open **Settings → System → Check ticket
attachments** and start the inventory. It reads all saved descriptions, including
archived tickets, and verifies attachment files against recorded size and hash.
The report links affected tickets and distinguishes temporary or missing uploads,
external images, missing attachment records/files, legacy storage, expired uploads,
files outside the ticket store and checksum mismatches. It never repairs or changes content,
fetches remote URLs or creates replacement images.

Generic upload maintenance reads the complete ticket reference set before
expiry. Referenced uploads are retained and an operator finding is logged; the
inventory identifies the tickets. A failed reference read aborts cleanup.
Unreferenced expired uploads can still be removed. Already lost originals are
reported and cannot be recovered.

## Offline migration of the legacy flat store

This is a file-and-metadata migration; no schema change or numbered SQL migration
is needed. It is explicit and is not run automatically by server startup.
Existing flat-store attachments stay readable until the operator migrates them.
Do not upload or run another Pages process during this operation.

1. Stop Pages and confirm that no process holds the configured database.
2. Choose a new backup directory **outside** the data directory, with enough
   space for a complete copy. Use the installed dependencies from the checkout:

   ```sh
   pnpm exec tsx scripts/migrate-ticket-assets.ts /absolute/data/pages.duckdb /absolute/backups/ticket-assets-before
   ```

3. The command opens the database exclusively, validates every attachment's size
   and SHA-256, reports unregistered files in both old and new stores and aborts for missing files or
   mismatches. It checkpoints the database and copies the **entire data
   directory**, including DuckDB, into `ticket-assets-before/data/`. It verifies
   the backed-up attachment bytes and records both paths in
   `ticket-assets-manifest.json` before moving any originals.
4. Destination files are copied without overwriting and verified in full. Only
   then does one database transaction switch all paths/types. The command
   checkpoints and verifies destinations again before removing verified old
   copies. Unknown files and mismatching originals are never deleted.
5. Retain the backup and JSON result. Run the same command again with the same
   backup directory: it verifies all files and reports `movedCount: 0`. After an
   interrupted copy, retry with that same backup. A mismatching destination is
   reported and is never overwritten; investigate it before retrying.
6. Start Pages, run the inventory, and open/download attachments in the affected
   tickets. Keep the offline backup until that review is complete.

### Rollback

Stop Pages. Preserve the current data directory under a different name, then
copy the complete `ticket-assets-before/data/` back to the original data-directory
path. The restored DuckDB and flat attachment files must come from the same
backup; do not restore only the database or only the files. Start the code version
used before migration (or this version, which retains legacy reads), then verify
attachment count, checksums and downloads. Do not merge later uploads into an
older database automatically: a full rollback restores the backup's point in
time. Keep the displaced directory for any explicit reconciliation.
