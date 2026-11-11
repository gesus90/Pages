-- PAGE-297: automations. An automation wakes an agent, runs a script or
-- starts a plan at a time, in an interval, on an event or by hand, always
-- with the rights of its creator. trigger_json and action_json hold the
-- validated definitions; trigger_type, event_type and action_type repeat
-- their kinds for the scheduler's indexes. next_run_at is the next due time
-- of a time trigger, kept apart from the revision because the scheduler
-- moves it without changing the automation. Times are ISO 8601 in UTC.
CREATE TABLE automations (
    id TEXT NOT NULL,
    creator_id TEXT NOT NULL,
    name TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    event_type TEXT,
    trigger_json TEXT NOT NULL,
    action_type TEXT NOT NULL,
    action_json TEXT NOT NULL,
    sharing_scope TEXT NOT NULL DEFAULT 'private',
    sharing_target_id TEXT,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    delete_after_success BOOLEAN NOT NULL DEFAULT FALSE,
    notification_mode TEXT NOT NULL DEFAULT 'off',
    notification_agent_id TEXT,
    next_run_at TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (id),
    CHECK (char_length(name) BETWEEN 1 AND 200),
    CHECK (trigger_type IN ('manual', 'once', 'interval', 'weekly', 'event')),
    CHECK ((trigger_type = 'event') = (event_type IS NOT NULL)),
    CHECK (action_type IN ('agent', 'script', 'plan')),
    CHECK (sharing_scope IN ('private', 'project', 'group')),
    CHECK ((sharing_scope = 'private') = (sharing_target_id IS NULL)),
    CHECK (notification_mode IN ('off', 'error', 'always')),
    CHECK (notification_mode = 'off' OR notification_agent_id IS NOT NULL),
    CHECK (NOT delete_after_success OR trigger_type = 'once'),
    CHECK (revision >= 1)
);

CREATE INDEX automations_due ON automations (next_run_at) WHERE is_active AND next_run_at IS NOT NULL;
CREATE INDEX automations_events ON automations (event_type) WHERE is_active AND event_type IS NOT NULL;
CREATE INDEX automations_creator ON automations (creator_id);

-- One row per run. Two partial unique indexes hold the rule of the ticket in
-- the database: at most one run of an automation runs (accepted or
-- delivered) and at most one more waits (queued); further triggers join the
-- waiting one. A run carries its result only once it ended. answer keeps the
-- first 4 KiB of the agent's final answer, output the last 64 KiB of a
-- script's output.
CREATE TABLE automation_runs (
    id TEXT NOT NULL,
    sequence BIGINT GENERATED ALWAYS AS IDENTITY,
    automation_id TEXT NOT NULL,
    trigger_kind TEXT NOT NULL,
    event_type TEXT,
    trigger_subject TEXT,
    trigger_data TEXT,
    requested_by TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    outcome TEXT,
    exit_code INTEGER,
    forward_state TEXT,
    started_plan_run_id TEXT,
    plan_run_status TEXT,
    paused BOOLEAN NOT NULL DEFAULT FALSE,
    error_code TEXT,
    summary TEXT,
    answer TEXT,
    output TEXT,
    error TEXT,
    queued_at TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT,
    PRIMARY KEY (id),
    FOREIGN KEY (automation_id) REFERENCES automations (id) ON DELETE CASCADE,
    CHECK (trigger_kind IN ('manual', 'once', 'interval', 'weekly', 'event')),
    CHECK (status IN ('queued', 'accepted', 'delivered', 'completed', 'failed')),
    CHECK (outcome IN ('ok', 'failed', 'forbidden', 'skipped')),
    CHECK ((status IN ('completed', 'failed')) = (outcome IS NOT NULL)),
    CHECK (forward_state IN ('woken', 'not_woken')),
    CHECK (summary IS NULL OR char_length(summary) <= 200),
    CHECK (answer IS NULL OR octet_length(answer) <= 4096),
    CHECK (output IS NULL OR octet_length(output) <= 65536),
    CHECK (error IS NULL OR char_length(error) <= 2000)
);

