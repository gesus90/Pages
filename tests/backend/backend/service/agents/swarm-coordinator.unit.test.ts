import { describe, expect, it } from "vitest";

import { SwarmCoordinator } from "@/backend/service/agents/swarm/SwarmCoordinator";
import { SwarmStartError } from "@/backend/service/agents/swarm/SwarmPorts";

import type {
  SwarmStoredBoard,
  SwarmTurn,
  SwarmWorkerEvents,
  SwarmWorkerSession,
} from "@/backend/service/agents/swarm/SwarmPorts";
import type { SwarmWorkspaceState } from "@/backend/service/agents/swarm/SwarmWorkspaceState";

/** A turn the test ends by hand, so concurrency stays deterministic. */
interface PendingTurn {
  readonly workerId: string;
  readonly prompt: string;
  readonly signal: AbortSignal;
  readonly end: (turn: SwarmTurn) => void;
}

interface Harness {
  readonly coordinator: SwarmCoordinator;
  readonly turns: PendingTurn[];
  readonly opened: string[];
  readonly closed: string[];
  readonly saved: SwarmStoredBoard[];
  readonly workspace: { state: SwarmWorkspaceState };
  readonly events: Map<string, SwarmWorkerEvents>;
  readonly controller: AbortController;
}

const EMPTY: SwarmWorkspaceState = {
  head: "h1",
  index: "i1",
  entries: new Map(),
};

function done(output: string): SwarmTurn {
  return { output, failure: null, errorCode: null };
}

async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function harness(options: {
  readonly workers?: number;
  readonly refuse?: ReadonlySet<string>;
  readonly stored?: SwarmStoredBoard | null;
  readonly now?: () => number;
}): Harness {
  const turns: PendingTurn[] = [];
  const opened: string[] = [];
  const closed: string[] = [];
  const saved: SwarmStoredBoard[] = [];
  const events = new Map<string, SwarmWorkerEvents>();
  const workspace = { state: EMPTY };
  const controller = new AbortController();
  const coordinator = new SwarmCoordinator(
    {
      main: { provider: "claude", model: "opus" },
      workers: Array.from({ length: options.workers ?? 3 }, () => ({
        provider: "codex",
        model: "gpt",
        access: "workspace_write" as const,
      })),
      instruction: null,
      stored: options.stored ?? null,
      signal: controller.signal,
    },
    {
      launcher: {
        open: (workerId, first, workerEvents) => {
          if (options.refuse?.has(workerId))
            return Promise.reject(new SwarmStartError("acp_worker_limit"));
          opened.push(workerId);
          events.set(workerId, workerEvents);
          const run = (
            prompt: string,
            turnSignal: AbortSignal,
          ): Promise<SwarmTurn> =>
            new Promise<SwarmTurn>((resolve) => {
              turns.push({
                workerId,
                prompt,
                signal: turnSignal,
                end: resolve,
              });
              turnSignal.addEventListener("abort", () => {
                resolve({ output: "", failure: "cancelled", errorCode: null });
              });
            });
          const session: SwarmWorkerSession = {
            run,
            close: () => {
              closed.push(workerId);
              return Promise.resolve();
            },
          };
          return first.signal.aborted
            ? Promise.reject(new Error("aborted"))
            : Promise.resolve({
                session,
                turn: run(first.prompt, first.signal),
              });
        },
      },
      probe: { snapshot: () => Promise.resolve(workspace.state) },
      save: (board) => {
        saved.push(board);
        return Promise.resolve();
      },
      now: options.now ?? (() => Date.parse("2026-11-12T10:00:00Z")),
      leaseMs: 120_000,
    },
  );
  return {
    coordinator,
    turns,
    opened,
    closed,
    saved,
    workspace,
    events,
    controller,
  };
}

function turnOf(test: Harness, workerId: string): PendingTurn {
  const turn = test.turns.find((entry) => entry.workerId === workerId);
  if (!turn) throw new Error(`No turn of ${workerId}`);
  test.turns.splice(test.turns.indexOf(turn), 1);
  return turn;
}

