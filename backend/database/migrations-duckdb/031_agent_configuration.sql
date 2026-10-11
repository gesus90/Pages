-- Keep profile identifiers as the public compatibility API; the profile row is now the agent.
ALTER TABLE agent_execution_profiles ADD COLUMN configuration_json TEXT;
ALTER TABLE agent_execution_profiles ADD COLUMN revision INTEGER DEFAULT 1;

-- Split mixed legacy access scopes without widening any grant. Keep the original ID
-- for its highest-ranked scope; additional scopes receive deterministic identifiers.
CREATE TEMP TABLE agent_scope_migration AS
SELECT
    profiles.id AS original_id,
    COALESCE(targets.kind, 'system') AS kind,
    ROW_NUMBER() OVER (
        PARTITION BY profiles.id
        ORDER BY CASE COALESCE(targets.kind, 'system')
            WHEN 'person' THEN 1
            WHEN 'group' THEN 2
            WHEN 'department' THEN 3
            ELSE 4
        END
    ) AS scope_rank
FROM agent_execution_profiles AS profiles
LEFT JOIN (
    SELECT DISTINCT
        profile_id,
        kind
    FROM agent_profile_targets
) AS targets
    ON targets.profile_id = profiles.id;

INSERT INTO agent_execution_profiles (
    id,
    name,
    connection_id,
    model,
    reasoning_effort,
    is_active
)
SELECT
    scopes.original_id || '-scope-' || scopes.kind,
    profiles.name || ' (' || scopes.kind || ')',
    profiles.connection_id,
    profiles.model,
    profiles.reasoning_effort,
    profiles.is_active
FROM agent_scope_migration AS scopes
INNER JOIN agent_execution_profiles AS profiles
    ON profiles.id = scopes.original_id
WHERE scopes.scope_rank > 1;

INSERT INTO agent_profile_purposes (profile_id, purpose)
SELECT
    scopes.original_id || '-scope-' || scopes.kind,
    purposes.purpose
FROM agent_scope_migration AS scopes
INNER JOIN agent_profile_purposes AS purposes
    ON purposes.profile_id = scopes.original_id
WHERE scopes.scope_rank > 1;

INSERT INTO agent_profile_targets (profile_id, kind, target_id)
SELECT
    scopes.original_id || '-scope-' || scopes.kind,
    targets.kind,
    targets.target_id
FROM agent_scope_migration AS scopes
INNER JOIN agent_profile_targets AS targets
    ON targets.profile_id = scopes.original_id
    AND targets.kind = scopes.kind
WHERE scopes.scope_rank > 1;

DELETE FROM agent_profile_targets
WHERE EXISTS (
    SELECT 1
    FROM agent_scope_migration AS scopes
    WHERE scopes.original_id = agent_profile_targets.profile_id
        AND scopes.kind = agent_profile_targets.kind
        AND scopes.scope_rank > 1
);

UPDATE agent_execution_profiles
SET configuration_json = json_object(
    'scope', scopes.kind,
    'tag', '',
    'markdown', '',
    'projectId', NULL,
    'accessMode', CASE WHEN scopes.kind = 'person' THEN 'personal' ELSE 'shared' END,
    'parameters', json('[]'),
    'directoryParameter', NULL,
    'sharing', json_object(
        'isGlobal', scopes.kind = 'system' AND EXISTS (
            SELECT 1
            FROM agent_profile_targets AS targets
            WHERE targets.profile_id = agent_execution_profiles.id
        ),
        'targets', COALESCE((
            SELECT json_group_array(json_object('kind', targets.kind, 'targetId', targets.target_id))
            FROM agent_profile_targets AS targets
            WHERE targets.profile_id = agent_execution_profiles.id
                AND targets.kind <> 'system'
        ), json('[]'))
    )
)
FROM agent_scope_migration AS scopes
WHERE agent_execution_profiles.id = CASE
    WHEN scopes.scope_rank = 1 THEN scopes.original_id
    ELSE scopes.original_id || '-scope-' || scopes.kind
END;

DROP TABLE agent_scope_migration;

-- SKILLS has no execution contract. Preserve it as an inactive agent and an
-- explicit legacy reference, never reinterpret it as Chat.
CREATE TABLE agent_legacy_function_assignments (
    function TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL
);

INSERT INTO agent_execution_profiles (
    id,
    name,
    connection_id,
    model,
    reasoning_effort,
    is_active,
    configuration_json
)
SELECT
    'legacy-skills',
    'SKILLS (legacy)',
    connection_id,
    model,
    reasoning_effort,
    FALSE,
    json_object(
        'scope', 'system', 'tag', 'SKILLS', 'markdown', '', 'projectId', NULL,
        'accessMode', 'shared', 'parameters', json('[]'), 'directoryParameter', NULL,
        'sharing', json_object('isGlobal', FALSE, 'targets', json('[]'))
    )
FROM agent_function_assignments
WHERE function = 'skills';

INSERT INTO agent_profile_purposes (profile_id, purpose)
SELECT id, 'agent'
FROM agent_execution_profiles
WHERE id = 'legacy-skills';

INSERT INTO agent_legacy_function_assignments (function, profile_id)
SELECT 'skills', id
FROM agent_execution_profiles
WHERE id = 'legacy-skills';

DROP TABLE agent_function_assignments;

-- Read-only compatibility facade; connection/model configuration exists only on the agent.
CREATE VIEW agent_function_assignments AS
SELECT
    targets.target_id AS function,
    profiles.connection_id,
    profiles.model,
    profiles.reasoning_effort
FROM agent_profile_targets AS targets
INNER JOIN agent_execution_profiles AS profiles
    ON profiles.id = targets.profile_id
WHERE targets.kind = 'system'
    AND targets.target_id = 'text'
UNION ALL
SELECT
    legacy.function,
    profiles.connection_id,
    profiles.model,
    profiles.reasoning_effort
FROM agent_legacy_function_assignments AS legacy
INNER JOIN agent_execution_profiles AS profiles
    ON profiles.id = legacy.profile_id;
