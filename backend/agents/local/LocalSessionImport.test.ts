import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSessionRepository } from "@/backend/database/repositories/agent/AgentSessionRepository";
import { LocalSessionImport } from "@/backend/agents/local/LocalSessionImport";

import type { Database } from "@/backend/database/Database";
import type { LocalSessionRepository } from "@/backend/database/repositories/agent/LocalSessionRepository";
import type { LocalSessionEntry } from "@/backend/database/repositories/agent/LocalSessionRepository";
import type {
  LocalJournalRecord,
  LocalSessionMutation,
} from "@/backend/agents/local/LocalSessionContracts";
import type { LocalSessionJournal } from "@/backend/agents/local/LocalSessionJournal";

const mocks = vi.hoisted(() => ({
  files: { read: vi.fn(), write: vi.fn() },
  sessions: {
    saveAttempt: vi.fn(),
    appendEvents: vi.fn(),
    saveTurnUsage: vi.fn(),
    saveOpenCodeMessage: vi.fn(),
    findAttempt: vi.fn(),
  },
  owners: {
    requireImporter: vi.fn(),
    saveResult: vi.fn(),
    acknowledge: vi.fn(),
  },
  accountClaudeUsage: vi.fn(),
}));

vi.mock("@/backend/storage/AgentPayloadFileStore", () => ({
  requireAgentFiles: () => mocks.files,
}));
vi.mock("@/backend/service/agents/sessions/ClaudeUsageAccounting", () => ({
  accountClaudeUsage: mocks.accountClaudeUsage,
}));
vi.mock("@/backend/database/repositories/agent/AgentSessionRepository", () => ({
  AgentSessionRepository: vi.fn(function () {
    return mocks.sessions;
  }),
}));
vi.mock("@/backend/database/repositories/agent/LocalSessionRepository", () => ({
  LocalSessionRepository: vi.fn(function () {
    return mocks.owners;
  }),
}));

const RUN = "11111111-1111-4111-8111-111111111111";
const INSTANCE = "22222222-2222-4222-8222-222222222222";
const ATTEMPT = "33333333-3333-4333-8333-333333333333";
const TOKEN = "importer-token";
const DIGEST = "d".repeat(64);

/** Typed doubles for repository and mutation shapes that the import only forwards. */
function double<Contract>(value: object): Contract {
  return value as unknown as Contract;
}

function createEntry(
  overrides: Partial<LocalSessionEntry> = {},
): LocalSessionEntry {
  return double<LocalSessionEntry>({
    instanceKey: "key",
    instanceId: INSTANCE,
    runId: RUN,
    acknowledgedSequence: 4,
    acknowledgedDigest: "previous",
    checkpointFile: null,
    ...overrides,
  });
}

function record(content = "{}"): LocalJournalRecord {
  return { sequence: 5, previousDigest: "previous", digest: DIGEST, content };
}

const body = vi.fn();
const query = vi.fn();
const list = vi.fn();
const transaction = { id: "transaction" };
const database = double<Database>({
  query,
  transaction: async (work: (value: unknown) => Promise<void>) =>
    work(transaction),
});

function create(entry = createEntry()): LocalSessionImport {
  return new LocalSessionImport({
    database,
    owners: double<LocalSessionRepository>({ list }),
    entry,
    journal: double<LocalSessionJournal>({ body }),
    token: TOKEN,
  });
}

function mutation(value: object): LocalSessionMutation {
  return double<LocalSessionMutation>(value);
}

beforeEach(() => {
  query.mockResolvedValue([["plan"]]);
  mocks.files.write.mockResolvedValue("file");
  mocks.sessions.findAttempt.mockResolvedValue({
    key: { runId: RUN },
    instanceId: INSTANCE,
  });
});

