-- PAGE-259: participants and groups of the chat page, each owned by exactly one
-- account. A participant is a row of chat_contacts (PAGE-266) and refers to a
-- person or an agent of users; the last activity orders both lists, newest
-- first. Times are ISO 8601 with milliseconds, so entries added in one save
-- keep their order.
ALTER TABLE chat_contacts
    ADD COLUMN last_activity_at TEXT;

UPDATE chat_contacts
SET last_activity_at = replace(created_at, ' ', 'T') || '.000Z';

ALTER TABLE chat_contacts
    ALTER COLUMN last_activity_at SET NOT NULL;

CREATE INDEX chat_contacts_owner_activity ON chat_contacts (owner_id, last_activity_at);

CREATE TABLE chat_groups (
    id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT utc_now(),
    last_activity_at TEXT NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (owner_id, id),
    CHECK (char_length(name) BETWEEN 1 AND 80),
    CHECK (char_length(description) <= 500)
);

CREATE INDEX chat_groups_owner_activity ON chat_groups (owner_id, last_activity_at);

-- A member is always a participant of the group owner's own list; removing the
-- participant from that list removes it from the owner's groups as well.
CREATE TABLE chat_group_members (
    group_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    added_at TEXT NOT NULL,
    PRIMARY KEY (group_id, contact_id),
    FOREIGN KEY (owner_id, group_id)
        REFERENCES chat_groups (owner_id, id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id, contact_id)
        REFERENCES chat_contacts (owner_id, contact_id) ON DELETE CASCADE
);
