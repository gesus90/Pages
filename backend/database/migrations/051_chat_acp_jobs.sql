-- Pica over Codex ACP (PAGE-68). Text is stored only where the conversation already
-- holds it; no row carries a credential, token or server path.

-- The agent session that continues a conversation, bound to its owner.
CREATE TABLE chat_acp_sessions (
    chat_session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    model TEXT NOT NULL,
    reasoning_effort TEXT,
    profile TEXT NOT NULL,
    acp_session_id TEXT NOT NULL,
    -- The last message the agent session saw; a later message from elsewhere ends continuation.
    through_message_id TEXT,
    updated_at TEXT NOT NULL DEFAULT utc_now()
);

-- A server-side answer that runs on without the browser.
CREATE TABLE chat_jobs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (
        state IN ('running', 'completed', 'failed', 'stopped', 'interrupted')
    ),
    error_code TEXT,
    -- Latest context occupancy and cost as the adapter reported them; NULL means not reported.
    context_used BIGINT,
    context_size BIGINT,
    cost_amount DOUBLE,
    cost_currency TEXT,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    ended_at TEXT
);

CREATE INDEX chat_job_session ON chat_jobs (session_id);

-- Tokens per turn, written once per turn so a repeated report is not counted twice.
CREATE TABLE chat_job_turns (
    job_id TEXT NOT NULL,
    turn INTEGER NOT NULL,
    input_tokens BIGINT,
    output_tokens BIGINT,
    total_tokens BIGINT,
    PRIMARY KEY (job_id, turn)
);

-- The journal a returning browser reads after its cursor.
CREATE TABLE chat_job_events (
    job_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (job_id, sequence)
);

-- Messages sent while a job answered.
CREATE TABLE chat_steers (
    message_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN ('pending', 'delivered', 'accepted', 'followUp', 'failed')
    ),
    updated_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE INDEX chat_steer_session ON chat_steers (session_id);

-- The immutable snapshot of the attachments selected for one message and how each reached the agent.
CREATE TABLE chat_selections (
    message_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    items TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE INDEX chat_selection_session ON chat_selections (session_id);
