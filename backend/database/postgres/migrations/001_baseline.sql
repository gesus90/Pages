-- End state of the DuckDB migrations 001 to 088 in backend/database/migrations/.
-- The history is not replayed; docs/PostgresMigration.md maps the types and lists
-- every deliberate difference, and pnpm run postgres:check compares both schemas.

-- Same result as the macros of backend/database/executor/DatabaseWorker.ts: the
-- text format all time columns store. now() is the start of the transaction there
-- as well, and the time zone of the session has no influence.
CREATE FUNCTION utc_after(time_shift INTERVAL) RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
    SELECT to_char((now() AT TIME ZONE 'UTC') + time_shift, 'YYYY-MM-DD HH24:MI:SS');
$$;

CREATE FUNCTION utc_now() RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
    SELECT utc_after(INTERVAL '0 days');
$$;

CREATE SEQUENCE agent_plan_cleanup_failure_order START 1;

CREATE SEQUENCE agent_plan_start_rejection_order START 1;

CREATE TABLE acp_resource_leases (
    instance_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    run_id TEXT,
    step_id TEXT,
    state TEXT NOT NULL,
    since TEXT NOT NULL,
    namespace_identity TEXT,
    PRIMARY KEY (instance_id),
    CHECK (provider IN ('codex_cli', 'claude_code', 'opencode', 'antigravity')),
    CHECK (state IN ('starting', 'running', 'idle', 'closing', 'cleanup_failed'))
);

CREATE TABLE administration_activity (
    id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    "source" TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    changes_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id),
    CHECK ("source" IN ('mcp', 'ai'))
);

CREATE TABLE agent_asset_revisions (
    source_type TEXT NOT NULL,
    source_attachment_id TEXT NOT NULL,
    replacement_attachment_id TEXT NOT NULL,
    expected_digest TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (source_type, source_attachment_id),
    UNIQUE (source_type, replacement_attachment_id),
    CHECK (source_type IN ('ticket', 'wiki'))
);

CREATE TABLE agent_assets (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    kind TEXT NOT NULL,
    size BIGINT NOT NULL,
    checksum TEXT NOT NULL,
    storage_name TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    page_id TEXT,
    attachment_id TEXT,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (id),
    CHECK (status IN ('staged', 'linked', 'expired')),
    CHECK (kind IN ('media', 'file'))
);

CREATE TABLE agent_connection_checks (
    connection_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    error_code TEXT,
    detail_json TEXT NOT NULL DEFAULT '{}',
    duration_ms BIGINT NOT NULL,
    checked_by TEXT NOT NULL,
    checked_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (connection_id, kind),
    CHECK (kind IN ('auth', 'model')),
    CHECK (status IN ('passed', 'failed')),
    CHECK (((status = 'passed') AND (error_code IS NULL)) OR ((status = 'failed') AND (error_code IS NOT NULL)))
);

CREATE TABLE agent_connection_scope_targets (
    connection_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    PRIMARY KEY (connection_id, kind, target_id),
    CHECK (kind IN ('person', 'group', 'department'))
);

CREATE TABLE agent_connection_scopes (
    connection_id TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    PRIMARY KEY (connection_id),
    CHECK ("mode" IN ('global', 'restricted'))
);

CREATE TABLE agent_connections (
    id TEXT NOT NULL,
    "name" TEXT NOT NULL,
    provider TEXT NOT NULL,
    secret_encrypted TEXT,
    test_model TEXT,
    cli_logged_in_at TEXT,
    cli_account_label TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    reasoning_effort TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    zai_account_type TEXT DEFAULT 'api',
    PRIMARY KEY (id),
    CHECK (provider IN ('openrouter', 'openai', 'google_ai_studio', 'zai', 'anthropic', 'codex_cli', 'claude_code', 'opencode', 'antigravity')),
    CHECK (((provider IN ('codex_cli', 'claude_code', 'opencode', 'antigravity')) AND (secret_encrypted IS NULL)) OR ((provider NOT IN ('codex_cli', 'claude_code', 'opencode', 'antigravity')) AND (secret_encrypted IS NOT NULL) AND (cli_logged_in_at IS NULL) AND (cli_account_label IS NULL)))
);

CREATE TABLE agent_execution_profiles (
    id TEXT NOT NULL,
    "name" TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    model TEXT NOT NULL,
    reasoning_effort TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    configuration_json TEXT,
    revision INTEGER DEFAULT 1,
    owner_id TEXT,
    model_profile_id TEXT,
    PRIMARY KEY (id)
);

CREATE TABLE agent_import_items (
    run_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    target_key TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    target_id TEXT,
    error_code TEXT,
    result_json TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (run_id, source_key),
    CHECK ("action" IN ('created', 'skipped', 'conflict', 'failed'))
);

CREATE TABLE agent_import_runs (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    status TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    conflict_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    finished_at BIGINT,
    PRIMARY KEY (id),
    CHECK (status IN ('running', 'complete', 'partial'))
);

CREATE TABLE agent_import_sources (
    project_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    target_kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    target_revision INTEGER NOT NULL,
    result_json TEXT NOT NULL,
    last_run_id TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (project_id, source_key)
);

CREATE TABLE agent_legacy_function_assignments (
    "function" TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    PRIMARY KEY ("function")
);

CREATE TABLE agent_model_catalogs (
    connection_id TEXT NOT NULL,
    interval_hours INTEGER NOT NULL DEFAULT 0,
    next_refresh_at TEXT,
    attempted_at TEXT,
    refreshed_at TEXT,
    error_code TEXT,
    models_json TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (connection_id),
    CHECK (interval_hours IN (0, 6, 24, 168))
);

CREATE TABLE agent_operation_keys (
    user_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, operation_id)
);

