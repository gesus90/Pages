import { expect, it, vi } from "vitest";

import { AgentPlanStartActions } from "@/backend/service/agents/AgentPlanStartActions";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";

import { parameterRunFixture } from "./page55-run-fixture";

it("authorizes the saved revision before inspecting resource owners and does not start a run", async () => {
  const fixture = await parameterRunFixture();
  const prepare = vi.fn(async () => fixture.snapshot);
  const owners = vi.fn(async () => [{ runId: "old-run", planName: "Other plan", startedAt: "2026-11-13T11:11:00Z" }]);
  const start = vi.fn();
  const actions = new AgentPlanStartActions({
    access: { require: async () => ({ ...fixture.snapshot.plan, canEdit: true, projectName: "Project", github: null }) },
    preparation: { prepare }, startResources: { owners }, engine: { start }, plans: { save: vi.fn() }, revise: async () => fixture.snapshot.plan,
  });
  await expect(actions.owners("owner", "plan", 2)).rejects.toMatchObject({ code: "plan_conflict" });
  expect(owners).not.toHaveBeenCalled();
  await expect(actions.owners("owner", "plan", 1)).resolves.toHaveLength(1);
  expect(owners).toHaveBeenCalledWith(fixture.snapshot);
  expect(start).not.toHaveBeenCalled();
});

it.each([new AgentError("plan_invalid"), new AgentExecutionError("connectionUnavailable")])("preserves the existing restart/reset dialog when preparation refuses dispatch", async (error) => {
  const fixture = await parameterRunFixture();
  const actions = new AgentPlanStartActions({
    access: { require: async () => ({ ...fixture.snapshot.plan, canEdit: true, projectName: "Project", github: null }) },
    preparation: { prepare: async () => { throw error; } },
    engine: { start: vi.fn() }, plans: { save: vi.fn() }, revise: async () => fixture.snapshot.plan,
  });
  await expect(actions.owners("owner", "plan", 1)).resolves.toEqual([]);
});
