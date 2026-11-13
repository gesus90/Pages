-- PAGE-335: the worker unit an ACP process starts in, recorded before the
-- spawn. A process that ends before its identity is recorded leaves only
-- this name behind; once no unit of the lease runs any more, no process of
-- it can remain and the reservation is released. NULL for a start without a
-- unit and for leases from before this migration.
ALTER TABLE acp_resource_leases
    ADD COLUMN worker_unit TEXT;
