-- PAGE-283: Pages sets no cost limits for agents; the owner sets limits at the
-- providers. The monthly limit, the refused starts and learning runs it
-- recorded and the check of the activity kind for them are gone. The costs of
-- sessions and learning runs stay in the activity.
DELETE FROM agent_activity
WHERE kind = 'limit'
    OR detail LIKE '%"status":"limitReached"%';

UPDATE agent_employees
SET last_learning_result = NULL
WHERE last_learning_result LIKE '%"status":"limitReached"%';

ALTER TABLE agent_activity
    DROP CONSTRAINT IF EXISTS agent_activity_kind_check;

ALTER TABLE agent_activity
    ADD CONSTRAINT agent_activity_kind_check CHECK (kind IN ('learning'));

ALTER TABLE agent_employees
    DROP COLUMN IF EXISTS monthly_cost_limit;
