-- PAGE-329: a plan belongs to a list of teams. Each entry is a group or a
-- department with the rights to read, change and run the plan. The single
-- column agent_plans.department_id stays as the name space of the plan; its
-- department becomes the first team entry, with all three rights, so no
-- existing plan loses its team.
CREATE TABLE agent_plan_teams (
    plan_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    can_read BOOLEAN NOT NULL DEFAULT TRUE,
    can_edit BOOLEAN NOT NULL DEFAULT TRUE,
    can_run BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (plan_id, kind, target_id),
    CHECK (kind IN ('group', 'department'))
);

CREATE INDEX agent_plan_teams_by_target
    ON agent_plan_teams (kind, target_id, plan_id);

INSERT INTO agent_plan_teams (
    plan_id,
    position,
    kind,
    target_id,
    can_read,
    can_edit,
    can_run
)
SELECT
    id,
    0,
    'department',
    department_id,
    TRUE,
    TRUE,
    TRUE
FROM agent_plans
WHERE department_id IS NOT NULL;

-- An administrator approves the content of one script step. The approval is
-- bound to the hash of script, interpreter profile and workspace; any change
-- of them makes the stored hash differ, which lifts the approval.
CREATE TABLE agent_plan_script_approvals (
    plan_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    approved_by TEXT NOT NULL,
    approved_at TEXT NOT NULL,
    PRIMARY KEY (plan_id, step_id)
);

-- The history of a plan: changes of teams and owner, script approvals and
-- every action of an administrator on a plan of somebody else. The entries
-- stay when the plan is deleted, so a deletion remains traceable.
CREATE TABLE agent_plan_audit (
    id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    revision INTEGER NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    PRIMARY KEY (id)
);

CREATE INDEX agent_plan_audit_by_plan
    ON agent_plan_audit (plan_id, created_at, id);

CREATE FUNCTION delete_agent_plan_access() RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM agent_plan_teams WHERE plan_id = OLD.id;
    DELETE FROM agent_plan_script_approvals WHERE plan_id = OLD.id;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_plan_access_cleanup
AFTER DELETE ON agent_plans
FOR EACH ROW EXECUTE FUNCTION delete_agent_plan_access();
