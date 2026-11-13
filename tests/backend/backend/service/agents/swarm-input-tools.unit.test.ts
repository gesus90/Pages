import { describe, expect, it, vi } from "vitest";

import { readPlanInput, readPlanNode } from "@/backend/agents/AgentPlanInput";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AgentPlanSwarmService } from "@/backend/service/agents/swarm/AgentPlanSwarmService";
import {
  AgentPlanSwarmRegistry,
  SwarmCallError,
  answerSwarmCall,
} from "@/backend/service/agents/swarm/SwarmRegistry";
import {
  readSwarmStatus,
  changedSwarmPaths,
} from "@/backend/service/agents/swarm/SwarmWorkspaceState";
import {
  planSessionScope,
  planSessionTools,
} from "@/backend/service/agents/AgentPlanSessionAccess";
import { sessionOperations } from "@/backend/service/mcp/AgentOperationCatalog";
import { newPlanSwarm } from "@/definition/AgentPlanSwarm";

import type { SwarmCoordinator } from "@/backend/service/agents/swarm/SwarmCoordinator";

const MODEL = {
  connectionId: "c",
  provider: "claude_code",
  model: "opus",
  reasoningEffort: "medium",
};

function swarmNode(
  changes: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...newPlanSwarm({ id: "s1", x: 10, y: 10 }),
    task: { source: "text", text: "Analyse" },
    main: { model: MODEL, access: "read_only" },
    workers: {
      count: 5,
      mode: "individual",
      same: { model: MODEL, access: "read_only" },
      individual: [
        {
          model: { ...MODEL, provider: "codex_cli" },
          access: "workspace_write",
        },
        { model: { ...MODEL, provider: "opencode" }, access: "yolo" },
      ],
      instruction: "Be brief",
    },
    ...changes,
  };
}

function plan(nodes: unknown[], extra: Record<string, unknown> = {}): unknown {
  return {
    name: "P",
    workspaceId: "w",
    usage: "private",
    globals: {},
    nodes,
    edges: [],
    ...extra,
  };
}

describe("reading swarm nodes", () => {
  it("reads and keeps a swarm with individual helper models", () => {
    const node = readPlanNode(swarmNode());
    expect(node).toMatchObject({
      type: "swarm",
      workers: { count: 5, mode: "individual", instruction: "Be brief" },
      main: { model: MODEL },
    });
    expect(JSON.parse(JSON.stringify(node))).toEqual(node);
  });

  it("refuses an invalid swarm with swarm_invalid", () => {
    for (const changes of [
      {
        workers: {
          count: 11,
          mode: "same",
          same: { model: null, access: "read_only" },
          individual: [],
        },
      },
      { timeoutMinutes: 5000 },
      { directory: "../outside" },
      { unknownField: true },
      { main: { model: MODEL, access: "root" } },
    ])
      expect(() => readPlanNode(swarmNode(changes))).toThrow(
        expect.objectContaining({ code: "swarm_invalid" }),
      );
  });

  it("refuses a remote target when the plan is saved, never silently", () => {
    const remote = { kind: "remote", workspaceId: "r1" };
    expect(() =>
      readPlanInput(plan([swarmNode({ executionTarget: remote })])),
    ).toThrow(new AgentError("swarm_remote_unsupported"));
    expect(() =>
      readPlanInput(plan([swarmNode()], { executionTarget: remote })),
    ).toThrow(new AgentError("swarm_remote_unsupported"));
    expect(readPlanInput(plan([swarmNode()])).nodes).toHaveLength(1);
  });
});

