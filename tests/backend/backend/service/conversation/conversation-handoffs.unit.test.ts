import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { logEvent } from "@/backend/logging/Logger";
import { isAgentChainPaused } from "@/backend/service/conversation/ConversationAgentChain";
import { CONVERSATION_DECISION_LIMITS } from "@/definition/ConversationDecision";
import { CONVERSATION_OBSERVER_LIMITS } from "@/definition/ConversationObserver";

import { accountsOf, handoffFixture } from "./conversation-handoff-fixture";

import type * as Logger from "@/backend/logging/Logger";
import type { HandoffFixture } from "./conversation-handoff-fixture";

vi.mock("@/backend/logging/Logger", async (original) => ({
  ...(await original<typeof Logger>()),
  logEvent: vi.fn(),
  logCaughtError: vi.fn(),
}));

const stops: (() => void)[] = [];

beforeEach(() => {
  vi.mocked(logEvent).mockClear();
});

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
});

function started(fixture: HandoffFixture): HandoffFixture {
  stops.push(fixture.service.start());
  return fixture;
}

function count(list: readonly string[], id: string): number {
  return list.filter((entry) => entry === id).length;
}

function pausedLogs(): Parameters<typeof logEvent>[0][] {
  return vi
    .mocked(logEvent)
    .mock.calls.map(([entry]) => entry)
    .filter((entry) => entry.event === "conversation.agent_reply.paused");
}

/** Scripts a chain a → b → c → a … in which each answer mentions the next agent. */
function scriptChain(fixture: HandoffFixture, answers: number): void {
  const cycle = ["a", "b", "c"];
  for (let index = 0; index < answers; index += 1) {
    const agent = cycle[index % 3] ?? "a";
    const next = cycle[(index + 1) % 3] ?? "a";
    const queue = fixture.script.get(agent) ?? [];
    queue.push(`@${next} weiter mit Schritt ${String(index + 2)}`);
    fixture.script.set(agent, queue);
  }
}

it("starts agent A again when agent B mentions it, although A answered in the round before", async () => {
  const fixture = started(handoffFixture());
  fixture.script.set("a", ["Meine erste Einschätzung."]);
  fixture.script.set("b", ["@a Siehst du das auch so?"]);
  const origin = fixture.personWrites("@a @b Bitte prüfen", ["a", "b"]);
  await fixture.service.answer(origin, fixture.memberIds);
  expect(count(fixture.started, "a")).toBe(2);
  expect(fixture.requests.at(-1)?.lastMessage).toBe(
    "@a Siehst du das auch so?",
  );
  // The second answer of A in the same round is stored, not swallowed by an idempotency key.
  expect(fixture.stored.filter((entry) => entry.senderId === "a")).toHaveLength(
    2,
  );
});

it.each(["@a Stand ist erledigt.", "@a", "Danke @a"])(
  "wakes the agent for an @ mention without question mark or request: %s",
  async (text) => {
    const fixture = started(handoffFixture());
    fixture.script.set("b", [text]);
    const origin = fixture.personWrites("@b Status", ["b"]);
    await fixture.service.answer(origin, fixture.memberIds);
    expect(fixture.started).toEqual(["b", "a"]);
  },
);

it("starts nothing for a self mention and an agent once for repeated mentions in one message", async () => {
  const fixture = started(handoffFixture());
  fixture.script.set("a", ["@a notiere ich mir. @b @b @B bitte übernehmen"]);
  const origin = fixture.personWrites("@a Plan", ["a"]);
  await fixture.service.answer(origin, fixture.memberIds);
  expect(fixture.started).toEqual(["a", "b"]);
  expect(fixture.memory.handoffs.has(`${fixture.stored[1]?.id ?? ""}|a`)).toBe(
    false,
  );
});

