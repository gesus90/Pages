-- DuckDB 1.5.5 can persist stale secondary ART storage during a shutdown
-- checkpoint after WAL replay. Rebuild explicit indexes from retained table rows.
-- Constraints stay enforced by the migration transaction; no table data changes.
-- New names allow DROP and CREATE within the same DuckDB transaction.
-- Database.close checkpoints with a live connection to prevent recurrence.

DROP INDEX administration_activity_created_at;
CREATE INDEX administration_activity_created_at_v085
ON administration_activity (
    created_at
);

DROP INDEX agent_assets_expiry;
CREATE INDEX agent_assets_expiry_v085
ON agent_assets (
    status,
    expires_at
);

DROP INDEX agent_connections_name_lower;
CREATE UNIQUE INDEX agent_connections_name_lower_v085
ON agent_connections (
    (lower("name"))
);

DROP INDEX agent_import_runs_project;
CREATE INDEX agent_import_runs_project_v085
ON agent_import_runs (
    project_id,
    created_at
);

DROP INDEX agent_import_sources_target;
CREATE INDEX agent_import_sources_target_v085
ON agent_import_sources (
    target_kind,
    target_id
);

DROP INDEX agent_plan_cleanup_failures_owner;
CREATE INDEX agent_plan_cleanup_failures_owner_v085
ON agent_plan_cleanup_failures (
    run_id,
    user_id,
    sequence_number
);

DROP INDEX agent_plan_recovery_execution_run;
CREATE INDEX agent_plan_recovery_execution_run_v085
ON agent_plan_recovery_executions (
    run_id,
    result_revision
);

DROP INDEX agent_plan_repair_run;
CREATE INDEX agent_plan_repair_run_v085
ON agent_plan_repair_attempts (
    run_id,
    result_revision
);

DROP INDEX agent_plan_start_rejections_owner;
CREATE INDEX agent_plan_start_rejections_owner_v085
ON agent_plan_start_rejections (
    plan_id,
    user_id,
    sequence_number
);

DROP INDEX agent_plans_team_name;
CREATE UNIQUE INDEX agent_plans_team_name_v085
ON agent_plans (
    project_id,
    department_id,
    name_key
);

DROP INDEX agent_run_credentials_step;
CREATE INDEX agent_run_credentials_step_v085
ON agent_run_credentials (
    run_id,
    step_id
);

DROP INDEX agent_session_attempt_run;
CREATE INDEX agent_session_attempt_run_v085
ON agent_session_attempts (
    run_id,
    step_id
);

DROP INDEX agent_session_history_cursor;
CREATE INDEX agent_session_history_cursor_v085
ON agent_session_history_chunks (
    attempt_id,
    last_sequence
);

DROP INDEX agent_session_message_attempt;
CREATE INDEX agent_session_message_attempt_v085
ON agent_session_messages (
    attempt_id
);

DROP INDEX chat_attachment_session;
CREATE INDEX chat_attachment_session_v085
ON chat_attachments (
    session_id
);

DROP INDEX chat_job_session;
CREATE INDEX chat_job_session_v085
ON chat_jobs (
    session_id
);

DROP INDEX chat_message_client_id;
CREATE UNIQUE INDEX chat_message_client_id_v085
ON chat_messages (
    session_id,
    client_message_id
);

DROP INDEX chat_message_session;
CREATE INDEX chat_message_session_v085
ON chat_messages (
    session_id
);

DROP INDEX chat_selection_session;
CREATE INDEX chat_selection_session_v085
ON chat_selections (
    session_id
);

DROP INDEX chat_session_owner;
CREATE INDEX chat_session_owner_v085
ON chat_sessions (
    user_id
);

DROP INDEX chat_steer_session;
CREATE INDEX chat_steer_session_v085
ON chat_steers (
    session_id
);

DROP INDEX departments_name_normalized;
CREATE UNIQUE INDEX departments_name_normalized_v085
ON departments (
    (lower("name"))
);

DROP INDEX discord_connection_attempts_owner;
CREATE INDEX discord_connection_attempts_owner_v085
ON discord_connection_attempts (
    project_id,
    user_id
);

DROP INDEX discord_deliveries_due;
CREATE INDEX discord_deliveries_due_v085
ON discord_deliveries (
    status,
    next_attempt_at
);

DROP INDEX discord_deliveries_project;
CREATE INDEX discord_deliveries_project_v085
ON discord_deliveries (
    project_id,
    subject_key
);

DROP INDEX labels_name_lower;
CREATE UNIQUE INDEX labels_name_lower_v085
ON labels (
    (lower("name"))
);

DROP INDEX milestone_initiatives_initiative_id;
CREATE INDEX milestone_initiatives_initiative_id_v085
ON milestone_initiatives (
    initiative_id
);

DROP INDEX project_activity_work_item_id;
CREATE INDEX project_activity_work_item_id_v085
ON project_activity (
    work_item_id
);

DROP INDEX project_departments_by_department;
CREATE INDEX project_departments_by_department_v085
ON project_departments (
    department_id,
    project_id
);

DROP INDEX remote_connections_name_lower;
CREATE UNIQUE INDEX remote_connections_name_lower_v085
ON remote_connections (
    (lower("name"))
);

DROP INDEX roles_name_normalized;
CREATE UNIQUE INDEX roles_name_normalized_v085
ON roles (
    (lower("name"))
);

DROP INDEX runner_history_recovery_pending;
CREATE INDEX runner_history_recovery_pending_v085
ON runner_history_recovery (
    connection_id,
    restored_at,
    "sequence"
);

DROP INDEX user_group_members_by_user;
CREATE INDEX user_group_members_by_user_v085
ON user_group_members (
    user_id,
    group_id
);

DROP INDEX user_groups_name_lower;
CREATE UNIQUE INDEX user_groups_name_lower_v085
ON user_groups (
    (lower("name"))
);

DROP INDEX users_username_normalized;
CREATE UNIQUE INDEX users_username_normalized_v085
ON users (
    (lower(username))
);

DROP INDEX work_items_assignee_group_idx;
CREATE INDEX work_items_assignee_group_idx_v085
ON work_items (
    assignee_group_id
);

DROP INDEX work_items_department_idx;
CREATE INDEX work_items_department_idx_v085
ON work_items (
    department_id,
    project_id
);

