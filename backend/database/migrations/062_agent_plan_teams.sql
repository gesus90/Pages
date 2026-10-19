-- Team scope of agent plans and node templates (PAGE-118).
--
-- A plan or template created after this migration by a person who belongs to
-- exactly one department is assigned to that department for good: the
-- members of the department who can open the project share it. Templates
-- stored before keep NULL and stay personal. This migration itself publishes,
-- renames, merges and deletes nothing.
--
-- Plans that exist right now are marked once with legacy_share_pending. The
-- server start (AgentPlanLegacyShare) later gives each marked plan the
-- department of its owner, but only while the owner belongs to exactly one,
-- and then drops the mark. Plans created after this migration are never
-- marked, so a later private plan is never published retroactively.
--
-- name_key is the normalized plan name (see agentPlanNameKey). The unique
-- index only holds for rows that carry a department and a key, because NULL
-- values are never equal in a unique index. Existing plans, including ones
-- that share a name, therefore stay outside the rule and cannot make this
-- migration fail.
ALTER TABLE agent_plans ADD COLUMN department_id TEXT;
ALTER TABLE agent_plans ADD COLUMN name_key TEXT;
ALTER TABLE agent_plans ADD COLUMN updated_by TEXT;
ALTER TABLE agent_plans ADD COLUMN updated_at TEXT;
ALTER TABLE agent_plans ADD COLUMN legacy_share_pending BOOLEAN DEFAULT false;
UPDATE agent_plans SET legacy_share_pending = true;

CREATE UNIQUE INDEX agent_plans_team_name
    ON agent_plans (project_id, department_id, name_key);

-- A shared template names the project and the department it was saved for;
-- a personal one keeps both NULL, as every template saved before.
ALTER TABLE agent_plan_templates ADD COLUMN project_id TEXT;
ALTER TABLE agent_plan_templates ADD COLUMN department_id TEXT;
