-- PAGE-29: color theme of a user ('light', 'dark' or 'system'). NULL keeps the
-- default: the interface follows the operating system preference. DuckDB
-- rejects a CHECK constraint on an added column, so the service validates
-- the stored value, as it does for the time zone and the date format.
ALTER TABLE user_settings ADD COLUMN theme TEXT;
