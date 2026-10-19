-- Personal node templates of the plan editor. Only the owner lists and
-- inserts them. node_type stays free text so a later node type needs no
-- migration of the templates saved before; the service checks it.
CREATE TABLE agent_plan_templates (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    node_type TEXT NOT NULL,
    node_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    UNIQUE (owner_id, name_key)
);
