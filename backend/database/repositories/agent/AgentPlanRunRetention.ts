/** Maximum number of runs purged in one background maintenance pass. */
export const PLAN_RUN_PURGE_BATCH_SIZE = 64;

/**
 * SQL predicate over `runs`: only known terminal states with no remaining owners
 * or cleanup obligations may lose their rows or session directories.
 */
export const SETTLED_PLAN_RUN = `
    runs.status IN ('succeeded', 'failed', 'cancelled', 'work_done_closeout_open')
    AND NOT EXISTS (
        SELECT 1 FROM acp_resource_leases WHERE run_id = runs.id
    )
    AND NOT EXISTS (
        SELECT 1 FROM agent_plan_workspace_locks WHERE run_id = runs.id
    )
    AND NOT EXISTS (
        SELECT 1
        FROM agent_workspace_cleanup
        WHERE run_id = runs.id
            AND state <> 'completed'
    )
    AND NOT EXISTS (
        SELECT 1
        FROM agent_local_session_owners
        WHERE run_id = runs.id
            AND released_at IS NULL
    )
    AND NOT EXISTS (
        SELECT 1 FROM plan_run_api_cleanup WHERE run_id = runs.id
    )
    AND NOT EXISTS (
        SELECT 1
        FROM plan_run_commands
        WHERE run_id = runs.id
            AND status = 'accepted'
    )
`;
