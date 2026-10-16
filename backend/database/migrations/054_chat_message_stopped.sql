-- Marks an answer of Pica that the person stopped before it ended (PAGE-90).
-- Its text is what the agent had written until the stop. Earlier messages
-- carry NULL, which reads as an answer that was not stopped.
ALTER TABLE chat_messages ADD COLUMN is_stopped BOOLEAN;
