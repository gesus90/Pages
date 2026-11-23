import { describe, expect, it } from "vitest";

import {
  readEntryInputs,
  readEntryReturns,
  readPlanEndNode,
  readPlanEntryNode,
  readPlanJumpNode,
  readPlanSignalNode,
  readPlanStartNode,
  readRunInvocation,
} from "@/backend/agents/AgentPlanJumpInput";
import { readPlanText } from "@/backend/agents/AgentPlanInput";

import type { PlanJumpReaders } from "@/backend/agents/AgentPlanJumpInput";

const READERS: PlanJumpReaders = {
  text: readPlanText,
  bindings: () => ({}),
};
const BASE = { id: "node", x: 1, y: 2 };

function invalid(read: () => unknown, code = "plan_jump_invalid"): void {
  expect(read).toThrowError(expect.objectContaining({ code }));
}

const OUT = {
  type: "jump",
  direction: "out",
  target: null,
  wait: "continue",
  timeout: { kind: "unlimited" },
  workspace: "own",
  inputs: [],
  returns: [],
  bindings: {},
};

function jump(change: Record<string, unknown>): Record<string, unknown> {
  return { ...OUT, ...change };
}

describe("readPlanEntryNode", () => {
  it("dispatches each entry family and ignores other nodes", () => {
    expect(readPlanEntryNode({ type: "start" }, BASE, READERS)).toEqual({
      ...BASE,
      type: "start",
    });
    expect(readPlanEntryNode({ type: "end" }, BASE, READERS)).toEqual({
      ...BASE,
      type: "end",
    });
    expect(readPlanEntryNode(OUT, BASE, READERS)).toMatchObject({
      type: "jump",
      direction: "out",
    });
    expect(
      readPlanEntryNode({ type: "signal", signalName: "ready" }, BASE, READERS),
    ).toMatchObject({ type: "signal", signalName: "ready" });
    expect(readPlanEntryNode({ type: "step" }, BASE, READERS)).toBeNull();
  });
});

describe("readEntryInputs", () => {
  const declared = { name: "topic", type: "text", isRequired: true };

  it("reads inputs with and without a default", () => {
    expect(
      readEntryInputs(
        [
          declared,
          {
            name: "count",
            type: "number",
            isRequired: false,
            defaultValue: { type: "number", number: 3 },
          },
          { ...declared, name: "other", defaultValue: null },
        ],
        READERS,
      ),
    ).toEqual([
      { ...declared, defaultValue: null },
      {
        name: "count",
        type: "number",
        isRequired: false,
        defaultValue: { type: "number", number: 3 },
      },
      { ...declared, name: "other", defaultValue: null },
    ]);
    expect(readEntryInputs([], READERS)).toEqual([]);
  });

  it("rejects malformed inputs", () => {
    invalid(() => readEntryInputs("none", READERS));
    invalid(() =>
      readEntryInputs(
        Array.from({ length: 17 }, (_, index) => ({
          ...declared,
          name: `n${index}`,
        })),
        READERS,
      ),
    );
    invalid(() =>
      readEntryInputs([{ ...declared, isRequired: "yes" }], READERS),
    );
    invalid(() => readEntryInputs([{ ...declared, type: "other" }], READERS));
    invalid(() => readEntryInputs([declared, declared], READERS));
    invalid(() =>
      readEntryInputs(
        [{ ...declared, defaultValue: { type: "number", number: 1 } }],
        READERS,
      ),
    );
    invalid(() => readEntryInputs(["entry"], READERS), "plan_invalid");
  });
});

describe("readEntryReturns", () => {
  it("reads returns and rejects malformed ones", () => {
    expect(
      readEntryReturns([{ name: "result", type: "ticket" }], READERS),
    ).toEqual([{ name: "result", type: "ticket" }]);
    invalid(() => readEntryReturns(null, READERS));
    invalid(() =>
      readEntryReturns(
        [
          { name: "a", type: "text" },
          { name: "a", type: "text" },
        ],
        READERS,
      ),
    );
    invalid(() => readEntryReturns([{ name: "a", type: "x" }], READERS));
  });
});

