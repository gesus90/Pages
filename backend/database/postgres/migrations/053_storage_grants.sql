-- PAGE-323: explicit folder grants, bound to the instance Google account.
CREATE TABLE storage_folder_grants (
    permission_id TEXT NOT NULL,
    folder_ref TEXT NOT NULL,
    folder_name TEXT NOT NULL,
    target_kind TEXT NOT NULL CHECK (target_kind IN ('role', 'department', 'group')),
    target_id TEXT NOT NULL,
    PRIMARY KEY (permission_id, folder_ref, target_kind, target_id)
);

CREATE TABLE storage_activity (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    operation TEXT NOT NULL,
    ref TEXT NOT NULL,
    permission_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now()
);
CREATE INDEX storage_activity_account ON storage_activity (actor_id, created_at);
