-- Credentials of agent plan sessions (PAGE-47): one per running CLI node,
-- bound to its executor, its run and its step, limited to the listed agent API
-- operations and tickets, and valid only until the node closes. Only the
-- SHA-256 hash of a credential is stored.
CREATE TABLE agent_run_credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    operations_json TEXT NOT NULL,
    ticket_ids_json TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    revoked_at BIGINT
);

CREATE INDEX agent_run_credentials_step ON agent_run_credentials (run_id, step_id);