describe("SwarmCoordinator", () => {
  it("hands subtasks to free helpers that work in parallel in their own sessions", async () => {
    const test = harness({});
    const first = test.coordinator.assign({
      instruction: "contracts",
      workerId: null,
      scope: ["docs/contracts/"],
      taskId: null,
    });
    const second = test.coordinator.assign({
      instruction: "invoices",
      workerId: "H3",
      scope: ["docs/invoices"],
      taskId: null,
    });
    await settle();
    expect(first).toMatchObject({ status: "assigned", task: { id: "T1" } });
    expect(second).toMatchObject({ status: "assigned", task: { id: "T2" } });
    expect(test.opened).toEqual(["H1", "H3"]);
    expect(test.turns.map((turn) => turn.workerId)).toEqual(["H1", "H3"]);
    expect(
      test.coordinator.view().workers.map((worker) => worker.status),
    ).toEqual(["busy", "idle", "busy"]);
    turnOf(test, "H3").end(done("3 invoices"));
    turnOf(test, "H1").end(done("2 contracts"));
    await settle();
    const view = test.coordinator.view();
    expect(view.tasks.map((task) => [task.status, task.result])).toEqual([
      ["done", "2 contracts"],
      ["done", "3 invoices"],
    ]);
    expect(view.workers.every((worker) => worker.status === "idle")).toBe(true);
  });
});

describe("SwarmCoordinator areas and locks", () => {
  it("refuses an overlapping area without changing the board", async () => {
    const test = harness({});
    test.coordinator.assign({
      instruction: "docs",
      workerId: null,
      scope: ["docs"],
      taskId: null,
    });
    await settle();
    const before = test.coordinator.view();
    const outcome = test.coordinator.assign({
      instruction: "nested",
      workerId: null,
      scope: ["./docs/mails/"],
      taskId: null,
    });
    expect(outcome).toMatchObject({
      status: "refused",
      code: "swarm_scope_overlap",
    });
    expect(test.coordinator.view()).toEqual(before);
    expect(
      test.coordinator.assign({
        instruction: "escape",
        workerId: null,
        scope: ["../etc"],
        taskId: null,
      }),
    ).toMatchObject({ status: "refused", code: "swarm_scope_invalid" });
  });

  it("locks a file for one helper at once and frees the lock when its subtask ends", async () => {
    const test = harness({});
    for (const instruction of ["a", "b"])
      test.coordinator.assign({
        instruction,
        workerId: null,
        scope: [],
        taskId: null,
      });
    await settle();
    expect(test.coordinator.lock("H1", "src/a.ts")).toEqual({
      status: "locked",
      path: "src/a.ts",
    });
    expect(test.coordinator.lock("H2", "./src/a.ts")).toEqual({
      status: "taken",
      path: "src/a.ts",
      owner: "H1",
    });
    // Crossed requests never deadlock: each answers at once.
    expect(test.coordinator.lock("H2", "src/b.ts").status).toBe("locked");
    expect(test.coordinator.lock("H1", "src/b.ts")).toMatchObject({
      owner: "H2",
    });
    turnOf(test, "H1").end(done("ok"));
    await settle();
    expect(test.coordinator.listLocks().map((lock) => lock.owner)).toEqual([
      "H2",
    ]);
    expect(test.coordinator.lock("H2", "src/a.ts").status).toBe("locked");
    expect(test.coordinator.lock("H1", "src/c.ts")).toMatchObject({
      code: "swarm_worker_inactive",
    });
  });

  it("frees the locks of a crashed helper and closes its session", async () => {
    const test = harness({});
    test.coordinator.assign({
      instruction: "a",
      workerId: null,
      scope: [],
      taskId: null,
    });
    await settle();
    test.coordinator.lock("H1", "x.txt");
    turnOf(test, "H1").end({
      output: "",
      failure: "failed",
      errorCode: "process_exit",
    });
    await settle();
    const view = test.coordinator.view();
    expect(view.tasks[0]).toMatchObject({
      status: "failed",
      error: "process_exit",
    });
    expect(view.workers[0]).toMatchObject({ status: "failed", locks: [] });
    expect(test.coordinator.listLocks()).toEqual([]);
    expect(test.closed).toEqual(["H1"]);
  });
});

