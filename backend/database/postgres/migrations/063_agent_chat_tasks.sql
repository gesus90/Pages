-- PAGE-392: scheduled tasks of chat agents. A person asks an agent in a chat
-- for a reminder or a recurring task; Pages stores it as an automation of
-- that person and binds the automation here to the chat and the agent. A
-- group binding names its conversation, a direct binding the person of the
-- direct chat with the agent. The binding goes with the chat: removing the
-- conversation or the agent from the person's list removes the binding, and
-- removing the binding removes its automation with its runs.

CREATE TABLE agent_chat_tasks (
    automation_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    requester_id TEXT NOT NULL,
    chat_kind TEXT NOT NULL,
    conversation_id TEXT,
    person_id TEXT,
    kind TEXT NOT NULL,
    request TEXT NOT NULL,
    instruction TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (automation_id),
    FOREIGN KEY (automation_id) REFERENCES automations (id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
    CHECK (chat_kind IN ('direct', 'group')),
    CHECK ((chat_kind = 'group') = (conversation_id IS NOT NULL)),
    CHECK ((chat_kind = 'direct') = (person_id IS NOT NULL)),
    CHECK (kind IN ('reminder', 'task')),
    CHECK (char_length(request) BETWEEN 1 AND 2000),
    CHECK (char_length(instruction) BETWEEN 1 AND 2000)
);

CREATE INDEX agent_chat_tasks_conversation ON agent_chat_tasks (conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX agent_chat_tasks_direct ON agent_chat_tasks (person_id, agent_id) WHERE person_id IS NOT NULL;

-- A binding that goes takes its automation along, whichever way it went.
CREATE FUNCTION agent_chat_task_removed() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM automations
    WHERE id = OLD.automation_id;
    RETURN OLD;
END;
$$;

CREATE TRIGGER agent_chat_tasks_remove_automation
AFTER DELETE ON agent_chat_tasks
FOR EACH ROW
EXECUTE FUNCTION agent_chat_task_removed();

-- Deleting the direct chat with an agent from the person's list removes its tasks.
CREATE FUNCTION agent_chat_contact_removed() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM agent_chat_tasks
    WHERE chat_kind = 'direct'
        AND person_id = OLD.owner_id
        AND agent_id = OLD.contact_id;
    RETURN OLD;
END;
$$;

CREATE TRIGGER chat_contacts_remove_agent_chat_tasks
AFTER DELETE ON chat_contacts
FOR EACH ROW
EXECUTE FUNCTION agent_chat_contact_removed();

-- How many tasks one chat may hold, set under Settings → Agents.
ALTER TABLE agent_chat_settings
    ADD COLUMN scheduled_task_limit INTEGER NOT NULL DEFAULT 20;

ALTER TABLE agent_chat_settings
    ADD CONSTRAINT agent_chat_settings_scheduled_task_limit
    CHECK (scheduled_task_limit BETWEEN 1 AND 200);
