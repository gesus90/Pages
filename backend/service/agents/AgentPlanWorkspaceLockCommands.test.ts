import { expect, it, vi } from "vitest";

import { emptyAgentPlan } from "@/definition/AgentPlan";
import { PLAN_RESOURCE_WRITE_TOOLS } from "@/definition/AgentTools/PlanResources";

import {
  AgentPlanWorkspaceLockCommands,
  readWorkspaceLockRelease,
} from "./AgentPlanWorkspaceLockCommands";
import { planControl } from "./AgentPlanControl";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import type { AgentPlanView } from "@/definition/AgentPlan";

const input = { operationId: "decision", planId: "plan", runId: "older-run" };

function fixture(): {
  commands: AgentPlanWorkspaceLockCommands;
  release: ReturnType<
    typeof vi.fn<
      ConstructorParameters<
        typeof AgentPlanWorkspaceLockCommands
      >[0]["plans"]["releaseWorkspaceLocks"]
    >
  >;
  setOwner: (ownerId: string) => void;
} {
  let plan: AgentPlanView = {
    ...emptyAgentPlan(),
    projectId: "project",
    revision: 1,
    id: "plan",
    ownerId: "owner",
    canEdit: true,
    projectName: "Fixture",
    github: null,
  };
  let stored: StoredAgentOperation | null = null;
  const transaction: DatabaseTransaction = {
    query: async () =>
      stored ? [[stored.fingerprint, stored.operation, stored.resultJson]] : [],
    execute: async (statement, parameters) => {
      expect(statement).toContain("INSERT INTO agent_operation_keys");
      if (
        !parameters ||
        typeof parameters.operation !== "string" ||
        typeof parameters.fingerprint !== "string" ||
        typeof parameters.result_json !== "string"
      )
        throw new Error("Invalid journal");
      stored = {
        operation: parameters.operation,
        fingerprint: parameters.fingerprint,
        resultJson: parameters.result_json,
      };
    },
  };
  const release = vi.fn<
    ConstructorParameters<
      typeof AgentPlanWorkspaceLockCommands
    >[0]["plans"]["releaseWorkspaceLocks"]
  >(async (userId, runId, options) => {
    expect(userId).toBe("owner");
    expect(runId).toBe("older-run");
    await options?.journal?.(transaction);
  });
  const commands = new AgentPlanWorkspaceLockCommands({
    database: { transaction: async (work) => work(transaction) },
    plans: {
      view: async () => plan,
      releaseWorkspaceLocks: release,
      control: async () =>
        planControl(plan, null, { userId: "owner", hasReservation: false }),
      controlRun: async () => {
        throw new Error("Must not read historical content");
      },
      run: async () => {
        throw new Error("Must not read historical content");
      },
      startRejections: async () => ({ entry: null, nextBefore: null }),
    },
  });
  return {
    commands,
    release,
    setOwner: (ownerId) => {
      plan = { ...plan, ownerId };
    },
  };
}

it("exposes a personal checked release with the complete tool schema", () => {
  const tool = PLAN_RESOURCE_WRITE_TOOLS.find(
    (entry) => entry.operation === "plans.workspace_locks.release",
  )?.tool;
  expect(tool?.name).toBe("release_plan_workspace_locks");
  expect(tool?.inputSchema.required).toEqual([
    "operationId",
    "planId",
    "runId",
  ]);
});

it("releases an exact foreign-starter reservation and replays it without another release", async () => {
  const { commands, release } = fixture();
  const result = await commands.write("owner", input);
  expect(result.releasedRunId).toBe(input.runId);
  expect(result.control?.canPlay).toBe(true);
  const call = release.mock.calls[0];
  expect(call?.[0]).toBe("owner");
  expect(call?.[1]).toBe("older-run");
  expect(call?.[2]?.planId).toBe("plan");
  expect(typeof call?.[2]?.journal).toBe("function");
  expect(await commands.write("owner", input)).toEqual(result);
  expect(release).toHaveBeenCalledTimes(1);
});

it("refuses changed arguments under the same decision identifier", async () => {
  const { commands, release } = fixture();
  await commands.write("owner", input);
  await expect(
    commands.write("owner", { ...input, runId: "different-run" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(release).toHaveBeenCalledTimes(1);
});

it("rechecks ownership before replay after ownership is transferred", async () => {
  const { commands, release, setOwner } = fixture();
  await commands.write("owner", input);
  setOwner("new-owner");
  await expect(commands.write("owner", input)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(release).toHaveBeenCalledTimes(1);
});

it("refuses a team editor before touching the reservation", async () => {
  const { commands, release } = fixture();
  await expect(commands.write("team-editor", input)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(release).not.toHaveBeenCalled();
});

it("does not journal a refusal and retries the same decision after cleanup is confirmed", async () => {
  const { commands, release } = fixture();
  release.mockRejectedValueOnce(new Error("cleanup unconfirmed"));
  await expect(commands.write("owner", input)).rejects.toThrow(
    "cleanup unconfirmed",
  );
  expect((await commands.write("owner", input)).releasedRunId).toBe(
    "older-run",
  );
  expect(release).toHaveBeenCalledTimes(2);
});

it.each([
  { ...input, runId: "" },
  { ...input, confirm: true },
  { planId: "plan", runId: "run" },
])("rejects incomplete or invented process-end assertions", (fields) => {
  expect(() => readWorkspaceLockRelease(fields)).toThrow();
});
