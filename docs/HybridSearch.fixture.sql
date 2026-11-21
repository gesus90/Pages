-- Sample data of the hybrid search for a disposable, migrated Pages database.
-- Never load it into a database with real data.
--
-- Two departments, two persons, two projects and their sources:
--   Alice belongs to Entwicklung and reads the project Plattform.
--   Bob belongs to Vertrieb and reads the project Vertrieb.
--   SAMPLE-3 carries the department Entwicklung; SAMPLE-1 has the released
--   asset refresh-trace.log, whose bytes are given in HybridSearch.md.
-- docs/HybridSearch.fixture.json names the indexing run, the searches and
-- the results with allowed and withdrawn rights and the keyword fallback.

INSERT INTO departments (id, name)
VALUES
    ('d0000000-0000-4000-8000-000000000001', 'Entwicklung'),
    ('d0000000-0000-4000-8000-000000000002', 'Vertrieb');

INSERT INTO users (id, username, display_name, password_hash, role)
VALUES
    ('a0000000-0000-4000-8000-000000000001', 'alice', 'Alice', 'not-a-login', 'employee'),
    ('a0000000-0000-4000-8000-000000000002', 'bob', 'Bob', 'not-a-login', 'employee');

-- A department-bound role: its members read only the projects of their departments.
INSERT INTO roles (id, name, hierarchy_rank, department_bound)
VALUES ('fixture-department-member', 'Abteilungsmitglied', 10, 1);

INSERT INTO role_permissions (role_id, permission)
VALUES ('fixture-department-member', 'write');

INSERT INTO user_authorization (user_id, role_id, is_admin, active_mode, first_name)
VALUES
    ('a0000000-0000-4000-8000-000000000001', 'fixture-department-member', 0, 'role', 'Alice'),
    ('a0000000-0000-4000-8000-000000000002', 'fixture-department-member', 0, 'role', 'Bob');

INSERT INTO department_members (user_id, department_id)
VALUES
    ('a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
    ('a0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002');

INSERT INTO projects (id, name, owner_id, status)
VALUES
    ('b0000000-0000-4000-8000-000000000001', 'Plattform', 'a0000000-0000-4000-8000-000000000001', 'active'),
    ('b0000000-0000-4000-8000-000000000002', 'Vertrieb', 'a0000000-0000-4000-8000-000000000002', 'active');

INSERT INTO project_departments (project_id, department_id)
VALUES
    ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
    ('b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002');

INSERT INTO work_items (
    id,
    project_id,
    "key",
    number,
    type,
    title,
    description,
    status_id,
    created_by
)
VALUES
    (
        'c0000000-0000-4000-8000-000000000001',
        'b0000000-0000-4000-8000-000000000001',
        'SAMPLE-1',
        1,
        'task',
        'Session refresh fails with 401 after password change',
        E'After a password change the refresh token is revoked. The web client keeps the old token and every refresh answers 401 until the person signs in again.\n\nWorkaround: sign out and sign in again.',
        'status-todo',
        'a0000000-0000-4000-8000-000000000001'
    ),
    (
        'c0000000-0000-4000-8000-000000000002',
        'b0000000-0000-4000-8000-000000000001',
        'SAMPLE-2',
        2,
        'task',
        'Export time sheets as CSV',
        'The monthly time sheet export writes one CSV row per booking with person, day and hours.',
        'status-todo',
        'a0000000-0000-4000-8000-000000000001'
    ),
    (
        'c0000000-0000-4000-8000-000000000003',
        'b0000000-0000-4000-8000-000000000001',
        'SAMPLE-3',
        3,
        'task',
        'Rotate the signing keys of session tokens',
        'Signing keys of session tokens are rotated every 90 days; old keys stay valid for one refresh.',
        'status-todo',
        'a0000000-0000-4000-8000-000000000001'
    ),
    (
        'c0000000-0000-4000-8000-000000000004',
        'b0000000-0000-4000-8000-000000000002',
        'SALES-1',
        1,
        'task',
        'Customer cannot refresh the session after a password change',
        'A customer reports that the session refresh answers 401 after a password change.',
        'status-todo',
        'a0000000-0000-4000-8000-000000000002'
    );

INSERT INTO work_item_departments (work_item_id, department_id)
VALUES ('c0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001');

INSERT INTO wiki_pages (id, scope, project_id, author_id, owner_id, title, "content", revision)
VALUES
    (
        'e0000000-0000-4000-8000-000000000001',
        'instance',
        NULL,
        'a0000000-0000-4000-8000-000000000001',
        'a0000000-0000-4000-8000-000000000001',
        'Anmeldung und Sitzungen',
        E'## Passwort ändern\n\nNach einer Passwortänderung beendet Pages alle Sitzungen; die Person meldet sich neu an.\n\n## Token erneuern\n\nDer Client erneuert die Sitzung mit dem Refresh-Token, bevor sie abläuft.',
        3
    ),
    (
        'e0000000-0000-4000-8000-000000000002',
        'project',
        'b0000000-0000-4000-8000-000000000002',
        'a0000000-0000-4000-8000-000000000002',
        'a0000000-0000-4000-8000-000000000002',
        'Vertriebsleitfaden',
        'Meldet ein Kunde 401 nach einer Passwortänderung, verweist der Vertrieb auf SAMPLE-1 und bittet um eine neue Anmeldung.',
        1
    );

INSERT INTO work_item_attachments (
    id,
    work_item_id,
    file_name,
    content_type,
    kind,
    size,
    checksum,
    storage_name,
    uploaded_by
)
VALUES (
    'f0000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000001',
    'refresh-trace.log',
    'application/octet-stream',
    'file',
    125,
    '1a583d912cb23e5e717f34e4fee466a9bb1e3713dc2775262ab930ed42e47a9f',
    'assets/c0000000-0000-4000-8000-000000000001/f0000000-0000-4000-8000-000000000001.log',
    'a0000000-0000-4000-8000-000000000001'
);

INSERT INTO ticket_asset_search_releases (attachment_id, released_by)
VALUES ('f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001');
