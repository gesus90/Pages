import { expect, it, vi } from "vitest";

import { AgentRunDiagnosisService } from "@/backend/service/agents/diagnosis/AgentRunDiagnosisService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentRunDiagnosisParts } from "@/backend/service/agents/diagnosis/AgentRunDiagnosisService";

function setup(): {
  service: AgentRunDiagnosisService;
  parts: AgentRunDiagnosisParts;
  search: ReturnType<typeof vi.fn>;
} {
  const plans = [
    { id: "plan", name: "Plan", projectId: "project", projectName: "Project" },
  ];
  const row = {
    runId: "run",
    planId: "plan",
    planName: "Plan",
    projectId: "project",
    status: "failed",
    startedAt: "2026-01-01",
    endedAt: null,
    startedById: "user",
    failedStepId: null,
    errorClass: null,
    errorCode: null,
  };
  const search = vi.fn(async () => [row]);
  const parts = partial<AgentRunDiagnosisParts>({
    plans: { summaries: vi.fn(async () => plans) },
    indexer: { refresh: vi.fn(async () => undefined) },
    failures: {
      count: vi.fn(async () => 2),
      search,
      groups: vi.fn(async () => []),
      totalFailedSteps: vi.fn(async () => 0),
    },
    reader: {
      describeStarter: vi.fn(async (id: string) => ({
        id,
        displayName: "User",
      })),
      read: vi.fn(async () => ({
        run: { id: "run" },
        hiddenSources: ["secret"],
      })),
    },
    logs: {
      read: vi.fn(async () => ({
        rows: [
          {
            id: 1,
            at: "now",
            level: "info",
            source: "cli",
            stepId: null,
            attemptId: null,
            message: "private text",
            isFiltered: false,
          },
          {
            id: 2,
            at: "now",
            level: "info",
            source: "system",
            stepId: null,
            attemptId: null,
            message: "public",
            isFiltered: false,
          },
        ],
        hasMore: true,
      })),
    },
  });
  return { service: new AgentRunDiagnosisService(parts), parts, search };
}

it("lists only visible plans and pages through runs", async () => {
  const { service, search } = setup();
  expect(await service.visiblePlans("user")).toEqual([
    { id: "plan", name: "Plan", projectId: "project", projectName: "Project" },
  ]);
  const first = await service.listRuns("user", { limit: 1 });
  expect(first.runs).toMatchObject([
    { runId: "run", startedBy: { id: "user", displayName: "User" } },
  ]);
  expect(first.nextCursor).toBeTruthy();
  await service.listRuns("user", { limit: 1, cursor: first.nextCursor });
  expect(search).toHaveBeenLastCalledWith(
    expect.objectContaining({ planIds: ["plan"] }),
    { offset: 1, limit: 1 },
  );
  await expect(
    service.listRuns("user", { planId: "hidden" }),
  ).rejects.toThrow();
  await expect(
    service.listRuns("other", { limit: 1, cursor: first.nextCursor }),
  ).rejects.toThrow();
});

it("summarizes only visible plans and respects project filters", async () => {
  const { service, parts } = setup();
  expect(
    await service.summarizeFailures("user", { projectId: "other" }),
  ).toMatchObject({ groups: [], totalFailedSteps: 0 });
  expect(parts.failures.groups).toHaveBeenCalledWith(
    expect.objectContaining({ planIds: [], projectId: "other" }),
    "errorClass",
    expect.any(Number),
  );
});

it("hides CLI text when a run contains hidden sources and binds cursors to the reader", async () => {
  const { service } = setup();
  const page = await service.logs("user", { runId: "run" });
  expect(page.entries).toMatchObject([
    { source: "cli", isFiltered: true },
    { source: "system", message: "public" },
  ]);
  expect(page.entries[0]).not.toHaveProperty("message");
  expect(page.hiddenFields).toEqual(["entries.message"]);
  expect(page.nextCursor).toBeTruthy();
  await expect(
    service.logs("other", { runId: "run", cursor: page.nextCursor }),
  ).rejects.toThrow();
});
