-- The shared memory of a swarm node. The task board stays in
-- agent_plan_swarm_boards; knowledge lives in its own tables under run and
-- node. One state row per run and node is the revision counter that a
-- publish locks, so revisions are given out without gaps; it also holds the
-- consolidated snapshot with its optimistic version and the setting whether
-- the entries stay after the run ended. Events are never changed except for
-- the mark that a consolidation superseded them. Times are ISO 8601 in UTC;
-- flags are 0 or 1.
CREATE TABLE agent_plan_swarm_memory_states (
    run_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    snapshot_text TEXT NOT NULL DEFAULT '',
    snapshot_revision INTEGER NOT NULL DEFAULT 0,
    snapshot_version INTEGER NOT NULL DEFAULT 0,
    snapshot_contradictions TEXT NOT NULL DEFAULT '[]',
    snapshot_updated_at TEXT,
    keep_after_end INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, node_id)
);

CREATE TABLE agent_plan_swarm_memory_events (
    run_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    event_id TEXT NOT NULL,
    author TEXT NOT NULL,
    kind TEXT NOT NULL,
    body TEXT NOT NULL,
    is_redacted INTEGER NOT NULL DEFAULT 0,
    superseded_by INTEGER,
    created_at TEXT NOT NULL,
    PRIMARY KEY (run_id, node_id, revision),
    UNIQUE (run_id, node_id, event_id)
);

CREATE INDEX agent_plan_swarm_memory_events_author
    ON agent_plan_swarm_memory_events (run_id, node_id, author);

-- Up to which revision the main model ('main') and each helper (H1 … H10)
-- received the entries, so a tool answer and the next turn bring only newer ones.
CREATE TABLE agent_plan_swarm_memory_reads (
    run_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, node_id, agent_id)
);

-- Entries Pages refused, with the reason, for the activity view and the log
-- export. They take no revision and count towards no entry limit.
CREATE TABLE agent_plan_swarm_memory_rejections (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    author TEXT NOT NULL,
    kind TEXT NOT NULL,
    body TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX agent_plan_swarm_memory_rejections_node
    ON agent_plan_swarm_memory_rejections (run_id, node_id, created_at);
