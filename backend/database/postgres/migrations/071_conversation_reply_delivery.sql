-- How a message of a person reaches each asked agent, kept apart from who was
-- chosen. delivery_intent is chosen when the answer is claimed: 'task' for a
-- new task, 'steer' to go into the agent's running answer, 'after' behind it.
-- delivery is what the server confirmed: 'injected' once the running answer
-- took the message, 'started' once a new task was accepted, 'queued' while it
-- waits for the agent's running answer or a free place, 'failed' when neither
-- took it. Both stay NULL for answers whose delivery is not tracked, such as
-- hand-overs between agents.
ALTER TABLE conversation_reply_targets
    ADD COLUMN delivery_intent TEXT
        CHECK (delivery_intent IN ('task', 'steer', 'after')),
    ADD COLUMN delivery TEXT
        CHECK (delivery IN ('injected', 'started', 'queued', 'failed'));