CREATE TABLE agent_plan_checkpoints (
    run_id TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    step_id TEXT NOT NULL,
    run_revision BIGINT NOT NULL,
    checkpoint_json TEXT NOT NULL,
    PRIMARY KEY (run_id, "version"),
    UNIQUE (run_id, step_id)
);

CREATE TABLE agent_plan_cleanup_failures (
    id TEXT NOT NULL,
    sequence_number BIGINT NOT NULL DEFAULT nextval('agent_plan_cleanup_failure_order'),
    run_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    failure_json TEXT NOT NULL,
    PRIMARY KEY (id)
);

CREATE TABLE agent_plan_continuations (
    run_id TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    plan_revision INTEGER NOT NULL,
    adopted_at TEXT NOT NULL,
    boundary_json TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    PRIMARY KEY (run_id, "version")
);

CREATE TABLE agent_plan_loop_iterations (
    run_id TEXT NOT NULL,
    loop_id TEXT NOT NULL,
    iteration INTEGER NOT NULL,
    run_revision BIGINT NOT NULL,
    completed_at TEXT NOT NULL,
    count_source TEXT NOT NULL,
    count_mode TEXT NOT NULL,
    effective_count INTEGER NOT NULL,
    condition_state TEXT NOT NULL,
    condition_met BOOLEAN,
    iteration_json TEXT NOT NULL,
    PRIMARY KEY (run_id, loop_id, iteration),
    CHECK (iteration >= 1),
    CHECK (count_source IN ('value', 'parameter', 'stack', 'while')),
    CHECK (count_mode IN ('max', 'expected')),
    CHECK (effective_count BETWEEN 0 AND 999),
    CHECK (condition_state IN ('not_evaluated', 'evaluated'))
);

CREATE TABLE agent_plan_recovery_executions (
    id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    "action" TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    expected_revision BIGINT NOT NULL,
    result_revision BIGINT NOT NULL,
    target_run_id TEXT,
    execution_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (run_id, idempotency_key),
    CHECK ("action" IN ('restart', 'resume', 'release'))
);

CREATE TABLE agent_plan_repair_attempts (
    id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    step_id TEXT,
    "action" TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    expected_revision BIGINT NOT NULL,
    result_revision BIGINT NOT NULL,
    attempt_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (run_id, idempotency_key),
    CHECK ("action" IN ('record_repair', 'reconcile', 'cancel'))
);

CREATE TABLE agent_plan_runs (
    id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    status TEXT NOT NULL,
    view_json TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    recovery_revision BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (id)
);

CREATE TABLE agent_plan_start_rejections (
    id TEXT NOT NULL,
    sequence_number BIGINT NOT NULL DEFAULT nextval('agent_plan_start_rejection_order'),
    plan_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    rejection_json TEXT NOT NULL,
    PRIMARY KEY (id)
);

CREATE TABLE agent_plan_step_reports (
    run_id TEXT NOT NULL,
    session_scope_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL,
    terms_json TEXT NOT NULL,
    report_json TEXT,
    PRIMARY KEY (run_id, session_scope_id)
);

CREATE TABLE agent_plan_templates (
    id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    "name" TEXT NOT NULL,
    name_key TEXT NOT NULL,
    node_type TEXT NOT NULL,
    node_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    project_id TEXT,
    department_id TEXT,
    PRIMARY KEY (id),
    UNIQUE (owner_id, name_key)
);

CREATE TABLE agent_plan_work (
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL,
    ticket_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    record_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (run_id, step_id, attempt_id, ticket_id, revision)
);

CREATE TABLE agent_plan_workspace_locks (
    workspace_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    PRIMARY KEY (workspace_id)
);

CREATE TABLE agent_plans (
    id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    "name" TEXT NOT NULL,
    usage TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    plan_json TEXT NOT NULL,
    department_id TEXT,
    name_key TEXT,
    updated_by TEXT,
    updated_at TEXT,
    legacy_share_pending BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (id),
    CHECK (usage IN ('private', 'workspace'))
);

CREATE TABLE agent_profile_purposes (
    profile_id TEXT NOT NULL,
    purpose TEXT NOT NULL,
    PRIMARY KEY (profile_id, purpose),
    CHECK (purpose IN ('chat', 'agent'))
);

CREATE TABLE agent_profile_targets (
    profile_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    PRIMARY KEY (profile_id, kind, target_id),
    CHECK (kind IN ('person', 'group', 'department', 'system'))
);

CREATE TABLE agent_run_credentials (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    operations_json TEXT NOT NULL,
    ticket_ids_json TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    revoked_at BIGINT,
    reach TEXT DEFAULT 'tickets',
    PRIMARY KEY (id),
    UNIQUE (token_hash)
);

CREATE TABLE agent_session_attempts (
    attempt_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    group_id TEXT,
    state TEXT NOT NULL,
    next_sequence INTEGER NOT NULL DEFAULT 1,
    context_used BIGINT,
    context_limit BIGINT,
    context_source TEXT,
    context_at TEXT,
    confirmed_model TEXT,
    confirmed_model_source TEXT,
    confirmed_model_at TEXT,
    confirmed_reasoning TEXT,
    confirmed_reasoning_source TEXT,
    confirmed_reasoning_at TEXT,
    workspace_directory TEXT,
    git_state TEXT,
    git_reference TEXT,
    workspace_at TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (attempt_id),
    CHECK (provider IN ('codex_cli', 'claude_code', 'opencode', 'antigravity')),
    CHECK (state IN ('starting', 'running', 'waiting_for_input', 'idle', 'waiting_for_capacity', 'recovering', 'ended', 'failed', 'cancelled')),
    CHECK (git_state IN ('branch', 'detached', 'no_repository', 'unreadable'))
);

CREATE TABLE agent_session_events (
    attempt_id TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    turn INTEGER,
    kind TEXT NOT NULL,
    body TEXT NOT NULL,
    is_truncated BOOLEAN NOT NULL DEFAULT FALSE,
    dedupe_key TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (attempt_id, "sequence")
);

