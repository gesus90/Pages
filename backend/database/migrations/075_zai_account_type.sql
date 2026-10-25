-- Existing z.ai keys retain the standard API until an administrator explicitly
-- chooses the Coding Plan. No credential, selection, plan or history is rewritten.
ALTER TABLE agent_connections
ADD COLUMN zai_account_type TEXT DEFAULT 'api';