describe("readPlanJumpNode outgoing", () => {
  function read(change: Record<string, unknown>): unknown {
    return readPlanJumpNode(jump(change), BASE, READERS);
  }

  it("reads a minimal call", () => {
    const node = readPlanJumpNode(OUT, BASE, READERS);
    expect(node).toEqual({
      ...BASE,
      type: "jump",
      direction: "out",
      target: null,
      wait: "continue",
      timeout: { kind: "unlimited" },
      workspace: "own",
      inputs: [],
      returns: [],
      bindings: {},
    });
  });

  it("reads a complete signal wait with a target", () => {
    const target = {
      planId: "plan",
      entryNodeId: "entry",
      planName: "Plan",
      entryName: "Entry",
    };
    expect(
      read({
        name: "Call",
        target,
        wait: "signal",
        signalName: "ready",
        timeout: { kind: "minutes", minutes: 5 },
        workspace: "shared",
        payloadType: "text",
      }),
    ).toMatchObject({
      name: "Call",
      target,
      wait: "signal",
      signalName: "ready",
      timeout: { kind: "minutes", minutes: 5 },
      workspace: "shared",
      payloadType: "text",
    });
  });

  it("reads a completion wait and a continue wait with a signal name", () => {
    expect(read({ wait: "completion" })).toMatchObject({ wait: "completion" });
    expect(read({ signalName: "ready" })).toMatchObject({
      signalName: "ready",
    });
  });

  it("rejects malformed calls", () => {
    invalid(() => read({ wait: "forever" }));
    invalid(() => read({ wait: "signal" }));
    invalid(() => read({ signalName: 1 }));
    invalid(() => read({ signalName: "1bad" }));
    invalid(() => read({ workspace: "other" }));
    invalid(() => read({ workspace: "shared" }));
    invalid(() => read({ payloadType: "other" }));
    invalid(() => read({ timeout: { kind: "other" } }));
    invalid(() => read({ timeout: { kind: "minutes", minutes: "5" } }));
    invalid(() => read({ timeout: { kind: "minutes", minutes: 1.5 } }));
    invalid(() => read({ timeout: { kind: "minutes", minutes: 0 } }));
    invalid(() => read({ timeout: { kind: "minutes", minutes: 43_201 } }));
    invalid(() => read({ inputs: "none" }));
    invalid(() => read({ returns: "none" }));
    invalid(() => read({ timeout: null }), "plan_invalid");
    invalid(() => read({ target: "plan" }), "plan_invalid");
    invalid(() => read({ name: "" }), "plan_invalid");
  });
});

describe("readPlanJumpNode incoming", () => {
  const incoming = {
    direction: "in",
    name: "Entry",
    isEnabled: false,
    inputs: [],
  };

  it("reads a receiving entry", () => {
    expect(readPlanJumpNode(incoming, BASE, READERS)).toEqual({
      ...BASE,
      type: "jump",
      direction: "in",
      name: "Entry",
      isEnabled: false,
      inputs: [],
    });
  });

  it("rejects another direction and a mistyped switch", () => {
    invalid(() =>
      readPlanJumpNode({ ...incoming, direction: "up" }, BASE, READERS),
    );
    invalid(() =>
      readPlanJumpNode({ ...incoming, isEnabled: "no" }, BASE, READERS),
    );
    invalid(() =>
      readPlanJumpNode({ ...incoming, inputs: null }, BASE, READERS),
    );
    invalid(
      () => readPlanJumpNode({ ...incoming, name: undefined }, BASE, READERS),
      "plan_invalid",
    );
  });
});

describe("readPlanSignalNode", () => {
  it("reads a signal with and without optional members", () => {
    expect(readPlanSignalNode({ signalName: "ready" }, BASE, READERS)).toEqual({
      ...BASE,
      type: "signal",
      signalName: "ready",
      bindings: {},
    });
    expect(
      readPlanSignalNode(
        { name: "Send", signalName: "ready", payloadType: "number" },
        BASE,
        READERS,
      ),
    ).toMatchObject({ name: "Send", payloadType: "number" });
  });

  it("rejects a malformed signal", () => {
    invalid(() => readPlanSignalNode({ signalName: "no way" }, BASE, READERS));
    invalid(() => readPlanSignalNode({}, BASE, READERS));
    invalid(() =>
      readPlanSignalNode(
        { signalName: "ready", payloadType: "x" },
        BASE,
        READERS,
      ),
    );
  });
});

describe("readPlanStartNode", () => {
  it("reads an old start without optional members", () => {
    expect(readPlanStartNode({}, BASE, READERS)).toEqual({
      ...BASE,
      type: "start",
    });
  });

  it("reads a callable start with name and inputs", () => {
    expect(
      readPlanStartNode(
        {
          name: "Start",
          callable: false,
          inputs: [{ name: "topic", type: "text", isRequired: true }],
        },
        BASE,
        READERS,
      ),
    ).toMatchObject({
      name: "Start",
      callable: false,
      inputs: [{ name: "topic", defaultValue: null }],
    });
  });

  it("rejects a mistyped release", () => {
    invalid(() => readPlanStartNode({ callable: "yes" }, BASE, READERS));
  });
});

describe("readPlanEndNode", () => {
  it("reads an old end and a complete end", () => {
    expect(readPlanEndNode({}, BASE, READERS)).toEqual({
      ...BASE,
      type: "end",
    });
    expect(
      readPlanEndNode(
        { returns: [{ name: "result", type: "text" }], bindings: {} },
        BASE,
        READERS,
      ),
    ).toEqual({
      ...BASE,
      type: "end",
      returns: [{ name: "result", type: "text" }],
      bindings: {},
    });
  });
});

describe("readRunInvocation", () => {
  const invocation = {
    invocationId: "i",
    entryNodeId: "e",
    sourcePlanId: "p",
    sourceRunId: "r",
    sourceNodeId: "n",
    wait: "completion",
  };

  it("reads a stored call and rejects a malformed one", () => {
    expect(readRunInvocation(invocation)).toEqual(invocation);
    invalid(
      () => readRunInvocation({ ...invocation, wait: "other" }),
      "plan_invalid",
    );
    invalid(() => readRunInvocation(null), "plan_invalid");
  });
});