CREATE TABLE agent_session_history_chunks (
    attempt_id TEXT NOT NULL,
    launch_id TEXT NOT NULL,
    chunk_index BIGINT NOT NULL,
    byte_offset BIGINT NOT NULL,
    byte_length INTEGER NOT NULL,
    first_sequence BIGINT NOT NULL,
    last_sequence BIGINT NOT NULL,
    sha256 TEXT NOT NULL,
    previous_sha256 TEXT,
    events_jsonl TEXT NOT NULL,
    PRIMARY KEY (attempt_id, chunk_index),
    CHECK (byte_length BETWEEN 1 AND 4194304)
);

CREATE TABLE agent_session_messages (
    id TEXT NOT NULL,
    attempt_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (id),
    CHECK (kind IN ('instruction', 'repair')),
    CHECK (status IN ('queued', 'delivering', 'delivered', 'failed', 'cancelled', 'uncertain'))
);

CREATE TABLE agent_session_turn_usage (
    attempt_id TEXT NOT NULL,
    turn INTEGER NOT NULL,
    provider TEXT NOT NULL,
    model TEXT,
    input_tokens BIGINT,
    output_tokens BIGINT,
    cache_read_tokens BIGINT,
    cache_write_tokens BIGINT,
    total_tokens BIGINT,
    input_includes_cache BOOLEAN,
    is_partial BOOLEAN NOT NULL DEFAULT FALSE,
    reported_at TEXT NOT NULL,
    PRIMARY KEY (attempt_id, turn)
);

CREATE TABLE agent_workspace_cleanup (
    workspace_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    removed_by TEXT NOT NULL,
    workspace_name TEXT NOT NULL,
    requested_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    state TEXT NOT NULL DEFAULT 'pending',
    blocker TEXT NOT NULL DEFAULT 'cleanup_requested',
    PRIMARY KEY (workspace_id, run_id)
);

CREATE TABLE agent_workspaces (
    id TEXT NOT NULL,
    "name" TEXT NOT NULL,
    path TEXT NOT NULL,
    directory_identity TEXT NOT NULL,
    project_id TEXT NOT NULL,
    registered_by TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (id),
    UNIQUE (path)
);

CREATE TABLE chat_acp_sessions (
    chat_session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    model TEXT NOT NULL,
    reasoning_effort TEXT,
    profile TEXT NOT NULL,
    acp_session_id TEXT NOT NULL,
    through_message_id TEXT,
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (chat_session_id)
);

CREATE TABLE chat_attachments (
    id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    message_id TEXT,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size BIGINT NOT NULL,
    storage_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    origin TEXT DEFAULT 'user',
    pica_run_id TEXT,
    PRIMARY KEY (id)
);

CREATE TABLE chat_job_events (
    job_id TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (job_id, "sequence")
);

CREATE TABLE chat_job_turns (
    job_id TEXT NOT NULL,
    turn INTEGER NOT NULL,
    input_tokens BIGINT,
    output_tokens BIGINT,
    total_tokens BIGINT,
    tokens_are_partial BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (job_id, turn)
);

CREATE TABLE chat_jobs (
    id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    state TEXT NOT NULL,
    error_code TEXT,
    context_used BIGINT,
    context_size BIGINT,
    cost_amount DOUBLE PRECISION,
    cost_currency TEXT,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    ended_at TEXT,
    cost_is_estimated BOOLEAN,
    cost_scope TEXT,
    PRIMARY KEY (id),
    CHECK (state IN ('running', 'completed', 'failed', 'stopped', 'interrupted'))
);

CREATE TABLE chat_messages (
    id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    client_message_id TEXT,
    is_stopped BOOLEAN,
    PRIMARY KEY (id),
    CHECK ("role" IN ('user', 'assistant'))
);

CREATE TABLE chat_selections (
    message_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    items TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (message_id)
);

CREATE TABLE chat_sessions (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    last_message_at TEXT NOT NULL DEFAULT utc_now(),
    context_summary TEXT,
    context_through_id TEXT,
    context_revision INTEGER DEFAULT 0,
    PRIMARY KEY (id)
);

CREATE TABLE chat_settings (
    id INTEGER NOT NULL,
    attachment_limit_bytes BIGINT NOT NULL DEFAULT 16777216,
    system_instruction TEXT,
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id),
    CHECK (id = 1),
    CHECK (attachment_limit_bytes BETWEEN 1048576 AND 536870912)
);

CREATE TABLE chat_steers (
    message_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    status TEXT NOT NULL,
    answer_message_id TEXT,
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (message_id),
    CHECK (status IN ('pending', 'delivered', 'accepted', 'followUp', 'failed'))
);

CREATE TABLE department_members (
    user_id TEXT NOT NULL,
    department_id TEXT NOT NULL,
    PRIMARY KEY (user_id, department_id)
);

CREATE TABLE departments (
    id TEXT NOT NULL,
    "name" TEXT NOT NULL,
    PRIMARY KEY (id)
);

CREATE TABLE discord_connection_attempts (
    id TEXT NOT NULL,
    state_hash TEXT NOT NULL,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    base_url TEXT NOT NULL,
    status TEXT NOT NULL,
    failure TEXT,
    guild_id TEXT,
    guild_name TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    PRIMARY KEY (id),
    UNIQUE (state_hash),
    CHECK (status IN ('pending', 'authorized', 'failed', 'confirmed', 'cancelled'))
);

CREATE TABLE discord_deliveries (
    id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    subject_key TEXT NOT NULL,
    content_json TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    locked_until TEXT,
    last_problem TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    sent_at TEXT,
    PRIMARY KEY (id),
    CHECK (status IN ('pending', 'sending', 'sent', 'failed'))
);

