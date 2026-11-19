-- The order in which a person arranged the cards of the Agents page, kept per
-- account so it holds after a reload and on every device. The row lists the
-- connection IDs as a JSON array, first card first; an account without a row
-- sees the default order.
CREATE TABLE agent_quota_card_orders (
    user_id TEXT NOT NULL,
    connection_ids_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id),
    CHECK (char_length(connection_ids_json) <= 60000)
);
