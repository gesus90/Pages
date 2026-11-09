-- PAGE-266: agents as employees. An agent is a row of users with the account
-- kind 'agent': no usable password, no session, never an administrator. Its
-- model, access, cost limit, SOUL.md, AGENT.md and MEMORY.md live beside the
-- account; the archive holds what MEMORY.md does not keep loaded.
ALTER TABLE users
    ADD COLUMN account_kind TEXT NOT NULL DEFAULT 'person';

ALTER TABLE users
    ADD CONSTRAINT users_account_kind CHECK (account_kind IN ('person', 'agent'));

ALTER TABLE users
    ADD COLUMN job_title TEXT;

CREATE TABLE agent_employees (
    user_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    model TEXT NOT NULL,
    reasoning_effort TEXT,
    access TEXT NOT NULL DEFAULT 'read_only',
    monthly_cost_limit DOUBLE PRECISION,
    soul TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    memory TEXT NOT NULL DEFAULT '',
    is_learning_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    learning_interval_hours INTEGER NOT NULL DEFAULT 12,
    learned_through TEXT,
    last_learning_at TEXT,
    last_learning_result TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (user_id),
    CHECK (access IN ('read_only', 'yolo')),
    CHECK (monthly_cost_limit IS NULL OR monthly_cost_limit >= 0),
    CHECK (learning_interval_hours > 0)
);

-- The searchable second level of the memory; never loaded as a whole.
CREATE TABLE agent_memory_archive (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    word_count INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id)
);

CREATE INDEX agent_memory_archive_user ON agent_memory_archive (user_id, created_at);

-- A restorable state of MEMORY.md and its archive after each change.
CREATE TABLE agent_memory_versions (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    memory TEXT NOT NULL,
    archive TEXT NOT NULL,
    core_words INTEGER NOT NULL,
    archive_words INTEGER NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id),
    CHECK (reason IN ('initial', 'learning', 'edit', 'restore'))
);

CREATE INDEX agent_memory_versions_user ON agent_memory_versions (user_id, created_at);

-- Learning runs and refused starts; sessions, tickets and wiki changes are read
-- from where Pages already keeps them.
CREATE TABLE agent_activity (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    detail TEXT NOT NULL,
    cost_amount DOUBLE PRECISION,
    cost_state TEXT NOT NULL DEFAULT 'none',
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id),
    CHECK (kind IN ('learning', 'limit')),
    CHECK (cost_state IN ('known', 'unknown', 'none'))
);

CREATE INDEX agent_activity_user ON agent_activity (user_id, created_at);

-- The chat session of one person with one agent, and the agent's own learning session.
CREATE TABLE agent_conversations (
    chat_session_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    purpose TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (chat_session_id),
    UNIQUE (agent_id, person_id, purpose),
    CHECK (purpose IN ('chat', 'learning'))
);

-- The people and agents a person keeps in the participant list of the chat.
CREATE TABLE chat_contacts (
    owner_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (owner_id, contact_id),
    CHECK (owner_id <> contact_id)
);

-- An agent can never sign in or become an administrator, whatever path a
-- request takes; the services refuse it first, these triggers refuse it last.
CREATE FUNCTION refuse_agent_session() RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM users
        WHERE users.id = NEW.user_id
            AND users.account_kind = 'agent'
    ) THEN
        RAISE EXCEPTION 'An agent account cannot sign in.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sessions_refuse_agent
BEFORE INSERT ON sessions
FOR EACH ROW EXECUTE FUNCTION refuse_agent_session();

CREATE FUNCTION refuse_agent_administrator() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_admin = 1 AND EXISTS (
        SELECT 1
        FROM users
        WHERE users.id = NEW.user_id
            AND users.account_kind = 'agent'
    ) THEN
        RAISE EXCEPTION 'An agent account cannot be an administrator.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_authorization_refuse_agent_administrator
BEFORE INSERT OR UPDATE ON user_authorization
FOR EACH ROW EXECUTE FUNCTION refuse_agent_administrator();
