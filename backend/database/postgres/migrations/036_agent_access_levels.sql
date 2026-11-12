-- PAGE-303: three access levels of an agent in its chats. 'read_only' stays
-- the stored key of "Nur Pages" and the default. The earlier full access
-- 'yolo' always ran inside the bubblewrap isolation, which is the new level
-- 'workspace' ("Arbeitsplatz"); it keeps that meaning and is never widened.
-- 'yolo' now means no isolation and is set only by an administrator.
ALTER TABLE agent_employees
    DROP CONSTRAINT IF EXISTS agent_employees_access_check;

UPDATE agent_employees
SET access = 'workspace'
WHERE access = 'yolo';

ALTER TABLE agent_employees
    ADD CONSTRAINT agent_employees_access_check
    CHECK (access IN ('read_only', 'workspace', 'yolo'));

-- Every change of the level is recorded with the person and the time.
ALTER TABLE agent_activity
    DROP CONSTRAINT IF EXISTS agent_activity_kind_check;

ALTER TABLE agent_activity
    ADD CONSTRAINT agent_activity_kind_check CHECK (kind IN ('learning', 'access'));
