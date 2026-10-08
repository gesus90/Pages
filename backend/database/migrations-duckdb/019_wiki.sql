-- The wiki (A6). Pages form a tree, belong to the whole instance, to one
-- project or to their owner alone (scope), and can be tied to further
-- anchors that restrict who sees them. The old table cannot get a nullable
-- project and the new constraints in place, so it is rebuilt: the rows it
-- holds become project pages owned by their author. The defaults of scope
-- and owner_id exist for the SQLite transfer, which copies only the columns
-- the former file had and then sets the owner from the author.
CREATE TABLE wiki_pages_next (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL DEFAULT 'project' CHECK (
        scope IN ('instance', 'project', 'private')
    ),
    project_id TEXT,
    parent_id TEXT,
    position BIGINT NOT NULL DEFAULT 0,
    owner_id TEXT NOT NULL DEFAULT '',
    author_id TEXT NOT NULL,
    updated_by TEXT,
    title TEXT NOT NULL,
    icon TEXT,
    content TEXT NOT NULL DEFAULT '',
    revision BIGINT NOT NULL DEFAULT 1,
    is_template INTEGER NOT NULL DEFAULT 0 CHECK (
        is_template IN (0, 1)
    ),
    current_until TEXT,
    deleted_at TEXT,
    deleted_by TEXT,
    deleted_root_id TEXT,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now()
);

INSERT INTO wiki_pages_next (
    id,
    scope,
    project_id,
    owner_id,
    author_id,
    updated_by,
    title,
    content,
    created_at,
    updated_at
)
SELECT
    id,
    'project',
    project_id,
    author_id,
    author_id,
    author_id,
    title,
    content,
    created_at,
    updated_at
FROM wiki_pages;

DROP TABLE wiki_pages;

ALTER TABLE wiki_pages_next RENAME TO wiki_pages;

-- Further restrictions of a page: it is visible only to people who see every
-- anchor. The target is a department, a milestone or an epic.
CREATE TABLE wiki_page_anchors (
    page_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (
        kind IN ('department', 'milestone', 'epic')
    ),
    target_id TEXT NOT NULL,
    PRIMARY KEY (page_id, kind, target_id)
);

-- Earlier versions of a page. Saving within a few minutes by the same
-- author refreshes the newest version instead of adding one.
CREATE TABLE wiki_page_versions (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL,
    revision BIGINT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    author_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now()
);

-- Links a page contains, read from its text whenever it is saved. A ticket
-- is named by its key.
CREATE TABLE wiki_page_links (
    page_id TEXT NOT NULL,
    target_kind TEXT NOT NULL CHECK (
        target_kind IN ('page', 'ticket')
    ),
    target_id TEXT NOT NULL,
    PRIMARY KEY (page_id, target_kind, target_id)
);

-- Files attached to a page. The bytes live in the data directory under
-- storage_name, a name the server picked.
CREATE TABLE wiki_attachments (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (
        kind IN ('media', 'file')
    ),
    size BIGINT NOT NULL,
    checksum TEXT NOT NULL,
    storage_name TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now()
);

-- Comments below a page, replies, and comments on a quoted passage. The
-- quote with its surroundings finds the passage again after the text changed.
CREATE TABLE wiki_comments (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL,
    parent_id TEXT,
    author_id TEXT NOT NULL,
    body TEXT NOT NULL,
    quote TEXT,
    quote_prefix TEXT,
    quote_suffix TEXT,
    resolved_at TEXT,
    resolved_by TEXT,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now()
);

-- People named in a page or a comment; "For me" lists them.
CREATE TABLE wiki_mentions (
    page_id TEXT NOT NULL,
    comment_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (page_id, comment_id, user_id)
);

-- Personal wiki state of a user.
CREATE TABLE wiki_favorites (
    user_id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (user_id, page_id)
);

CREATE TABLE wiki_recent_pages (
    user_id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    visited_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (user_id, page_id)
);

CREATE TABLE wiki_expanded_pages (
    user_id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    PRIMARY KEY (user_id, page_id)
);

CREATE TABLE wiki_user_state (
    user_id TEXT PRIMARY KEY,
    feed_read_at TEXT NOT NULL DEFAULT utc_now()
);

-- Settings of the wiki as a whole; an administrator changes them in the
-- system settings. One row (id = 1) at most; defaults apply without it.
CREATE TABLE wiki_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    trash_retention_days BIGINT NOT NULL,
    version_retention_days BIGINT NOT NULL,
    version_keep_last BIGINT NOT NULL,
    media_limit_bytes BIGINT NOT NULL,
    file_limit_bytes BIGINT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT utc_now()
);
