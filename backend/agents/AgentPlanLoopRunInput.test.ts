import { describe, expect, it } from "vitest";

import { readPlanLoopRuns } from "@/backend/agents/AgentPlanLoopRunInput";

const NODE = {
  id: "node",
  name: "Node",
  status: "succeeded",
  cancellation: "none",
  isBlocked: false,
  output: null,
  error: null,
  session: null,
};

const ITERATION = {
  id: "iteration",
  number: 1,
  status: "succeeded",
  startedAt: "2026-01-01T00:00:00.000Z",
  endedAt: null,
  nodes: [NODE],
  condition: { state: "not_evaluated", reason: "disabled" },
  error: null,
};

const SESSION = {
  nodeId: "node",
  key: "key",
  policy: "reuse",
  state: "open",
  createdInIteration: 1,
  turns: 2,
  instanceId: "instance",
  acpSessionId: "acp",
  nativeSessionId: "native",
  closeout: "confirmed",
};

const LOOP = {
  id: "loop",
  name: "Loop",
  status: "succeeded",
  count: { source: "value", parameterId: null, effective: 3, mode: "max" },
  sessionPolicy: "fresh",
  condition: null,
  iterations: [ITERATION],
  sessions: [SESSION],
  completion: "count_reached",
  cleanup: "not_needed",
  startedAt: "2026-01-01T00:00:00.000Z",
  endedAt: "2026-01-01T01:00:00.000Z",
  error: null,
};

function read(loop: Record<string, unknown>): unknown {
  return readPlanLoopRuns([loop]);
}

function rejects(loop: Record<string, unknown>): void {
  expect(() => read(loop)).toThrowError(
    expect.objectContaining({ name: "AgentError" }),
  );
}

function withIteration(
  change: Record<string, unknown>,
): Record<string, unknown> {
  return { ...LOOP, iterations: [{ ...ITERATION, ...change }] };
}

function withSession(change: Record<string, unknown>): Record<string, unknown> {
  return { ...LOOP, sessions: [{ ...SESSION, ...change }] };
}

describe("readPlanLoopRuns", () => {
  it("reads a complete loop", () => {
    const [loop] = readPlanLoopRuns([LOOP]);
    expect(loop).toMatchObject({
      id: "loop",
      count: { effective: 3, source: "value", parameterId: null },
      completion: "count_reached",
      sessions: [{ turns: 2, createdInIteration: 1 }],
    });
    expect(loop?.iterations[0]?.nodes[0]?.id).toBe("node");
    expect(loop).not.toHaveProperty("whileChecks");
  });

  it("reads an empty list and rejects a malformed or oversized list", () => {
    expect(readPlanLoopRuns([])).toEqual([]);
    expect(() => readPlanLoopRuns("loops")).toThrowError(
      expect.objectContaining({ code: "plan_invalid" }),
    );
    expect(() =>
      readPlanLoopRuns(Array.from({ length: 101 }, () => LOOP)),
    ).toThrowError(expect.objectContaining({ code: "plan_invalid" }));
  });

  it("reads loops with absent optional members", () => {
    const [loop] = readPlanLoopRuns([
      {
        ...LOOP,
        count: undefined,
        completion: undefined,
        startedAt: undefined,
        endedAt: undefined,
        error: "x".repeat(300),
      },
    ]);
    expect(loop).toMatchObject({
      count: null,
      completion: null,
      startedAt: null,
    });
    expect(loop?.error).toHaveLength(200);
  });

  it.each(["condition_met", "while_false"])(
    "reads the completion %s",
    (completion) => {
      expect(readPlanLoopRuns([{ ...LOOP, completion }])[0]?.completion).toBe(
        completion,
      );
    },
  );

  it("rejects malformed loop members", () => {
    rejects({ ...LOOP, status: "unknown" });
    rejects({ ...LOOP, iterations: "none" });
    rejects({
      ...LOOP,
      iterations: Array.from({ length: 1_000 }, () => ITERATION),
    });
    rejects({ ...LOOP, sessions: "none" });
    rejects({ ...LOOP, sessions: Array.from({ length: 101 }, () => SESSION) });
    rejects({ ...LOOP, sessionPolicy: "keep" });
    rejects({ ...LOOP, completion: "other" });
    rejects({ ...LOOP, cleanup: "other" });
    rejects({ ...LOOP, name: "" });
    rejects({ ...LOOP, error: 1 });
  });
});

