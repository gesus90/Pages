import { describe, expect, it, vi } from "vitest";

import { readPlanPollingResponse } from "@/app/lib/agent-plan-poll";

const reader = vi.hoisted(() => ({ readPlanRun: vi.fn() }));
vi.mock("@/backend/agents/AgentPlanRunInput", () => reader);

const CONTROL = {
  runId: "run-1",
  status: "running",
  canPlay: false,
  canPause: true,
  canResume: false,
  canStop: true,
  canEdit: false,
  issue: null,
  planRevision: 4,
  continuationVersion: 2,
  frontierStepIds: ["a", "b"],
};

describe("reading a plan polling response", () => {
  it("answers the control state of a plan", () => {
    expect(
      readPlanPollingResponse({
        ok: true,
        intent: "poll-control",
        control: CONTROL,
      }),
    ).toEqual({
      ok: true,
      intent: "poll-control",
      control: { ...CONTROL, issues: undefined },
    });
  });

  it("reads the issues of the plan and keeps null node and port", () => {
    const response = readPlanPollingResponse({
      ok: true,
      control: {
        ...CONTROL,
        planRevision: null,
        issue: "graph",
        issues: [{ nodeId: null, port: null, reason: "name" }],
      },
    });

    expect(response).toMatchObject({
      ok: true,
      intent: "poll",
      control: {
        planRevision: null,
        issue: "graph",
        issues: [{ nodeId: null, port: null, reason: "name" }],
      },
    });
  });

  it("reads a run through the run reader", () => {
    const run = { id: "run-1" };
    reader.readPlanRun.mockReturnValue(run);

    expect(readPlanPollingResponse({ ok: true, run: {} })).toEqual({
      ok: true,
      intent: "poll",
      run,
    });
  });

  it("passes a failure on with its error code and falls back to a general one", () => {
    expect(
      readPlanPollingResponse({ ok: false, intent: "x", error: "gone" }),
    ).toEqual({
      ok: false,
      intent: "x",
      error: "gone",
    });
    expect(readPlanPollingResponse({ ok: false })).toEqual({
      ok: false,
      intent: "poll",
      error: "general",
    });
    expect(readPlanPollingResponse({ ok: false, intent: 3, error: 4 })).toEqual(
      {
        ok: false,
        intent: "poll",
        error: "general",
      },
    );
  });
});

describe("refusing a malformed polling response", () => {
  it.each([
    { label: "an unknown outcome", response: { ok: "yes" } },
    { label: "neither control nor run", response: { ok: true } },
    { label: "a non-object", response: "ok" },
    {
      label: "an unknown status",
      response: { ok: true, control: { ...CONTROL, status: "weird" } },
    },
    {
      label: "a non-array frontier",
      response: { ok: true, control: { ...CONTROL, frontierStepIds: "a" } },
    },
    {
      label: "a non-text frontier step",
      response: { ok: true, control: { ...CONTROL, frontierStepIds: [1] } },
    },
    {
      label: "a non-boolean permission",
      response: { ok: true, control: { ...CONTROL, canPlay: 1 } },
    },
    {
      label: "a negative version",
      response: { ok: true, control: { ...CONTROL, continuationVersion: -1 } },
    },
    {
      label: "a fractional revision",
      response: { ok: true, control: { ...CONTROL, planRevision: 1.5 } },
    },
    {
      label: "a non-text issue",
      response: { ok: true, control: { ...CONTROL, issue: 3 } },
    },
    {
      label: "an unknown issue reason",
      response: {
        ok: true,
        control: {
          ...CONTROL,
          issues: [{ nodeId: null, port: null, reason: "bogus" }],
        },
      },
    },
    {
      label: "a non-text issue node",
      response: {
        ok: true,
        control: {
          ...CONTROL,
          issues: [{ nodeId: 1, port: null, reason: "name" }],
        },
      },
    },
  ])("refuses $label", ({ response }) => {
    expect(() => readPlanPollingResponse(response)).toThrow();
  });
});
