-- Each resume appends its execution basis; the original snapshot and checkpoints stay intact.
CREATE TABLE agent_plan_continuations (
    run_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    plan_revision INTEGER NOT NULL,
    adopted_at TEXT NOT NULL,
    boundary_json TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    PRIMARY KEY (run_id, version)
);
