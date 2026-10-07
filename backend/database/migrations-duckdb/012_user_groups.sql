-- Groups are a people concept of their own: managed with the users, assignable
-- to tickets. A ticket has either an assignee or an assignee group, never both.
-- Members are plain user ids; deactivating a user removes the membership, so a
-- group may end up empty and then cannot be assigned any more.
CREATE TABLE user_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE UNIQUE INDEX user_groups_name_lower ON user_groups (lower(name));

CREATE TABLE user_group_members (
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX user_group_members_by_user
    ON user_group_members (user_id, group_id);

ALTER TABLE work_items ADD COLUMN assignee_group_id TEXT;

CREATE INDEX work_items_assignee_group_idx
    ON work_items (assignee_group_id);
