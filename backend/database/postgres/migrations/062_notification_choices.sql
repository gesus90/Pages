-- PAGE-421: Account choices apply to browser toasts and Pica Mobile push.
-- Defaults cover accounts with and without an existing preference row.
ALTER TABLE pica_mobile_notification_preferences
    ADD COLUMN receive_notifications BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN chats BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN pica BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN plan_interruptions BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN plan_completions BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN plan_all_statuses BOOLEAN NOT NULL DEFAULT FALSE;
