-- Rows of chat, Discord, MCP and Pica Mobile keep the order they were created in (see
-- migration 090). It decides the latest attempt and the waiting message, what is handed
-- out first and what an account keeps, and stands in lists of tokens and steers.
ALTER TABLE personal_agent_tokens ADD COLUMN creation_order BIGINT;
UPDATE personal_agent_tokens
SET creation_order = rowid - (SELECT MAX(rowid) + 1 FROM personal_agent_tokens);
ALTER TABLE personal_agent_tokens ALTER COLUMN creation_order SET DEFAULT nextval('row_creation_order');

ALTER TABLE discord_connection_attempts ADD COLUMN creation_order BIGINT;
UPDATE discord_connection_attempts
SET creation_order = rowid - (SELECT MAX(rowid) + 1 FROM discord_connection_attempts);
ALTER TABLE discord_connection_attempts ALTER COLUMN creation_order SET DEFAULT nextval('row_creation_order');

ALTER TABLE discord_deliveries ADD COLUMN creation_order BIGINT;
UPDATE discord_deliveries
SET creation_order = rowid - (SELECT MAX(rowid) + 1 FROM discord_deliveries);
ALTER TABLE discord_deliveries ALTER COLUMN creation_order SET DEFAULT nextval('row_creation_order');

ALTER TABLE pica_mobile_notification_deliveries ADD COLUMN creation_order BIGINT;
UPDATE pica_mobile_notification_deliveries
SET creation_order = rowid - (SELECT MAX(rowid) + 1 FROM pica_mobile_notification_deliveries);
ALTER TABLE pica_mobile_notification_deliveries ALTER COLUMN creation_order SET DEFAULT nextval('row_creation_order');

ALTER TABLE pica_mobile_notification_events ADD COLUMN creation_order BIGINT;
UPDATE pica_mobile_notification_events
SET creation_order = rowid - (SELECT MAX(rowid) + 1 FROM pica_mobile_notification_events);
ALTER TABLE pica_mobile_notification_events ALTER COLUMN creation_order SET DEFAULT nextval('row_creation_order');

ALTER TABLE chat_steers ADD COLUMN creation_order BIGINT;
UPDATE chat_steers
SET creation_order = rowid - (SELECT MAX(rowid) + 1 FROM chat_steers);
ALTER TABLE chat_steers ALTER COLUMN creation_order SET DEFAULT nextval('row_creation_order');

ALTER TABLE chat_selections ADD COLUMN creation_order BIGINT;
UPDATE chat_selections
SET creation_order = rowid - (SELECT MAX(rowid) + 1 FROM chat_selections);
ALTER TABLE chat_selections ALTER COLUMN creation_order SET DEFAULT nextval('row_creation_order');

ALTER TABLE chat_attachments ADD COLUMN creation_order BIGINT;
UPDATE chat_attachments
SET creation_order = rowid - (SELECT MAX(rowid) + 1 FROM chat_attachments);
ALTER TABLE chat_attachments ALTER COLUMN creation_order SET DEFAULT nextval('row_creation_order');