describe("swarm tools of a session", () => {
  it("offers the main tools to the main session and the lock tools to helpers only", () => {
    const main = planSessionScope({
      userId: "u",
      runId: "r",
      stepId: "s1",
      tickets: [],
      lifetimeMs: 0,
      reach: "read",
      swarm: "main",
    });
    const ops = sessionOperations(main, false);
    expect(ops).toContain("run.swarm.assign");
    expect(ops).not.toContain("run.swarm.lock");
    const plain = planSessionScope({
      userId: "u",
      runId: "r",
      stepId: "a",
      tickets: [],
      lifetimeMs: 0,
      reach: "read",
    });
    expect(sessionOperations(plain, false)).not.toContain("run.swarm.assign");
    expect(planSessionTools({ reach: "tickets", swarm: "worker" })).toContain(
      "swarm_lock",
    );
  });

  it("reaches only the swarm of its own run and side", () => {
    const registry = new AgentPlanSwarmRegistry();
    const coordinator = {
      assign: vi.fn(() => ({ status: "assigned" })),
      lock: vi.fn(() => ({ status: "locked", path: "a" })),
      isWorkerActive: () => true,
      version: () => 3,
      view: () => ({ tasks: [] }),
      listLocks: () => [],
    } as unknown as SwarmCoordinator;
    const remove = registry.register("r1", "s1", coordinator);
    expect(
      registry.handle({
        runId: "r1",
        stepId: "s1",
        operation: "run.swarm.assign",
        parameters: { instruction: "x" },
      }),
    ).toEqual({ status: "assigned" });
    expect(() =>
      registry.handle({
        runId: "r2",
        stepId: "s1",
        operation: "run.swarm.assign",
        parameters: {},
      }),
    ).toThrow(new SwarmCallError("FORBIDDEN"));
    expect(() =>
      registry.handle({
        runId: "r1",
        stepId: "s1::H1",
        operation: "run.swarm.assign",
        parameters: {},
      }),
    ).toThrow(new SwarmCallError("FORBIDDEN"));
    expect(() =>
      registry.handle({
        runId: "r1",
        stepId: "s1",
        operation: "run.swarm.lock",
        parameters: { path: "a" },
      }),
    ).toThrow(new SwarmCallError("FORBIDDEN"));
    expect(
      registry.handle({
        runId: "r1",
        stepId: "s1::H1",
        operation: "run.swarm.lock",
        parameters: { path: "a" },
      }),
    ).toEqual({ status: "locked", path: "a" });
    expect(() =>
      registry.handle({
        runId: "r1",
        stepId: "s1::H1",
        operation: "run.swarm.lock",
        parameters: { path: "a", extra: 1 },
      }),
    ).toThrow(new SwarmCallError("INVALID_REQUEST"));
    expect(
      answerSwarmCall(
        { runId: "r9", stepId: "s1", swarmOperation: "run.swarm.status" },
        registry,
      ),
    ).toEqual({ refused: "FORBIDDEN" });
    remove();
    expect(registry.has("r1", "s1")).toBe(false);
  });
});

describe("swarm tools across processes", () => {
  it("forwards to the engine process and waits for a change of the board without blocking it", async () => {
    let version = 1;
    const forward = vi.fn(() => {
      version += 1;
      return Promise.resolve({ version: version >= 4 ? 4 : 1 });
    });
    let now = 0;
    const service = new AgentPlanSwarmService({
      local: { has: () => false, handle: () => ({}) },
      forward,
      sleep: (milliseconds) => {
        now += milliseconds;
        return Promise.resolve();
      },
      now: () => now,
    });
    const scope = {
      runId: "r",
      stepId: "s",
      operations: [],
      tickets: [],
      reach: "read" as const,
    };
    await expect(
      service.handle(scope, "run.swarm.status", { waitSeconds: 30 }),
    ).resolves.toEqual({ swarm: { version: 4 } });
    expect(forward).toHaveBeenCalledTimes(3);
    expect(forward.mock.calls[0]).toEqual([
      {
        runId: "r",
        stepId: "s",
        operation: "run.swarm.status",
        parameters: {},
      },
    ]);
    const refused = new AgentPlanSwarmService({
      local: { has: () => false, handle: () => ({}) },
      forward: null,
    });
    await expect(refused.handle(scope, "run.swarm.status", {})).rejects.toEqual(
      new AgentOperationError("FORBIDDEN"),
    );
  });
});

describe("git status of the working directory", () => {
  it("reads changes, new, deleted and renamed files", () => {
    const output = [
      "1 .M N... 100644 100644 100644 a b src/a.ts",
      "? new file.txt",
      "1 D. N... 100644 000000 000000 a 0 gone.ts",
      "2 R. N... 100644 100644 100644 a a R100 moved.ts",
      "old.ts",
      "",
    ].join("\0");
    const entries = readSwarmStatus(output);
    expect(entries.map((entry) => entry.path)).toEqual([
      "src/a.ts",
      "new file.txt",
      "gone.ts",
      "moved.ts",
    ]);
    expect(entries[3]?.origin).toBe("old.ts");
    expect(
      changedSwarmPaths(
        {
          head: "h",
          index: "i",
          entries: new Map([
            ["a", "1"],
            ["b", "1"],
          ]),
        },
        {
          head: "h",
          index: "i",
          entries: new Map([
            ["a", "2"],
            ["c", "1"],
          ]),
        },
      ),
    ).toEqual(["a", "b", "c"]);
  });
});
