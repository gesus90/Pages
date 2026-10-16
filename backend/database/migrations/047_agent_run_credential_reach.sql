-- PAGE-63: how far the credential of an agent plan session reaches. 'tickets'
-- keeps the earlier behaviour: the listed operations on the bound tickets only.
-- 'read' allows every reading operation and 'full' every operation the
-- executor may use, both under the normal checks of the executor's rights;
-- they serve the two permission modes of Codex CLI agents. DuckDB rejects a
-- CHECK constraint on an added column, so the repository reads every other
-- value as 'tickets'.
ALTER TABLE agent_run_credentials ADD COLUMN reach TEXT DEFAULT 'tickets';
