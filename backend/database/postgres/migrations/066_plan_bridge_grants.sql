-- The bearers of the plan bridge survive a restart of the API process.
--
-- An agent session runs in its own unit and outlives a restart of the API
-- process. Until now its bearer existed only in the memory of that process,
-- so after a deploy every call of a surviving session was refused although
-- its step credential was still valid.
--
-- A row holds neither the bearer nor a usable credential: bearer_hash is the
-- SHA-256 of the bearer and only finds the row; sealed_token is the step
-- credential, encrypted with a key that is derived from the bearer and bound
-- to run, step, instance and expiry of the row. Only the session that holds
-- the bearer can open it. expires_at zero means until revocation. The row
-- goes with the credential it stands for.
CREATE TABLE agent_plan_bridge_grants (
    bearer_hash TEXT NOT NULL,
    credential_hash TEXT NOT NULL,
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    sealed_token TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (bearer_hash),
    FOREIGN KEY (credential_hash) REFERENCES agent_run_credentials (token_hash) ON DELETE CASCADE,
    CHECK (expires_at >= 0)
);

CREATE INDEX agent_plan_bridge_grants_step
    ON agent_plan_bridge_grants (run_id, step_id);

CREATE INDEX agent_plan_bridge_grants_credential
    ON agent_plan_bridge_grants (credential_hash);
