CREATE TABLE runner_plan_events (
    connection_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    sequence BIGINT NOT NULL,
    event_id TEXT NOT NULL,
    event_digest TEXT NOT NULL,
    PRIMARY KEY (connection_id, session_id, sequence),
    UNIQUE (event_id)
);
