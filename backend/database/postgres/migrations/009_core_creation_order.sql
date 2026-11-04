-- Projects, their parts, accounts and sessions keep their creation order (DuckDB migration
-- 093). A fresh database has no such rows, and db:transfer copies the values.
ALTER TABLE projects ADD COLUMN creation_order BIGINT DEFAULT nextval('row_creation_order');
ALTER TABLE project_goals ADD COLUMN creation_order BIGINT DEFAULT nextval('row_creation_order');
ALTER TABLE project_events ADD COLUMN creation_order BIGINT DEFAULT nextval('row_creation_order');
ALTER TABLE users ADD COLUMN creation_order BIGINT DEFAULT nextval('row_creation_order');
ALTER TABLE user_authorization ADD COLUMN creation_order BIGINT DEFAULT nextval('row_creation_order');
ALTER TABLE sessions ADD COLUMN creation_order BIGINT DEFAULT nextval('row_creation_order');
