-- Pages authenticates with usernames, so users gain a unique username and an
-- updated_at column while email becomes optional. DuckDB refuses to alter a
-- table that foreign keys point at, so the affected tables are copied,
-- recreated with the new definition, and refilled inside one transaction.
CREATE TABLE users_backup AS
SELECT
    id,
    email,
    display_name,
    password_hash,
    role,
    created_at
FROM users;

CREATE TABLE projects_backup AS
SELECT
    id,
    name,
    description,
    owner_id,
    created_at,
    updated_at
FROM projects;

CREATE TABLE project_members_backup AS
SELECT
    project_id,
    user_id,
    joined_at
FROM project_members;

CREATE TABLE tasks_backup AS
SELECT
    id,
    project_id,
    assignee_id,
    title,
    description,
    status,
    created_at,
    updated_at
FROM tasks;

CREATE TABLE wiki_pages_backup AS
SELECT
    id,
    project_id,
    author_id,
    title,
    content,
    created_at,
    updated_at
FROM wiki_pages;

DROP TABLE wiki_pages;

DROP TABLE tasks;

DROP TABLE project_members;

DROP TABLE projects;

DROP TABLE users;

CREATE TABLE users (
    id UUID PRIMARY KEY,
    username VARCHAR NOT NULL UNIQUE,
    display_name VARCHAR NOT NULL,
    password_hash VARCHAR NOT NULL,
    email VARCHAR UNIQUE,
    role VARCHAR NOT NULL CHECK (
        role IN ('admin', 'project_manager', 'employee')
    ),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Accounts created before this migration signed in with their email address,
-- which therefore becomes their username.
INSERT INTO users (
    id,
    username,
    display_name,
    password_hash,
    email,
    role,
    created_at,
    updated_at
)
SELECT
    id,
    email AS username,
    display_name,
    password_hash,
    email,
    role,
    created_at,
    created_at AS updated_at
FROM users_backup;

CREATE TABLE projects (
    id UUID PRIMARY KEY,
    name VARCHAR NOT NULL,
    description VARCHAR,
    owner_id UUID NOT NULL REFERENCES users (id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO projects (
    id,
    name,
    description,
    owner_id,
    created_at,
    updated_at
)
SELECT
    id,
    name,
    description,
    owner_id,
    created_at,
    updated_at
FROM projects_backup;

CREATE TABLE project_members (
    project_id UUID NOT NULL REFERENCES projects (id),
    user_id UUID NOT NULL REFERENCES users (id),
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, user_id)
);

INSERT INTO project_members (
    project_id,
    user_id,
    joined_at
)
SELECT
    project_id,
    user_id,
    joined_at
FROM project_members_backup;

CREATE TABLE tasks (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects (id),
    assignee_id UUID REFERENCES users (id),
    title VARCHAR NOT NULL,
    description VARCHAR,
    status VARCHAR NOT NULL DEFAULT 'open' CHECK (
        status IN ('open', 'in_progress', 'completed')
    ),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO tasks (
    id,
    project_id,
    assignee_id,
    title,
    description,
    status,
    created_at,
    updated_at
)
SELECT
    id,
    project_id,
    assignee_id,
    title,
    description,
    status,
    created_at,
    updated_at
FROM tasks_backup;

CREATE TABLE wiki_pages (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects (id),
    author_id UUID NOT NULL REFERENCES users (id),
    title VARCHAR NOT NULL,
    content VARCHAR NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO wiki_pages (
    id,
    project_id,
    author_id,
    title,
    content,
    created_at,
    updated_at
)
SELECT
    id,
    project_id,
    author_id,
    title,
    content,
    created_at,
    updated_at
FROM wiki_pages_backup;

DROP TABLE wiki_pages_backup;

DROP TABLE tasks_backup;

DROP TABLE project_members_backup;

DROP TABLE projects_backup;

DROP TABLE users_backup;

CREATE TABLE sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id),
    token_hash VARCHAR NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    last_used_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
