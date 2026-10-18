-- Destructive removal: saved text suggestions, conversations and preferences
-- cannot be recovered without restoring a pre-upgrade database backup.
DROP INDEX assistant_conversation_owner;
DROP TABLE assistant_messages;
DROP TABLE assistant_conversations;
DROP TABLE text_assistant_preferences;
DROP TABLE text_assistant_settings;

-- Keep central agent definitions, IDs, connection grants and all other uses.
-- Even a definition that loses its only purpose may still be referenced by
-- a user agent, a plan or a historical run; it gains no replacement purpose.
DELETE FROM agent_profile_targets
WHERE kind = 'system'
    AND target_id = 'text';

DELETE FROM agent_legacy_function_assignments
WHERE function = 'text';

-- Rebuild the purpose constraint so the removed purpose cannot be stored again.
CREATE TABLE agent_profile_purposes_next (
    profile_id TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('chat', 'agent')),
    PRIMARY KEY (profile_id, purpose)
);

INSERT INTO agent_profile_purposes_next (
    profile_id,
    purpose
)
SELECT
    profile_id,
    purpose
FROM agent_profile_purposes
WHERE purpose <> 'text';

DROP TABLE agent_profile_purposes;
ALTER TABLE agent_profile_purposes_next RENAME TO agent_profile_purposes;

-- Retain the independent SKILLS legacy metadata without the text-role branch.
CREATE OR REPLACE VIEW agent_function_assignments AS
SELECT
    legacy.function,
    profiles.connection_id,
    profiles.model,
    profiles.reasoning_effort
FROM agent_legacy_function_assignments AS legacy
INNER JOIN agent_execution_profiles AS profiles
    ON profiles.id = legacy.profile_id;
