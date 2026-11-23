import { describe, expect, it } from "vitest";

import {
  readPlanSwarmNode,
  requireLocalPlanSwarms,
} from "@/backend/agents/AgentPlanSwarmInput";
import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentPlanInput } from "@/definition/AgentPlan";

const WORKER = { model: null, access: "read_only" };
const BASE = { id: "swarm", x: 1, y: 2 };
const BINDINGS = { task: { kind: "x" } };
const readBindings = (): never => BINDINGS as never;

function node(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...BASE,
    type: "swarm",
    bindings: {},
    task: { source: "text", text: "Do" },
    main: { model: null, access: "read_only" },
    workers: { count: 2, mode: "same", same: WORKER, individual: [] },
    timeoutMinutes: 30,
    ...overrides,
  };
}

function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof AgentError) return error.code;
  }
  return "none";
}

describe("readPlanSwarmNode", () => {
  it("reads a minimal node and drops empty optional texts", () => {
    const result = readPlanSwarmNode(
      node({
        directory: "  ",
        main: { model: null, access: "yolo", instruction: "  " },
        workers: {
          count: 2,
          mode: "same",
          same: WORKER,
          individual: [],
          instruction: " ",
        },
      }),
      { id: "swarm", x: 1, y: 2 },
      readBindings,
    );

    expect(result).toEqual({
      id: "swarm",
      x: 1,
      y: 2,
      type: "swarm",
      task: { source: "text", text: "Do" },
      main: { model: null, access: "yolo" },
      workers: { count: 2, mode: "same", same: WORKER, individual: [] },
      timeoutMinutes: 30,
      bindings: BINDINGS,
    });
  });

  it("keeps every optional setting", () => {
    const result = readPlanSwarmNode(
      node({
        name: "Swarm",
        directory: " sub/dir ",
        main: { model: null, access: "read_only", instruction: "Lead" },
        workers: {
          count: 1,
          mode: "individual",
          same: WORKER,
          individual: [WORKER],
          instruction: "Help",
        },
        executionTarget: { kind: "local" },
        memory: { enabled: true, workersPublish: false, keepAfterEnd: true },
      }),
      BASE,
      readBindings,
    );

    expect(result).toMatchObject({
      name: "Swarm",
      directory: "sub/dir",
      main: { instruction: "Lead" },
      workers: { instruction: "Help" },
      executionTarget: { kind: "local" },
      memory: { enabled: true, workersPublish: false, keepAfterEnd: true },
    });
  });

  it("accepts a ticket task and a remote target, which is refused later", () => {
    const result = readPlanSwarmNode(
      node({
        task: { source: "ticket" },
        executionTarget: { kind: "remote", workspaceId: "w" },
      }),
      BASE,
      readBindings,
    );

    expect(result.executionTarget).toEqual({
      kind: "remote",
      workspaceId: "w",
    });
  });

  it("rejects malformed nodes", () => {
    expect(codeOf(() => readPlanSwarmNode({}, BASE, readBindings))).toBe(
      "swarm_invalid",
    );
  });

  it.each([
    { workers: { count: 0, mode: "same", same: WORKER, individual: [] } },
    { timeoutMinutes: 0 },
    { directory: "../outside" },
  ])("rejects a node that cannot be saved %j", (overrides) => {
    expect(
      codeOf(() => readPlanSwarmNode(node(overrides), BASE, readBindings)),
    ).toBe("swarm_invalid");
  });
});

describe("requireLocalPlanSwarms", () => {
  function plan(
    nodes: readonly unknown[],
    executionTarget?: unknown,
  ): AgentPlanInput {
    return { nodes, executionTarget } as unknown as AgentPlanInput;
  }

  const swarm = readPlanSwarmNode(node(), BASE, readBindings);

  it("returns a plan whose swarms stay local", () => {
    const local = plan([{ type: "parameter" }, swarm]);

    expect(requireLocalPlanSwarms(local)).toBe(local);
  });

  it("refuses a swarm that inherits a remote plan target", () => {
    expect(
      codeOf(() =>
        requireLocalPlanSwarms(
          plan([swarm], { kind: "remote", workspaceId: "w" }),
        ),
      ),
    ).toBe("swarm_remote_unsupported");
  });
});