describe("readPlanLoopRuns count and condition", () => {
  it("reads a parameter count", () => {
    const count = {
      source: "parameter",
      parameterId: "p",
      effective: 0,
      mode: "expected",
    };
    expect(readPlanLoopRuns([{ ...LOOP, count }])[0]?.count).toEqual(count);
  });

  it("rejects a malformed count", () => {
    const count = {
      source: "value",
      parameterId: null,
      effective: 1,
      mode: "max",
    };
    rejects({ ...LOOP, count: { ...count, effective: 1_000 } });
    rejects({ ...LOOP, count: { ...count, source: "other" } });
    rejects({ ...LOOP, count: { ...count, mode: "other" } });
    rejects({ ...LOOP, count: { ...count, parameterId: 1 } });
  });

  it("reads and rejects a condition", () => {
    const condition = {
      isActive: false,
      sourceNodeId: "node",
      outputPath: "$.done",
      expected: { type: "null" },
    };
    expect(readPlanLoopRuns([{ ...LOOP, condition }])[0]?.condition).toEqual(
      condition,
    );
    rejects({ ...LOOP, condition: { ...condition, isActive: "no" } });
    rejects({ ...LOOP, condition: { ...condition, sourceNodeId: "" } });
    rejects({ ...LOOP, condition: { ...condition, expected: { type: "x" } } });
  });
});

describe("readPlanLoopRuns while checks", () => {
  const check = { before: 2, source: "member", value: true, at: "now" };

  it("reads recorded checks", () => {
    expect(
      readPlanLoopRuns([{ ...LOOP, whileChecks: [check] }])[0],
    ).toMatchObject({ whileChecks: [check] });
    expect(
      readPlanLoopRuns([
        { ...LOOP, whileChecks: [{ ...check, source: "parameter" }] },
      ])[0]?.whileChecks?.[0]?.source,
    ).toBe("parameter");
  });

  it("rejects malformed checks", () => {
    rejects({ ...LOOP, whileChecks: "none" });
    rejects({
      ...LOOP,
      whileChecks: Array.from({ length: 1_001 }, () => check),
    });
    rejects({ ...LOOP, whileChecks: [{ ...check, before: "1" }] });
    rejects({ ...LOOP, whileChecks: [{ ...check, before: 1.5 }] });
    rejects({ ...LOOP, whileChecks: [{ ...check, before: 0 }] });
    rejects({ ...LOOP, whileChecks: [{ ...check, value: "yes" }] });
    rejects({ ...LOOP, whileChecks: [{ ...check, source: "other" }] });
    rejects({ ...LOOP, whileChecks: [{ ...check, at: "" }] });
  });
});

describe("readPlanLoopRuns iterations", () => {
  it("keeps an entry failure and a stored end", () => {
    const iteration = readPlanLoopRuns([
      withIteration({ entryFailure: true, endedAt: "later", error: "failed" }),
    ])[0]?.iterations[0];
    expect(iteration).toMatchObject({
      entryFailure: true,
      endedAt: "later",
      error: "failed",
    });
  });

  it("drops an entry failure that is not true", () => {
    const iteration = readPlanLoopRuns([withIteration({ entryFailure: 1 })])[0]
      ?.iterations[0];
    expect(iteration).not.toHaveProperty("entryFailure");
  });

  it("rejects malformed iterations", () => {
    rejects(withIteration({ number: "1" }));
    rejects(withIteration({ number: 1.5 }));
    rejects(withIteration({ number: 0 }));
    rejects(withIteration({ status: "unknown" }));
    rejects(withIteration({ nodes: "none" }));
    rejects(withIteration({ nodes: Array.from({ length: 101 }, () => NODE) }));
    rejects(withIteration({ startedAt: "" }));
    rejects(withIteration({ nodes: [{ ...NODE, status: "unknown" }] }));
    rejects(withIteration({ endedAt: 1 }));
  });
});

