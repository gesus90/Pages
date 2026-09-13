-- Stores binary profile images for users who upload a custom avatar.
CREATE TABLE user_avatars (
    user_id TEXT PRIMARY KEY REFERENCES users (id),
    mime_type TEXT NOT NULL,
    filename TEXT NOT NULL,
    data BLOB NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
