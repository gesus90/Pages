import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationObserverError } from "@/backend/error/ConversationObserverError";
import { ConversationChatDecisions } from "@/backend/service/conversation/ConversationChatDecisions";
import { ConversationAccounts } from "@/backend/service/conversation/ConversationDirectory";
import {
  CONVERSATION_DEFAULT_DECISION_RULES,
  CONVERSATION_NO_RULE_OVERRIDES,
} from "@/definition/ConversationDecision";

import type { StoredConversationMessage } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type { ConversationChatDecisionsDependencies } from "@/backend/service/conversation/ConversationChatDecisions";
import type { ConversationDecisionRequest } from "@/backend/service/conversation/ConversationChatDecisions";
import type { ConversationDecisionAnswer } from "@/backend/service/conversation/ConversationDecisionModel";
import type { ConversationMessage } from "@/definition/Conversation";
import type { User } from "@/definition/User";

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

const person: User = {
  id: "person",
  username: "anna",
  displayName: "Anna",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};

function agentUser(id: string, name: string): User {
  return { ...person, id, username: name.toLowerCase(), displayName: name, isAgent: true };
}

const ed = agentUser("ed", "Ed");
const mei = agentUser("mei", "Mei");
const inactive = agentUser("inactive", "Inactive");

function accountOf(user: User, isAvailable = true): [string, { user: User; participant: { id: string; name: string; kind: "human" | "agent"; color: null }; role: string; isAvailable: boolean }] {
  return [
    user.id,
    {
      user,
      participant: {
        id: user.id,
        name: user.displayName,
        kind: user.isAgent === true ? "agent" : "human",
        color: null,
      },
      role: user.id === "ed" ? "Entwickler" : "",
      isAvailable,
    },
  ];
}

const accounts = new ConversationAccounts(
  new Map([
    accountOf(person),
    accountOf(ed),
    accountOf(mei),
    accountOf(inactive, false),
  ]),
);

const message: ConversationMessage = {
  id: "judged",
  conversationId: "group",
  clientMessageId: "client",
  sender: { id: "person", kind: "human", name: "Anna", color: null },
  text: "Danke!",
  createdAt: "2026-01-01T00:00:00Z",
  mentions: [],
  attachments: [],
  links: [],
};

function stored(sequence: number, text: string, extra: Partial<StoredConversationMessage> = {}): StoredConversationMessage {
  return {
    id: `m${String(sequence)}`,
    sequence,
    conversationId: "group",
    senderId: "person",
    clientMessageId: `c${String(sequence)}`,
    text,
    mentions: [],
    createdAt: "2026-01-01T00:00:00Z",
    voice: null,
    notice: null,
    ...extra,
  };
}

const request: ConversationDecisionRequest = {
  conversation: { id: "group", name: "Pages Team" },
  originMessageId: "judged",
  person,
  message,
  memberIds: ["person", "ed", "mei", "inactive"],
  settings: {
    conversationId: "group",
    mode: "decision",
    overrides: CONVERSATION_NO_RULE_OVERRIDES,
  },
  accounts,
};

function modelAnswer(
  answerProbability: number,
  options: Record<string, number>,
): ConversationDecisionAnswer {
  return {
    model: "perplexity/pplx-decider-v1.3",
    probabilities: {
      answerProbability,
      options: Object.entries(options).map(([id, probability]) => ({
        agentId: id === "nobody" ? null : id,
        probability,
      })),
    },
  };
}

function fixture(): {
  service: ConversationChatDecisions;
  dependencies: ConversationChatDecisionsDependencies;
} {
  const dependencies: ConversationChatDecisionsDependencies = {
    messages: {
      find: vi.fn().mockResolvedValue(stored(3, "Danke!")),
      history: vi.fn().mockResolvedValue([
        stored(3, "Danke!"),
        stored(2, "Fehlerhinweis", { notice: "agent_failed" }),
        stored(1, "Wir brauchen den Fix."),
      ]),
    },
    rounds: {
      claimRouting: vi.fn().mockResolvedValue(true),
      finishRouting: vi.fn().mockResolvedValue(undefined),
    },
    decisions: { record: vi.fn().mockResolvedValue(undefined) },
    model: { ask: vi.fn() },
    defaults: {
      rules: vi.fn().mockResolvedValue(CONVERSATION_DEFAULT_DECISION_RULES),
    },
    agents: {
      find: vi.fn().mockImplementation((id: string) =>
        Promise.resolve(
          id === "ed"
            ? {
                instructions:
                  "# Aufgabe: Coder\n\nDu setzt Tickets im Code um.\n\n## Zuständig für\n- Umsetzung nach Ticket\n\n## Arbeitsweise\n1. Lies das Ticket.",
              }
            : null,
        ),
      ),
    },
    publisher: { publish: vi.fn() },
    now: () => new Date("2026-01-01T12:00:00Z"),
  };
  return { service: new ConversationChatDecisions(dependencies), dependencies };
}

