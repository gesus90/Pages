import { expect, it } from "vitest";

import {
  ownerOperations,
  sessionOperations,
} from "@/backend/service/mcp/AgentOperationCatalog";
import { AGENT_PLAN_RECOVERY_COMMAND_OPERATIONS } from "@/definition/AgentPlanOperations";

import type { AgentRunScope } from "@/definition/McpAuthorization";

const PERSONAL_ONLY = [
  "plans.run.recovery.read",
  "plans.run.diagnostics.read",
  "plans.run.session.events.read",
  "plans.run.checkpoint.read",
  ...AGENT_PLAN_RECOVERY_COMMAND_OPERATIONS,
] as const;

it("offers the diagnostic and recovery commands to personal credentials", () => {
  for (const operation of PERSONAL_ONLY)
    expect(ownerOperations(false)).toContain(operation);
});

it.each(["tickets", "read", "full"] as const)(
  "withholds personal recovery and diagnostics from %s run credentials",
  (reach) => {
    const scope: AgentRunScope = {
      runId: "synthetic-run",
      stepId: "synthetic-step",
      reach,
      operations: [...PERSONAL_ONLY],
      tickets: [],
    };
    const offered = sessionOperations(scope, true);
    for (const operation of PERSONAL_ONLY)
      expect(offered).not.toContain(operation);
  },
);
