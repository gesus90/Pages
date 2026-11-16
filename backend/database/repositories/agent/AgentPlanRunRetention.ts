/** Maximum number of runs purged in one background maintenance pass. */
export const PLAN_RUN_PURGE_BATCH_SIZE = 64;

/** The purge predicate and its diagnostic reasons share the same conditions. */
export const PLAN_RUN_SETTLEMENT_RULES = [
  {
    reason: "run_status",
    condition:
      "runs.status IN ('succeeded', 'failed', 'cancelled', 'work_done_closeout_open')",
  },
  {
    reason: "acp_resource_leases",
    condition:
      "NOT EXISTS (SELECT 1 FROM acp_resource_leases WHERE run_id = runs.id)",
  },
  {
    reason: "workspace_locks",
    condition:
      "NOT EXISTS (SELECT 1 FROM agent_plan_workspace_locks WHERE run_id = runs.id)",
  },
  {
    reason: "workspace_cleanup",
    condition: `NOT EXISTS (
        SELECT 1 FROM agent_workspace_cleanup
        WHERE run_id = runs.id AND state <> 'completed'
    )`,
  },
  {
    reason: "local_session_owners",
    condition: `NOT EXISTS (
        SELECT 1 FROM agent_local_session_owners
        WHERE run_id = runs.id AND released_at IS NULL
    )`,
  },
  {
    reason: "api_cleanup",
    condition:
      "NOT EXISTS (SELECT 1 FROM plan_run_api_cleanup WHERE run_id = runs.id)",
  },
  {
    reason: "accepted_commands",
    condition: `NOT EXISTS (
        SELECT 1 FROM plan_run_commands
        WHERE run_id = runs.id AND status = 'accepted'
    )`,
  },
] as const;

/** Only terminal runs with no remaining owners or cleanup obligations may lose their rows. */
export const SETTLED_PLAN_RUN = PLAN_RUN_SETTLEMENT_RULES.map(
  (rule) => `(${rule.condition})`,
).join("\n    AND ");
