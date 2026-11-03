-- PAGE-175: a loop takes its count from the count output of a stack or runs
-- as a while loop, and a bound count may be 0. Rebuild the iteration table so
-- its checks admit these sources; every stored row keeps its values.
CREATE TABLE agent_plan_loop_iterations_next (
    run_id TEXT NOT NULL,
    loop_id TEXT NOT NULL,
    iteration INTEGER NOT NULL CHECK (iteration >= 1),
    run_revision BIGINT NOT NULL,
    completed_at TEXT NOT NULL,
    count_source TEXT NOT NULL CHECK (count_source IN ('value', 'parameter', 'stack', 'while')),
    count_mode TEXT NOT NULL CHECK (count_mode IN ('max', 'expected')),
    effective_count INTEGER NOT NULL CHECK (effective_count BETWEEN 0 AND 999),
    condition_state TEXT NOT NULL CHECK (condition_state IN ('not_evaluated', 'evaluated')),
    condition_met BOOLEAN,
    iteration_json TEXT NOT NULL,
    PRIMARY KEY (run_id, loop_id, iteration)
);

INSERT INTO agent_plan_loop_iterations_next (
    run_id,
    loop_id,
    iteration,
    run_revision,
    completed_at,
    count_source,
    count_mode,
    effective_count,
    condition_state,
    condition_met,
    iteration_json
)
SELECT
    run_id,
    loop_id,
    iteration,
    run_revision,
    completed_at,
    count_source,
    count_mode,
    effective_count,
    condition_state,
    condition_met,
    iteration_json
FROM agent_plan_loop_iterations;

DROP TABLE agent_plan_loop_iterations;
ALTER TABLE agent_plan_loop_iterations_next RENAME TO agent_plan_loop_iterations;
