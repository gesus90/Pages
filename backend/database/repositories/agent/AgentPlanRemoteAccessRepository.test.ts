import { beforeEach, expect, it, vi } from "vitest";

import { AgentPlanRemoteAccessRepository } from "./AgentPlanRemoteAccessRepository";

import type { DatabaseTransaction } from "@/backend/database/Database";

vi.mock("@/backend/agents/AgentPlanRunInput", () => ({
  readPlanRun: (value: unknown) => value,
}));

const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
const query = vi.fn<DatabaseTransaction["query"]>();

function repository(): AgentPlanRemoteAccessRepository {
  return new AgentPlanRemoteAccessRepository({
    transaction: async (work) => work({ execute, query }),
  });
}

beforeEach(() => {
  execute.mockClear();
  query.mockReset();
});

it("updates only the step with the matching attempt", async () => {
  const view = {
    steps: [
      { id: "a", execution: { attemptId: "t1" }, resourceAccess: "old" },
      { id: "b", execution: { attemptId: "t2" } },
      { id: "c" },
    ],
  };
  query.mockResolvedValueOnce([[JSON.stringify(view)]]);
  const update = vi.fn((previous: unknown) => `${String(previous)}+`);

  await repository().write("r1", "t1", update as never);

  expect(update).toHaveBeenCalledTimes(1);
  const written = JSON.parse(
    String(execute.mock.calls[0]?.[1]?.view_json),
  ) as typeof view;
  expect(written.steps[0]).toMatchObject({ resourceAccess: "old+" });
  expect(written.steps[1]).toEqual(view.steps[1]);
  expect(written.steps[2]).toEqual(view.steps[2]);
  expect(execute.mock.calls[0]?.[1]?.id).toBe("r1");
});

it("fails when the run does not exist", async () => {
  query.mockResolvedValueOnce([]);

  await expect(repository().write("r1", "t1", vi.fn())).rejects.toThrow(
    "Remote run missing",
  );
  expect(execute).not.toHaveBeenCalled();
});
