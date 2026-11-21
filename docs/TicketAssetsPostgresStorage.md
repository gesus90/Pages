# Ticket asset bytes in PostgreSQL: assessment

This page assesses whether the bytes of ticket assets could move from the ticket
file store into PostgreSQL. It is a decision aid, not a description of current
behavior: today PostgreSQL keeps the metadata in `work_item_attachments` and the
bytes stay in `assets/<ticket-uuid>/<attachment-uuid>.<extension>` below the
Pages data directory (see [Ticket attachments](TicketAssets.md)). Nothing on this
page is implemented.

## File sizes

The limits of the wiki settings apply to ticket assets too. By default an image,
audio or video file may have 500 MiB and any other file 100 MiB; administrators
can raise both up to 100 GiB.

| Question                  | File store (today)                      | `bytea` column                                                | Large objects (`pg_largeobject`)                            |
| ------------------------- | --------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| Largest single asset      | Limited by the disk only                | 1 GB per value, hard limit of PostgreSQL                      | 4 TB per object                                             |
| Upload of a 500 MiB video | Streamed, constant memory               | Whole value in the Node process and in the server backend     | Streamed in chunks through `lo_write`                       |
| Download                  | Streamed with `Content-Length`          | Whole value read before the first byte; `substring` per range | Streamed through `lo_read`                                  |
| Compression               | None                                    | TOAST compresses, without gain for JPEG, PNG, MP4, PDF or ZIP | None                                                        |
| Removal                   | File deleted, folder removed when empty | Row deleted; space returns after `VACUUM`                     | `lo_unlink` needed, else orphans stay; `vacuumlo` cleans up |

Consequences:

- `bytea` cannot hold the default media limit of 500 MiB safely. A value is
  built in memory on both sides, so one upload needs roughly twice its size in
  RAM, plus the escaped text form when the driver does not use binary transfer.
  `bytea` suits small assets only, for example images and documents below
  10 MiB.
- Large objects can hold every allowed size and stream, but they bring their
  own lifecycle: a reference column (`oid`), explicit unlinking in the same
  transaction as the metadata deletion, and `vacuumlo` for objects a failed
  path left behind. Permissions of large objects are separate from table
  permissions.
- The current limits up to 100 GiB rule out both forms for the largest
  configurable files; a threshold would keep large files in the file store.

## Backup

Today two stores must be backed up together: PostgreSQL by its base backup and
WAL archive, and the data directory as files. A database restore without the
matching files shows attachment rows whose files are missing; files restored
without the rows are swept as orphans. The inventory under
**Settings → System → Check ticket attachments** finds both cases.

With the bytes in PostgreSQL:

- One base backup and the WAL archive contain metadata and bytes together, so a
  point-in-time recovery restores both consistently. This is the main benefit.
- Every uploaded byte is written to the WAL and archived once more. With full
  page writes after a checkpoint the WAL volume exceeds the asset size. A day
  with 2 GiB of new assets adds at least 2 GiB of WAL to the archive.
- The example setup in [PostgreSQL operations](PostgresMigration.md) keeps 7 daily base
  backups. Each one contains all assets again, so the backup disk needs about
  `7 × (database + all assets) + WAL of 7 days`. The file store, backed up
  incrementally by a file backup, does not multiply.
- `pg_dump` exports `bytea` values as text unless the custom format is used,
  and large objects only with `--large-objects` (the default for a whole-database
  dump). Dump and restore time grow with the asset volume.
- The daily restore check copies the whole base backup and replays the WAL;
  its duration and disk space grow by the asset volume as well.

## Restore

- A PostgreSQL restore (base backup plus WAL up to a point in time) would bring
  back the bytes of exactly that point. No separate file restore would be needed,
  and the ticket asset inventory would find no missing files.
- Restoring a single deleted asset is no longer a file copy: the whole cluster
  has to be restored next to the live one and the bytes copied over.
- Restore time grows with the cluster size. A 50 GiB asset volume makes every
  restore at least as long as copying 50 GiB.
- Moving existing assets into PostgreSQL would be an offline migration of its
  own, like the existing flat-store migration: copy, verify the SHA-256 against
  `checksum`, switch the metadata in one transaction, then remove the files.

## Recommendation

Keep the bytes in the ticket file store. The checksum, MIME type and storage
path in `work_item_attachments` and the change log `ticket_asset_changes` work
the same for either store, so a later move needs no change for readers of the
change log.

If consistent point-in-time recovery of assets becomes a requirement, the
smallest step is a threshold: assets up to a fixed size (for example 10 MiB)
in a separate table with a `bytea` column, larger ones in the file store. Before
that decision, measure on a copy of the instance:

1. the total size and the size distribution of the assets
   (`SELECT count(*), sum(size), percentile_cont(0.5) WITHIN GROUP (ORDER BY size) FROM work_item_attachments;`),
2. the new asset bytes per day (`created_at`),
3. the free space on the backup disk against `7 × (database + assets below the threshold)`.
