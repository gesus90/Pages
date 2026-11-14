import { strict as assert } from "node:assert";

import { AcpResourceRepository } from "@/backend/database/repositories/agent/AcpResourceRepository";
import { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";

import { call, prepare } from "./world";

import type {
  PlanSession,
  PlanSessionClosed,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { AcpStartLifecycle } from "@/backend/service/agents/resources/AcpStartLifecycle";
import type { AcpNamespaceOwner } from "@/definition/AcpResource";
import type { RepositoryFlow, RepositoryWorld } from "./world";

/** What the check reads from one row of `acp_resource_leases`. */
interface LeaseRow {
  readonly state: string;
  readonly lifecycle: string | null;
  readonly workerUnit: string | null;
  readonly hasIdentity: boolean;
}

const IDENTITY: AcpNamespaceOwner = {
  pid: 4242,
  uid: 1000,
  start: 77,
  boot: "01234567-89ab-4def-8123-456789abcdef",
  unit: "pages-acp-chat-pg-0a1b2c3d.service",
};

function unitOf(instanceId: string): string {
  return `pages-acp-${instanceId}-0a1b2c3d.service`;
}

function turn(): PlanSessionTurn {
  return {
    output: "answer",
    sessionId: "native",
    failure: null,
    errorCode: null,
    endedAt: new Date().toISOString(),
    permissionDenials: 0,
    effective: {},
    events: [],
  };
}

function closeout(isConfirmed: boolean): PlanSessionClosed {
  return {
    exit: { code: 0, signal: null },
    endedAt: new Date().toISOString(),
    leftovers: isConfirmed ? 0 : 1,
    isConfirmed,
  };
}

/** A chat worker whose closeout cannot confirm its end on its own, and whose process can be killed. */
function chatWorker(isConfirmed: boolean): PlanSession & {
  readonly kill: () => void;
} {
  let kill = (): void => undefined;
  const terminated = new Promise<void>((resolve) => {
    kill = resolve;
  });
  return {
    turn: Promise.resolve(turn()),
    terminated,
    next: async () => turn(),
    close: async () => closeout(isConfirmed),
    kill: () => kill(),
  };
}

function nextInput(): Parameters<NonNullable<PlanSession["next"]>>[0] {
  const input: unknown = { prompt: "round", directory: "/workspace" };
  return input as Parameters<NonNullable<PlanSession["next"]>>[0];
}

async function readLeases(
  world: RepositoryWorld,
): Promise<ReadonlyMap<string, LeaseRow>> {
  const rows = await world.database.query(`
    SELECT
        instance_id,
        state,
        lifecycle,
        worker_unit,
        namespace_identity
    FROM acp_resource_leases
    ORDER BY instance_id;
  `);
  return new Map(
    rows.map((row) => [
      String(row[0]),
      {
        state: String(row[1]),
        lifecycle: row[2] === null ? null : String(row[2]),
        workerUnit: row[3] === null ? null : String(row[3]),
        hasIdentity: row[4] !== null,
      },
    ]),
  );
}

async function waitForRelease(
  world: RepositoryWorld,
  instanceId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!(await readLeases(world)).has(instanceId)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`The lease ${instanceId} was not released.`);
}

function chatStart(
  scheduler: AcpResourceScheduler,
  instanceId: string,
  worker: PlanSession,
  isIdentified: boolean,
): (signal: AbortSignal, lifecycle: AcpStartLifecycle) => Promise<PlanSession> {
  return async (signal, lifecycle) => {
    lifecycle.trackSpawn();
    await lifecycle.beforeSpawn(unitOf(instanceId));
    if (isIdentified) await scheduler.registerNamespace(instanceId, IDENTITY);
    return worker;
  };
}

function scheduler(
  world: RepositoryWorld,
  remainingUnits: { value: number },
): AcpResourceScheduler {
  return new AcpResourceScheduler({
    store: new AcpResourceRepository(world.database),
    options: { maxConcurrentAcpSessions: 4 },
    memory: async () => 4096,
    cleanup: async () => {
      throw new Error("Process ownership is unverified");
    },
    settleUnits: async () => remainingUnits.value,
    hasRunningUnit: async () => remainingUnits.value > 0,
  });
}

function owner(instanceId: string): {
  readonly instanceId: string;
  readonly userId: string;
  readonly provider: "claude_code";
  readonly runId: null;
  readonly stepId: null;
} {
  return {
    instanceId,
    userId: "user-admin",
    provider: "claude_code",
    runId: null,
    stepId: null,
  };
}

/** Ten rounds through one chat session keep one row, which moves to `process` and is deleted at the end. */
async function checkReusedSession(world: RepositoryWorld): Promise<unknown> {
  const units = { value: 0 };
  const resources = scheduler(world, units);
  await resources.recover();
  const session = await resources.open(
    owner("chat-pg"),
    new AbortController().signal,
    chatStart(resources, "chat-pg", chatWorker(true), true),
  );
  await session.turn;
  for (let round = 1; round < 10; round += 1)
    await session.next?.(nextInput(), new AbortController().signal, {
      started: () => undefined,
      identified: () => undefined,
    });
  const held = await readLeases(world);
  assert.deepEqual([...held.keys()], ["chat-pg"]);
  assert.deepEqual(held.get("chat-pg"), {
    state: "idle",
    lifecycle: "process",
    workerUnit: unitOf("chat-pg"),
    hasIdentity: true,
  });
  await session.close();
  assert.equal((await readLeases(world)).size, 0);
  await resources.shutdown();
  return { rounds: 10, rowsWhileHeld: held.size };
}

/** A killed worker and one that died before its identity release their rows once their unit is inactive. */
async function checkEndedWorkers(world: RepositoryWorld): Promise<unknown> {
  const units = { value: 0 };
  const resources = scheduler(world, units);
  await resources.recover();
  const killed = chatWorker(false);
  await resources.open(
    owner("chat-killed"),
    new AbortController().signal,
    chatStart(resources, "chat-killed", killed, true),
  );
  const early = chatWorker(false);
  await resources.open(
    owner("chat-early"),
    new AbortController().signal,
    chatStart(resources, "chat-early", early, false),
  );
  killed.kill();
  early.kill();
  await waitForRelease(world, "chat-killed");
  await waitForRelease(world, "chat-early");
  await resources.shutdown();
  return { released: ["chat-killed", "chat-early"] };
}

/** A worker whose unit still runs keeps its row; once the unit is gone the next check releases it. */
async function checkLivingUnit(world: RepositoryWorld): Promise<unknown> {
  const units = { value: 1 };
  const resources = scheduler(world, units);
  await resources.recover();
  const session = await resources.open(
    owner("chat-alive"),
    new AbortController().signal,
    chatStart(resources, "chat-alive", chatWorker(false), false),
  );
  await session.close();
  const kept = (await readLeases(world)).get("chat-alive");
  assert.deepEqual(kept, {
    state: "cleanup_failed",
    lifecycle: "spawning",
    workerUnit: unitOf("chat-alive"),
    hasIdentity: false,
  });
  units.value = 0;
  assert.equal(await resources.reconcile(), 0);
  assert.equal((await readLeases(world)).size, 0);
  await resources.shutdown();
  return { kept };
}

/** A hundred rounds leave no row in `cleanup_failed` and `spawning`. */
async function checkHundredRounds(world: RepositoryWorld): Promise<unknown> {
  const resources = scheduler(world, { value: 0 });
  await resources.recover();
  for (let round = 0; round < 100; round += 1) {
    const instanceId = `chat-round-${round}`;
    const session = await resources.open(
      owner(instanceId),
      new AbortController().signal,
      chatStart(resources, instanceId, chatWorker(false), round % 2 === 0),
    );
    await session.turn;
    await session.close();
  }
  const [count] = await world.database.query(`
    SELECT COUNT(*)
    FROM acp_resource_leases
    WHERE state = 'cleanup_failed'
        AND lifecycle = 'spawning';
  `);
  assert.equal(Number(count?.[0]), 0);
  assert.equal((await readLeases(world)).size, 0);
  await resources.shutdown();
  return { rounds: 100, deadRows: 0 };
}

/** A row without identity whose unit is gone is released when the service starts. */
async function checkStartup(world: RepositoryWorld): Promise<unknown> {
  await new AcpResourceRepository(world.database).save({
    ...owner("chat-restart"),
    state: "cleanup_failed",
    since: new Date().toISOString(),
    lifecycle: "spawning",
    workerUnit: unitOf("chat-restart"),
    namespace: null,
  });
  const resources = scheduler(world, { value: 0 });
  await resources.recover();
  assert.equal((await readLeases(world)).size, 0);
  await resources.shutdown();
  return { released: "chat-restart" };
}

/** The reservations of chat sessions (PAGE-335) in real rows of `acp_resource_leases`. */
export const ACP_CHAT_LEASE_FLOW: RepositoryFlow = {
  title: "acp chat leases",
  steps: [
    prepare("DELETE FROM acp_resource_leases;"),
    call("AcpResourceScheduler.chatSessionReuse", checkReusedSession),
    call("AcpResourceScheduler.chatSessionEnd", checkEndedWorkers),
    call("AcpResourceScheduler.chatSessionUnitAlive", checkLivingUnit),
    call("AcpResourceScheduler.chatSessionRounds", checkHundredRounds),
    call("AcpResourceScheduler.chatSessionStartup", checkStartup),
    prepare("DELETE FROM acp_resource_leases;"),
  ],
};
