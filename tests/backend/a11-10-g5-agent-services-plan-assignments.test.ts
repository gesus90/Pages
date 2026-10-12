import { afterEach, describe, expect, it } from "vitest";

import {
  createExecutionPlanHarness,
  executionPlan,
  executionStep,
} from "../helpers/execution-plans";
import { useMigratedDatabase } from "../helpers/test-database";

import type { ExecutionPlanHarness } from "../helpers/execution-plans";

describe("A11.10 g5: tickets that execution plans bind to agents", () => {
  const getDatabase = useMigratedDatabase();
  let harness: ExecutionPlanHarness | undefined;
  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });

  it("lists a bound ticket for the step agent and its personal agent, and skips other bindings and empty plans", async () => {
    harness = await createExecutionPlanHarness(getDatabase());
    const current = harness;
    const planId = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.agentId, {
        globals: { topic: "Global" },
        nodes: [
          {
            ...executionStep("A", current.agentId, {
              input: { kind: "source", nodeId: "ticket" },
            }),
            personalAgentId: "personal-agent",
          },
          executionStep("B", current.agentId, {
            note: { kind: "literal", value: { type: "text", text: "Note" } },
            topic: { kind: "source", nodeId: "variable" },
          }),
          { id: "ticket", type: "task", taskId: current.task.id, x: 0, y: 0 },
          { id: "variable", type: "variable", name: "topic", x: 0, y: 40 },
        ],
      }),
    );
    await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.agentId, {
        name: "Unbound",
        nodes: [executionStep("C", current.agentId)],
      }),
    );
    const binding = {
      planId,
      planName: "Build",
      taskId: current.task.id,
      key: current.task.key,
      title: "Implement worker",
    };
    expect(await current.service.taskAssignments(current.admin)).toEqual({
      [current.agentId]: [binding],
      "personal-agent": [binding],
    });
  });
});
