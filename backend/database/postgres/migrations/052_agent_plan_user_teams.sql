-- PAGE-330: persons are read-only entries of the existing team model.
ALTER TABLE agent_plan_teams
    DROP CONSTRAINT agent_plan_teams_kind_check;

ALTER TABLE agent_plan_teams
    ADD CONSTRAINT agent_plan_teams_kind_check
    CHECK (kind IN ('group', 'department', 'user'));

ALTER TABLE agent_plan_teams
    ADD CONSTRAINT agent_plan_teams_user_read_only
    CHECK (kind <> 'user' OR (can_read = TRUE AND can_edit = FALSE AND can_run = FALSE));
