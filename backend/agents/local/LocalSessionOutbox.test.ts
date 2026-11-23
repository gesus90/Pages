import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalSessionJournal } from "@/backend/agents/local/LocalSessionJournal";
import { LocalSessionOutbox } from "@/backend/agents/local/LocalSessionOutbox";
import { Database } from "@/backend/database/Database";

import type { MockInstance } from "vitest";
import type {
  AgentSessionAttemptRecord,
  NewAgentSessionEvent,
} from "@/backend/service/agents/sessions/AgentSessionStore";
import type { StoredOpenCodeUsage } from "@/backend/service/agents/sessions/OpenCodeUsage";
import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";

const ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-01-01T00:00:00.000Z";

const attempt: AgentSessionAttemptRecord = {
  key: { planId: ID, runId: ID, stepId: "step", attemptId: ID },
  userId: ID,
  provider: "codex_cli",
  instanceId: ID,
  groupId: null,
  state: "running",
  context: {
    contextUsed: null,
    contextLimit: null,
    percent: null,
    source: null,
    reportedAt: null,
  },
  confirmedModel: { value: null, source: null, reportedAt: null },
  confirmedReasoning: { value: null, source: null, reportedAt: null },
  workspace: null,
  updatedAt: NOW,
};
const events: readonly NewAgentSessionEvent[] = [
  {
    turn: 1,
    kind: "progress",
    text: "working",
    isTruncated: false,
    createdAt: NOW,
    dedupeKey: null,
  },
];
const usage: AgentSessionTurnUsage = {
  attemptId: ID,
  turn: 1,
  provider: "codex_cli",
  model: null,
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  totalTokens: 3,
  inputIncludesCache: null,
  isPartial: false,
  reportedAt: NOW,
};
const openCodeUsage: StoredOpenCodeUsage = {
  id: "message",
  sessionId: "session",
  attemptId: ID,
  turn: 1,
  model: null,
  inputTokens: 1,
  outputTokens: 2,
  reasoningTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  costUsd: null,
  price: { amount: null, state: "unknown", priceAsOf: null },
  reportedAt: NOW,
};

function createOutbox(): {
  readonly outbox: LocalSessionOutbox;
  readonly append: MockInstance<LocalSessionJournal["append"]>;
} {
  const append = spyAppend();
  return {
    outbox: new LocalSessionOutbox(
      Database.prototype,
      LocalSessionJournal.prototype,
    ),
    append,
  };
}

function spyAppend(): MockInstance<LocalSessionJournal["append"]> {
  return vi.spyOn(LocalSessionJournal.prototype, "append").mockResolvedValue({
    sequence: 1,
    previousDigest: "",
    digest: "0".repeat(64),
    payload: "{}",
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LocalSessionOutbox", () => {
  it("journals an attempt instead of writing it", async () => {
    const { outbox, append } = createOutbox();
    await outbox.saveAttempt(attempt);
    expect(append).toHaveBeenCalledWith({ kind: "attempt", attempt });
  });

  it("journals events and publishes none itself", async () => {
    const { outbox, append } = createOutbox();
    await expect(outbox.appendEvents(ID, events, 50)).resolves.toEqual([]);
    expect(append).toHaveBeenCalledWith({
      kind: "events",
      attemptId: ID,
      events: [...events],
      retain: 50,
    });
  });

  it("journals turn usage", async () => {
    const { outbox, append } = createOutbox();
    await outbox.saveTurnUsage(usage);
    expect(append).toHaveBeenCalledWith({ kind: "usage", usage });
  });

  it("journals OpenCode message usage", async () => {
    const { outbox, append } = createOutbox();
    await outbox.saveOpenCodeMessage(openCodeUsage);
    expect(append).toHaveBeenCalledWith({
      kind: "opencode_usage",
      usage: openCodeUsage,
    });
  });
});
