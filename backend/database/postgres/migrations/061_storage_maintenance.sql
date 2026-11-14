-- PAGE-418: retain maintenance cadence across restarts and service processes.
CREATE TABLE pages_storage_maintenance (
    task TEXT PRIMARY KEY,
    last_run_ms BIGINT NOT NULL CHECK (last_run_ms >= 0)
);

ALTER TABLE pages_event_outbox ADD COLUMN storage_usage TEXT;

ALTER TABLE automation_events DROP CONSTRAINT automation_events_event_type_check;
ALTER TABLE automation_events ADD CONSTRAINT automation_events_event_type_check
    CHECK (event_type IN (
        'plan.started',
        'plan.succeeded',
        'plan.failed',
        'plan.step_changed',
        'ticket.created',
        'ticket.status_changed',
        'storage.limit_exceeded'
    ));

-- The new event segment contains an underscore; existing event names remain valid.
ALTER TABLE pages_event_outbox DROP CONSTRAINT pages_event_outbox_kind_check;
ALTER TABLE pages_event_outbox ADD CONSTRAINT pages_event_outbox_kind_check
    CHECK (kind ~ '^[a-z]+(\.[a-z_]+)+$');
