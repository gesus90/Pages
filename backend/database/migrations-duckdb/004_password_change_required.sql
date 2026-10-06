-- Existing accounts and the setup administrator already chose their password.
ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0;
-- DuckDB blocks constraint changes while an expression index depends on users.
-- The migration runner holds one transaction, so uniqueness stays externally
-- atomic. A new index name is required when recreating it in that transaction.
DROP INDEX users_username_lower;
ALTER TABLE users ALTER COLUMN must_change_password SET NOT NULL;
CREATE UNIQUE INDEX users_username_normalized ON users (lower(username));
