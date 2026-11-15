-- PAGE-390: an administrator switches single tool groups of an agent off
-- (shell, files, web, browser, pages, chat). The column holds the disabled
-- groups as a comma-separated list; empty, the default, keeps every group
-- the access level allows, so every existing agent stays as it was.
ALTER TABLE agent_employees
    ADD COLUMN disabled_tool_groups TEXT NOT NULL DEFAULT '';
