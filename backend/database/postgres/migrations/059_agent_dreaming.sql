-- PAGE-378: Dreaming with a schedule of its own per agent, lessons and recipes.
--
-- The schedule: every `dream_interval` hours or days. A schedule in days runs at
-- `dream_time` (HH:MM in the time zone of the server; none follows the time of
-- the instance) and, at an interval of 7 days, on `dream_weekday` (1 Monday to
-- 7 Sunday). `is_learning_enabled` stays the switch of the whole dream run.
-- `dream_on_full_logbook` lets a Lagebuch that is about 80 % full ask for a
-- run. `dream_connection_id` and `dream_model` name a model for the run (both
-- or neither; neither is the agent's own model). `dream_requested_at` is a run
-- somebody asked for (`dream_requested_trigger` manual or logbook) that waits
-- until the agent works in no chat.
-- `dream_logbook_through` and `dream_tools_through` are the newest Lagebuch
-- entry and the newest tool use a finished run has read, so the next run reads
-- what is new; `dream_last_run` is the log of the last run as JSON.
ALTER TABLE agent_employees
    ADD COLUMN dream_interval INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN dream_unit TEXT NOT NULL DEFAULT 'days',
    ADD COLUMN dream_time TEXT,
    ADD COLUMN dream_weekday INTEGER,
    ADD COLUMN dream_on_full_logbook BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN dream_connection_id TEXT,
    ADD COLUMN dream_model TEXT,
    ADD COLUMN dream_requested_at TEXT,
    ADD COLUMN dream_requested_trigger TEXT,
    ADD COLUMN dream_logbook_through BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN dream_tools_through BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN dream_last_run TEXT,
    ADD CONSTRAINT agent_employees_dream_unit_check
        CHECK (dream_unit IN ('hours', 'days')),
    ADD CONSTRAINT agent_employees_dream_interval_check
        CHECK (
            (dream_unit = 'hours' AND dream_interval BETWEEN 1 AND 720)
            OR (dream_unit = 'days' AND dream_interval BETWEEN 1 AND 30)
        ),
    ADD CONSTRAINT agent_employees_dream_time_check
        CHECK (dream_time IS NULL OR dream_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    ADD CONSTRAINT agent_employees_dream_weekday_check
        CHECK (dream_weekday IS NULL OR dream_weekday BETWEEN 1 AND 7),
    ADD CONSTRAINT agent_employees_dream_requested_check
        CHECK (
            (dream_requested_at IS NULL) = (dream_requested_trigger IS NULL)
            AND (dream_requested_trigger IS NULL OR dream_requested_trigger IN ('manual', 'logbook'))
        ),
    ADD CONSTRAINT agent_employees_dream_model_check
        CHECK ((dream_connection_id IS NULL) = (dream_model IS NULL));

-- The tool calls of the chat sessions of an agent: the tool, its input and the
-- start of its result (bounded, credentials masked) and whether it worked. The dream run reads them to find
-- paths and values the agent looks up again and again, failures and costly
-- patterns. A confidential chat writes nothing here.
CREATE TABLE agent_tool_uses (
    id BIGINT GENERATED ALWAYS AS IDENTITY,
    agent_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    input TEXT NOT NULL,
    output TEXT NOT NULL DEFAULT '',
    is_ok BOOLEAN NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id)
);

CREATE INDEX agent_tool_uses_agent ON agent_tool_uses (agent_id, id);

-- The recipes of an agent. A flow recipe (`steps`) is a fixed chain of tool
-- calls the tool `rezept(name, parameter)` runs in one call; a knowledge recipe
-- (`body`) is a short guide that is loaded only when it fits the topic of the
-- chat. `parameters`, `keywords` and `steps` are JSON. A recipe carries its
-- evidence, the date and strength of its newest confirmation and how often it
-- was used. Two failed calls in a row (`failure_streak`) switch it off
-- (`disabled_reason` failed); the next dream run corrects or drops it.
CREATE TABLE agent_recipes (
    id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT '[]',
    parameters TEXT NOT NULL DEFAULT '[]',
    steps TEXT NOT NULL DEFAULT '[]',
    body TEXT NOT NULL DEFAULT '',
    evidence TEXT NOT NULL DEFAULT '',
    confirmed_on TEXT NOT NULL,
    strength INTEGER NOT NULL DEFAULT 1,
    use_count INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    disabled_reason TEXT,
    failure_streak INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    origin TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id),
    UNIQUE (agent_id, name),
    CHECK (kind IN ('flow', 'knowledge')),
    CHECK (origin IN ('dream', 'manual')),
    CHECK (disabled_reason IS NULL OR disabled_reason IN ('failed', 'manual')),
    CHECK (is_active = (disabled_reason IS NULL))
);

CREATE INDEX agent_recipes_agent ON agent_recipes (agent_id);
