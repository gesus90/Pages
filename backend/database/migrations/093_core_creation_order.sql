-- Projects, their parts, accounts and sessions keep the order they were created in (see
-- migration 090). Equal names and times in a list stood in the physical order of the
-- rows. Changing a profile moved its row to the end, see `UserRepository.updateProfile`.

ALTER TABLE projects ADD COLUMN creation_order BIGINT;
UPDATE projects
SET creation_order = rowid - (SELECT MAX(rowid) + 1 FROM projects);
ALTER TABLE projects ALTER COLUMN creation_order SET DEFAULT nextval('row_creation_order');

ALTER TABLE project_goals ADD COLUMN creation_order BIGINT;
UPDATE project_goals
SET creation_order = rowid - (SELECT MAX(rowid) + 1 FROM project_goals);
ALTER TABLE project_goals ALTER COLUMN creation_order SET DEFAULT nextval('row_creation_order');

ALTER TABLE project_events ADD COLUMN creation_order BIGINT;
UPDATE project_events
SET creation_order = rowid - (SELECT MAX(rowid) + 1 FROM project_events);
ALTER TABLE project_events ALTER COLUMN creation_order SET DEFAULT nextval('row_creation_order');

ALTER TABLE users ADD COLUMN creation_order BIGINT;
UPDATE users
SET creation_order = rowid - (SELECT MAX(rowid) + 1 FROM users);
ALTER TABLE users ALTER COLUMN creation_order SET DEFAULT nextval('row_creation_order');

ALTER TABLE user_authorization ADD COLUMN creation_order BIGINT;
UPDATE user_authorization
SET creation_order = rowid - (SELECT MAX(rowid) + 1 FROM user_authorization);
ALTER TABLE user_authorization ALTER COLUMN creation_order SET DEFAULT nextval('row_creation_order');

ALTER TABLE sessions ADD COLUMN creation_order BIGINT;
UPDATE sessions
SET creation_order = rowid - (SELECT MAX(rowid) + 1 FROM sessions);
ALTER TABLE sessions ALTER COLUMN creation_order SET DEFAULT nextval('row_creation_order');