it("starts all 19 @ hand-overs of one round; the limit of eight does not apply to @", async () => {
  const fixture = started(handoffFixture());
  scriptChain(fixture, 20);
  const origin = fixture.personWrites("@a Bitte durchsprechen", ["a"]);
  await fixture.service.answer(origin, fixture.memberIds);
  // One answer to the person, then 19 hand-overs.
  expect(fixture.started).toHaveLength(20);
  const handoffs = fixture.memory.claims.filter(
    (claim) => claim.trigger === "handoff",
  );
  expect(handoffs).toHaveLength(19);
  expect(fixture.memory.rounds.get(origin.id)?.automaticCount).toBe(0);
});

it("limits contributions without @ to eight per round; @ hand-overs neither use nor reset these places", async () => {
  const fixture = started(handoffFixture());
  fixture.settings.current = { ...fixture.settings.current, mode: "decision" };
  vi.mocked(fixture.dependencies.decisions.decide).mockResolvedValue(
    ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((agentId) => ({
      agentId,
      trigger: "context" as const,
      reason: "Zuständig",
    })),
  );
  fixture.script.set("a", ["@i bitte ergänzen"]);
  const origin = fixture.personWrites("Wer weiß das?");
  await fixture.service.answer(origin, fixture.memberIds);
  const automatic = fixture.memory.claims.filter((claim) => claim.isAutomatic);
  expect(automatic).toHaveLength(8);
  // I was refused as the ninth contribution without @, but A's @ hands over to it.
  expect(
    fixture.memory.claims.filter((claim) => claim.agentId === "i"),
  ).toEqual([
    expect.objectContaining({ trigger: "handoff", isAutomatic: false }),
  ]);
  expect(fixture.memory.rounds.get(origin.id)?.automaticCount).toBe(8);
  expect(
    vi
      .mocked(logEvent)
      .mock.calls.some(
        ([entry]) => entry.event === "conversation.agent_reply.limit",
      ),
  ).toBe(true);
  // The count is not reset by the @ hand-over: a further contribution without @ is refused.
  expect(
    await fixture.dependencies.rounds.claim({
      originMessageId: origin.id,
      conversationId: "group",
      personId: "person",
      createdAt: "now",
      agentId: "i",
      trigger: "context",
      triggerMessageId: "another",
      requestedBy: null,
      reason: "",
      isAutomatic: true,
    }),
  ).toBe("limit");
});

it("limits decision contributions to the places left without @", async () => {
  const fixture = started(handoffFixture());
  fixture.settings.current = { ...fixture.settings.current, mode: "decision" };
  vi.mocked(fixture.dependencies.decisions.decide).mockResolvedValue(
    ["a", "b", "c"].map((agentId) => ({
      agentId,
      trigger: "context" as const,
      reason: "Zuständig",
    })),
  );
  const origin = fixture.personWrites("Frage ohne @");
  fixture.memory.rounds.set(origin.id, {
    personId: "person",
    automaticCount: 6,
  });
  for (const agentId of ["a", "b", "c", "d", "e"])
    fixture.memory.targets.set(`x-${agentId}|${agentId}`, {
      originMessageId: origin.id,
      agentId,
      triggerMessageId: `x-${agentId}`,
      trigger: "handoff",
      isAutomatic: false,
      state: "answered",
      replyMessageId: null,
    });
  await fixture.service.answer(origin, fixture.memberIds);
  expect(fixture.dependencies.decisions.decide).toHaveBeenCalledOnce();
  expect(fixture.started).toEqual(["a", "b"]);
  expect(fixture.memory.rounds.get(origin.id)?.automaticCount).toBe(8);
});

it("tells the chain pause at 19, 20 and 21 agent messages in a row", async () => {
  const users = handoffFixture().users;
  const accounts = accountsOf(users);
  for (const [agents, isPaused] of [
    [19, false],
    [20, true],
    [21, true],
  ] as const) {
    const fixture = handoffFixture();
    fixture.personWrites("Hallo");
    fixture.agentHistory(agents);
    expect(
      await isAgentChainPaused(
        fixture.dependencies.messages,
        accounts,
        "group",
      ),
    ).toBe(isPaused);
  }
  expect(CONVERSATION_DECISION_LIMITS.agentStreak).toBe(20);
});

