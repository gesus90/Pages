import { beforeEach, expect, it, vi } from "vitest";

import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { AgentLocalSessionPreparation } from "@/backend/service/agents/AgentLocalSessionPreparation";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { LocalSessionLaunch } from "@/backend/agents/local/LocalSessionContracts";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanStepStart } from "@/backend/service/agents/AgentPlanStepStart";

const find = vi.fn();
const snapshot = vi.fn();
const prepare = vi.fn();
const service = new AgentLocalSessionPreparation(
  partial<AgentPlanRunRepository>({ find, snapshot }),
  partial<AgentPlanStepStart>({ prepare }),
);
const launch = partial<LocalSessionLaunch>({
  runId: "run",
  userId: "user",
  stepId: "step",
  attemptId: "attempt",
  instanceId: "instance",
  sessionScopeId: "step",
  prompt: "prompt",
  isInstruction: false,
  mcp: null,
  timeoutMinutes: 5,
  resumeSessionId: null,
});
const record = {
  attemptId: "attempt",
  instanceId: "instance",
  runner: "codex_cli",
  dispatchedPromptDigest: planContentDigest("prompt"),
  requested: {
    directory: "/workspace",
    connectionId: "connection",
    model: "model",
  },
};
const run = {
  id: "run",
  planId: "plan",
  userId: "user",
  status: "running",
  stopRequested: false,
  steps: [{ id: "step", session: record }],
};
const step = {
  step: { id: "step", agentId: "agent", personalAgentId: null },
  name: "Agent",
};

beforeEach(() => {
  vi.resetAllMocks();
  find.mockResolvedValue(run);
  snapshot.mockResolvedValue({
    plan: { id: "plan", nodes: [], edges: [] },
    steps: [step],
  });
  prepare.mockResolvedValue({
    input: {
      directory: "/workspace",
      agent: { connection: { id: "connection" }, model: "model" },
    },
    options: {},
  });
});

it("prepares only the pinned attempt and prompt", async () => {
  const result = await service.prepare(launch, null);
  expect(result.input).toMatchObject({
    prompt: "prompt",
    directory: "/workspace",
    instanceId: "instance",
    mcp: null,
    options: { timeoutMinutes: 5 },
    resourceContext: { planId: "plan", runId: "run", stepId: "step" },
  });
  expect(result.recording).toMatchObject({
    key: { attemptId: "attempt", stepId: "step" },
    userId: "user",
  });
});

it("rejects unavailable runs, wrong owners and stop requests", async () => {
  for (const value of [
    null,
    { ...run, userId: "other" },
    { ...run, stopRequested: true },
    { ...run, status: "succeeded" },
  ]) {
    find.mockResolvedValueOnce(value);
    await expect(service.prepare(launch, null)).rejects.toThrow();
  }
  expect(prepare).not.toHaveBeenCalled();
});

it("rejects changed attempts, prompts, directories and session scopes", async () => {
  await expect(
    service.prepare({ ...launch, instanceId: "other" }, null),
  ).rejects.toThrow();
  await expect(
    service.prepare({ ...launch, prompt: "changed" }, null),
  ).rejects.toThrow();
  prepare.mockResolvedValueOnce({
    input: {
      directory: "/other",
      agent: { connection: { id: "connection" }, model: "model" },
    },
    options: {},
  });
  await expect(service.prepare(launch, null)).rejects.toThrow();
  await expect(
    service.prepare({ ...launch, sessionScopeId: "other" }, null),
  ).rejects.toThrow();
});

it("requires an in-memory bearer for a tool-enabled turn", async () => {
  await expect(
    service.prepare(
      partial<LocalSessionLaunch>({
        ...launch,
        mcp: { url: "http://internal" },
      }),
      null,
    ),
  ).rejects.toThrow();
  expect(find).not.toHaveBeenCalled();
});