describe("restore, refresh and cursor", () => {
  it("restores nothing without a checkpoint file", async () => {
    await expect(create().restore()).resolves.toEqual([]);
  });

  it("restores the checkpoint written by an earlier run", async () => {
    mocks.files.read.mockResolvedValue(
      JSON.stringify([{ kind: "identified", sessionId: "s" }]),
    );
    const restored = await create(
      createEntry({ checkpointFile: "cp" }),
    ).restore();
    expect(restored).toEqual([{ kind: "identified", sessionId: "s" }]);
    expect(mocks.files.read).toHaveBeenCalledWith("cp");
  });

  it("rejects an invalid checkpoint", async () => {
    mocks.files.read.mockResolvedValue(JSON.stringify([{ kind: "nope" }]));
    await expect(
      create(createEntry({ checkpointFile: "cp" })).restore(),
    ).rejects.toThrow();
  });

  it("refreshes from the committed metadata", async () => {
    const subject = create();
    list.mockResolvedValue([
      createEntry({ instanceId: "another" }),
      createEntry({ acknowledgedSequence: 9, acknowledgedDigest: "newer" }),
    ]);
    await expect(subject.refresh()).resolves.toEqual([]);
    expect(subject.cursor).toBe(9);
    expect(subject.acknowledgement).toEqual({ sequence: 9, digest: "newer" });
    expect(list).toHaveBeenCalledWith("key");
  });

  it("fails when the owner metadata disappeared", async () => {
    list.mockResolvedValue([]);
    await expect(create().refresh()).rejects.toThrow("disappeared");
  });
});

describe("take", () => {
  it.each([
    { label: "sequence", wrong: { ...record(), sequence: 6 } },
    { label: "digest", wrong: { ...record(), previousDigest: "other" } },
  ])("rejects a record with a wrong $label", async ({ wrong }) => {
    await expect(create().take(wrong)).rejects.toThrow("sequence mismatch");
  });

  it("rejects a run without a plan", async () => {
    body.mockResolvedValue(mutation({ kind: "identified", sessionId: "s" }));
    query.mockResolvedValueOnce([]);
    await expect(create().take(record())).rejects.toThrow("run is missing");
    query.mockResolvedValueOnce([[5]]);
    await expect(create().take(record())).rejects.toThrow("run is missing");
  });

  it("keeps one milestone per kind in the checkpoint and advances the cursor", async () => {
    const subject = create();
    const first = mutation({ kind: "identified", sessionId: "one" });
    body.mockResolvedValue(first);
    await expect(subject.take(record())).resolves.toBe(first);
    expect(mocks.files.write).toHaveBeenLastCalledWith(
      "plan",
      JSON.stringify([first]),
    );
    expect(subject.cursor).toBe(5);
    expect(subject.acknowledgement).toEqual({ sequence: 5, digest: DIGEST });
    expect(mocks.owners.requireImporter).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: INSTANCE }),
      TOKEN,
    );
    expect(mocks.owners.acknowledge).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: INSTANCE }),
      {
        sequence: 5,
        digest: DIGEST,
        checkpointFile: "file",
        token: TOKEN,
      },
    );

    const second = mutation({ kind: "identified", sessionId: "two" });
    body.mockResolvedValue(second);
    await subject.take({
      ...record(),
      sequence: 6,
      previousDigest: DIGEST,
    });
    expect(mocks.files.write).toHaveBeenLastCalledWith(
      "plan",
      JSON.stringify([second]),
    );
  });

  it("does not checkpoint transient mutations", async () => {
    body.mockResolvedValue(mutation({ kind: "frame" }));
    await create().take(record());
    expect(mocks.files.write).toHaveBeenCalledWith("plan", "[]");
  });

  it("stores the result of a turn from a payload reference or inline content", async () => {
    const turn = mutation({ kind: "turn", attemptId: ATTEMPT, turnId: "turn" });
    body.mockResolvedValue(turn);
    await create().take({
      sequence: 5,
      previousDigest: "previous",
      digest: DIGEST,
      payload: "payload-file",
    });
    expect(mocks.owners.saveResult).toHaveBeenLastCalledWith(
      INSTANCE,
      "turn",
      "payload-file",
    );
    mocks.files.write
      .mockResolvedValueOnce("checkpoint")
      .mockResolvedValueOnce("content-file");
    await create().take(record("inline"));
    expect(mocks.files.write).toHaveBeenCalledWith("plan", "inline");
    expect(mocks.owners.saveResult).toHaveBeenLastCalledWith(
      INSTANCE,
      "turn",
      "content-file",
    );
    expect(mocks.sessions.findAttempt).toHaveBeenCalledWith(ATTEMPT);
  });

  it("serializes concurrent imports", async () => {
    body.mockResolvedValue(mutation({ kind: "frame" }));
    const subject = create();
    const first = subject.take(record());
    const second = subject.take({
      ...record(),
      sequence: 6,
      previousDigest: DIGEST,
    });
    await Promise.all([first, second]);
    expect(subject.cursor).toBe(6);
  });
});

