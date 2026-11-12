-- PAGE-309: one-time plans. The mark itself ("oneShot") lives in the plan graph
-- like every other plan setting. Only the deadline needs a column of its own:
-- it is set when a run of a one-time plan ends as succeeded, cleared by "keep"
-- or by removing the mark, and survives a restart, so a deletion that fell due
-- while the service was down is carried out after the start. Times are ISO 8601
-- in UTC.
ALTER TABLE agent_plans
    ADD COLUMN one_shot_delete_at TEXT;

CREATE INDEX agent_plans_one_shot_due
    ON agent_plans (one_shot_delete_at)
    WHERE one_shot_delete_at IS NOT NULL;
