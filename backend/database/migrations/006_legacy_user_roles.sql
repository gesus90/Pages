-- Also used inside the SQLite transfer transaction after copying legacy rows.
-- Only installations with existing non-admin accounts get legacy profiles.
INSERT INTO roles (id, name, hierarchy_rank, department_bound)
SELECT 'legacy-manager', 'Manager', 20, 0
WHERE EXISTS (SELECT 1 FROM users WHERE role = 'manager')
ON CONFLICT DO NOTHING;
INSERT INTO roles (id, name, hierarchy_rank, department_bound)
SELECT 'legacy-employee', 'Employee', 10, 0
WHERE EXISTS (SELECT 1 FROM users WHERE role = 'employee')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission)
SELECT roles.id, permissions.permission
FROM roles
CROSS JOIN (VALUES ('write'), ('create_projects'), ('manage_projects'), ('milestones'), ('manage_users')) AS permissions(permission)
WHERE roles.id = 'legacy-manager'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
SELECT id, 'write' FROM roles WHERE id = 'legacy-employee'
ON CONFLICT DO NOTHING;

INSERT INTO user_authorization (
    user_id, role_id, is_admin, active_mode, first_name, all_projects
)
SELECT
    id,
    CASE role
        WHEN 'manager' THEN 'legacy-manager'
        WHEN 'employee' THEN 'legacy-employee'
        ELSE NULL
    END,
    CASE WHEN role = 'admin' THEN 1 ELSE 0 END,
    CASE WHEN role = 'admin' THEN 'admin' ELSE 'role' END,
    display_name,
    CASE WHEN role = 'manager' THEN 1 ELSE 0 END
FROM users
ON CONFLICT DO NOTHING;
