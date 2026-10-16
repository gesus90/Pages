CREATE TABLE agent_function_assignments (
    function TEXT PRIMARY KEY CHECK (function IN ('text', 'skills')),
    connection_id TEXT NOT NULL,
    model TEXT NOT NULL,
    reasoning_effort TEXT
);

INSERT INTO agent_function_assignments (
    function,
    connection_id,
    model,
    reasoning_effort
)
SELECT
    'text',
    connection_id,
    model,
    reasoning_effort
FROM text_assistant_settings
WHERE connection_id IS NOT NULL
    AND model IS NOT NULL;

ALTER TABLE text_assistant_settings DROP COLUMN connection_id;
ALTER TABLE text_assistant_settings DROP COLUMN model;
ALTER TABLE text_assistant_settings DROP COLUMN reasoning_effort;
