-- PAGE-306: the TODO list a CLI reports as a structured ACP plan while a step
-- runs. The row belongs to one attempt of one node, so every iteration of a
-- loop keeps its own list; a later plan update of the attempt replaces the
-- list. todos_json holds the entries with identifier, text, status and the
-- time of their last change. Times are ISO 8601 in UTC.
CREATE TABLE agent_plan_agent_todos (
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL,
    todos_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (attempt_id)
);

CREATE INDEX agent_plan_agent_todos_run_idx
    ON agent_plan_agent_todos (run_id);
