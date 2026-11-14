-- PAGE-382: files that agents attach in chats are kept at most 72 hours.
--
-- expires_at is set for every attachment an agent's answer brings, generated
-- images included; uploads of people keep it NULL and stay. Once the moment
-- has passed, Pages removes the file and its preview image from the file
-- store and sets expired_at; the row stays, so the chat shows the name and
-- the date of the expired file in its place. Times are ISO 8601 with
-- milliseconds, as in 048.
ALTER TABLE conversation_attachments
    ADD COLUMN expires_at TEXT,
    ADD COLUMN expired_at TEXT;

CREATE INDEX conversation_attachments_due ON conversation_attachments (expires_at)
    WHERE expires_at IS NOT NULL
        AND expired_at IS NULL;

-- PAGE-382: an agent generates images with its own model; Pages records each
-- generation with its cost in the activity of the agent, like other model
-- costs.
ALTER TABLE agent_activity
    DROP CONSTRAINT IF EXISTS agent_activity_kind_check;

ALTER TABLE agent_activity
    ADD CONSTRAINT agent_activity_kind_check CHECK (kind IN ('learning', 'access', 'image'));
