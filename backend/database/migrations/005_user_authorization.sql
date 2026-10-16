-- Additive transition: user IDs, credentials, history and the A3 compatibility
-- column users.role remain intact. New authorization lives in its own aggregate.
CREATE TABLE roles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hierarchy_rank BIGINT NOT NULL,
    department_bound INTEGER NOT NULL DEFAULT 1 CHECK (department_bound IN (0, 1))
);
CREATE UNIQUE INDEX roles_name_normalized ON roles (lower(name));

CREATE TABLE role_permissions (
    role_id TEXT NOT NULL,
    permission TEXT NOT NULL CHECK (permission IN (
        'write', 'create_projects', 'manage_projects', 'milestones',
        'manage_users', 'manage_departments', 'manage_roles'
    )),
    PRIMARY KEY (role_id, permission)
);

CREATE TABLE departments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
);
CREATE UNIQUE INDEX departments_name_normalized ON departments (lower(name));

CREATE TABLE user_authorization (
    user_id TEXT PRIMARY KEY,
    role_id TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
    active_mode TEXT NOT NULL CHECK (active_mode IN ('admin', 'role')),
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    all_departments INTEGER NOT NULL DEFAULT 0 CHECK (all_departments IN (0, 1)),
    all_projects INTEGER NOT NULL DEFAULT 0 CHECK (all_projects IN (0, 1)),
    has_had_department INTEGER NOT NULL DEFAULT 0 CHECK (has_had_department IN (0, 1)),
    CHECK (is_admin = 1 OR role_id IS NOT NULL),
    CHECK (active_mode <> 'admin' OR is_admin = 1),
    CHECK (active_mode <> 'role' OR role_id IS NOT NULL)
);

CREATE TABLE department_members (
    user_id TEXT NOT NULL,
    department_id TEXT NOT NULL,
    PRIMARY KEY (user_id, department_id)
);

CREATE TABLE managed_departments (
    user_id TEXT NOT NULL,
    department_id TEXT NOT NULL,
    PRIMARY KEY (user_id, department_id)
);
