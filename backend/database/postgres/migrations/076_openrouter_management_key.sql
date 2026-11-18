ALTER TABLE agent_connections
    ADD COLUMN openrouter_management_secret_encrypted TEXT;

ALTER TABLE agent_connections
    ADD CONSTRAINT agent_connections_openrouter_management_provider
    CHECK (openrouter_management_secret_encrypted IS NULL OR provider = 'openrouter');
