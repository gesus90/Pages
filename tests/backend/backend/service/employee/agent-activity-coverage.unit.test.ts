import { expect, it, vi } from "vitest";

import { AgentActivityService } from "@/backend/service/employee/AgentActivityService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";

it("sums known cost and retains the count of unknown sessions for the UTC month", async () => {
  const costSince = vi.fn(async () => ({ known: 1.25, unknownSessions: 2 }));
  const service = new AgentActivityService(
    partial<EmployeeStore>({ activity: () => ({ costSince }) }),
    () => new Date("2026-11-16T12:00:00Z"),
  );
  await expect(
    service.cost(partial<StoredAgentEmployee>({ userId: "agent" })),
  ).resolves.toEqual({ spent: 1.25, unknownSessions: 2, month: "2026-11" });
  expect(costSince).toHaveBeenCalledWith(
    "agent",
    expect.stringContaining("2026-11-01"),
  );
});

it("merges activity by time and links only ticket changes", async () => {
  const cost = { state: "none", amount: null, isEstimated: false };
  const activity = {
    sessions: vi.fn(async () => [
      {
        id: "s",
        purpose: "learning",
        createdAt: "2026-11-01T00:00:00Z",
        state: "done",
        personName: "Person",
        cost,
      },
    ]),
    events: vi.fn(async () => [
      {
        id: "e",
        kind: "access",
        createdAt: "2026-11-03T00:00:00Z",
        detail: "{}",
        cost,
      },
    ]),
    changes: vi.fn(async () => [
      {
        id: "c",
        kind: "ticket",
        createdAt: "2026-11-02T00:00:00Z",
        message: "Updated",
        workItemKey: "A 1",
      },
    ]),
  };
  const service = new AgentActivityService(
    partial<EmployeeStore>({ activity: () => activity }),
  );
  const entries = await service.list("agent");
  expect(entries.map((entry) => entry.id)).toEqual([
    "event:e",
    "change:c",
    "session:s",
  ]);
  expect(entries[1]).toMatchObject({ link: "/tasks/A%201" });
  expect(entries[2]).toMatchObject({ kind: "learning", link: null });
  expect(activity.sessions).toHaveBeenCalledWith("agent", 60);
});