describe("readPlanLoopRuns iteration conditions", () => {
  function condition(value: Record<string, unknown>): Record<string, unknown> {
    return withIteration({ condition: value });
  }

  function outcome(loop: Record<string, unknown>): unknown {
    return readPlanLoopRuns([loop])[0]?.iterations[0]?.condition;
  }

  it.each(["disabled", "expected", "incomplete"])(
    "reads a condition not evaluated because it is %s",
    (reason) => {
      expect(outcome(condition({ state: "not_evaluated", reason }))).toEqual({
        state: "not_evaluated",
        reason,
      });
    },
  );

  it("reads a failed condition", () => {
    expect(
      outcome(condition({ state: "failed", code: "plan_loop_output_missing" })),
    ).toEqual({ state: "failed", code: "plan_loop_output_missing" });
  });

  it("reads an evaluated condition with each kind of found value", () => {
    expect(
      outcome(
        condition({
          state: "evaluated",
          isMet: true,
          found: { type: "array" },
        }),
      ),
    ).toEqual({ state: "evaluated", isMet: true, found: { type: "array" } });
    expect(
      outcome(
        condition({
          state: "evaluated",
          isMet: false,
          found: { type: "object" },
        }),
      ),
    ).toMatchObject({ found: { type: "object" } });
    expect(
      outcome(
        condition({
          state: "evaluated",
          isMet: false,
          found: { type: "string", value: "x" },
        }),
      ),
    ).toMatchObject({ found: { type: "string", value: "x" } });
  });

  it("rejects malformed outcomes", () => {
    rejects(condition({ state: "not_evaluated", reason: "other" }));
    rejects(condition({ state: "failed", code: "other" }));
    rejects(condition({ state: "pending" }));
    rejects(
      condition({ state: "evaluated", isMet: "yes", found: { type: "null" } }),
    );
    rejects(
      condition({ state: "evaluated", isMet: true, found: { type: "x" } }),
    );
  });
});

describe("readPlanLoopRuns sessions", () => {
  it("reads sessions without a creating iteration or identities", () => {
    const [first, second] =
      readPlanLoopRuns([
        {
          ...LOOP,
          sessions: [
            { ...SESSION, createdInIteration: null, instanceId: null },
            {
              ...SESSION,
              createdInIteration: undefined,
              acpSessionId: undefined,
              nativeSessionId: "n".repeat(300),
            },
          ],
        },
      ])[0]?.sessions ?? [];
    expect(first).toMatchObject({ createdInIteration: null, instanceId: null });
    expect(second).toMatchObject({
      createdInIteration: null,
      acpSessionId: null,
    });
    expect(second?.nativeSessionId).toHaveLength(200);
  });

  it.each(["open", "closed", "lost", "not_retained"])(
    "reads the session state %s",
    (state) => {
      expect(
        readPlanLoopRuns([withSession({ state })])[0]?.sessions[0]?.state,
      ).toBe(state);
    },
  );

  it("rejects malformed sessions", () => {
    rejects(withSession({ turns: "1" }));
    rejects(withSession({ turns: 1.5 }));
    rejects(withSession({ turns: -1 }));
    rejects(withSession({ createdInIteration: "1" }));
    rejects(withSession({ createdInIteration: 1.5 }));
    rejects(withSession({ policy: "keep" }));
    rejects(withSession({ state: "gone" }));
    rejects(withSession({ closeout: "gone" }));
    rejects(withSession({ key: "k".repeat(301) }));
  });
});
