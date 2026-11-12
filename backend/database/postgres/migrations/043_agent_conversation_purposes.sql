-- Merge of PAGE-297 and PAGE-305: 038_agent_memory_dream and 038_automations
-- each replaced the list of purposes of agent_conversations with a list of
-- their own, so whichever runs last would drop the purpose of the other.
-- This migration sets the list that holds both: the memory session of an
-- agent (PAGE-305) and the session of an automation (PAGE-297).
ALTER TABLE agent_conversations
    DROP CONSTRAINT agent_conversations_purpose_check;

ALTER TABLE agent_conversations
    ADD CONSTRAINT agent_conversations_purpose_check
    CHECK (purpose IN ('chat', 'learning', 'conversation', 'automation', 'memory'));
