ALTER TABLE chat_messages
    ADD COLUMN agent_answer TEXT;

ALTER TABLE conversation_messages
    ADD COLUMN agent_answer TEXT;
