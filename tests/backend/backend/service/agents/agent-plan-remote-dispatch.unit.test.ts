import { expect, it, vi } from "vitest";

import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";
import { dispatchRemotePlanStep } from "@/backend/service/agents/AgentPlanRemoteDispatch";
import { remoteTodoChecklists } from "@/backend/service/agents/AgentPlanRemoteChecklist";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { RemoteDispatchRequest } from "@/backend/service/agents/AgentPlanRemoteDispatch";
import type { AgentPlanStep } from "@/definition/AgentPlan";

it("dispatches only an explicit remote step and records its dispatch", async () => {
  const run = vi.fn(async () => ({ status: "succeeded" }));
  const dispatched = new Set<string>();
  const request = partial<RemoteDispatchRequest>({
    active: {
      snapshot: { remoteSteps: [{ step: { id: "step" } }], steps: [] },
      view: { status: "running" },
      dispatched,
    },
    stepId: "step",
    signal: new AbortController().signal,
    service: { run },
  });
  await expect(dispatchRemotePlanStep(request)).resolves.toEqual({
    status: "succeeded",
  });
  expect(dispatched.has("step")).toBe(true);
  expect(dispatchRemotePlanStep({ ...request, stepId: "unknown" })).toBeNull();
  expect(() =>
    dispatchRemotePlanStep({ ...request, service: undefined }),
  ).toThrow();
});

it("does not dispatch an aborted or paused step", async () => {
  const run = vi.fn(async () => {
    throw new AgentPlanPausedError();
  });
  const active = partial<RemoteDispatchRequest["active"]>({
    snapshot: { remoteSteps: [{ step: { id: "step" } }], steps: [] },
    view: { status: "running" },
    dispatched: new Set(),
  });
  const request = partial<RemoteDispatchRequest>({
    active,
    stepId: "step",
    signal: new AbortController().signal,
    service: { run },
  });
  await expect(dispatchRemotePlanStep(request)).resolves.toEqual({
    status: "paused",
  });
  const controller = new AbortController();
  controller.abort();
  await expect(
    dispatchRemotePlanStep({ ...request, signal: controller.signal }),
  ).resolves.toMatchObject({
    status: "cancelled",
    cancellation: "not_started",
  });
});

it("loads each ticket checklist and refuses missing task access", async () => {
  const checklist = vi.fn(
    async (userId: string, projectId: string, id: string) => {
      expect(userId).toBe("user");
      expect(projectId).toBe("project");
      return { id };
    },
  );
  const input = partial<Parameters<typeof remoteTodoChecklists>[0]>({
    step: partial<AgentPlanStep>({}),
    parameters: { tickets: { one: {}, two: {} } },
    tasks: { checklist },
    userId: "user",
    projectId: "project",
  });
  await expect(remoteTodoChecklists(input)).resolves.toEqual([
    { id: "one" },
    { id: "two" },
  ]);
  await expect(
    remoteTodoChecklists({ ...input, tasks: undefined }),
  ).rejects.toMatchObject({ code: "plan_binding_invalid" });
  await expect(
    remoteTodoChecklists({ ...input, parameters: undefined }),
  ).resolves.toEqual([]);
});
