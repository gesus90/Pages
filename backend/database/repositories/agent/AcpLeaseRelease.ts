import { logEvent } from "@/backend/logging/Logger";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AcpLeaseRelease } from "@/backend/service/agents/resources/AcpResourceStore";

interface LeaseReleaseOptions {
  readonly instanceId: string;
  readonly isUncertain: boolean;
  readonly runId?: string;
  readonly reason: string;
}

/** Removes a proven lease in the caller's transaction and logs only its committed release. */
export async function releaseAcpLease(
  transaction: DatabaseTransaction,
  options: LeaseReleaseOptions,
): Promise<AcpLeaseRelease> {
  const deleted = await transaction.query(
    `
    DELETE FROM acp_resource_leases
    WHERE instance_id = $instance_id
        AND ($is_uncertain = FALSE OR state = 'cleanup_failed')
        AND ($run_id::TEXT IS NULL OR run_id = $run_id)
    RETURNING run_id;
  `,
    {
      instance_id: options.instanceId,
      is_uncertain: options.isUncertain,
      run_id: options.runId ?? null,
    },
  );
  if (deleted.length > 0) {
    transaction.onCommit?.(() => {
      logEvent({
        level: "info",
        event: "agent.acp_lease.released",
        component: "AcpResourceRepository",
        message: "Committed an ACP reservation release",
        metadata: {
          runId: deleted[0]?.[0] ?? null,
          lock: options.instanceId,
          reason: options.reason,
        },
      });
      return Promise.resolve();
    });
    return "released";
  }
  const [remaining] = await transaction.query(
    "SELECT instance_id FROM acp_resource_leases WHERE instance_id = $instance_id;",
    { instance_id: options.instanceId },
  );
  return remaining ? "changed" : "absent";
}
