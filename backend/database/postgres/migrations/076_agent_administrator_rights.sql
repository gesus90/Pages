ALTER TABLE agent_employees
    ADD COLUMN has_administrator_rights BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE agent_activity
    DROP CONSTRAINT agent_activity_kind_check;

ALTER TABLE agent_activity
    ADD CONSTRAINT agent_activity_kind_check CHECK (
        kind IN ('learning', 'access', 'administrator_granted', 'administrator_revoked', 'image', 'video', 'audio')
    );

ALTER TABLE administration_activity
    DROP CONSTRAINT administration_activity_source_check;

ALTER TABLE administration_activity
    ADD CONSTRAINT administration_activity_source_check CHECK (
        source IN ('ui', 'mcp', 'ai')
    );