CREATE TABLE github_external_issues (
    id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    issue_number BIGINT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open',
    dismissed INTEGER NOT NULL DEFAULT 0,
    imported_work_item_id TEXT,
    detected_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id),
    UNIQUE (project_id, issue_number),
    CHECK (state IN ('open', 'closed')),
    CHECK (dismissed IN (0, 1))
);

CREATE TABLE github_pull_requests (
    id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    number BIGINT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open',
    merged INTEGER NOT NULL DEFAULT 0,
    branch TEXT,
    work_item_id TEXT,
    synced_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id),
    UNIQUE (project_id, number),
    CHECK (state IN ('open', 'closed')),
    CHECK (merged IN (0, 1))
);

CREATE TABLE instance_logo (
    id INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id),
    CHECK (id = 1)
);

CREATE TABLE instance_settings (
    id INTEGER NOT NULL,
    company_name TEXT NOT NULL,
    primary_administrator_id TEXT NOT NULL,
    setup_completed_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id),
    CHECK (id = 1)
);

CREATE TABLE labels (
    id TEXT NOT NULL,
    "name" TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#6b7280',
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id)
);

CREATE TABLE managed_departments (
    user_id TEXT NOT NULL,
    department_id TEXT NOT NULL,
    PRIMARY KEY (user_id, department_id)
);

CREATE TABLE mcp_http_access (
    token_hash TEXT NOT NULL,
    resource TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    PRIMARY KEY (token_hash)
);

CREATE TABLE mcp_http_clients (
    id TEXT NOT NULL,
    metadata TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    PRIMARY KEY (id)
);

CREATE TABLE mcp_http_codes (
    code_hash TEXT NOT NULL,
    parameters TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    PRIMARY KEY (code_hash)
);

CREATE TABLE mcp_pairing_preferences (
    user_id TEXT NOT NULL,
    validity_days INTEGER NOT NULL,
    PRIMARY KEY (user_id),
    CHECK (validity_days BETWEEN 0 AND 365)
);

CREATE TABLE mcp_pairing_requests (
    id TEXT NOT NULL,
    user_code_hash TEXT NOT NULL,
    device_secret_hash TEXT NOT NULL,
    client_name TEXT NOT NULL,
    device_label TEXT NOT NULL,
    package_version TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    status TEXT NOT NULL,
    user_id TEXT,
    decided_at BIGINT,
    approved_name TEXT,
    approved_validity_seconds BIGINT,
    csrf_hash TEXT,
    last_poll_at BIGINT,
    poll_interval INTEGER NOT NULL DEFAULT 5,
    token_id TEXT,
    PRIMARY KEY (id),
    UNIQUE (user_code_hash),
    CHECK (status IN ('pending', 'approved', 'denied', 'cancelled', 'consumed', 'expired'))
);

CREATE TABLE milestone_dependencies (
    id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    link_type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id),
    UNIQUE (source_id, target_id, link_type),
    CHECK (link_type IN ('prerequisite', 'follows', 'blocks', 'relates_to'))
);

CREATE TABLE milestone_initiatives (
    milestone_id TEXT NOT NULL,
    initiative_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (milestone_id, initiative_id)
);

CREATE TABLE milestones (
    id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    "name" TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    color_key TEXT,
    icon_key TEXT,
    color_custom TEXT,
    start_at TEXT,
    due_at TEXT,
    completed_at TEXT,
    archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id),
    CHECK (status IN ('open', 'completed', 'archived'))
);

CREATE TABLE page_agent_archived_runs (
    plan_run_id TEXT NOT NULL,
    PRIMARY KEY (plan_run_id)
);

CREATE TABLE page_agent_run_inputs (
    plan_run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    started_at TEXT NOT NULL,
    PRIMARY KEY (plan_run_id, step_id)
);

CREATE TABLE page_agent_run_records (
    agent_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    plan_run_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    status TEXT NOT NULL,
    model TEXT NOT NULL,
    reasoning_effort TEXT,
    "input" TEXT NOT NULL,
    result TEXT NOT NULL,
    PRIMARY KEY (agent_id, run_id),
    CHECK (status IN ('succeeded', 'failed', 'cancelled', 'timeout'))
);

CREATE TABLE pages_runners (
    connection_id TEXT NOT NULL,
    runner_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    connection_revision INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    registered_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (connection_id),
    UNIQUE (runner_id)
);

CREATE TABLE personal_agent_tokens (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    "name" TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT,
    revoked_at BIGINT,
    "source" TEXT DEFAULT 'manual',
    device_label TEXT,
    last_used_at BIGINT,
    rotated_at BIGINT,
    rotation_requested_at BIGINT,
    previous_token_hash TEXT,
    previous_valid_until BIGINT,
    PRIMARY KEY (id),
    UNIQUE (token_hash)
);

CREATE TABLE pica_mobile_notification_deliveries (
    delivery_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    seq BIGINT NOT NULL,
    state TEXT NOT NULL,
    attempts INTEGER NOT NULL,
    not_before TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    locked_until TEXT,
    outcome TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT,
    PRIMARY KEY (delivery_id),
    CHECK (state IN ('pending', 'sending', 'sent', 'failed', 'expired', 'superseded', 'dropped'))
);

CREATE TABLE pica_mobile_notification_events (
    event_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    seq BIGINT NOT NULL,
    event_type TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    steps_json TEXT,
    step_count INTEGER,
    reason TEXT,
    PRIMARY KEY (event_id),
    CHECK (event_type IN ('step_started', 'run_cancelled', 'run_failed', 'run_succeeded'))
);

CREATE TABLE pica_mobile_notification_instance (
    singleton INTEGER NOT NULL,
    instance_id TEXT NOT NULL,
    PRIMARY KEY (singleton),
    CHECK (singleton = 1)
);

