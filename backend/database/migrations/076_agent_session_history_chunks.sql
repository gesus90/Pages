-- PAGE-161: the durable public session journal, chunked independently of its recent-event cache.
-- Old attempts keep their explicit retained-from marker. New archives have no per-run byte cap.
CREATE TABLE agent_session_history_chunks (
    attempt_id TEXT NOT NULL,
    launch_id TEXT NOT NULL,
    chunk_index BIGINT NOT NULL,
    byte_offset BIGINT NOT NULL,
    byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 4194304),
    first_sequence BIGINT NOT NULL,
    last_sequence BIGINT NOT NULL,
    sha256 TEXT NOT NULL,
    previous_sha256 TEXT,
    events_jsonl TEXT NOT NULL,
    PRIMARY KEY (attempt_id, chunk_index)
);

CREATE INDEX agent_session_history_cursor
ON agent_session_history_chunks (attempt_id, last_sequence);
