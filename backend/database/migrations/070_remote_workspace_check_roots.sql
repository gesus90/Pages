-- PAGE-138: the allowed directories that the latest directory check of a
-- remote workspace applied, as a JSON array of absolute paths. When the
-- connection's effective list differs, the stored result is shown as
-- outdated until the next check. NULL marks a check stored before the
-- directories were recorded.
ALTER TABLE remote_workspaces ADD COLUMN check_roots_json TEXT;