CREATE TABLE pica_mobile_notification_occurrences (
    run_id TEXT NOT NULL,
    occurrence_key TEXT NOT NULL,
    event_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (run_id, occurrence_key)
);

CREATE TABLE pica_mobile_notification_sequences (
    run_id TEXT NOT NULL,
    last_seq BIGINT NOT NULL,
    PRIMARY KEY (run_id)
);

CREATE TABLE pica_mobile_push_registrations (
    device_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    token_fingerprint TEXT NOT NULL,
    token_encrypted TEXT NOT NULL,
    locale TEXT NOT NULL,
    preview TEXT NOT NULL,
    registered_at TEXT NOT NULL,
    renewed_at TEXT NOT NULL,
    activated_at TEXT,
    PRIMARY KEY (device_id),
    CHECK (locale IN ('de', 'en')),
    CHECK (preview IN ('hidden', 'details'))
);

CREATE TABLE pica_settings (
    id INTEGER NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    selection_json TEXT,
    run_json TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    legacy_checked BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (id),
    CHECK (id = 1)
);

CREATE TABLE project_activity (
    id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL,
    "action" TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    work_item_id TEXT,
    wiki_page_id TEXT,
    "source" TEXT NOT NULL DEFAULT 'ui',
    PRIMARY KEY (id),
    CHECK (category IN ('tasks', 'planning', 'team', 'integrations', 'project', 'wiki')),
    CHECK ("source" IN ('ui', 'mcp', 'ai'))
);

CREATE TABLE project_departments (
    project_id TEXT NOT NULL,
    department_id TEXT NOT NULL,
    PRIMARY KEY (project_id, department_id)
);

CREATE TABLE project_discord_connections (
    project_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    guild_name TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    channel_name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    notify_ticket_created INTEGER NOT NULL DEFAULT 1,
    notify_ticket_updated INTEGER NOT NULL DEFAULT 1,
    notify_milestone_created INTEGER NOT NULL DEFAULT 1,
    notify_milestone_updated INTEGER NOT NULL DEFAULT 1,
    connected_by TEXT NOT NULL,
    connected_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id),
    CHECK (notify_ticket_created IN (0, 1)),
    CHECK (notify_ticket_updated IN (0, 1)),
    CHECK (notify_milestone_created IN (0, 1)),
    CHECK (notify_milestone_updated IN (0, 1))
);

CREATE TABLE project_events (
    id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    event_date TEXT NOT NULL,
    event_time TEXT,
    "type" TEXT NOT NULL DEFAULT 'general',
    archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id)
);

CREATE TABLE project_goals (
    id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    is_done INTEGER NOT NULL DEFAULT 0,
    "position" BIGINT NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id),
    CHECK (is_done IN (0, 1))
);

CREATE TABLE project_icons (
    project_id TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    filename TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (project_id)
);

CREATE TABLE project_integrations (
    project_id TEXT NOT NULL,
    repo_url TEXT NOT NULL DEFAULT '',
    repo_name TEXT,
    token_hash TEXT,
    token_encrypted TEXT,
    has_token INTEGER NOT NULL DEFAULT 0,
    sync_issues INTEGER NOT NULL DEFAULT 1,
    sync_status INTEGER NOT NULL DEFAULT 1,
    sync_comments INTEGER NOT NULL DEFAULT 1,
    sync_pull_requests INTEGER NOT NULL DEFAULT 0,
    sync_commits INTEGER NOT NULL DEFAULT 0,
    sync_direction TEXT NOT NULL DEFAULT 'bidirectional',
    sync_interval_minutes INTEGER NOT NULL DEFAULT 15,
    is_connected INTEGER NOT NULL DEFAULT 0,
    last_sync_at TEXT,
    next_sync_at TEXT,
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    sync_enabled INTEGER DEFAULT 1,
    PRIMARY KEY (project_id),
    CHECK (has_token IN (0, 1)),
    CHECK (sync_issues IN (0, 1)),
    CHECK (sync_status IN (0, 1)),
    CHECK (sync_comments IN (0, 1)),
    CHECK (sync_pull_requests IN (0, 1)),
    CHECK (sync_commits IN (0, 1)),
    CHECK (sync_direction IN ('bidirectional', 'push', 'pull')),
    CHECK (sync_interval_minutes IN (0, 5, 15, 30, 60)),
    CHECK (is_connected IN (0, 1))
);

CREATE TABLE project_keys (
    project_id TEXT NOT NULL,
    "key" TEXT NOT NULL,
    last_number BIGINT DEFAULT 0,
    PRIMARY KEY (project_id),
    UNIQUE ("key")
);

CREATE TABLE project_members (
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    joined_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (project_id, user_id),
    CHECK ("role" IN ('manager', 'member', 'viewer'))
);

CREATE TABLE project_tags (
    project_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (project_id, tag)
);

CREATE TABLE project_template_goals (
    template_id TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    title TEXT NOT NULL,
    PRIMARY KEY (template_id, "position")
);

CREATE TABLE project_template_tags (
    template_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (template_id, tag)
);

CREATE TABLE project_templates (
    id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    "name" TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id),
    UNIQUE (project_id)
);

CREATE TABLE projects (
    id TEXT NOT NULL,
    "name" TEXT NOT NULL,
    description TEXT,
    owner_id TEXT NOT NULL,
    parent_id TEXT,
    manager_id TEXT,
    status TEXT NOT NULL DEFAULT 'planned',
    progress INTEGER NOT NULL DEFAULT 0,
    placeholder_color TEXT NOT NULL DEFAULT '#FCE3D3',
    start_date TEXT,
    target_date TEXT,
    notes TEXT NOT NULL DEFAULT '',
    archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id),
    CHECK (status IN ('planned', 'active', 'paused', 'completed')),
    CHECK (progress BETWEEN 0 AND 100)
);

