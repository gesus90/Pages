-- Rows of chat, Discord, MCP and Pica Mobile keep their creation order (DuckDB migration
-- 092). A fresh database has no such rows, and db:transfer copies the values.
ALTER TABLE personal_agent_tokens ADD COLUMN creation_order BIGINT DEFAULT nextval('row_creation_order');
ALTER TABLE discord_connection_attempts ADD COLUMN creation_order BIGINT DEFAULT nextval('row_creation_order');
ALTER TABLE discord_deliveries ADD COLUMN creation_order BIGINT DEFAULT nextval('row_creation_order');
ALTER TABLE pica_mobile_notification_deliveries ADD COLUMN creation_order BIGINT DEFAULT nextval('row_creation_order');
ALTER TABLE pica_mobile_notification_events ADD COLUMN creation_order BIGINT DEFAULT nextval('row_creation_order');
ALTER TABLE chat_steers ADD COLUMN creation_order BIGINT DEFAULT nextval('row_creation_order');
ALTER TABLE chat_selections ADD COLUMN creation_order BIGINT DEFAULT nextval('row_creation_order');
ALTER TABLE chat_attachments ADD COLUMN creation_order BIGINT DEFAULT nextval('row_creation_order');
