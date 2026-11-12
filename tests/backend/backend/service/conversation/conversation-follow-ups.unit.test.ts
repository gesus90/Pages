import { afterEach, expect, it, vi } from "vitest";

import {
  CONVERSATION_OBSERVER_LIMITS,
  conversationRoundLimits,
} from "@/definition/ConversationObserver";

import { followUpFixture } from "./conversation-follow-up-fixture";

afterEach(() => {
  vi.useRealTimers();
});

it("bundles B and C before A continues exactly once with both replies", async () => {
  const { service, dependencies, origin, memberIds, stored, claims } =
    followUpFixture();
  const stop = service.start();
  vi.mocked(dependencies.runner.answer).mockImplementation(
    async ({ agent, prompt }) => {
      if (agent.id === "a" && !prompt.includes("Antworten seit deiner letzten"))
        return "@b @c Was empfehlt ihr?";
      if (agent.id === "b") return "@a Vorschlag von B";
      if (agent.id === "c") {
        expect(claims.filter((claim) => claim.agentId === "a")).toHaveLength(1);
        return "@a Ergänzung von C";
      }
      expect(prompt).toContain("Vorschlag von B");
      expect(prompt).toContain("Ergänzung von C");
      return "Ein gemeinsames Ergebnis";
    },
  );
  await service.answer(origin, memberIds);
  await service.answer(origin, memberIds);
  expect(claims.map((claim) => claim.agentId)).toEqual(["a", "b", "c", "a"]);
  expect(
    stored.filter((entry) => entry.text === "Ein gemeinsames Ergebnis"),
  ).toHaveLength(1);
  stop();
});

it("waits three minutes for missing C, then gives A the available reply and names C", async () => {
  vi.useFakeTimers();
  const { service, dependencies, origin, memberIds, claims } =
    followUpFixture();
  const stop = service.start();
  let finishC: (answer: string) => void = () => {
    throw new Error("C has not started");
  };
  vi.mocked(dependencies.runner.answer).mockImplementation(
    async ({ agent, prompt }) => {
      if (agent.id === "a" && !prompt.includes("Antworten seit deiner letzten"))
        return "@b @c Was empfehlt ihr?";
      if (agent.id === "b") return "@a Nur B hat geantwortet";
      if (agent.id === "c")
        return new Promise<string>((resolve) => {
          finishC = resolve;
        });
      expect(prompt).toContain("Nur B hat geantwortet");
      expect(prompt).toContain("Fehlende Antworten: C");
      return "Ergebnis mit B; C fehlt";
    },
  );
  const answering = service.answer(origin, memberIds);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(
    CONVERSATION_OBSERVER_LIMITS.followUpTimeoutMilliseconds - 1,
  );
  expect(claims.filter((claim) => claim.agentId === "a")).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(claims.filter((claim) => claim.agentId === "a")).toHaveLength(2);
  finishC("@a Späte Antwort von C");
  await answering;
  expect(claims.filter((claim) => claim.agentId === "a")).toHaveLength(2);
  stop();
});

it("ends after the third additional answer of A and posts the quiet notice once", async () => {
  const { service, dependencies, origin, memberIds, stored, claims } =
    followUpFixture();
  const stop = service.start();
  vi.mocked(dependencies.runner.answer).mockImplementation(
    async ({ agent }) => {
      if (agent.id !== "a") return "@a Meine Antwort";
      const count = claims.filter((claim) => claim.agentId === "a").length;
      return `@${["b", "c", "d", "e"][count - 1]} Was meinst du zur neuen Frage?`;
    },
  );
  await service.answer(origin, memberIds);
  await service.answer(origin, memberIds);
  expect(claims.filter((claim) => claim.agentId === "a")).toHaveLength(4);
  expect(claims.some((claim) => claim.agentId === "e")).toBe(false);
  expect(stored.filter((entry) => entry.notice === "round_limit")).toHaveLength(
    1,
  );
  expect(stored.at(-1)?.text).toBe("Abstimmung beendet, Grenze erreicht");
  stop();
});

it("stops a multi-agent round at eight contributions before the chain pause", async () => {
  const { service, dependencies, origin, memberIds, stored, claims } =
    followUpFixture();
  const stop = service.start();
  const chain = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
  vi.mocked(dependencies.runner.answer).mockImplementation(
    async ({ agent }) =>
      `@${chain[chain.indexOf(agent.id) + 1]} Bitte weiter prüfen?`,
  );
  await service.answer(origin, memberIds);
  expect(claims).toHaveLength(8);
  expect(
    stored.filter(
      (entry) => entry.notice === null && entry.senderId !== "person",
    ),
  ).toHaveLength(8);
  expect(stored.at(-1)?.notice).toBe("round_limit");
  expect(dependencies.guard?.isPaused).not.toHaveBeenCalled();
  stop();
});