describe("SwarmCoordinator checks", () => {
  it("reports changes outside areas and locks, but not allowed changes of another helper", async () => {
    const test = harness({});
    test.coordinator.assign({
      instruction: "a",
      workerId: null,
      scope: ["a"],
      taskId: null,
    });
    test.coordinator.assign({
      instruction: "b",
      workerId: null,
      scope: ["b"],
      taskId: null,
    });
    await settle();
    test.coordinator.lock("H1", "shared.txt");
    test.workspace.state = {
      head: "h1",
      index: "i1",
      entries: new Map([
        ["a/new.txt", "? x"],
        ["b/deleted.txt", "1 .D x"],
        ["shared.txt", "1 .M x"],
        ["outside.txt", "1 .M x"],
        ["renamed.txt", "2 R. x"],
      ]),
    };
    turnOf(test, "H1").end(done("ok"));
    await settle();
    const violations = test.coordinator.view().violations;
    expect(violations).toEqual([
      {
        kind: "outside",
        taskId: "T1",
        workerIds: ["H1", "H2"],
        files: ["outside.txt", "renamed.txt"],
        at: "2026-11-12T10:00:00.000Z",
      },
    ]);
    test.workspace.state = { ...test.workspace.state, head: "h2" };
    turnOf(test, "H2").end(done("committed"));
    await settle();
    expect(
      test.coordinator.view().violations.map((entry) => entry.kind),
    ).toEqual(["outside", "head"]);
  });
});

describe("SwarmCoordinator failures", () => {
  it("keeps the node alive when helpers cannot start and lets the main model hand the subtask out again", async () => {
    const test = harness({ workers: 5, refuse: new Set(["H3", "H4", "H5"]) });
    for (const workerId of ["H1", "H2", "H3", "H4", "H5"])
      test.coordinator.assign({
        instruction: workerId,
        workerId,
        scope: [],
        taskId: null,
      });
    await settle();
    const view = test.coordinator.view();
    expect(view.workers.map((worker) => worker.status)).toEqual([
      "busy",
      "busy",
      "not_started",
      "not_started",
      "not_started",
    ]);
    expect(view.workers[2].reason).toBe("acp_worker_limit");
    expect(view.tasks[2]).toMatchObject({
      status: "failed",
      attempts: 0,
      error: "not_started:acp_worker_limit",
    });
    expect(view.outcome).toBe("running");
    turnOf(test, "H1").end(done("one"));
    await settle();
    expect(
      test.coordinator.assign({
        instruction: "",
        workerId: null,
        scope: [],
        taskId: "T3",
      }),
    ).toMatchObject({ status: "assigned", task: { id: "T3", attempts: 1 } });
    await settle();
    expect(test.coordinator.view().tasks[2]).toMatchObject({
      status: "running",
      workerId: "H1",
    });
  });

  it("hands a failed subtask out at most three times again and never a finished one", async () => {
    const test = harness({ workers: 1 });
    test.coordinator.assign({
      instruction: "a",
      workerId: null,
      scope: [],
      taskId: null,
    });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await settle();
      turnOf(test, "H1").end({
        output: "",
        failure: "timeout",
        errorCode: null,
      });
      await settle();
      const again = test.coordinator.assign({
        instruction: "",
        workerId: null,
        scope: [],
        taskId: "T1",
      });
      expect(again.status).toBe(attempt < 3 ? "assigned" : "refused");
    }
    expect(test.coordinator.view().tasks[0]).toMatchObject({
      attempts: 4,
      error: "swarm_worker_timeout",
    });
    test.coordinator.assign({
      instruction: "b",
      workerId: null,
      scope: [],
      taskId: null,
    });
    await settle();
    turnOf(test, "H1").end(done("b"));
    await settle();
    expect(
      test.coordinator.assign({
        instruction: "",
        workerId: null,
        scope: [],
        taskId: "T2",
      }),
    ).toMatchObject({ code: "swarm_task_done" });
  });
});

