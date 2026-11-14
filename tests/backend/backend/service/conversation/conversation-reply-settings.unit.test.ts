import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationReplySettingsRepository } from "@/backend/database/repositories/conversation/ConversationReplySettingsRepository";
import { ConversationAccounts } from "@/backend/service/conversation/ConversationDirectory";
import { ConversationReplySettingsService } from "@/backend/service/conversation/ConversationReplySettingsService";
import {
  CONVERSATION_DEFAULT_DECISION_RULES,
  CONVERSATION_NO_RULE_OVERRIDES,
} from "@/definition/ConversationDecision";

import { bareInstance } from "../tasks/bare-instance";

import type { ConversationReplySettingsDependencies } from "@/backend/service/conversation/ConversationReplySettingsService";
import type { StoredDecisionListing } from "@/backend/database/repositories/conversation/ConversationDecisionRepository";
import type {
  ConversationDecisionModelView,
  ConversationReplySettings,
} from "@/definition/ConversationDecision";
import type { User } from "@/definition/User";

const manager: User = {
  id: "manager",
  username: "manager",
  displayName: "Manager",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const member: User = { ...manager, id: "member", username: "member" };
const GROUP = {
  id: "group",
  kind: "group",
  name: "Team",
  lastActivityAt: "today",
  isMuted: false,
  unreadCount: 0,
} as const;
const READY: ConversationDecisionModelView = {
  status: "ready",
  name: "Perplexity Decider V1.3",
};

function accounts(): ConversationAccounts {
  return new ConversationAccounts(
    new Map([
      [
        "ed",
        {
          user: { ...manager, id: "ed", displayName: "Ed", isAgent: true },
          participant: { id: "ed", name: "Ed", kind: "agent", color: null },
          role: "",
          isAvailable: true,
        },
      ],
    ]),
  );
}

function fixture(): {
  service: ConversationReplySettingsService;
  dependencies: ConversationReplySettingsDependencies;
  stored: { current: ConversationReplySettings };
} {
  const settings = bareInstance(ConversationReplySettingsRepository.prototype);
  const current: ConversationReplySettings = {
    conversationId: "group",
    mode: "decision",
    overrides: CONVERSATION_NO_RULE_OVERRIDES,
  };
  const stored = { current };
  vi.spyOn(settings, "find").mockImplementation(async () => stored.current);
  vi.spyOn(settings, "save").mockResolvedValue();
  const dependencies: ConversationReplySettingsDependencies = {
    conversations: {
      findForMember: vi.fn().mockResolvedValue(GROUP),
      createdBy: vi.fn().mockResolvedValue("manager"),
    },
    settings,
    decisions: {
      recent: vi.fn().mockResolvedValue([]),
      latestFallback: vi.fn().mockResolvedValue(null),
    },
    instance: {
      rules: vi.fn().mockResolvedValue(CONVERSATION_DEFAULT_DECISION_RULES),
      modelView: vi.fn().mockResolvedValue(READY),
    },
    directory: { read: vi.fn().mockResolvedValue(accounts()) },
    publisher: { publish: vi.fn() },
    now: () => new Date("2026-01-01T00:00:00Z"),
  };
  return {
    service: new ConversationReplySettingsService(dependencies),
    dependencies,
    stored,
  };
}

let context: ReturnType<typeof fixture>;
beforeEach(() => {
  context = fixture();
});

describe("read", () => {
  it("gives a group without values of its own the default mode and the defaults of the instance", async () => {
    const view = await context.service.read(manager, "group");
    expect(view).toEqual({
      conversationId: "group",
      mode: "decision",
      rules: CONVERSATION_DEFAULT_DECISION_RULES,
      defaults: CONVERSATION_DEFAULT_DECISION_RULES,
      isDefault: true,
      canManage: true,
      decisionModel: READY,
      hint: null,
    });
  });

  it("applies the values of the group over the defaults of the instance", async () => {
    context.stored.current = {
      conversationId: "group",
      mode: "mentions",
      overrides: {
        ...CONVERSATION_NO_RULE_OVERRIDES,
        answerThreshold: 80,
        maximumResponders: 1,
      },
    };
    vi.mocked(context.dependencies.instance.rules).mockResolvedValue({
      ...CONVERSATION_DEFAULT_DECISION_RULES,
      secondThreshold: 30,
    });
    const view = await context.service.read(member, "group");
    expect(view.rules).toEqual({
      answerThreshold: 80,
      responsibilityThreshold: 50,
      secondThreshold: 30,
      maximumResponders: 1,
    });
    expect(view.isDefault).toBe(false);
    expect(view.mode).toBe("mentions");
    expect(view.canManage).toBe(false);
  });

  it.each([
    ["no model is set", { status: "noModel", name: null }, null, "noModel"],
    [
      "the model is gone",
      { status: "modelUnavailable", name: "x" },
      null,
      "modelUnavailable",
    ],
    ["the last call failed", READY, "model_failed", "modelFailed"],
  ] as const)(
    'tells a manager when %s, because the group then behaves like "Nur @"',
    async (_, model, fallback, hint) => {
      vi.mocked(context.dependencies.instance.modelView).mockResolvedValue(
        model,
      );
      vi.mocked(
        context.dependencies.decisions.latestFallback,
      ).mockResolvedValue(fallback);
      expect((await context.service.read(manager, "group")).hint).toBe(hint);
    },
  );

  it('tells nobody else and says nothing in the mode "Nur @" or when all is well', async () => {
    vi.mocked(context.dependencies.instance.modelView).mockResolvedValue({
      status: "noModel",
      name: null,
    });
    expect((await context.service.read(member, "group")).hint).toBeNull();
    context.stored.current = { ...context.stored.current, mode: "mentions" };
    expect((await context.service.read(manager, "group")).hint).toBeNull();
    context.stored.current = { ...context.stored.current, mode: "decision" };
    vi.mocked(context.dependencies.instance.modelView).mockResolvedValue(READY);
    vi.mocked(context.dependencies.decisions.latestFallback).mockResolvedValue(
      "none",
    );
    expect((await context.service.read(manager, "group")).hint).toBeNull();
  });

  it("knows no direct conversation and no conversation of a non-member", async () => {
    vi.mocked(
      context.dependencies.conversations.findForMember,
    ).mockResolvedValueOnce({
      ...GROUP,
      kind: "direct",
    });
    await expect(context.service.read(manager, "group")).rejects.toMatchObject({
      code: "not_found",
    });
    vi.mocked(
      context.dependencies.conversations.findForMember,
    ).mockResolvedValueOnce(null);
    await expect(context.service.read(manager, "group")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("save", () => {
  const rules = {
    answerThreshold: 70,
    responsibilityThreshold: 55,
    secondThreshold: 35,
    maximumResponders: 3,
  };

  it("stores mode, thresholds and maximum of the group and tells the live view", async () => {
    context.stored.current = {
      conversationId: "group",
      mode: "decision",
      overrides: rules,
    };
    const view = await context.service.save(manager, {
      conversationId: "group",
      mode: "decision",
      rules,
    });
    expect(context.dependencies.settings.save).toHaveBeenCalledWith({
      settings: { conversationId: "group", mode: "decision", overrides: rules },
      updatedBy: "manager",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(context.dependencies.publisher.publish).toHaveBeenCalledWith({
      type: "conversation.changed",
      id: "group",
    });
    expect(view.rules).toEqual(rules);
    expect(view.isDefault).toBe(false);
  });

  it('returns the group to the defaults of the instance with null rules, also in the mode "Nur @"', async () => {
    await context.service.save(manager, {
      conversationId: "group",
      mode: "mentions",
      rules: null,
    });
    expect(context.dependencies.settings.save).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: {
          conversationId: "group",
          mode: "mentions",
          overrides: CONVERSATION_NO_RULE_OVERRIDES,
        },
      }),
    );
  });

  it("is refused for a member who does not manage the group", async () => {
    await expect(
      context.service.save(member, {
        conversationId: "group",
        mode: "mentions",
        rules: null,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(context.dependencies.settings.save).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown mode", { mode: "observer", rules: null }],
    ["the removed mode observer", { mode: "observer", rules: rules }],
    [
      "a threshold above 100",
      { mode: "decision", rules: { ...rules, answerThreshold: 101 } },
    ],
    [
      "a fractional threshold",
      { mode: "decision", rules: { ...rules, secondThreshold: 40.5 } },
    ],
    [
      "no answering agent",
      { mode: "decision", rules: { ...rules, maximumResponders: 0 } },
    ],
    [
      "too many answering agents",
      { mode: "decision", rules: { ...rules, maximumResponders: 4 } },
    ],
    ["a missing field", { mode: "decision", rules: { answerThreshold: 60 } }],
    [
      "a default responder, which no longer exists",
      { mode: "decision", rules: null, defaultResponderId: "ed" },
    ],
  ])("refuses %s", async (_, body) => {
    await expect(
      context.service.save(manager, { conversationId: "group", ...body }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(context.dependencies.settings.save).not.toHaveBeenCalled();
  });
});

describe("decisions", () => {
  const listing: StoredDecisionListing = {
    messageId: "m1",
    conversationId: "group",
    outcome: "responders",
    fallback: "none",
    responderIds: ["ed"],
    model: "perplexity/pplx-decider-v1.3",
    answerProbability: 0.82,
    choices: [
      { agentId: "ed", probability: 0.78 },
      { agentId: null, probability: 0.07 },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    text: `  ${"Bitte prüfen\n".repeat(30)}`,
  };

  it("lists the newest decisions of a group with names and a shortened message", async () => {
    vi.mocked(context.dependencies.decisions.recent).mockResolvedValue([
      listing,
    ]);
    const [entry] = await context.service.decisions(member, "group");
    expect(context.dependencies.decisions.recent).toHaveBeenCalledWith(
      "group",
      30,
    );
    expect(entry).toMatchObject({
      messageId: "m1",
      outcome: "responders",
      responders: [{ id: "ed", name: "Ed" }],
      answerProbability: 0.82,
      choices: [
        { agentId: "ed", name: "Ed", probability: 0.78 },
        { agentId: null, name: "", probability: 0.07 },
      ],
      model: "perplexity/pplx-decider-v1.3",
      createdAt: "2026-01-01T00:00:00Z",
    });
    expect(Array.from(entry?.text ?? "").length).toBeLessThanOrEqual(160);
    expect(entry?.text.endsWith("…")).toBe(true);
  });

  it("keeps a short message as it is and refuses a non-member", async () => {
    vi.mocked(context.dependencies.decisions.recent).mockResolvedValue([
      { ...listing, text: "Danke!" },
    ]);
    expect((await context.service.decisions(member, "group"))[0]?.text).toBe(
      "Danke!",
    );
    vi.mocked(
      context.dependencies.conversations.findForMember,
    ).mockResolvedValueOnce(null);
    await expect(
      context.service.decisions(member, "group"),
    ).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
