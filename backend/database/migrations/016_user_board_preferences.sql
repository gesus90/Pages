-- What a user last chose on the task board (filters, view, sort order, grouping),
-- stored as normalized JSON text so new filters need no new column.
CREATE TABLE user_board_preferences (
    user_id TEXT PRIMARY KEY,
    preferences TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT utc_now()
);
