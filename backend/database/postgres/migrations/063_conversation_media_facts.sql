-- PAGE-384: the chat shows a video with its resolution and its length before
-- the original loads, and a sound with its length.
--
-- The browser reads these facts when it creates the preview image of a video
-- or plays a file (PAGE-298 creates previews in the browser, not on the
-- server) and stores them once per attachment; NULL until then. The length is
-- kept in milliseconds.
ALTER TABLE conversation_attachments
    ADD COLUMN media_width INTEGER,
    ADD COLUMN media_height INTEGER,
    ADD COLUMN media_duration_ms INTEGER;

-- PAGE-384: an agent generates videos and sounds with its own model; Pages
-- records each generation with its cost in the activity of the agent, like
-- the images of PAGE-382.
ALTER TABLE agent_activity
    DROP CONSTRAINT IF EXISTS agent_activity_kind_check;

ALTER TABLE agent_activity
    ADD CONSTRAINT agent_activity_kind_check CHECK (
        kind IN ('learning', 'access', 'image', 'video', 'audio')
    );
