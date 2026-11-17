-- The call register of agent plans. A Jump of one plan calls an entry of
-- another plan; the call is stored once, under a stable identity of the
-- calling run, the Jump node and its activation, so a repeated or recovered
-- activation finds its call instead of making a second one. The call holds
-- everything the calling and the called run need: the frozen target revision
-- and interface, the declared inputs, how the caller waits, its deadline, the
-- state and, once decided, the outcome. A call is decided exactly once: every
-- decision is a conditional update of decided_at, and an accepted signal of the
-- awaited name is marked on the same row (signal_accepted_at), so a racing
-- timeout or failure can never take the decision from it. The start of the target run
-- is tracked apart from it (start_state), because a call that goes on at once
-- is decided while its target still waits for its turn. Times are ISO 8601 in UTC;
-- flags are 0 or 1.
CREATE TABLE agent_plan_invocations (
    id TEXT PRIMARY KEY,
    source_plan_id TEXT NOT NULL,
    source_run_id TEXT NOT NULL,
    source_node_id TEXT NOT NULL,
    activation INTEGER NOT NULL DEFAULT 1,
    iteration INTEGER,
    activation_key TEXT NOT NULL,
    user_id TEXT NOT NULL,
    target_plan_id TEXT NOT NULL,
    target_revision INTEGER NOT NULL,
    entry_node_id TEXT NOT NULL,
    target_run_id TEXT,
    target_status TEXT,
    inputs_json TEXT NOT NULL DEFAULT '{}',
    interface_json TEXT NOT NULL DEFAULT '{}',
    wait_mode TEXT NOT NULL,
    signal_name TEXT,
    signal_accepted_at TEXT,
    workspace_mode TEXT NOT NULL DEFAULT 'own',
    handover_state TEXT NOT NULL DEFAULT 'none',
    handover_keys_json TEXT NOT NULL DEFAULT '[]',
    start_state TEXT NOT NULL DEFAULT 'pending',
    is_detached INTEGER NOT NULL DEFAULT 0,
    deadline_at TEXT,
    state TEXT NOT NULL,
    failure_reason TEXT,
    outcome_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    decided_at TEXT,
    creation_order BIGINT NOT NULL DEFAULT nextval('row_creation_order'),
    UNIQUE (source_run_id, source_node_id, activation_key),
    CHECK (wait_mode IN ('continue', 'completion', 'signal')),
    CHECK (workspace_mode IN ('own', 'shared')),
    CHECK (handover_state IN ('none', 'handed_over', 'returned')),
    CHECK (start_state IN ('pending', 'started', 'cancelled'))
);

CREATE INDEX agent_plan_invocations_target_run
    ON agent_plan_invocations (target_run_id)
    WHERE target_run_id IS NOT NULL;

CREATE INDEX agent_plan_invocations_source_run
    ON agent_plan_invocations (source_run_id);

CREATE INDEX agent_plan_invocations_open
    ON agent_plan_invocations (creation_order)
    WHERE decided_at IS NULL;

CREATE INDEX agent_plan_invocations_pending_start
    ON agent_plan_invocations (target_plan_id, creation_order)
    WHERE start_state = 'pending';

-- A signal a called run sent to its caller. The first signal of a name wins:
-- the primary key keeps every later one of the same name out, so a repeated
-- send never counts twice. A signal stays stored whether or not the caller
-- already waits for it.
CREATE TABLE agent_plan_invocation_signals (
    invocation_id TEXT NOT NULL,
    name TEXT NOT NULL,
    payload_json TEXT,
    accepted_at TEXT NOT NULL,
    PRIMARY KEY (invocation_id, name)
);
