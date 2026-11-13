-- PAGE-325: a person can collapse the list of the chat page to a narrow bar
-- of avatars. The choice is kept per account next to the split width; a
-- person who only collapsed the list has no split width yet.
ALTER TABLE chat_view_settings
    ALTER COLUMN split_width DROP NOT NULL,
    ADD COLUMN list_collapsed INTEGER NOT NULL DEFAULT 0,
    ADD CONSTRAINT chat_view_settings_list_collapsed_check
        CHECK (list_collapsed IN (0, 1));
