-- Runs, reservations and retained history packets keep the order they were created
-- in (see migration 090). It decides which run takes a working copy first after a
-- restart, which holder a waiting run names and which packet of a job comes first.
ALTER TABLE agent_plan_runs ADD COLUMN creation_order BIGINT;
UPDATE agent_plan_runs
SET creation_order = rowid - (SELECT MAX(rowid) + 1 FROM agent_plan_runs);
ALTER TABLE agent_plan_runs ALTER COLUMN creation_order SET DEFAULT nextval('row_creation_order');

ALTER TABLE agent_plan_workspace_locks ADD COLUMN creation_order BIGINT;
UPDATE agent_plan_workspace_locks
SET creation_order = rowid - (SELECT MAX(rowid) + 1 FROM agent_plan_workspace_locks);
ALTER TABLE agent_plan_workspace_locks ALTER COLUMN creation_order SET DEFAULT nextval('row_creation_order');

ALTER TABLE runner_history_recovery ADD COLUMN creation_order BIGINT;
UPDATE runner_history_recovery
SET creation_order = rowid - (SELECT MAX(rowid) + 1 FROM runner_history_recovery);
ALTER TABLE runner_history_recovery ALTER COLUMN creation_order SET DEFAULT nextval('row_creation_order');
