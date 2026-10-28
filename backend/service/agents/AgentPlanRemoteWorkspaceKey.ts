import { createHash } from "node:crypto";

import type { AgentPlanRemoteTarget } from "@/definition/AgentPlanExecution";

/** Stable reservation keys for the registered canonical path and its known host bindings. */
export function remoteWorkspaceKeys(
  target: AgentPlanRemoteTarget,
): readonly string[] {
  const identities = [`connection:${target.connectionId}`];
  if (target.hostIdentity) identities.push(`host:${target.hostIdentity}`);
  return identities.map((identity) => {
    const digest = createHash("sha256")
      .update(JSON.stringify([identity, target.path]))
      .digest("hex");
    return `remote-workspace:${digest}`;
  });
}
