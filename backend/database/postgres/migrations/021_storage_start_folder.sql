-- PAGE-188: the start folder of the Storage area. It is a navigation preference
-- per account and nothing else: no security boundary, no share, no upload
-- target. It is bound to the Google account of the instance connection
-- (google_permission_id), so a connection of another account never opens it.
-- folder_id is the stable Drive identifier; name and path are only the last
-- readable copy and are refreshed from Drive, never used to find the folder.
-- Times are Unix milliseconds.
CREATE TABLE storage_start_folder (
    user_id TEXT PRIMARY KEY,
    google_permission_id TEXT NOT NULL,
    folder_id TEXT NOT NULL,
    -- The shared drive of the folder, NULL for My Drive.
    drive_id TEXT,
    folder_name TEXT NOT NULL,
    folder_path TEXT NOT NULL,
    saved_at BIGINT NOT NULL
);
