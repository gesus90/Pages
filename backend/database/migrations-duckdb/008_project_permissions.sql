-- Creation and management are one capability. Archiving requires an explicit
-- additional grant; legacy managers do not acquire it during migration.
CREATE TABLE project_role_permissions (
    role_id TEXT NOT NULL,
    permission TEXT NOT NULL CHECK (permission IN (
        'write', 'manage_projects', 'archive_projects', 'milestones',
        'manage_users', 'manage_departments', 'manage_roles'
    )),
    PRIMARY KEY (role_id, permission)
);

INSERT INTO project_role_permissions (
    role_id,
    permission
)
SELECT DISTINCT
    role_id,
    CASE
        WHEN permission = 'create_projects' THEN 'manage_projects'
        ELSE permission
    END
FROM role_permissions;

DROP TABLE role_permissions;
ALTER TABLE project_role_permissions RENAME TO role_permissions;
