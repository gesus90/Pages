-- The boolean writer and strict row reader reject null activity states; adding a
-- NOT NULL constraint would require rebuilding the existing expression index.
ALTER TABLE agent_connections ADD COLUMN is_active BOOLEAN DEFAULT TRUE;

CREATE TABLE agent_execution_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    model TEXT NOT NULL,
    reasoning_effort TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE agent_profile_purposes (
    profile_id TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('text', 'chat', 'agent')),
    PRIMARY KEY (profile_id, purpose)
);

CREATE TABLE agent_profile_targets (
    profile_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('person', 'group', 'department', 'system')),
    target_id TEXT NOT NULL,
    PRIMARY KEY (profile_id, kind, target_id)
);

-- Preserve the A8 system function, including its existing editor chat use.
INSERT INTO agent_execution_profiles (
    id,
    name,
    connection_id,
    model,
    reasoning_effort
)
SELECT
    'system-text',
    'System Text',
    connection_id,
    model,
    reasoning_effort
FROM agent_function_assignments
WHERE function = 'text';

INSERT INTO agent_profile_purposes (profile_id, purpose)
SELECT
    id,
    purpose
FROM agent_execution_profiles
CROSS JOIN (VALUES ('text'), ('chat')) AS purposes(purpose);

INSERT INTO agent_profile_targets (profile_id, kind, target_id)
SELECT
    profile_id,
    'system',
    purpose
FROM agent_profile_purposes;
