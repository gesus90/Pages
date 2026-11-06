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

The ticket UI uploads directly to the ticket store. Agents preparing an
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

## Viewing images

A click on an image in the rendered description opens that image in a viewer
above the ticket. The viewer pages through the images of this description in the
order the text shows them, with arrows and the left and right arrow keys, and
shows the position such as "2 / 5". A single image has no navigation. Escape or
the close button return to the ticket with its focus and scroll position; looking
at images changes nothing and sends no write request. An image inside a link
opens the viewer instead of following the link, and the viewer offers the link
target. An image that cannot be loaded, such as a deleted attachment or one of a
ticket the person may not read, is reported in the viewer and the other images
stay reachable. The viewer loads the same `/aufgaben/attachments/<id>` route as
the description, so reading rights decide what it shows; it needs no write right.
Images of other tickets or wikis are not mixed into the list, and neither are
attachments that are only listed below the description.

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

The flat-store migration remains available for PostgreSQL. Stop Pages and every
other writer before using it, and prevent new connections for the whole window.
The command checks for existing connections before opening its own; that check is
not a lock and cannot prevent another client connecting later. An operator must
keep the database and data directory quiescent throughout the operation.

Pass the absolute private configuration path and a new backup directory outside
the data directory. The optional `--dry-run` validates and reports the proposed
moves without creating a backup or changing metadata or files:

```sh
pnpm exec tsx scripts/migrate-ticket-assets.ts /absolute/config.toml /absolute/backups/ticket-assets-before --dry-run
pnpm exec tsx scripts/migrate-ticket-assets.ts /absolute/config.toml /absolute/backups/ticket-assets-before
```

Before moving files the command creates a private backup directory, writes a
PostgreSQL custom-format dump and reads it through `pg_restore`, copies the whole
data directory and verifies each source attachment in the copy. It then copies
and verifies destinations, changes metadata in one transaction, verifies the
result and only removes verified originals. Preserve both the dump and copied
files. Interrupted or mismatched backups require investigation; do not replace an
existing backup. PostgreSQL credentials come from the configuration and are not
passed in command arguments.

Restoring a database dump and the matching data directory discards later changes.
Preserve the current state and require an explicit data-loss decision before any
restore. Older DuckDB files must be handled with the previous release before
transfer; the PostgreSQL command does not open them.
