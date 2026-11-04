-- Runs, reservations and retained history packets keep their creation order (DuckDB
-- migration 091). A fresh database has no such rows, and db:transfer copies the values.
ALTER TABLE agent_plan_runs ADD COLUMN creation_order BIGINT DEFAULT nextval('row_creation_order');
ALTER TABLE agent_plan_workspace_locks ADD COLUMN creation_order BIGINT DEFAULT nextval('row_creation_order');
ALTER TABLE runner_history_recovery ADD COLUMN creation_order BIGINT DEFAULT nextval('row_creation_order');
