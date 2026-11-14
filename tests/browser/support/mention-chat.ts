import type { Page } from "@playwright/test";

type DecisionStatus = "ready" | "noModel" | "modelUnavailable";

const MOMENT = "2026-11-12T09:36:00.000Z";

const MENTION_MEMBERS = [
  {
    id: "admin",
    name: "Administrator",
    username: "admin",
    kind: "human",
    role: "",
  },
  {
    id: "bakuman",
    name: "Bakuman",
    username: "bakuman",
    kind: "agent",
    role: "Designer",
  },
  {
    id: "ed",
    name: "Ed",
    username: "ed",
    kind: "agent",
    role: "Developer",
  },
  {
    id: "pica",
    name: "Pica",
    username: "pica",
    kind: "agent",
    role: "Assistant",
  },
];

function participant(id: string, name: string, role: string): object {
  return {
    id,
    name,
    role,
    username: id,
    kind: "agent",
    color: null,
    avatarImageUrl: null,
    status: "active",
    unreadCount: 0,
    canChat: true,
    lastActivityAt: MOMENT,
  };
}

function decision(fallback: "none" | "no_model"): object {
  const isFallback = fallback === "no_model";
  return {
    messageId: isFallback ? "fallback-message" : "decision-message",
    outcome: isFallback ? "unavailable" : "responders",
    fallback,
    responders: isFallback ? [] : [{ id: "ed", name: "Ed" }],
    answerProbability: isFallback ? null : 0.82,
    choices: isFallback
      ? []
      : [
          { agentId: "ed", name: "Ed", probability: 0.78 },
          { agentId: null, name: "", probability: 0.22 },
        ],
    model: isFallback ? null : "example/decision-model",
  };
}

function messages(): readonly object[] {
  return [
    {
      id: "mention-message",
      authorId: "ed",
      content: "@admin please review with @bakuman and @alle.",
      mentions: ["admin", "bakuman", "ed"],
      toolUses: [],
      createdAt: MOMENT,
      decision: decision("none"),
    },
    {
      id: "decision-message",
      authorId: null,
      content: "Please repair the chat service.",
      toolUses: [],
      createdAt: MOMENT,
    },
    {
      id: "fallback-message",
      authorId: null,
      content: "Who can take this?",
      toolUses: [],
      createdAt: MOMENT,
      decision: decision("no_model"),
    },
  ];
}

function directory(status: DecisionStatus): object {
  return {
    participants: [
      participant("bakuman", "Bakuman", "Designer"),
      participant("ed", "Ed", "Developer"),
      participant("pica", "Pica", "Assistant"),
    ],
    groups: [
      {
        id: "mention-team",
        name: "Mention team",
        description: "Synthetic mention browser fixture",
        memberIds: ["bakuman", "ed"],
        unreadCount: 0,
        lastActivityAt: MOMENT,
      },
    ],
    contactChoices: [],
    chatDecisionStatus: status,
    mentionDirectory: {
      selfId: "admin",
      members: MENTION_MEMBERS,
      aliases: [
        {
          name: "a-team",
          memberIds: ["bakuman", "ed"],
          kind: "department",
        },
      ],
    },
    histories: { "mention-team": messages() },
  };
}

/** Opens a group with synthetic API data while retaining the real authenticated app shell. */
export async function openMentionChat(
  page: Page,
  status: DecisionStatus = "ready",
): Promise<void> {
  await page.route("**/chat-page-api/page", async (route) => {
    await route.fulfill({ json: directory(status) });
  });
  await page.goto("/chat");
}