describe("SwarmCoordinator ending", () => {
  it("cancels a subtask and ends the node only through finish", async () => {
    const test = harness({});
    test.coordinator.assign({
      instruction: "a",
      workerId: null,
      scope: [],
      taskId: null,
    });
    await settle();
    expect(test.coordinator.cancel("T1")).toEqual({ status: "cancelled" });
    await settle();
    expect(test.coordinator.view().tasks[0].status).toBe("cancelled");
    expect(test.coordinator.view().outcome).toBe("running");
    expect(
      test.coordinator.finish({ status: "succeeded", summary: "fine" }),
    ).toEqual({
      status: "finished",
    });
    await expect(test.coordinator.finished).resolves.toEqual({
      status: "succeeded",
      summary: "fine",
    });
    expect(
      test.coordinator.finish({ status: "failed", summary: "x" }),
    ).toMatchObject({
      code: "swarm_finished",
    });
  });
});

describe("SwarmCoordinator resuming and TODOs", () => {
  it("resumes with finished subtasks kept and running ones back on the board without locks", async () => {
    const first = harness({});
    first.coordinator.assign({
      instruction: "a",
      workerId: null,
      scope: ["a"],
      taskId: null,
    });
    first.coordinator.assign({
      instruction: "b",
      workerId: null,
      scope: ["b"],
      taskId: null,
    });
    await settle();
    first.coordinator.lock("H2", "x");
    turnOf(first, "H1").end(done("a done"));
    await settle();
    const stored = first.coordinator.stored();
    expect(stored.locks.map((lock) => lock.path)).toEqual(["x"]);
    const resumed = harness({ stored });
    const view = resumed.coordinator.view();
    expect(view.tasks.map((task) => task.status)).toEqual(["done", "queued"]);
    expect(view.workers.every((worker) => worker.locks.length === 0)).toBe(
      true,
    );
    expect(resumed.coordinator.listLocks()).toEqual([]);
    expect(
      resumed.coordinator.assign({
        instruction: "",
        workerId: null,
        scope: [],
        taskId: "T1",
      }),
    ).toMatchObject({ code: "swarm_task_done" });
    expect(resumed.opened).toEqual([]);
  });
});

describe("SwarmCoordinator TODOs and leases", () => {
  it("shows the TODO list of every helper and ends all sessions on shutdown", async () => {
    const test = harness({});
    test.coordinator.assign({
      instruction: "a",
      workerId: null,
      scope: [],
      taskId: null,
    });
    await settle();
    test.events
      .get("H1")
      ?.todos([{ id: "1", text: "read", status: "active", updatedAt: "t" }]);
    test.coordinator.showMainTodos([
      { id: "1", text: "plan", status: "done", updatedAt: "t" },
    ]);
    const view = test.coordinator.view();
    expect(view.workers[0].todos).toHaveLength(1);
    expect(view.main.todos[0].text).toBe("plan");
    await test.coordinator.shutdown();
    expect(test.closed).toEqual(["H1"]);
    expect(test.coordinator.view().tasks[0].status).toBe("cancelled");
    expect(test.saved.length).toBeGreaterThan(0);
  });

  it("lets locks run out when their owner stops renewing them", async () => {
    let now = 0;
    const test = harness({ now: () => now });
    test.coordinator.assign({
      instruction: "a",
      workerId: null,
      scope: [],
      taskId: null,
    });
    await settle();
    test.coordinator.lock("H1", "x");
    now = 100_000;
    test.coordinator.renewLeases();
    now = 200_000;
    expect(test.coordinator.listLocks()).toHaveLength(1);
    now = 400_000;
    expect(test.coordinator.listLocks()).toEqual([]);
  });
});
