-- PAGE-146: how the remote console offers its screen to assistive technology
-- ('auto', 'on' or 'off'). NULL keeps the default 'auto': the accessible copy
-- is on when the console was opened without a pointer. DuckDB rejects a CHECK
-- constraint on an added column, so the service validates the stored value.
ALTER TABLE user_settings ADD COLUMN terminal_screen_reader TEXT;
