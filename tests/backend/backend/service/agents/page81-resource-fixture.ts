import { vi } from "vitest";

import { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";

import type {
  PlanSession,
  PlanSessionClosed,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type {
  AcpResourceOptions,
  AcpResourceOwner,
  AcpResourceRecord,
} from "@/definition/AcpResource";

/** A manually settled boundary, without timers, subprocesses or network. */
export function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (result: T) => void;
} {
  let complete: (result: T) => void = () => {
    throw new Error("Uninitialized boundary");
  };
  const promise = new Promise<T>((resolve) => {
    complete = resolve;
  });
  return { promise, resolve: complete };
}

/** Synthetic ownership, intentionally shared across providers and independent runs. */
export function owner(
  instanceId: string,
  provider: AcpResourceOwner["provider"] = "codex_cli",
): AcpResourceOwner {
  return {
    instanceId,
    userId: "owner",
    provider,
    runId: `run-${instanceId}`,
    stepId: "step",
  };
}

/** A successful native turn, independent of plan acceptance. */
export function completedTurn(): PlanSessionTurn {
  return {
    output: "result",
    sessionId: "native",
    failure: null,
    errorCode: null,
    endedAt: new Date().toISOString(),
    permissionDenials: 0,
    effective: {},
    events: [],
  };
}

/** A closeout that can independently model remaining descendants. */
export function closed(isConfirmed = true): PlanSessionClosed {
  return {
    exit: { code: 0, signal: null },
    endedAt: new Date().toISOString(),
    leftovers: isConfirmed ? 0 : 1,
    isConfirmed,
  };
}

/** In-process native adapter with observable turn reuse and closeout. */
export function nativeSession(): PlanSession & {
  readonly next: ReturnType<typeof vi.fn<NonNullable<PlanSession["next"]>>>;
  readonly close: ReturnType<typeof vi.fn<PlanSession["close"]>>;
} {
  return {
    turn: Promise.resolve(completedTurn()),
    next: vi.fn(async () => completedTurn()),
    close: vi.fn(async () => closed()),
  };
}

/** Memory and durable storage are controlled boundaries; no real database is opened. */
export function resourceWorld(options: Partial<AcpResourceOptions> = {}): {
  readonly scheduler: AcpResourceScheduler;
  readonly records: Map<string, AcpResourceRecord>;
  readonly store: {
    readonly list: ReturnType<
      typeof vi.fn<() => Promise<readonly AcpResourceRecord[]>>
    >;
    readonly save: ReturnType<
      typeof vi.fn<(record: AcpResourceRecord) => Promise<void>>
    >;
    readonly remove: ReturnType<
      typeof vi.fn<(instanceId: string) => Promise<void>>
    >;
  };
  readonly memory: ReturnType<typeof vi.fn<() => Promise<number | null>>>;
  readonly cleanup: ReturnType<
    typeof vi.fn<(instanceId: string) => Promise<{ remaining: number }>>
  >;
} {
  const records = new Map<string, AcpResourceRecord>();
  const store = {
    list: vi.fn(async () => [...records.values()]),
    save: vi.fn(async (record: AcpResourceRecord) => {
      records.set(record.instanceId, record);
    }),
    remove: vi.fn(async (instanceId: string) => {
      records.delete(instanceId);
    }),
  };
  const memory = vi.fn<() => Promise<number | null>>(async () => 4096);
  const cleanup = vi.fn<(instanceId: string) => Promise<{ remaining: number }>>(
    async () => ({ remaining: 0 }),
  );
  const scheduler = new AcpResourceScheduler({
    store,
    options,
    memory,
    cleanup,
  });
  return { scheduler, records, store, memory, cleanup };
}