it("announces a reached budget once while an already claimed answer is finishing", async () => {
  const { service, dependencies, origin, memberIds, stored } =
    followUpFixture();
  const stop = service.start();
  vi.mocked(dependencies.replySettings.find).mockResolvedValue({
    conversationId: "group",
    mode: "mentions",
    defaultResponderId: null,
    maximumResponders: 2,
    automaticRepliesPerOrigin: 2,
  });
  let finishB: (answer: string) => void = () => {
    throw new Error("B has not started");
  };
  vi.mocked(dependencies.runner.answer).mockImplementation(
    async ({ agent }) => {
      if (agent.id === "a") return "A hat geantwortet";
      return new Promise<string>((resolve) => {
        finishB = resolve;
      });
    },
  );
  const answering = service.answer(
    { ...origin, mentions: ["a", "b"] },
    memberIds,
  );
  await vi.waitFor(() =>
    expect(
      stored.filter((entry) => entry.notice === "round_limit"),
    ).toHaveLength(1),
  );
  expect(dependencies.rounds.end).toHaveBeenCalled();
  finishB("B hat geantwortet");
  await answering;
  expect(stored.filter((entry) => entry.notice === "round_limit")).toHaveLength(
    1,
  );
  expect(dependencies.runner.answer).toHaveBeenCalledTimes(2);
  stop();
});

it.each([
  "@b Danke für deinen Beitrag",
  "Danke für deinen Beitrag",
  "@b Die Prüfung ist erledigt.",
])(
  "does not turn a plain return mention into another question: %s",
  async (conclusion) => {
    const { service, dependencies, origin, memberIds, claims } =
      followUpFixture();
    const stop = service.start();
    vi.mocked(dependencies.runner.answer).mockImplementation(
      async ({ agent, prompt }) => {
        if (agent.id === "b") return "@a Hier ist die Antwort";
        return prompt.includes("Antworten seit deiner letzten")
          ? conclusion
          : "@b Was meinst du?";
      },
    );
    await service.answer(origin, memberIds);
    expect(claims.map((claim) => claim.agentId)).toEqual(["a", "b", "a"]);
    expect(dependencies.rounds.followUps.open).toHaveBeenCalledOnce();
    stop();
  },
);

it("a mention without a preceding question never reawakens the original agent", async () => {
  const { service, dependencies, origin, memberIds, claims } =
    followUpFixture();
  const stop = service.start();
  vi.mocked(dependencies.runner.answer).mockImplementation(async ({ agent }) =>
    agent.id === "a" ? "@b Danke" : "@a Gerne",
  );
  await service.answer(origin, memberIds);
  expect(claims.map((claim) => claim.agentId)).toEqual(["a", "b"]);
  stop();
});

it("restores an overdue stored batch once and retains the default and hard limits", async () => {
  vi.useFakeTimers();
  const { service, dependencies, questions, claims, stored } =
    followUpFixture();
  const stop = service.start();
  const [origin] = stored;
  if (!origin) throw new Error("Missing fixture origin");
  stored.push({
    ...origin,
    id: "question",
    sequence: 2,
    senderId: "a",
    text: "@b @c Was meint ihr?",
  });
  stored.push({
    ...origin,
    id: "reply",
    sequence: 3,
    senderId: "b",
    text: "@a Vorschlag",
  });
  questions.set("question", {
    questionMessageId: "question",
    originMessageId: "origin",
    conversationId: "group",
    agentId: "a",
    personId: "person",
    deadlineAt: new Date(Date.now() - 1).toISOString(),
    answers: [
      { agentId: "b", replyMessageId: "reply" },
      { agentId: "c", replyMessageId: null },
    ],
  });
  await service.recover(new Date());
  await service.recover(new Date());
  expect(claims).toHaveLength(1);
  expect(dependencies.runner.answer).toHaveBeenCalledOnce();
  expect(conversationRoundLimits({})).toEqual({
    repliesPerAgentPerOrigin: 4,
    automaticRepliesPerOrigin: 8,
  });
  expect(
    conversationRoundLimits({
      repliesPerAgentPerOrigin: 20,
      automaticRepliesPerOrigin: 20,
    }),
  ).toEqual({ repliesPerAgentPerOrigin: 4, automaticRepliesPerOrigin: 9 });
  stop();
});

it("restores a missing end notice after an interrupted process without waking an agent", async () => {
  const { service, dependencies, stored } = followUpFixture();
  const stop = service.start();
  vi.mocked(dependencies.rounds.unannouncedEnds).mockResolvedValue([
    {
      originMessageId: "origin",
      conversationId: "group",
      personId: "person",
      createdAt: new Date().toISOString(),
    },
  ]);
  await service.recover(new Date());
  await service.recover(new Date());
  expect(stored.filter((entry) => entry.notice === "round_limit")).toHaveLength(
    1,
  );
  expect(dependencies.runner.answer).not.toHaveBeenCalled();
  stop();
});
