-- Project-wide switch for the GitHub synchronization. Token and repository stay
-- stored while it is off; existing connections keep syncing because the default
-- is 1. DuckDB cannot add a column with constraints, so the 0/1 rule is checked
-- when the repository reads the column.
ALTER TABLE project_integrations ADD COLUMN sync_enabled INTEGER DEFAULT 1;