CREATE TABLE remote_connections (
    id TEXT NOT NULL,
    "name" TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT NOT NULL,
    auth_method TEXT NOT NULL,
    department_id TEXT NOT NULL,
    host_key_algorithm TEXT,
    host_key TEXT,
    host_key_fingerprint TEXT,
    password_encrypted TEXT,
    private_key_encrypted TEXT,
    passphrase_encrypted TEXT,
    checked_at TEXT,
    check_stage TEXT,
    check_code TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    revision INTEGER NOT NULL DEFAULT 1,
    allowed_roots_json TEXT DEFAULT '[]',
    PRIMARY KEY (id),
    CHECK (port BETWEEN 1 AND 65535),
    CHECK (auth_method IN ('password', 'key', 'key_passphrase')),
    CHECK (check_stage IN ('reachability', 'host_key', 'authentication')),
    CHECK (((host_key IS NULL) AND (host_key_algorithm IS NULL) AND (host_key_fingerprint IS NULL)) OR ((host_key IS NOT NULL) AND (host_key_algorithm IS NOT NULL) AND (host_key_fingerprint IS NOT NULL)))
);

CREATE TABLE remote_install_findings (
    connection_id TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT NOT NULL,
    host_key_fingerprint TEXT NOT NULL,
    observation_json TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    PRIMARY KEY (connection_id),
    CHECK (port BETWEEN 1 AND 65535)
);

CREATE TABLE remote_workspaces (
    id TEXT NOT NULL,
    "name" TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    path TEXT NOT NULL,
    project_id TEXT NOT NULL,
    registered_by TEXT NOT NULL,
    checked_at TEXT,
    check_issue TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    check_roots_json TEXT,
    PRIMARY KEY (id)
);

CREATE TABLE role_permissions (
    role_id TEXT NOT NULL,
    permission TEXT NOT NULL,
    PRIMARY KEY (role_id, permission),
    CHECK (permission IN ('write', 'manage_projects', 'archive_projects', 'milestones', 'manage_users', 'manage_departments', 'manage_roles'))
);

CREATE TABLE roles (
    id TEXT NOT NULL,
    "name" TEXT NOT NULL,
    hierarchy_rank BIGINT NOT NULL,
    department_bound INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (id),
    CHECK (department_bound IN (0, 1))
);

CREATE TABLE runner_deploy_keys (
    project_id TEXT NOT NULL,
    key_id TEXT NOT NULL,
    public_key TEXT NOT NULL,
    title TEXT NOT NULL,
    PRIMARY KEY (project_id, key_id),
    UNIQUE (project_id, public_key)
);

CREATE TABLE runner_history_recovery (
    event_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    "sequence" BIGINT NOT NULL,
    packet_json TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT utc_now(),
    restored_at TEXT,
    last_attempt_at TEXT,
    diagnosis_json TEXT,
    PRIMARY KEY (event_id)
);

CREATE TABLE runner_plan_events (
    connection_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    "sequence" BIGINT NOT NULL,
    event_id TEXT NOT NULL,
    event_digest TEXT NOT NULL,
    PRIMARY KEY (connection_id, session_id, "sequence"),
    UNIQUE (event_id)
);

CREATE TABLE sessions (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    expires_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id),
    UNIQUE (token_hash)
);

CREATE TABLE tasks (
    id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    assignee_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id),
    CHECK (status IN ('open', 'in_progress', 'completed'))
);

CREATE TABLE user_authorization (
    user_id TEXT NOT NULL,
    role_id TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    active_mode TEXT NOT NULL,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    all_departments INTEGER NOT NULL DEFAULT 0,
    all_projects INTEGER NOT NULL DEFAULT 0,
    has_had_department INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id),
    CHECK (is_admin IN (0, 1)),
    CHECK (active_mode IN ('admin', 'role')),
    CHECK (all_departments IN (0, 1)),
    CHECK (all_projects IN (0, 1)),
    CHECK (has_had_department IN (0, 1)),
    CHECK ((is_admin = 1) OR (role_id IS NOT NULL)),
    CHECK ((active_mode != 'admin') OR (is_admin = 1)),
    CHECK ((active_mode != 'role') OR (role_id IS NOT NULL))
);

CREATE TABLE user_avatars (
    user_id TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    filename TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (user_id)
);

CREATE TABLE user_board_preferences (
    user_id TEXT NOT NULL,
    preferences TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (user_id)
);

CREATE TABLE user_group_members (
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (group_id, user_id)
);

CREATE TABLE user_groups (
    id TEXT NOT NULL,
    "name" TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id)
);

CREATE TABLE user_settings (
    user_id TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'de',
    timezone TEXT,
    date_format TEXT,
    week_start TEXT,
    notify_email INTEGER,
    notify_desktop INTEGER,
    notify_mentions INTEGER,
    notify_assignments INTEGER,
    notify_due_dates INTEGER,
    notify_weekly_summary INTEGER,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    theme TEXT,
    design_theme TEXT,
    terminal_screen_reader TEXT,
    PRIMARY KEY (user_id),
    CHECK ("language" IN ('de', 'en')),
    CHECK (date_format IN ('DD.MM.YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD')),
    CHECK (week_start IN ('monday', 'sunday')),
    CHECK (notify_email IN (0, 1)),
    CHECK (notify_desktop IN (0, 1)),
    CHECK (notify_mentions IN (0, 1)),
    CHECK (notify_assignments IN (0, 1)),
    CHECK (notify_due_dates IN (0, 1)),
    CHECK (notify_weekly_summary IN (0, 1))
);

CREATE TABLE users (
    id TEXT NOT NULL,
    username TEXT NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT,
    "role" TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    avatar_type TEXT NOT NULL DEFAULT 'initials',
    avatar_icon TEXT,
    avatar_color TEXT,
    avatar_image_url TEXT,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    must_change_password INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE (username),
    UNIQUE (email),
    CHECK ("role" IN ('admin', 'manager', 'employee')),
    CHECK (avatar_type IN ('initials', 'icon', 'image'))
);

