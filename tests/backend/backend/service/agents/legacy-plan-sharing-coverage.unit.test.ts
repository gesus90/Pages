import { expect, it, vi } from "vitest";

import { shareLegacyPlans } from "@/backend/service/agents/AgentPlanLegacyShare";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AuthorizationSnapshot } from "@/backend/database/repositories/AuthorizationRepository";
import type { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";

it("shares only a sole current department and leaves ambiguous plans private", async () => {
  const listLegacyShareCandidates = vi
    .fn<AgentPlanRepository["listLegacyShareCandidates"]>()
    .mockResolvedValue([
      { id: "one", ownerId: "single" },
      { id: "two", ownerId: "multiple" },
      { id: "three", ownerId: "none" },
      { id: "four", ownerId: "single" },
      { id: "five", ownerId: "inactive" },
    ]);
  const shareLegacyPlan = vi
    .fn<AgentPlanRepository["shareLegacyPlan"]>()
    .mockResolvedValueOnce("shared")
    .mockResolvedValueOnce("collision");
  const releaseLegacyShare = vi
    .fn<AgentPlanRepository["releaseLegacyShare"]>()
    .mockResolvedValue(undefined);
  const snapshot = vi.fn(async () =>
    partial<AuthorizationSnapshot>({
      accounts: [
        {
          userId: "single",
          isActive: true,
          departments: ["team"],
          managedDepartments: ["team"],
        },
        {
          userId: "multiple",
          isActive: true,
          departments: ["one"],
          managedDepartments: ["two"],
        },
        {
          userId: "inactive",
          isActive: false,
          departments: ["team"],
          managedDepartments: [],
        },
      ],
    }),
  );
  const counts = await shareLegacyPlans({
    plans: { listLegacyShareCandidates, shareLegacyPlan, releaseLegacyShare },
    authorization: { snapshot },
  });
  expect(counts).toEqual({
    candidates: 5,
    shared: 1,
    deferred: 2,
    multiple: 1,
    collided: 1,
  });
  expect(releaseLegacyShare).toHaveBeenCalledWith("two");
  expect(shareLegacyPlan.mock.calls).toEqual([
    ["one", "team"],
    ["four", "team"],
  ]);
});

it("keeps startup running when plan storage is unavailable", async () => {
  const snapshot = vi.fn();
  const result = await shareLegacyPlans({
    plans: partial({
      listLegacyShareCandidates: vi
        .fn()
        .mockRejectedValue(new Error("offline")),
    }),
    authorization: { snapshot },
  });
  expect(result).toEqual({
    candidates: 0,
    shared: 0,
    deferred: 0,
    multiple: 0,
    collided: 0,
  });
  expect(snapshot).not.toHaveBeenCalled();
});