it.each([
  { before: 17, isStarted: true },
  { before: 18, isStarted: false },
  { before: 19, isStarted: false },
])(
  "starts the hand-over after $before earlier agent messages only below the pause, otherwise stores and logs it",
  async ({ before, isStarted }) => {
    const fixture = started(handoffFixture());
    fixture.personWrites("Hallo");
    fixture.agentHistory(before);
    fixture.script.set("a", ["@b bitte übernehmen"]);
    // Sender message plus A's answer: before + 2 agent messages in a row (19, 20, 21).
    const sent = fixture.agentSends("d", "@a kannst du?", ["a"]);
    const messagesBefore = fixture.stored.length;
    await fixture.service.answer(sent, fixture.memberIds);
    expect(count(fixture.started, "b")).toBe(isStarted ? 1 : 0);
    if (isStarted) return;
    const [paused] = fixture.memory.handoffsIn("paused");
    expect(paused).toMatchObject({ agentId: "b", pauseReason: "agent_streak" });
    expect(pausedLogs()).toHaveLength(1);
    expect(pausedLogs()[0]?.metadata).toMatchObject({
      agentId: "b",
      triggerMessageId: paused?.triggerMessageId,
      reason: "agent_streak",
    });
    // Only A's answer was stored: no hint in the chat.
    expect(fixture.stored).toHaveLength(messagesBefore + 1);
    expect(fixture.stored.every((entry) => entry.notice === null)).toBe(true);
  },
);

it("starts the stored hand-overs once a person writes, each exactly once with everything since the agent's last answer", async () => {
  const fixture = started(handoffFixture());
  scriptChain(fixture, 20);
  const origin = fixture.personWrites("@a Bitte durchsprechen", ["a"]);
  await fixture.service.answer(origin, fixture.memberIds);
  expect(fixture.started).toHaveLength(20);
  const [paused] = fixture.memory.handoffsIn("paused");
  // The 20th answer is B's; its hand-over to C waits.
  expect(paused?.agentId).toBe("c");
  const chatLength = fixture.stored.length;
  const next = fixture.personWrites("Weiter, bitte.");
  await Promise.all([
    fixture.service.answer(next, fixture.memberIds),
    fixture.service.answer(next, fixture.memberIds),
  ]);
  await fixture.service.answer(next, fixture.memberIds);
  expect(fixture.started).toHaveLength(21);
  expect(fixture.started.at(-1)).toBe("c");
  expect(fixture.memory.handoffsIn("paused")).toEqual([]);
  const prompt = fixture.requests.at(-1)?.prompt ?? "";
  expect(prompt).toContain("Nachrichten seit deiner letzten Nachricht");
  expect(prompt).toContain("Weiter, bitte.");
  expect(prompt).toContain("weiter mit Schritt 21");
  expect(fixture.stored).toHaveLength(chatLength + 2);
  // A later message of a person starts nothing again.
  await fixture.service.answer(
    fixture.personWrites("Noch etwas?"),
    fixture.memberIds,
  );
  expect(fixture.started).toHaveLength(21);
});

it("starts an agent exactly once for one asking message, repeated, concurrent and redelivered after a restart", async () => {
  const fixture = started(handoffFixture());
  const origin = fixture.personWrites("@a Bitte", ["a"]);
  await Promise.all([
    fixture.service.answer(origin, fixture.memberIds),
    fixture.service.answer(origin, fixture.memberIds),
  ]);
  await fixture.service.answer(origin, fixture.memberIds);
  const restarted = fixture.restart();
  await restarted.recover(new Date());
  await restarted.answer(origin, fixture.memberIds);
  expect(fixture.started).toEqual(["a"]);
});

