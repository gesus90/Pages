-- PAGE-20: agents that users create themselves, and the record of each agent
-- run. An agent with an owner names the administrator's model it was created
-- from; the connection and the model are checked against that model again at
-- every start, so the agent never widens a model grant. Rows of administrator
-- agents keep both columns NULL.
ALTER TABLE agent_execution_profiles ADD COLUMN owner_id TEXT;
ALTER TABLE agent_execution_profiles ADD COLUMN model_profile_id TEXT;

-- The rendered prompt is pinned when a step starts, so a record that is
-- written after a crash still shows what the model received.
CREATE TABLE page_agent_run_inputs (
    plan_run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    started_at TEXT NOT NULL,
    PRIMARY KEY (plan_run_id, step_id)
);

-- One record per finished run of an agent. The markdown file below the agent
-- folder is rendered from this row, so a repeated completion cannot create a
-- second record and a lost file is written again from it.
CREATE TABLE page_agent_run_records (
    agent_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    plan_run_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'cancelled', 'timeout')),
    model TEXT NOT NULL,
    reasoning_effort TEXT,
    input TEXT NOT NULL,
    result TEXT NOT NULL,
    PRIMARY KEY (agent_id, run_id)
);

-- Runs that ended before this migration have no records and get none: a record
-- written later would carry a wrong time and an input that was never pinned.
CREATE TABLE page_agent_archived_runs (
    plan_run_id TEXT PRIMARY KEY
);

INSERT INTO page_agent_archived_runs (plan_run_id)
SELECT id
FROM agent_plan_runs
WHERE status <> 'running';