let context: ReturnType<typeof fixture>;
beforeEach(() => {
  context = fixture();
});

describe("decide", () => {
  it("asks the model once with the message, the history and each agent's specialization", async () => {
    const { service, dependencies } = context;
    vi.mocked(dependencies.model.ask).mockResolvedValue(
      modelAnswer(0.06, { ed: 0.05, mei: 0.04, nobody: 0.91 }),
    );
    await service.decide(request);
    expect(dependencies.model.ask).toHaveBeenCalledOnce();
    const material = vi.mocked(dependencies.model.ask).mock.calls[0]?.[0];
    expect(material?.groupName).toBe("Pages Team");
    // Only available agents other than the sender are offered.
    expect(material?.candidates).toEqual([
      {
        id: "ed",
        name: "Ed",
        username: "ed",
        role: "Entwickler",
        specialization: "Du setzt Tickets im Code um. · Umsetzung nach Ticket",
      },
      { id: "mei", name: "Mei", username: "mei", role: "", specialization: "" },
    ]);
    // Oldest first, the judged message last, notices left out.
    expect(material?.lines.map((line) => line.text)).toEqual([
      "Wir brauchen den Fix.",
      "Danke!",
    ]);
  });

  it("starts nobody for a thank-you and stores the decision with model, probabilities and outcome", async () => {
    const { service, dependencies } = context;
    vi.mocked(dependencies.model.ask).mockResolvedValue(
      modelAnswer(0.06, { ed: 0.05, mei: 0.04, nobody: 0.91 }),
    );
    await expect(service.decide(request)).resolves.toEqual([]);
    expect(dependencies.decisions.record).toHaveBeenCalledWith({
      messageId: "judged",
      conversationId: "group",
      outcome: "nobody",
      fallback: "none",
      responderIds: [],
      model: "perplexity/pplx-decider-v1.3",
      answerProbability: 0.06,
      choices: [
        { agentId: null, probability: 0.91 },
        { agentId: "ed", probability: 0.05 },
        { agentId: "mei", probability: 0.04 },
      ],
      createdAt: "2026-01-01T12:00:00.000Z",
    });
    expect(dependencies.rounds.finishRouting).toHaveBeenCalledWith(
      "judged",
      expect.objectContaining({ state: "silent", errorCode: null }),
    );
    expect(dependencies.publisher.publish).toHaveBeenCalledWith({
      type: "conversation.changed",
      id: "group",
    });
  });

  it("starts the most probable agent with the probabilities as its reason", async () => {
    const { service, dependencies } = context;
    vi.mocked(dependencies.model.ask).mockResolvedValue(
      modelAnswer(0.82, { ed: 0.78, mei: 0.15, nobody: 0.07 }),
    );
    const starts = await service.decide(request);
    expect(starts).toEqual([
      {
        agentId: "ed",
        trigger: "context",
        reason:
          "Das Decision-Modell hat dich gewählt: Antwort erwartet 82 % · Ed 78 %, Mei 15 %, niemand 7 %.",
      },
    ]);
    expect(dependencies.decisions.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "responders", responderIds: ["ed"] }),
    );
    expect(dependencies.rounds.finishRouting).toHaveBeenCalledWith(
      "judged",
      expect.objectContaining({
        state: "routed",
        selection: [{ agentId: "ed", reason: starts[0]?.reason }],
      }),
    );
  });

  it("follows the thresholds and the maximum of the group before the defaults of the instance", async () => {
    const { service, dependencies } = context;
    vi.mocked(dependencies.model.ask).mockResolvedValue(
      modelAnswer(0.9, { ed: 0.5, mei: 0.45, nobody: 0.05 }),
    );
    const both = await service.decide(request);
    expect(both.map((start) => start.agentId)).toEqual(["ed", "mei"]);
    vi.mocked(dependencies.rounds.claimRouting).mockResolvedValue(true);
    const one = await service.decide({
      ...request,
      message: { ...message, id: "second" },
      settings: {
        ...request.settings,
        overrides: { ...CONVERSATION_NO_RULE_OVERRIDES, maximumResponders: 1 },
      },
    });
    expect(one.map((start) => start.agentId)).toEqual(["ed"]);
    vi.mocked(dependencies.defaults.rules).mockResolvedValue({
      ...CONVERSATION_DEFAULT_DECISION_RULES,
      answerThreshold: 95,
    });
    const none = await service.decide({
      ...request,
      message: { ...message, id: "third" },
    });
    expect(none).toEqual([]);
  });

  it.each([
    ["no model is chosen", new ConversationObserverError("decision_no_model"), "no_model"],
    ["the call fails", new ConversationObserverError("decision_failed"), "model_failed"],
    ["the answer is invalid", new ConversationObserverError("decision_invalid"), "model_failed"],
    ["something unexpected breaks", new Error("boom"), "model_failed"],
  ])("behaves like \"Nur @\" and stores it when %s", async (_name, error, fallback) => {
    const { service, dependencies } = context;
    vi.mocked(dependencies.model.ask).mockRejectedValue(error);
    await expect(service.decide(request)).resolves.toEqual([]);
    expect(dependencies.decisions.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "unavailable",
        fallback,
        responderIds: [],
        model: null,
        answerProbability: null,
        choices: [],
      }),
    );
    expect(dependencies.rounds.finishRouting).toHaveBeenCalledWith(
      "judged",
      expect.objectContaining({ state: "failed", errorCode: fallback }),
    );
  });

  it("decides a message once: a second claim asks nobody and stores nothing", async () => {
    const { service, dependencies } = context;
    vi.mocked(dependencies.rounds.claimRouting).mockResolvedValue(false);
    await expect(service.decide(request)).resolves.toEqual([]);
    expect(dependencies.model.ask).not.toHaveBeenCalled();
    expect(dependencies.decisions.record).not.toHaveBeenCalled();
  });

  it("asks nobody when the group has no agent that could answer", async () => {
    const { service, dependencies } = context;
    await expect(
      service.decide({ ...request, memberIds: ["person", "inactive"] }),
    ).resolves.toEqual([]);
    expect(dependencies.rounds.claimRouting).not.toHaveBeenCalled();
    expect(dependencies.model.ask).not.toHaveBeenCalled();
  });

  it("keeps the judged message when older history exceeds the character budget", async () => {
    const { service, dependencies } = context;
    vi.mocked(dependencies.messages.history).mockResolvedValue([
      stored(3, "Danke!"),
      stored(2, "x".repeat(6_000)),
    ]);
    vi.mocked(dependencies.model.ask).mockResolvedValue(
      modelAnswer(0.06, { ed: 0, mei: 0, nobody: 1 }),
    );
    await service.decide(request);
    const material = vi.mocked(dependencies.model.ask).mock.calls[0]?.[0];
    expect(material?.lines.map((line) => line.text)).toEqual(["Danke!"]);
    vi.mocked(dependencies.messages.find).mockResolvedValue(null);
    vi.mocked(dependencies.rounds.claimRouting).mockResolvedValue(true);
    await service.decide({ ...request, message: { ...message, id: "other" } });
    expect(vi.mocked(dependencies.model.ask).mock.calls[1]?.[0].lines).toEqual([]);
  });
});

describe("recordMention", () => {
  it("stores an @ addressing without a model and tells the live view", async () => {
    const { service, dependencies } = context;
    await service.recordMention({
      conversationId: "group",
      messageId: "judged",
      agentIds: ["ed"],
    });
    expect(dependencies.model.ask).not.toHaveBeenCalled();
    expect(dependencies.decisions.record).toHaveBeenCalledWith({
      messageId: "judged",
      conversationId: "group",
      outcome: "mention",
      fallback: "none",
      responderIds: ["ed"],
      model: null,
      answerProbability: null,
      choices: [],
      createdAt: "2026-01-01T12:00:00.000Z",
    });
    expect(dependencies.publisher.publish).toHaveBeenCalledWith({
      type: "conversation.changed",
      id: "group",
    });
  });
});
