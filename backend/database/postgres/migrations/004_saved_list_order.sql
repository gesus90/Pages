-- Permissions and memberships keep the order they were saved in (DuckDB migration 089).
-- A fresh database has no such rows, and db:transfer copies the positions.
ALTER TABLE role_permissions ADD COLUMN "position" BIGINT DEFAULT 0;
ALTER TABLE department_members ADD COLUMN "position" BIGINT DEFAULT 0;
ALTER TABLE managed_departments ADD COLUMN "position" BIGINT DEFAULT 0;
