-- PAGE-36: design theme of a user, stored as its stable identifier only. NULL
-- keeps the default: the Standard design. The color mode (column theme) stays
-- separate. Whether the identifier still names an installed theme is decided
-- when it is read, because themes are directories that can be added and
-- removed while Pages runs; DuckDB also rejects a CHECK constraint on an added
-- column.
ALTER TABLE user_settings ADD COLUMN design_theme TEXT;