CREATE TABLE wiki_attachments (
    id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    kind TEXT NOT NULL,
    size BIGINT NOT NULL,
    checksum TEXT NOT NULL,
    storage_name TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id),
    CHECK (kind IN ('media', 'file'))
);

CREATE TABLE wiki_comments (
    id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    parent_id TEXT,
    author_id TEXT NOT NULL,
    body TEXT NOT NULL,
    "quote" TEXT,
    quote_prefix TEXT,
    quote_suffix TEXT,
    resolved_at TEXT,
    resolved_by TEXT,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id)
);

CREATE TABLE wiki_expanded_pages (
    user_id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    PRIMARY KEY (user_id, page_id)
);

CREATE TABLE wiki_favorites (
    user_id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (user_id, page_id)
);

CREATE TABLE wiki_mentions (
    page_id TEXT NOT NULL,
    comment_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (page_id, comment_id, user_id)
);

CREATE TABLE wiki_page_anchors (
    page_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    PRIMARY KEY (page_id, kind, target_id),
    CHECK (kind IN ('department', 'milestone', 'epic'))
);

CREATE TABLE wiki_page_links (
    page_id TEXT NOT NULL,
    target_kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    PRIMARY KEY (page_id, target_kind, target_id),
    CHECK (target_kind IN ('page', 'ticket'))
);

CREATE TABLE wiki_page_versions (
    id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    revision BIGINT NOT NULL,
    title TEXT NOT NULL,
    "content" TEXT NOT NULL,
    author_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id)
);

CREATE TABLE wiki_pages (
    id TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'project',
    project_id TEXT,
    parent_id TEXT,
    "position" BIGINT NOT NULL DEFAULT 0,
    owner_id TEXT NOT NULL DEFAULT '',
    author_id TEXT NOT NULL,
    updated_by TEXT,
    title TEXT NOT NULL,
    icon TEXT,
    "content" TEXT NOT NULL DEFAULT '',
    revision BIGINT NOT NULL DEFAULT 1,
    is_template INTEGER NOT NULL DEFAULT 0,
    current_until TEXT,
    deleted_at TEXT,
    deleted_by TEXT,
    deleted_root_id TEXT,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    cover TEXT,
    PRIMARY KEY (id),
    CHECK ("scope" IN ('instance', 'project', 'private')),
    CHECK (is_template IN (0, 1))
);

CREATE TABLE wiki_recent_pages (
    user_id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    visited_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (user_id, page_id)
);

CREATE TABLE wiki_settings (
    id INTEGER NOT NULL,
    trash_retention_days BIGINT NOT NULL,
    version_retention_days BIGINT NOT NULL,
    version_keep_last BIGINT NOT NULL,
    media_limit_bytes BIGINT NOT NULL,
    file_limit_bytes BIGINT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id),
    CHECK (id = 1)
);

CREATE TABLE wiki_user_state (
    user_id TEXT NOT NULL,
    feed_read_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (user_id)
);

CREATE TABLE work_item_attachments (
    id TEXT NOT NULL,
    work_item_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    kind TEXT NOT NULL,
    size BIGINT NOT NULL,
    checksum TEXT NOT NULL,
    storage_name TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id),
    CHECK (kind IN ('media', 'file'))
);

CREATE TABLE work_item_checklist_items (
    id TEXT NOT NULL,
    work_item_id TEXT NOT NULL,
    title TEXT NOT NULL,
    is_done INTEGER NOT NULL DEFAULT 0,
    sort_order BIGINT NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id)
);

CREATE TABLE work_item_checklist_revisions (
    work_item_id TEXT NOT NULL,
    revision BIGINT NOT NULL,
    content_hash TEXT NOT NULL,
    PRIMARY KEY (work_item_id)
);

CREATE TABLE work_item_history (
    id TEXT NOT NULL,
    work_item_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    "action" TEXT NOT NULL,
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id)
);

CREATE TABLE work_item_labels (
    work_item_id TEXT NOT NULL,
    label_id TEXT NOT NULL,
    assigned_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (work_item_id, label_id)
);

CREATE TABLE work_item_links (
    id TEXT NOT NULL,
    work_item_id TEXT NOT NULL,
    linked_work_item_id TEXT NOT NULL,
    link_type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id),
    UNIQUE (work_item_id, linked_work_item_id, link_type),
    CHECK (link_type IN ('blocks', 'relates_to', 'duplicates'))
);

CREATE TABLE work_item_template_checklist_items (
    template_id TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    title TEXT NOT NULL,
    PRIMARY KEY (template_id, "position")
);

CREATE TABLE work_item_template_departments (
    template_id TEXT NOT NULL,
    department_id TEXT NOT NULL,
    PRIMARY KEY (template_id, department_id)
);

CREATE TABLE work_item_template_labels (
    template_id TEXT NOT NULL,
    label_id TEXT NOT NULL,
    PRIMARY KEY (template_id, label_id)
);

CREATE TABLE work_item_template_projects (
    template_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    PRIMARY KEY (template_id, project_id)
);

CREATE TABLE work_item_templates (
    id TEXT NOT NULL,
    "name" TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    "type" TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    priority TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'private',
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id)
);

CREATE TABLE work_item_tree_expansions (
    user_id TEXT NOT NULL,
    node_key TEXT NOT NULL,
    PRIMARY KEY (user_id, node_key)
);