it("starts an @ hand-over between agents once although its answer is processed twice", async () => {
  const fixture = started(handoffFixture());
  fixture.script.set("a", ["@b übernimm"]);
  const origin = fixture.personWrites("@a Los", ["a"]);
  await fixture.service.answer(origin, fixture.memberIds);
  // The stored hand-over and the unique (trigger, agent) target refuse a second start.
  const answer = fixture.stored.find((entry) => entry.senderId === "a");
  const claim = {
    originMessageId: origin.id,
    conversationId: "group",
    personId: "person",
    createdAt: "now",
    agentId: "b",
    trigger: "handoff" as const,
    triggerMessageId: answer?.id ?? "",
    requestedBy: "a",
    reason: "",
    isAutomatic: false,
  };
  expect(
    await fixture.dependencies.rounds.claim({ ...claim, handoff: "pending" }),
  ).toBe("duplicate");
  expect(await fixture.dependencies.rounds.claim(claim)).toBe("duplicate");
  expect(fixture.started).toEqual(["a", "b"]);
});

it("keeps a hand-over stored before a crash and resumes it once a person writes after the restart", async () => {
  const fixture = started(handoffFixture());
  fixture.script.set("a", ["@b übernimm"]);
  const realClaim = vi.mocked(fixture.dependencies.rounds.claim);
  const original = realClaim.getMockImplementation();
  realClaim.mockImplementation(async (claim) => {
    if (claim.agentId === "b") throw new Error("Process died before the job");
    return original ? original(claim) : "duplicate";
  });
  const origin = fixture.personWrites("@a Los", ["a"]);
  await expect(
    fixture.service.answer(origin, fixture.memberIds),
  ).rejects.toThrow("Process died");
  expect(fixture.memory.handoffsIn("pending")).toHaveLength(1);
  realClaim.mockImplementation(async (claim) =>
    original ? original(claim) : "duplicate",
  );
  const restarted = fixture.restart();
  await restarted.recover(new Date());
  expect(fixture.memory.handoffsIn("paused")).toHaveLength(1);
  expect(pausedLogs()).toHaveLength(1);
  expect(pausedLogs()[0]?.metadata).toMatchObject({
    agentId: "b",
    reason: "restart",
  });
  const next = fixture.personWrites("Und?");
  await restarted.answer(next, fixture.memberIds);
  await restarted.answer(next, fixture.memberIds);
  expect(fixture.started).toEqual(["a", "b"]);
});

it("resumes a claimed but unprocessed hand-over after a crash once, and never restarts a running one", async () => {
  const fixture = started(handoffFixture());
  const origin = fixture.personWrites("@a Los", ["a"]);
  const trigger = fixture.agentSends("a", "@b @c übernehmt", ["b", "c"]);
  for (const [agentId, state] of [
    ["b", "queued"],
    ["c", "running"],
  ] as const) {
    fixture.memory.handoffs.set(`${trigger.id}|${agentId}`, {
      triggerMessageId: trigger.id,
      agentId,
      originMessageId: origin.id,
      conversationId: "group",
      requestedBy: "a",
      reason: "A",
      state: "done",
      pauseReason: null,
    });
    fixture.memory.targets.set(`${trigger.id}|${agentId}`, {
      originMessageId: origin.id,
      agentId,
      triggerMessageId: trigger.id,
      trigger: "handoff",
      isAutomatic: false,
      state,
      replyMessageId: null,
    });
  }
  fixture.memory.rounds.set(origin.id, {
    personId: "person",
    automaticCount: 0,
  });
  const restarted = fixture.restart();
  await restarted.recover(new Date());
  expect(fixture.started).toEqual([]);
  const next = fixture.personWrites("Hallo?");
  await restarted.answer(next, fixture.memberIds);
  await restarted.answer(next, fixture.memberIds);
  expect(fixture.started).toEqual(["b"]);
  expect(fixture.memory.targets.get(`${trigger.id}|c`)?.state).toBe(
    "interrupted",
  );
});

