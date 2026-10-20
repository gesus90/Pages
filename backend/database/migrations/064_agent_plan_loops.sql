-- PAGE-122: one immutable row per completed loop iteration. The run view keeps
-- the live state of a loop; this table is the durable boundary a restart can
-- trust, written in the same transaction as the run view it belongs to. A
-- stored session ID in it is a record of what happened, never proof that the
-- session still lives.
CREATE TABLE agent_plan_loop_iterations (
    run_id TEXT NOT NULL,
    loop_id TEXT NOT NULL,
    iteration INTEGER NOT NULL CHECK (iteration >= 1),
    run_revision BIGINT NOT NULL,
    completed_at TEXT NOT NULL,
    count_source TEXT NOT NULL CHECK (count_source IN ('value', 'parameter')),
    count_mode TEXT NOT NULL CHECK (count_mode IN ('max', 'expected')),
    effective_count INTEGER NOT NULL CHECK (effective_count BETWEEN 1 AND 999),
    condition_state TEXT NOT NULL CHECK (condition_state IN ('not_evaluated', 'evaluated')),
    condition_met BOOLEAN,
    iteration_json TEXT NOT NULL,
    PRIMARY KEY (run_id, loop_id, iteration)
);
