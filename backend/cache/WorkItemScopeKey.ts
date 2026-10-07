import { createHash } from "node:crypto";

import type { WorkItemVisibility } from "@/definition/Task";

/** Encodes the actor and current ticket scope without delimiter or empty-scope collisions. */
export function workItemScopeKey(
  actorId: string,
  visibility: WorkItemVisibility,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        actorId,
        departments:
          visibility.departmentIds === null
            ? null
            : [...new Set(visibility.departmentIds)].sort(),
        projects:
          visibility.projectIds === undefined
            ? null
            : [...new Set(visibility.projectIds)].sort(),
      }),
    )
    .digest("hex");
}
