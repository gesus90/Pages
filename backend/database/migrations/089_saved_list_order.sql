-- Permissions and memberships keep the order they were saved in. It used to rest on
-- the physical order of the rows, which only DuckDB keeps.
ALTER TABLE role_permissions ADD COLUMN "position" BIGINT DEFAULT 0;
UPDATE role_permissions SET "position" = rowid;

ALTER TABLE department_members ADD COLUMN "position" BIGINT DEFAULT 0;
UPDATE department_members SET "position" = rowid;

ALTER TABLE managed_departments ADD COLUMN "position" BIGINT DEFAULT 0;
UPDATE managed_departments SET "position" = rowid;
