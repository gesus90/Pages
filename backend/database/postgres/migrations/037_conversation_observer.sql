-- PAGE-296: the observer of groups. A message of a person opens a round of
-- answers; every answer an agent gives because of it belongs to that round,
-- also when another agent or the observer handed it over. automatic_count
-- counts the answers the observer or a hand-over started, which are limited;
-- the agents the person mentioned with @ are not counted.
CREATE TABLE conversation_reply_rounds (
    origin_message_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    automatic_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (origin_message_id),
    FOREIGN KEY (origin_message_id) REFERENCES conversation_messages (id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
    CHECK (automatic_count >= 0)
);

-- Every agent answers a round once at most: the key holds it against repeated
-- events, concurrent jobs and a restart. trigger says why it answers,
-- trigger_message_id which message asked for it. state is honest: answered
-- only with a stored answer, failed or interrupted without one.
CREATE TABLE conversation_reply_targets (
    origin_message_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    trigger TEXT NOT NULL,
    trigger_message_id TEXT NOT NULL,
    requested_by TEXT,
    reason TEXT NOT NULL DEFAULT '',
    is_automatic BOOLEAN NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued',
    reply_message_id TEXT,
    notice TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (origin_message_id, agent_id),
    FOREIGN KEY (origin_message_id) REFERENCES conversation_reply_rounds (origin_message_id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
    CHECK (trigger IN ('direct', 'mention', 'context', 'handoff')),
    CHECK (state IN ('queued', 'running', 'answered', 'failed', 'interrupted')),
    CHECK (char_length(reason) <= 300)
);

CREATE INDEX conversation_reply_targets_reply ON conversation_reply_targets (reply_message_id);
CREATE INDEX conversation_reply_targets_state ON conversation_reply_targets (state);

-- At most one routing decision of the observer per message: the key holds it
-- against repeated events and a restart. selection holds the chosen agents
-- with their reasons as JSON; error_code why no agent was started.
CREATE TABLE conversation_observer_routings (
    trigger_message_id TEXT NOT NULL,
    origin_message_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'running',
    selection TEXT NOT NULL DEFAULT '[]',
    error_code TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT,
    PRIMARY KEY (trigger_message_id),
    FOREIGN KEY (origin_message_id) REFERENCES conversation_reply_rounds (origin_message_id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
    CHECK (state IN ('running', 'routed', 'silent', 'skipped', 'failed'))
);

-- One stored context per group, private to its members and removed with it.
-- through_sequence is the newest message completely processed; the summary
-- never skips an unread message. source_digest fingerprints the processed
-- messages, so a changed or vanished one invalidates the summary.
CREATE TABLE conversation_group_contexts (
    conversation_id TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    decisions TEXT NOT NULL DEFAULT '[]',
    open_items TEXT NOT NULL DEFAULT '[]',
    responsibilities TEXT NOT NULL DEFAULT '[]',
    sources TEXT NOT NULL DEFAULT '[]',
    through_sequence BIGINT NOT NULL DEFAULT 0,
    source_digest TEXT NOT NULL DEFAULT '',
    has_excerpts BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'unavailable',
    error_code TEXT,
    revision INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT,
    attempted_at TEXT,
    PRIMARY KEY (conversation_id),
    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
    CHECK (char_length(summary) <= 6000),
    CHECK (through_sequence >= 0),
    CHECK (status IN ('current', 'behind', 'unavailable', 'rebuilding'))
);

-- Every call of the observer with its outcome and the token usage its runner
-- reported, apart from the answers of the agents. No prompt and no answer is
-- kept here.
CREATE TABLE conversation_observer_runs (
    id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    trigger TEXT NOT NULL,
    person_id TEXT NOT NULL,
    connection_id TEXT,
    model TEXT,
    state TEXT NOT NULL,
    error_code TEXT,
    input_tokens BIGINT,
    output_tokens BIGINT,
    total_tokens BIGINT,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
    CHECK (kind IN ('routing', 'summary')),
    CHECK (state IN ('succeeded', 'failed', 'refused'))
);

CREATE INDEX conversation_observer_runs_conversation ON conversation_observer_runs (conversation_id, started_at);