CREATE UNIQUE INDEX automation_runs_one_active ON automation_runs (automation_id) WHERE status IN ('accepted', 'delivered');
CREATE UNIQUE INDEX automation_runs_one_waiting ON automation_runs (automation_id) WHERE status = 'queued';
CREATE INDEX automation_runs_history ON automation_runs (automation_id, sequence);
CREATE INDEX automation_runs_started_plan_run ON automation_runs (started_plan_run_id) WHERE started_plan_run_id IS NOT NULL;

-- The queue of every agent: the deliveries of runs to agents in the order
-- they arrived. kind says why the agent is woken: as the action, as the
-- forward of a script or as the notification of a result. One delivery per
-- run, agent and kind. A delivery outlives its run and its automation, so a
-- notification about a run that deleted its automation still arrives;
-- creator_id names whose rights it is checked against again.
CREATE TABLE automation_agent_jobs (
    id TEXT NOT NULL,
    sequence BIGINT GENERATED ALWAYS AS IDENTITY,
    automation_run_id TEXT,
    automation_id TEXT,
    agent_id TEXT NOT NULL,
    creator_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    prompt TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued',
    answer TEXT,
    error_code TEXT,
    session_id TEXT,
    queued_at TEXT NOT NULL,
    delivered_at TEXT,
    completed_at TEXT,
    PRIMARY KEY (id),
    UNIQUE (automation_run_id, agent_id, kind),
    FOREIGN KEY (automation_run_id) REFERENCES automation_runs (id) ON DELETE SET NULL,
    FOREIGN KEY (automation_id) REFERENCES automations (id) ON DELETE SET NULL,
    CHECK (kind IN ('action', 'forward', 'notification')),
    CHECK (state IN ('queued', 'delivered', 'completed', 'failed')),
    CHECK (answer IS NULL OR octet_length(answer) <= 4096)
);

CREATE INDEX automation_agent_jobs_queue ON automation_agent_jobs (agent_id, sequence) WHERE state IN ('queued', 'delivered');
CREATE INDEX automation_agent_jobs_run ON automation_agent_jobs (automation_run_id);

-- Events of plans and tickets, written where the change commits and read by
-- the scheduler in the order they happened. A processed event is removed.
CREATE TABLE automation_events (
    sequence BIGINT GENERATED ALWAYS AS IDENTITY,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    actor_id TEXT,
    occurred_at TEXT NOT NULL,
    PRIMARY KEY (sequence),
    CHECK (event_type IN ('plan.started', 'plan.succeeded', 'plan.failed', 'plan.step_changed', 'ticket.created', 'ticket.status_changed'))
);

-- Every way a ticket is created or moved (interface, agent tools, Pica, the
-- GitHub sync) writes the same row; the trigger records the event in the
-- transaction of that write, and only while an active automation waits for it.
CREATE FUNCTION record_automation_ticket_event() RETURNS TRIGGER AS $$
DECLARE
    kind TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        kind := 'ticket.created';
    ELSIF NEW.status_id IS DISTINCT FROM OLD.status_id THEN
        kind := 'ticket.status_changed';
    ELSE
        RETURN NULL;
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM automations
        WHERE automations.is_active
            AND automations.event_type = kind
    ) THEN
        RETURN NULL;
    END IF;
    INSERT INTO automation_events (
        event_type,
        payload,
        actor_id,
        occurred_at
    )
    VALUES (
        kind,
        json_build_object(
            'ticketId', NEW.id,
            'ticketKey', NEW."key",
            'title', NEW.title,
            'projectId', NEW.project_id,
            'statusId', NEW.status_id,
            'previousStatusId', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status_id END
        )::TEXT,
        CASE WHEN TG_OP = 'INSERT' THEN NEW.created_by END,
        to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER work_items_automation_events
AFTER INSERT OR UPDATE OF status_id ON work_items
FOR EACH ROW EXECUTE FUNCTION record_automation_ticket_event();

-- An agent's own session per automation, apart from its chats.
ALTER TABLE agent_conversations
    DROP CONSTRAINT agent_conversations_purpose_check;

ALTER TABLE agent_conversations
    ADD CONSTRAINT agent_conversations_purpose_check
    CHECK (purpose IN ('chat', 'learning', 'conversation', 'automation'));

-- When a person hears about the runs of the automations they created:
-- off, on errors (the default without a row) or always.
CREATE TABLE automation_notification_preferences (
    user_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id),
    CHECK (mode IN ('off', 'error', 'always'))
);
