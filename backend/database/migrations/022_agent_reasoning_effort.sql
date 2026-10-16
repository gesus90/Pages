-- Agent reasoning effort (A7 §21.3): the effort chosen for a connection's model.
-- NULL keeps the provider or CLI default; checks pass a saved effort through.
ALTER TABLE agent_connections ADD COLUMN reasoning_effort TEXT;
