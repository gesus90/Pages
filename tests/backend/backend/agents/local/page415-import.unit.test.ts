import { createHash } from "node:crypto";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { readLocalCompletion } from "@/backend/agents/local/LocalSessionCompletion";
import { LocalSessionImport } from "@/backend/agents/local/LocalSessionImport";
import { LocalSessionJournal } from "@/backend/agents/local/LocalSessionJournal";
import { LocalSessionRepository } from "@/backend/database/repositories/agent/LocalSessionRepository";
import { AgentSessionRepository } from "@/backend/database/repositories/agent/AgentSessionRepository";
import { AgentPayloadFileStore } from "@/backend/storage/AgentPayloadFileStore";
import { journalPayloadPath } from "@/backend/storage/LocalJournalCompaction";

import { journalFiles as files } from "./page415-files";
import { stub } from "./local-sessions-fixture";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { LocalSessionEntry } from "@/backend/database/repositories/agent/LocalSessionRepository";
import type { AgentSessionAttemptRecord } from "@/backend/service/agents/sessions/AgentSessionStore";
import type { LocalSessionMutation } from "@/backend/agents/local/LocalSessionContracts";

vi.mock("node:fs/promises", async () =>
  (await import("./page415-files")).journalFiles.module(),
);
vi.mock(import("@/backend/logging/Logger"), async (original) => ({
  ...(await original()),
  logCaughtError: vi.fn(),
}));

const ROOT = "/synthetic/page415-import";
const INSTANCE = "44444444-4444-4444-8444-444444444444";
const RUN = "22222222-2222-4222-8222-222222222222";
const ATTEMPT = "11111111-1111-4111-8111-111111111111";
const TURN = "33333333-3333-4333-8333-333333333333";
const DIRECTORY = `${ROOT}/local-sessions/${INSTANCE}`;
const stores: AgentPayloadFileStore[] = [];

beforeEach(() => files.reset());
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
});

function turn(output: string): LocalSessionMutation {
  return {
    kind: "turn",
    attemptId: ATTEMPT,
    turnId: TURN,
    result: {
      output,
      sessionId: "native",
      failure: null,
      errorCode: null,
      endedAt: "now",
      permissionDenials: 0,
      effective: {},
      events: [],
    },
  };
}

function setup(): {
  database: Database;
  owners: LocalSessionRepository;
  store: AgentPayloadFileStore;
  journal: LocalSessionJournal;
  importer: LocalSessionImport;
  savedResult: () => string | null;
} {
  const store = new AgentPayloadFileStore(ROOT);
  stores.push(store);
  let result: string | null = null;
  const query = vi.fn<DatabaseTransaction["query"]>(async (sql) => {
    if (sql.includes("agent_payload_garbage")) return [];
    if (sql.includes("AS storage_name"))
      return result === null ? [] : [[journalPayloadPath(result)]];
    if (sql.includes("SELECT payload_file"))
      return result === null ? [] : [[result]];
    if (sql.includes("SELECT plan_id")) return [["plan"]];
    if (sql.includes("FOR UPDATE") || sql.includes("RETURNING instance_id"))
      return [[INSTANCE]];
    throw new Error(`Unexpected test query: ${sql}`);
  });
  const execute = vi.fn<DatabaseTransaction["execute"]>(
    async (sql, parameters) => {
      if (
        sql.includes("agent_local_session_results") &&
        typeof parameters?.payload_file === "string"
      )
        result = parameters.payload_file;
    },
  );
  const transaction: DatabaseTransaction = {
    agentFiles: store,
    query,
    execute,
  };
  const database = stub<Database>({
    ...transaction,
    transaction: async <T>(
      work: (current: DatabaseTransaction) => Promise<T>,
    ) => work(transaction),
  });
  const owners = new LocalSessionRepository(database);
  const entry: LocalSessionEntry = {
    instanceId: INSTANCE,
    instanceKey: "key",
    runId: RUN,
    stepId: "step",
    attemptId: ATTEMPT,
    manifestDigest: "digest",
    proof: null,
    acknowledgedSequence: 0,
    acknowledgedDigest: "",
    checkpointFile: null,
    releasedAt: "released",
  };
  const journal = new LocalSessionJournal(DIRECTORY, "plan", store, () =>
    store.scheduleJournalGarbage(database),
  );
  const importer = new LocalSessionImport({
    database,
    owners,
    entry,
    journal,
    token: "importer",
  });
  vi.spyOn(AgentSessionRepository.prototype, "findAttempt").mockResolvedValue(
    stub<AgentSessionAttemptRecord>({
      key: { runId: RUN },
      instanceId: INSTANCE,
    }),
  );
  return {
    database,
    owners,
    store,
    journal,
    importer,
    savedResult: () => result,
  };
}

it.each(["inline", "large", "legacy"])(
  "imports %s results and retains their database payload after compaction",
  async (format) => {
    const { database, owners, store, journal, importer, savedResult } = setup();
    const mutation = turn(
      format === "large" ? "output".repeat(1000) : "finished",
    );
    let legacyPayload: string | null = null;
    if (format === "legacy") {
      legacyPayload = await store.write("plan", JSON.stringify(mutation));
      const digest = createHash("sha256")
        .update(JSON.stringify([1, "", legacyPayload]))
        .digest("hex");
      files.seed(
        `${DIRECTORY}/journal/0000000000000001.json`,
        JSON.stringify({
          sequence: 1,
          previousDigest: "",
          payload: legacyPayload,
          digest,
        }),
      );
    }
    await journal.initialize();
    const record =
      format === "legacy"
        ? (await journal.page(0))[0]
        : await journal.append(mutation);
    if (record === undefined) throw new Error("Missing test journal record");
    expect(await importer.take(record)).toEqual(mutation);
    expect(importer.acknowledgement).toEqual({
      sequence: 1,
      digest: record.digest,
    });
    const result = savedResult();
    expect(result).not.toBeNull();
    if (format === "legacy") expect(result).toBe(legacyPayload);
    if ("payload" in record) expect(result).toBe(record.payload);
    await journal.acknowledge(1, record.digest);
    await store.collectGarbage(database);
    await store.settleGarbage();
    expect(
      files.entries.has(`${DIRECTORY}/journal/0000000000000001.json`),
    ).toBe(false);
    expect(await readLocalCompletion(owners, database, INSTANCE, TURN)).toEqual(
      mutation,
    );
    const restarted = new LocalSessionJournal(DIRECTORY, "plan", store);
    await restarted.initialize();
    const next = await restarted.append({
      kind: "identified",
      sessionId: "after restart",
    });
    expect(next).toMatchObject({ sequence: 2, previousDigest: record.digest });
    expect(await importer.take(next)).toEqual({
      kind: "identified",
      sessionId: "after restart",
    });
  },
);
