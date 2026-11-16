import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type {
  PlanDecisionModelDependencies,
  PlanDecisionRequest,
} from "@/backend/service/agents/branching/AgentPlanDecisionModel";

const files = vi.hoisted(() => ({ mkdtemp: vi.fn(), rm: vi.fn() }));
vi.mock("node:fs/promises", () => ({ mkdtemp: files.mkdtemp, rm: files.rm }));

import { AgentPlanDecisionModel } from "@/backend/service/agents/branching/AgentPlanDecisionModel";

function turn(output: string): {
  output: string;
  failure: null;
  errorCode: null;
  permissionDenials: number;
} {
  return { output, failure: null, errorCode: null, permissionDenials: 0 };
}

function setup(): {
  service: AgentPlanDecisionModel;
  request: PlanDecisionRequest;
  open: ReturnType<typeof vi.fn>;
  next: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  const next = vi.fn();
  const close = vi.fn(async () => ({ isConfirmed: true }));
  const open = vi.fn(async () => ({
    turn: Promise.resolve(turn('{"decision":true,"reason":"Ready"}')),
    next,
    close,
  }));
  const dependencies = partial<PlanDecisionModelDependencies>({
    execution: { open },
    profiles: {
      resolveDefinition: vi.fn(async () => ({
        assignment: { connection: { provider: "codex_cli" } },
      })),
    },
    tasks: { snapshot: vi.fn() },
  });
  const request = partial<PlanDecisionRequest>({
    run: { id: "run", userId: "user", planId: "plan" },
    snapshot: { plan: { projectId: "project", nodes: [] } },
    decision: {
      id: "decision",
      type: "decision",
      mode: "model",
      question: "Ready?",
      input: { kind: "result", stepId: "step" },
      model: {
        model: "model",
        connectionId: "connection",
        provider: "codex_cli",
      },
    },
    results: new Map([
      [
        "step",
        {
          id: "step",
          name: "Work",
          status: "succeeded",
          output: "Result",
          activation: 2,
        },
      ],
    ]),
    signal: new AbortController().signal,
    authorize: vi.fn(async () => undefined),
  });
  return {
    service: new AgentPlanDecisionModel(dependencies),
    request,
    open,
    next,
    close,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  files.mkdtemp.mockResolvedValue("/simulated/decision");
  files.rm.mockResolvedValue(undefined);
});

it("settles a model decision using only a simulated session and cleans up", async () => {
  const { service, request, open, close } = setup();
  expect(await service.run(request)).toMatchObject({
    status: "succeeded",
    branch: "true",
    verdict: {
      reason: "Ready",
      sourceStepId: "step",
      sourceActivation: 2,
      isCorrected: false,
    },
  });
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({
      mcp: null,
      directory: "/simulated/decision",
      purpose: "decision",
    }),
    request.signal,
    expect.any(Object),
  );
  expect(close).toHaveBeenCalledOnce();
  expect(files.rm).toHaveBeenCalledWith("/simulated/decision", {
    recursive: true,
    force: true,
  });
});

it("offers exactly one correction for an invalid answer", async () => {
  const { service, request, open, next, close } = setup();
  open.mockResolvedValue({
    turn: Promise.resolve(turn("invalid")),
    next,
    close,
  });
  next.mockResolvedValue(turn('{"decision":false,"reason":"Not ready"}'));
  expect(await service.run(request)).toMatchObject({
    status: "succeeded",
    branch: "false",
    verdict: { isCorrected: true },
  });
  expect(next).toHaveBeenCalledOnce();
});

it("fails an invalid correction without activating a branch", async () => {
  const { service, request, open, next, close } = setup();
  open.mockResolvedValue({
    turn: Promise.resolve(turn("invalid")),
    next,
    close,
  });
  next.mockResolvedValue(turn("still invalid"));
  expect(await service.run(request)).toMatchObject({
    status: "failed",
    error: "plan_decision_answer_invalid",
  });
});

it("rejects incomplete decisions and missing source before opening a session", async () => {
  const { service, request, open } = setup();
  expect(
    await service.run({
      ...request,
      decision: { ...request.decision, question: " " },
    }),
  ).toMatchObject({ status: "failed" });
  expect(await service.run({ ...request, results: new Map() })).toMatchObject({
    status: "failed",
  });
  expect(open).not.toHaveBeenCalled();
});
