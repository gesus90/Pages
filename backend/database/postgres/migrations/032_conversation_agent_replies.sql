-- PAGE-276: agents answer in conversations. A message can be a hint from Pages
-- in an agent's name why it did not answer; its text says it in German, the
-- code lets a client show it in its own language. The session in which an
-- agent answers a conversation is kept per agent and conversation; its
-- person_id then holds the conversation ID.
ALTER TABLE conversation_messages
    ADD COLUMN notice TEXT;

ALTER TABLE conversation_messages
    ADD CONSTRAINT conversation_messages_notice_check
    CHECK (notice IS NULL OR notice IN ('agent_inactive', 'agent_cost_limit', 'agent_unavailable', 'agent_failed'));

ALTER TABLE agent_conversations
    DROP CONSTRAINT agent_conversations_purpose_check;

ALTER TABLE agent_conversations
    ADD CONSTRAINT agent_conversations_purpose_check
    CHECK (purpose IN ('chat', 'learning', 'conversation'));
