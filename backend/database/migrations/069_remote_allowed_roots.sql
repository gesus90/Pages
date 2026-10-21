-- PAGE-138: directories in which the workspace profiles of a remote
-- connection may lie, as a JSON array of absolute paths on the remote
-- machine. An empty list allows only the SSH user's home /home/<username>.
-- DuckDB rejects a CHECK constraint on an added column, so the repository
-- validates the value when it reads it.
ALTER TABLE remote_connections ADD COLUMN allowed_roots_json TEXT DEFAULT '[]';