it("answers two messages that mention the same busy agent one after the other, both contents arriving", async () => {
  const fixture = started(handoffFixture());
  fixture.script.set("a", ["@c Frage eins"]);
  fixture.script.set("b", ["@c Frage zwei"]);
  let active = 0;
  let mostActive = 0;
  const answer = vi.mocked(fixture.dependencies.runner.answer);
  const scripted = answer.getMockImplementation();
  answer.mockImplementation(async (request) => {
    if (request.agent.id !== "c") return scripted ? scripted(request) : "";
    active += 1;
    mostActive = Math.max(mostActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return scripted ? scripted(request) : "";
  });
  const origin = fixture.personWrites("@a @b Bitte", ["a", "b"]);
  await fixture.service.answer(origin, fixture.memberIds);
  const ofC = fixture.requests.filter((request) => request.agent.id === "c");
  expect(ofC.map((request) => request.lastMessage).sort()).toEqual([
    "@c Frage eins",
    "@c Frage zwei",
  ]);
  expect(mostActive).toBe(1);
  expect(fixture.stored.filter((entry) => entry.senderId === "c")).toHaveLength(
    2,
  );
});

it("bundles all replies that arrive before the deadline into one continuation; bundled replies start nothing else", async () => {
  const fixture = started(handoffFixture());
  fixture.script.set("a", ["@b @c Was empfehlt ihr?", "Gemeinsames Ergebnis"]);
  fixture.script.set("b", ["@a Vorschlag von B"]);
  fixture.script.set("c", ["@a Ergänzung von C"]);
  const origin = fixture.personWrites("@a Abstimmen", ["a"]);
  await fixture.service.answer(origin, fixture.memberIds);
  expect(fixture.started.sort()).toEqual(["a", "a", "b", "c"]);
  const prompt = fixture.requests.find((request) =>
    request.prompt.includes("Nachrichten seit deiner letzten Nachricht"),
  )?.prompt;
  expect(prompt).toContain("Vorschlag von B");
  expect(prompt).toContain("Ergänzung von C");
  // The double protection covers every bundled trigger.
  for (const reply of fixture.stored.filter(
    (entry) => entry.senderId === "b" || entry.senderId === "c",
  ))
    expect(
      await fixture.dependencies.rounds.claim({
        originMessageId: origin.id,
        conversationId: "group",
        personId: "person",
        createdAt: "now",
        agentId: "a",
        trigger: "handoff",
        triggerMessageId: reply.id,
        requestedBy: reply.senderId,
        reason: "",
        isAutomatic: false,
      }),
    ).toBe("duplicate");
  expect(fixture.memory.handoffs.size).toBe(2);
});

it("continues after the deadline with the available reply, names the missing one, and treats a late reply as a new hand-over once", async () => {
  vi.useFakeTimers();
  const fixture = started(handoffFixture());
  fixture.script.set("a", ["@b @c Was empfehlt ihr?"]);
  fixture.script.set("b", ["@a Nur B"]);
  let finishC: (text: string) => void = () => undefined;
  const answer = vi.mocked(fixture.dependencies.runner.answer);
  const scripted = answer.getMockImplementation();
  answer.mockImplementation(async (request) => {
    if (request.agent.id === "c") {
      fixture.started.push("c");
      return new Promise<string>((resolve) => {
        finishC = resolve;
      });
    }
    return scripted ? scripted(request) : "";
  });
  const origin = fixture.personWrites("@a Abstimmen", ["a"]);
  const running = fixture.service.answer(origin, fixture.memberIds);
  await vi.advanceTimersByTimeAsync(0);
  expect(count(fixture.started, "a")).toBe(1);
  fixture.advance(CONVERSATION_OBSERVER_LIMITS.followUpTimeoutMilliseconds);
  await vi.advanceTimersByTimeAsync(
    CONVERSATION_OBSERVER_LIMITS.followUpTimeoutMilliseconds,
  );
  expect(count(fixture.started, "a")).toBe(2);
  const continuation = fixture.requests.at(-1)?.prompt ?? "";
  expect(continuation).toContain("Nur B");
  expect(continuation).toContain("Fehlende Antworten: C");
  finishC("@a Späte Antwort von C");
  await running;
  await vi.advanceTimersByTimeAsync(0);
  // The late reply is outside the consumed batch: it starts A once as its own hand-over.
  expect(count(fixture.started, "a")).toBe(3);
  expect(fixture.requests.at(-1)?.lastMessage).toBe("@a Späte Antwort von C");
});

it("consumes a batch without any addressed reply silently and wakes nobody", async () => {
  vi.useFakeTimers();
  const fixture = started(handoffFixture());
  fixture.script.set("a", ["@b Was meinst du?"]);
  fixture.script.set("b", ["Keine Meinung."]);
  const origin = fixture.personWrites("@a Abstimmen", ["a"]);
  await fixture.service.answer(origin, fixture.memberIds);
  fixture.advance(CONVERSATION_OBSERVER_LIMITS.followUpTimeoutMilliseconds);
  await vi.advanceTimersByTimeAsync(
    CONVERSATION_OBSERVER_LIMITS.followUpTimeoutMilliseconds,
  );
  expect(fixture.started).toEqual(["a", "b"]);
  expect([...fixture.memory.questions.values()][0]?.consumedAt).not.toBeNull();
});

it("keeps a batch across a restart during its deadline and continues it exactly once afterwards", async () => {
  const fixture = started(handoffFixture());
  fixture.script.set("a", ["@b @c Was empfehlt ihr?"]);
  fixture.script.set("b", ["@a Vorschlag von B"]);
  fixture.script.set("c", ["Weiß nicht."]);
  const origin = fixture.personWrites("@a Abstimmen", ["a"]);
  await fixture.service.answer(origin, fixture.memberIds);
  for (const stop of stops.splice(0)) stop();
  expect(count(fixture.started, "a")).toBe(1);
  const restarted = fixture.restart();
  stops.push(restarted.start());
  await restarted.recover(new Date());
  expect(count(fixture.started, "a")).toBe(1);
  fixture.advance(CONVERSATION_OBSERVER_LIMITS.followUpTimeoutMilliseconds);
  const again = fixture.restart();
  stops.push(again.start());
  await Promise.all([again.recover(new Date()), again.recover(new Date())]);
  await again.recover(new Date());
  expect(count(fixture.started, "a")).toBe(2);
});

it("does not start a queued agent that lost its membership or was deactivated before its turn", async () => {
  const fixture = started(handoffFixture());
  let release: () => void = () => undefined;
  const answer = vi.mocked(fixture.dependencies.runner.answer);
  const scripted = answer.getMockImplementation();
  answer.mockImplementationOnce(async (request) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return scripted ? scripted(request) : "";
  });
  const first = fixture.personWrites("@a eins", ["a"]);
  const second = fixture.personWrites("@a zwei", ["a"]);
  const running = Promise.all([
    fixture.service.answer(first, fixture.memberIds),
    fixture.service.answer(second, fixture.memberIds),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.mocked(
    fixture.dependencies.conversations.findForMember,
  ).mockImplementation(async (conversationId, memberId) =>
    memberId === "a"
      ? null
      : {
          id: "group",
          kind: "group",
          name: "Team",
          lastActivityAt: "today",
          isMuted: false,
          unreadCount: 0,
        },
  );
  release();
  await running;
  expect(fixture.started).toEqual(["a"]);

  const deactivated = started(handoffFixture());
  vi.mocked(deactivated.dependencies.directory.read).mockResolvedValue(
    accountsOf(
      deactivated.users.map((user) =>
        user.id === "b" ? { ...user, isActive: false } : user,
      ),
    ),
  );
  deactivated.script.set("a", ["@b übernimm"]);
  await deactivated.service.answer(
    deactivated.personWrites("@a Los", ["a"]),
    deactivated.memberIds,
  );
  expect(deactivated.started).toEqual(["a"]);
});
