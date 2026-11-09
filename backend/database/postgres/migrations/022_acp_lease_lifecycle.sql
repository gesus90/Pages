-- PAGE-264: lifecycle evidence and the last periodic check of a reservation.
-- lifecycle stays NULL for leases from before this migration: they carry no
-- evidence, and none is invented for them. check_reason and checked_at keep
-- the result of the last model-free check of an unconfirmed reservation.
ALTER TABLE acp_resource_leases
    ADD COLUMN lifecycle TEXT,
    ADD COLUMN check_reason TEXT,
    ADD COLUMN checked_at TEXT,
    ADD CONSTRAINT acp_resource_leases_lifecycle_check
        CHECK (lifecycle IN ('reserved', 'spawning', 'not_spawned', 'process'));
