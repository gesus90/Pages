-- Existing sessions keep working without device metadata; only newly
-- created logins record the visitor's user agent.
ALTER TABLE sessions ADD COLUMN user_agent TEXT;

-- New personal settings are nullable so existing rows keep the application
-- defaults until a user chooses a value explicitly.
ALTER TABLE user_settings ADD COLUMN timezone TEXT;
ALTER TABLE user_settings ADD COLUMN date_format TEXT CHECK (
    date_format IS NULL
    OR date_format IN ('DD.MM.YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD')
);
ALTER TABLE user_settings ADD COLUMN week_start TEXT CHECK (
    week_start IS NULL
    OR week_start IN ('monday', 'sunday')
);
ALTER TABLE user_settings ADD COLUMN notify_email INTEGER CHECK (
    notify_email IS NULL
    OR notify_email IN (0, 1)
);
ALTER TABLE user_settings ADD COLUMN notify_desktop INTEGER CHECK (
    notify_desktop IS NULL
    OR notify_desktop IN (0, 1)
);
ALTER TABLE user_settings ADD COLUMN notify_mentions INTEGER CHECK (
    notify_mentions IS NULL
    OR notify_mentions IN (0, 1)
);
ALTER TABLE user_settings ADD COLUMN notify_assignments INTEGER CHECK (
    notify_assignments IS NULL
    OR notify_assignments IN (0, 1)
);
ALTER TABLE user_settings ADD COLUMN notify_due_dates INTEGER CHECK (
    notify_due_dates IS NULL
    OR notify_due_dates IN (0, 1)
);
ALTER TABLE user_settings ADD COLUMN notify_weekly_summary INTEGER CHECK (
    notify_weekly_summary IS NULL
    OR notify_weekly_summary IN (0, 1)
);