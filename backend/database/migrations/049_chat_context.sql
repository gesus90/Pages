ALTER TABLE chat_sessions ADD COLUMN context_summary TEXT;
ALTER TABLE chat_sessions ADD COLUMN context_through_id TEXT;
ALTER TABLE chat_sessions ADD COLUMN context_revision INTEGER DEFAULT 0;
