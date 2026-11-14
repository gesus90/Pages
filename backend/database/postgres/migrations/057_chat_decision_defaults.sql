-- PAGE-326: new group settings use the instance decision model. Existing
-- explicit choices remain intact; automatic decisions select at most one agent.
ALTER TABLE conversation_reply_settings
    ALTER COLUMN mode SET DEFAULT 'decision',
    ALTER COLUMN max_responders SET DEFAULT 1;