describe("persisted mutations", () => {
  const attempt = (runId: string, instanceId: string): LocalSessionMutation =>
    mutation({ kind: "attempt", attempt: { key: { runId }, instanceId } });

  it("saves an attempt of this binding", async () => {
    const value = attempt(RUN, INSTANCE);
    body.mockResolvedValue(value);
    await create().take(record());
    expect(mocks.sessions.saveAttempt).toHaveBeenCalledOnce();
  });

  it.each([
    { label: "run", value: attempt("other", INSTANCE) },
    { label: "instance", value: attempt(RUN, "other") },
  ])("rejects an attempt of a foreign $label", async ({ value }) => {
    body.mockResolvedValue(value);
    await expect(create().take(record())).rejects.toThrow("Foreign attempt");
    expect(mocks.sessions.saveAttempt).not.toHaveBeenCalled();
  });

  it("appends events with scoped deduplication keys", async () => {
    body.mockResolvedValue(
      mutation({
        kind: "events",
        attemptId: ATTEMPT,
        retain: 3,
        events: [{ dedupeKey: null }, { dedupeKey: "own" }],
      }),
    );
    await create().take(record());
    expect(mocks.sessions.appendEvents).toHaveBeenCalledWith(
      ATTEMPT,
      [
        { dedupeKey: `local:${INSTANCE}:5:0` },
        { dedupeKey: `local:${INSTANCE}:own` },
      ],
      3,
    );
  });

  it("rejects an unknown or foreign attempt", async () => {
    body.mockResolvedValue(
      mutation({ kind: "events", attemptId: ATTEMPT, retain: 0, events: [] }),
    );
    mocks.sessions.findAttempt.mockResolvedValueOnce(null);
    await expect(create().take(record())).rejects.toThrow("Unknown local");
    mocks.sessions.findAttempt.mockResolvedValueOnce({
      key: { runId: "other" },
      instanceId: INSTANCE,
    });
    await expect(create().take(record())).rejects.toThrow("Foreign attempt");
  });

  it("saves turn usage of other providers", async () => {
    const usage = { attemptId: ATTEMPT, provider: "codex_cli" };
    body.mockResolvedValue(mutation({ kind: "usage", usage }));
    await create().take(record());
    expect(mocks.sessions.saveTurnUsage).toHaveBeenCalledWith(usage);
    expect(mocks.accountClaudeUsage).not.toHaveBeenCalled();
  });

  it("accounts Claude usage instead of saving turn usage", async () => {
    const usage = { attemptId: ATTEMPT, provider: "claude_code" };
    body.mockResolvedValue(mutation({ kind: "usage", usage }));
    await create().take(record());
    expect(mocks.accountClaudeUsage).toHaveBeenCalledOnce();
    expect(mocks.accountClaudeUsage.mock.calls[0]?.[1]).toBe(usage);
    expect(mocks.sessions.saveTurnUsage).not.toHaveBeenCalled();
  });

  it("saves OpenCode messages", async () => {
    const usage = { attemptId: ATTEMPT };
    body.mockResolvedValue(mutation({ kind: "opencode_usage", usage }));
    await create().take(record());
    expect(mocks.sessions.saveOpenCodeMessage).toHaveBeenCalledWith(usage);
  });

  it("runs a nested transaction on the open one", async () => {
    mocks.sessions.findAttempt.mockResolvedValue({
      key: { runId: RUN },
      instanceId: INSTANCE,
    });
    body.mockResolvedValue(
      mutation({
        kind: "usage",
        usage: { attemptId: ATTEMPT, provider: "claude_code" },
      }),
    );
    await create().take(record());
    const nested: unknown = mocks.accountClaudeUsage.mock.calls[0]?.[0];
    const work = vi.fn(async (value: unknown) => value);
    const result: unknown = await Reflect.get(
      Object(nested),
      "transaction",
    )(work);
    expect(result).toBeDefined();
    expect(work).toHaveBeenCalledOnce();
  });
});

it("gives the session repository the open transaction as its own", async () => {
  body.mockResolvedValue(mutation({ kind: "frame" }));
  await create().take(record());
  const executor: unknown = vi.mocked(AgentSessionRepository).mock
    .calls[0]?.[0];
  const work = vi.fn(async (value: unknown) => value);
  await expect(
    Reflect.get(Object(executor), "transaction")(work),
  ).resolves.toBe(transaction);
});
