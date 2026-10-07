-- Highest ticket number a project has handed out, so a key such as ALPH-9 is
-- never given to a second ticket after the first one was deleted or moved to
-- another project. Existing projects start at their highest number in use;
-- allocation also compares with the tickets themselves, so the counter can
-- never fall behind them (for instance after the SQLite transfer, which
-- copies no counters). DuckDB cannot add a column with constraints, so
-- NULL is read as 0.
ALTER TABLE project_keys ADD COLUMN last_number BIGINT DEFAULT 0;

UPDATE project_keys
SET last_number = COALESCE(
    (
        SELECT MAX(work_items.number)
        FROM work_items
        WHERE work_items.project_id = project_keys.project_id
    ),
    0
);