CREATE TABLE work_items (
    id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    "key" TEXT NOT NULL,
    number BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    parent_id TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status_id TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal',
    assignee_id TEXT,
    created_by TEXT NOT NULL,
    milestone_id TEXT,
    start_at TEXT,
    due_at TEXT,
    sort_order BIGINT NOT NULL DEFAULT 0,
    completed_at TEXT,
    archived_at TEXT,
    github_issue_number BIGINT,
    github_issue_url TEXT,
    github_issue_state TEXT,
    github_issue_updated_at TEXT,
    github_content_hash TEXT,
    github_conflict INTEGER NOT NULL DEFAULT 0,
    github_last_sync_at TEXT,
    github_last_error TEXT,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    department_id TEXT,
    assignee_group_id TEXT,
    PRIMARY KEY (id),
    UNIQUE ("key"),
    CHECK ("type" IN ('initiative', 'epic', 'task', 'subtask')),
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    CHECK (github_issue_state IN ('open', 'closed')),
    CHECK (github_conflict IN (0, 1))
);

CREATE TABLE workflow_statuses (
    id TEXT NOT NULL,
    project_id TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" BIGINT NOT NULL DEFAULT 0,
    is_done INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CHECK (is_done IN (0, 1))
);

CREATE INDEX administration_activity_created_at_v085
    ON administration_activity (created_at);

CREATE INDEX agent_assets_expiry_v085
    ON agent_assets (status, expires_at);

CREATE UNIQUE INDEX agent_connections_name_lower_v085
    ON agent_connections ((lower("name")));

CREATE INDEX agent_import_runs_project_v085
    ON agent_import_runs (project_id, created_at);

CREATE INDEX agent_import_sources_target_v085
    ON agent_import_sources (target_kind, target_id);

CREATE INDEX agent_plan_cleanup_failures_owner_v085
    ON agent_plan_cleanup_failures (run_id, user_id, sequence_number);

CREATE INDEX agent_plan_recovery_execution_run_v085
    ON agent_plan_recovery_executions (run_id, result_revision);

CREATE INDEX agent_plan_repair_run_v085
    ON agent_plan_repair_attempts (run_id, result_revision);

CREATE INDEX agent_plan_start_rejections_owner_v085
    ON agent_plan_start_rejections (plan_id, user_id, sequence_number);

CREATE UNIQUE INDEX agent_plans_team_name_v085
    ON agent_plans (project_id, department_id, name_key);

CREATE INDEX agent_run_credentials_step_v085
    ON agent_run_credentials (run_id, step_id);

CREATE INDEX agent_session_attempt_run_v085
    ON agent_session_attempts (run_id, step_id);

CREATE INDEX agent_session_history_cursor_v085
    ON agent_session_history_chunks (attempt_id, last_sequence);

CREATE INDEX agent_session_message_attempt_v085
    ON agent_session_messages (attempt_id);

CREATE INDEX chat_attachment_session_v085
    ON chat_attachments (session_id);

CREATE INDEX chat_job_session_v085
    ON chat_jobs (session_id);

CREATE UNIQUE INDEX chat_message_client_id_v085
    ON chat_messages (session_id, client_message_id);

CREATE INDEX chat_message_session_v085
    ON chat_messages (session_id);

CREATE INDEX chat_selection_session_v085
    ON chat_selections (session_id);

CREATE INDEX chat_session_owner_v085
    ON chat_sessions (user_id);

CREATE INDEX chat_steer_session_v085
    ON chat_steers (session_id);

CREATE UNIQUE INDEX departments_name_normalized_v085
    ON departments ((lower("name")));

CREATE INDEX discord_connection_attempts_owner_v085
    ON discord_connection_attempts (project_id, user_id);

CREATE INDEX discord_deliveries_due_v085
    ON discord_deliveries (status, next_attempt_at);

CREATE INDEX discord_deliveries_project_v085
    ON discord_deliveries (project_id, subject_key);

CREATE UNIQUE INDEX labels_name_lower_v085
    ON labels ((lower("name")));

CREATE INDEX milestone_initiatives_initiative_id_v085
    ON milestone_initiatives (initiative_id);

CREATE INDEX project_activity_work_item_id_v085
    ON project_activity (work_item_id);

CREATE INDEX project_departments_by_department_v085
    ON project_departments (department_id, project_id);

CREATE UNIQUE INDEX remote_connections_name_lower_v085
    ON remote_connections ((lower("name")));

CREATE UNIQUE INDEX roles_name_normalized_v085
    ON roles ((lower("name")));

CREATE INDEX runner_history_recovery_pending_v085
    ON runner_history_recovery (connection_id, restored_at, "sequence");

CREATE INDEX user_group_members_by_user_v085
    ON user_group_members (user_id, group_id);

CREATE UNIQUE INDEX user_groups_name_lower_v085
    ON user_groups ((lower("name")));

CREATE UNIQUE INDEX users_username_normalized_v085
    ON users ((lower(username)));

CREATE INDEX work_items_assignee_group_idx_v085
    ON work_items (assignee_group_id);

CREATE INDEX work_items_department_idx_v085
    ON work_items (department_id, project_id);

CREATE VIEW agent_function_assignments AS
SELECT
    legacy."function",
    profiles.connection_id,
    profiles.model,
    profiles.reasoning_effort
FROM agent_legacy_function_assignments AS legacy
INNER JOIN agent_execution_profiles AS profiles
    ON profiles.id = legacy.profile_id;

INSERT INTO workflow_statuses (
    id,
    project_id,
    key,
    name,
    position,
    is_done
)
VALUES
    ('status-backlog', NULL, 'backlog', 'Backlog', 1, 0),
    ('status-todo', NULL, 'todo', 'To Do', 2, 0),
    ('status-in-progress', NULL, 'in_progress', 'In Arbeit', 3, 0),
    ('status-review', NULL, 'review', 'Review', 4, 0),
    ('status-done', NULL, 'done', 'Done', 5, 1);

INSERT INTO chat_settings (id) VALUES (1);

INSERT INTO pica_settings (id) VALUES (1);
