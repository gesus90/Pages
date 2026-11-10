-- PAGE-283: templates for AGENT.md, kept for the whole instance. A template
-- fills the field of a new or edited agent once; changing a template changes
-- no agent. name_key is the name in lower case, so a name is unique without
-- regard to case.
CREATE TABLE agent_instruction_templates (
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id),
    UNIQUE (name_key)
);

-- The defaults Coder, Designer and Manager are stored once, in the language of
-- the first person who reads the templates. The mark keeps a removed default
-- from coming back.
CREATE TABLE agent_instruction_template_seeding (
    id INTEGER NOT NULL,
    is_seeded BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (id),
    CHECK (id = 1)
);

INSERT INTO agent_instruction_template_seeding (
    id,
    is_seeded
)
VALUES (
    1,
    FALSE
);
