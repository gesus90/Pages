-- PAGE-267: a removed agent keeps its users row as a tombstone, so tickets,
-- wiki pages, comments and chat messages keep its name as their author.
-- Everything else of the agent is deleted; lists of accounts skip the row.
ALTER TABLE users
    ADD COLUMN removed_at TEXT;
