-- PAGE-313: the swarm node. A main model splits a task among helpers at run
-- time. The task board of one swarm node in one run is kept as one row: the
-- subtasks with helper, status, result and attempts, the helpers, the
-- reported violations and the virtual locks with owner and expiry. A resumed
-- run reads the board of the run it resumes; finished subtasks stay finished.
-- Times are ISO 8601 in UTC.
CREATE TABLE agent_plan_swarm_boards (
    run_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    board_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, node_id)
);

-- The TODO lists of PAGE-306 get the helper as part of their key, so the main
-- model and every helper of a swarm keep their own list under the attempt of
-- the swarm node. An empty worker_id is the list of an ordinary node, as
-- before; 'main' is the main model and H1 … H10 are the helpers.
ALTER TABLE agent_plan_agent_todos
    ADD COLUMN worker_id TEXT NOT NULL DEFAULT '';

ALTER TABLE agent_plan_agent_todos
    DROP CONSTRAINT agent_plan_agent_todos_pkey;

ALTER TABLE agent_plan_agent_todos
    ADD PRIMARY KEY (attempt_id, worker_id);
