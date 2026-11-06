# Agent payload storage

New plan-run snapshots, continuation bases, local and remote session event bodies,
immutable history chunks and remote history custody packets live under
`agent-payloads/` in the configured Pages data directory. PostgreSQL stores only
server-generated relative references with byte size and SHA-256 for those payloads.
The public run and session contracts contain no storage paths.

Each new file is written with private permissions, synchronized, renamed to a
unique immutable name and followed by a directory synchronization before a
transaction publishes its reference. Snapshot and event preparation happens before
the reference transaction. Event numbering and deduplication are rechecked under
the attempt lock; runner receipt/import transactions retain their original
atomicity. A crash may leave an unreferenced file, never a reference to an unfinished
file. Files are never overwritten, including the last history chunk.

Reads resolve the explicit file column and verify both byte size and SHA-256 on
every access. `plan_payload_missing` and `plan_payload_corrupt` are safe errors
without internal paths. Old inline snapshots, event bodies and chunks remain
readable in place. No old data is moved. Workspace reference metadata preserves
the existing registration-removal checks without placing the large snapshot in SQL.

Deletion triggers persist file deletion intents in the same transaction as the
reference removal. The database client drains these after commit and on startup;
failed removals remain queued. Plan deletion removes its private payload directory,
including unreferenced preparation files. Historical public run/agent records stay
as before; deleted plan payloads cannot be reconstructed from an empty substitute.
Project deletion removes references and files of all affected runs. The bounded
event-row retention still applies; the complete chunk journal keeps its existing
lifetime through plan/project deletion. Rolled-back and unknown-commit writes do
not eagerly remove possibly referenced files.

The directory is part of instance data and must accompany a PostgreSQL backup
when restoring these file-backed records. A database-only copy can still read
legacy rows but explicitly reports missing files for new payload references.
