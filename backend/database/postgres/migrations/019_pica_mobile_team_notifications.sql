-- PAGE-263: Pica Mobile also notifies the members of a plan's team about runs
-- other people start, when they ask for it. The choice belongs to the account,
-- not to a device, so it survives a new registration, a new session and a
-- restart. Without a row the choice is off. `team_runs_since` is the moment the
-- choice was last switched on; nothing that happened before it is announced.
CREATE TABLE pica_mobile_notification_preferences (
    account_id TEXT NOT NULL,
    team_runs BOOLEAN NOT NULL DEFAULT FALSE,
    team_runs_since TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (account_id)
);

-- A fact of a run is now announced once per recipient account instead of once
-- per run. Every record so far belonged to the account of its event, and the
-- starter of the run was the only recipient before.
ALTER TABLE pica_mobile_notification_occurrences ADD COLUMN account_id TEXT;

UPDATE pica_mobile_notification_occurrences AS occurrences
SET account_id = events.account_id
FROM pica_mobile_notification_events AS events
WHERE events.event_id = occurrences.event_id;

UPDATE pica_mobile_notification_occurrences AS occurrences
SET account_id = runs.user_id
FROM agent_plan_runs AS runs
WHERE occurrences.account_id IS NULL
    AND runs.id = occurrences.run_id;

-- A record without its event and without its run can never match a new fact.
DELETE FROM pica_mobile_notification_occurrences
WHERE account_id IS NULL;

ALTER TABLE pica_mobile_notification_occurrences ALTER COLUMN account_id SET NOT NULL;

ALTER TABLE pica_mobile_notification_occurrences
    DROP CONSTRAINT pica_mobile_notification_occurrences_pkey;

ALTER TABLE pica_mobile_notification_occurrences
    ADD PRIMARY KEY (run_id, account_id, occurrence_key);
