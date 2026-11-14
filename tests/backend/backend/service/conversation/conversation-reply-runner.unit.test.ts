import { expect, it, vi } from "vitest";

import * as logging from "@/backend/logging/Logger";
import { safeLogMetadata } from "@/backend/logging/LogRedaction";
import { AgentJobAnswerError } from "@/backend/error/AgentJobAnswerError";
import { ConversationAccounts } from "@/backend/service/conversation/ConversationDirectory";
import { ConversationReplyRunner } from "@/backend/service/conversation/ConversationReplyRunner";

import type { ConversationAgentRequest } from "@/backend/service/conversation/ConversationAgentReplies";
import type {
  ConversationReplyJob,
  ConversationReplyRunnerDependencies,
} from "@/backend/service/conversation/ConversationReplyRunner";
import type { StoredConversationAttachment } from "@/backend/database/repositories/conversation/ConversationAttachmentRepository";
import type { AgentFile } from "@/backend/service/conversation/content/ConversationAgentFiles";
import type { StoredConversationMessage } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type { Mock } from "vitest";
import type { User } from "@/definition/User";

const person: User = {
  id: "person",
  username: "person",
  displayName: "Person",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const agent: User = {
  ...person,
  id: "agent",
  username: "agent",
  displayName: "Agent",
  isAgent: true,
};
const conversation = {
  id: "group",
  kind: "group",
  name: "Team",
  lastActivityAt: "2026-01-01",
  isMuted: false,
  unreadCount: 0,
} as const;
const message: StoredConversationMessage = {
  id: "origin",
  sequence: 1,
  conversationId: "group",
  senderId: "person",
  clientMessageId: "client",
  text: "Question",
  mentions: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  voice: null,
  notice: null,
};
const staged: StoredConversationAttachment = {
  id: "attachment-1",
  conversationId: "group",
  messageId: null,
  uploaderId: "agent",
  name: "eins.png",
  mimeType: "image/png",
  sizeBytes: 3,
  storageName: "stored-1",
  position: 0,
  thumbnail: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};
const job: ConversationReplyJob = {
  round: {
    originMessageId: "origin",
    conversation,
    memberIds: ["person", "agent"],
    person,
  },
  agentId: "agent",
  trigger: "mention",
  triggerMessageId: "origin",
  reason: "asked",
};

function fixture(user: User = agent): {
  runner: ConversationReplyRunner;
  messages: Record<"find" | "history" | "insert" | "contextCount", Mock>;
  rounds: { setTargetState: Mock };
  events: { publish: Mock };
  answer: Mock;
  dependencies: ConversationReplyRunnerDependencies;
} {
  const accounts = new ConversationAccounts(
    new Map([
      [
        "agent",
        {
          user,
          participant: {
            id: "agent",
            name: "Agent",
            kind: "agent",
            color: null,
          },
          role: "",
          isAvailable: true,
        },
      ],
    ]),
  );
  const messages = {
    find: vi.fn().mockResolvedValue(message),
    history: vi.fn().mockResolvedValue([message]),
    contextCount: vi.fn().mockResolvedValue(1),
    insert: vi.fn().mockResolvedValue({
      message: {
        ...message,
        id: "answer",
        senderId: "agent",
        text: "Answer",
      },
      isNew: true,
    }),
  };
  const rounds = { setTargetState: vi.fn().mockResolvedValue(undefined) };
  const events = { publish: vi.fn() };
  const answer = vi.fn().mockResolvedValue(" Answer ");
  const dependencies: ConversationReplyRunnerDependencies = {
    conversations: { findForMember: vi.fn().mockResolvedValue(conversation) },
    messages,
    directory: { read: vi.fn().mockResolvedValue(accounts) },
    runner: { answer },
    rounds,
    contexts: { promptContext: vi.fn().mockResolvedValue({ context: null }) },
    events,
    publisher: { publish: vi.fn() },
    agentFiles: {
      select: vi
        .fn()
        .mockResolvedValue({ text: "Answer", files: [], lines: ["Answer"] }),
      open: vi.fn(),
    },
    attachments: {
      stage: vi.fn(),
      bind: vi.fn(),
      release: vi.fn(),
      open: vi.fn(),
    },
    content: { describe: vi.fn().mockResolvedValue(new Map()) },
    now: () => new Date("2026-01-01T00:00:00Z"),
  };
  return {
    runner: new ConversationReplyRunner(dependencies),
    messages,
    rounds,
    events,
    answer,
    dependencies,
  };
}

it("stores and announces an agent answer with its round state", async () => {
  const { runner, messages, rounds, events, answer } = fixture();
  const result = await runner.run(job);
  expect(result).toMatchObject({
    id: "answer",
    text: "Answer",
    sender: { id: "agent" },
  });
  expect(answer).toHaveBeenCalledWith(
    expect.objectContaining({ agent, person, lastMessage: "Question" }),
  );
  expect(messages.insert).toHaveBeenCalledWith(
    expect.objectContaining({
      senderId: "agent",
      text: "Answer",
      notice: null,
    }),
    { type: "conversation.changed", id: "group" },
  );
  expect(rounds.setTargetState).toHaveBeenLastCalledWith(
    { originMessageId: "origin", agentId: "agent", triggerMessageId: "origin" },
    expect.objectContaining({ state: "answered", replyMessageId: "answer" }),
  );
  expect(events.publish).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "message",
      recipientIds: ["person", "agent"],
    }),
  );
  expect(runner.workingAgentIds("group")).toEqual([]);
});

it("refuses missing membership and stores an inactive notice", async () => {
  const missing = fixture();
  vi.mocked(
    missing.dependencies.conversations.findForMember,
  ).mockResolvedValueOnce(null);
  await expect(missing.runner.run(job)).resolves.toBeNull();
  expect(missing.rounds.setTargetState).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ state: "failed" }),
  );
  expect(missing.answer).not.toHaveBeenCalled();
  const inactive = fixture({ ...agent, isActive: false });
  await expect(inactive.runner.run(job)).resolves.toBeNull();
  expect(inactive.messages.insert).toHaveBeenCalledWith(
    expect.objectContaining({
      notice: "agent_inactive",
      text: "Agent ist deaktiviert und antwortet nicht auf diese Nachricht.",
    }),
    expect.anything(),
  );
  expect(inactive.answer).not.toHaveBeenCalled();
});

it("binds the stored file and keeps the line of a file that failed with the reason (B2)", async () => {
  const { runner, messages, dependencies } = fixture();
  const lines = [
    "Hier die Entwürfe:",
    "![Eins](file:/home/a/Results/eins.png)",
    "![Zwei](file:/home/a/Results/zwei.png)",
  ];
  const file = (index: number, name: string): AgentFile => ({
    path: `/home/a/Results/${name}`,
    name,
    mimeType: "image/png",
    sizeBytes: 3,
    lineIndex: index,
  });
  vi.mocked(dependencies.agentFiles.select).mockResolvedValueOnce({
    text: "Hier die Entwürfe:",
    files: [file(1, "eins.png"), file(2, "zwei.png")],
    lines,
  });
  vi.mocked(dependencies.attachments.stage)
    .mockResolvedValueOnce(staged)
    .mockRejectedValueOnce(new Error("disk full"));
  await runner.run(job);
  const expected =
    "Hier die Entwürfe:\n![Zwei](file:/home/a/Results/zwei.png) (Datei nicht angehängt: Speichern fehlgeschlagen)";
  expect(messages.insert).toHaveBeenCalledWith(
    expect.objectContaining({ text: expected }),
    expect.anything(),
  );
  expect(dependencies.attachments.stage).toHaveBeenCalledTimes(2);
  expect(dependencies.attachments.stage).toHaveBeenCalledWith(
    { conversationId: "group", senderId: "agent" },
    expect.objectContaining({ name: "eins.png" }),
  );
  expect(dependencies.attachments.bind).toHaveBeenCalledWith(
    { id: "answer", conversationId: "group", senderId: "agent" },
    ["attachment-1"],
  );
  expect(dependencies.attachments.release).not.toHaveBeenCalled();
  // The files are stored before the answer, so a failure can still change its text.
  expect(
    vi.mocked(dependencies.attachments.stage).mock.invocationCallOrder[1],
  ).toBeLessThan(messages.insert.mock.invocationCallOrder[0] ?? 0);
});

it("releases the stored files of a repeated answer", async () => {
  const { runner, messages, dependencies } = fixture();
  vi.mocked(dependencies.agentFiles.select).mockResolvedValueOnce({
    text: "",
    files: [
      {
        path: "/home/a/Results/eins.png",
        name: "eins.png",
        mimeType: "image/png",
        sizeBytes: 3,
        lineIndex: 0,
      },
    ],
    lines: ["![Eins](file:/home/a/Results/eins.png)"],
  });
  vi.mocked(dependencies.attachments.stage).mockResolvedValueOnce(staged);
  messages.insert.mockResolvedValueOnce({
    message: { ...message, id: "answer", senderId: "agent" },
    isNew: false,
  });
  await runner.run(job);
  expect(dependencies.attachments.bind).not.toHaveBeenCalled();
  expect(dependencies.attachments.release).toHaveBeenCalledWith("agent", [
    "attachment-1",
  ]);
});

it("PAGE-344 gives the answered message's image to the answering agent", async () => {
  const { runner, answer, dependencies } = fixture();
  const image = {
    id: "image-now",
    name: "screenshot.png",
    mimeType: "image/png",
    sizeBytes: 3,
    kind: "image",
    url: "/chat/files/image-now",
  } as const;
  vi.mocked(dependencies.content.describe).mockResolvedValue(
    new Map([[message.id, { attachments: [image], links: [] }]]),
  );
  await runner.run(job);
  expect(answer).toHaveBeenCalledWith(
    expect.objectContaining({ attachments: [image] }),
  );
});

it("PAGE-344 delivers the image of an earlier context message", async () => {
  const { runner, answer, messages, dependencies } = fixture();
  const previous = {
    ...message,
    id: "previous",
    sequence: 1,
    text: "Earlier image",
  };
  const answered = { ...message, sequence: 2 };
  messages.find.mockResolvedValue(answered);
  messages.history.mockResolvedValue([answered, previous]);
  const image = {
    id: "earlier-image",
    name: "earlier.png",
    mimeType: "image/png",
    sizeBytes: 3,
    kind: "image",
    url: "/chat/files/earlier-image",
  } as const;
  vi.mocked(dependencies.content.describe).mockResolvedValue(
    new Map([[previous.id, { attachments: [image], links: [] }]]),
  );
  await runner.run(job);
  expect(answer).toHaveBeenCalledWith(
    expect.objectContaining({ attachments: [image] }),
  );
  expect(answer.mock.calls[0]?.[0].prompt).toContain("Anhang von #1");
});

it("PAGE-344 supplies all 30 unseen messages, full text and attachments to a kept session", async () => {
  const { runner, answer, messages, dependencies } = fixture();
  const history = Array.from({ length: 31 }, (_, index) => ({
    ...message,
    id: `m-${index + 1}`,
    sequence: index + 1,
    text: `Unique-${index + 1}: ${"long text ".repeat(100)} END-${index + 1}`,
  })).reverse();
  const answered = history.find((item) => item.sequence === 31);
  messages.find.mockResolvedValue(answered);
  messages.history.mockImplementation(
    async (id: string, before: number | null, limit: number) =>
      history
        .filter((item) => before === null || item.sequence < before)
        .slice(0, limit),
  );
  messages.contextCount.mockResolvedValue(31);
  const image = {
    id: "during-image",
    name: "during.png",
    mimeType: "image/png",
    sizeBytes: 3,
    kind: "image",
    url: "/chat/files/during-image",
  } as const;
  vi.mocked(dependencies.content.describe).mockImplementation(
    async (selected) =>
      new Map(
        selected
          .filter((item) => item.sequence === 5)
          .map((item) => [item.id, { attachments: [image], links: [] }]),
      ),
  );
  answer.mockImplementationOnce(async (request: ConversationAgentRequest) => {
    if (!request.prepareTurn) throw new Error("Missing turn preparation");
    const continued = await request.prepareTurn(1);
    expect(continued.prompt.match(/^#\d+ /gm)).toHaveLength(30);
    for (let sequence = 2; sequence <= 31; sequence += 1) {
      expect(continued.prompt).toContain(`Unique-${sequence}:`);
      expect(continued.prompt).toContain(`END-${sequence}`);
    }
    expect(continued.prompt).not.toContain("Unique-1:");
    expect(continued.prompt).not.toContain("Unique-32:");
    expect(continued.prompt).not.toContain("[gekürzt]");
    expect(continued.attachments).toEqual([image]);
    expect(continued.throughSequence).toBe(31);
    return "Complete answer";
  });
  await runner.run(job);
  expect(answer).toHaveBeenCalledOnce();
});

it("PAGE-344 states the exact missing count without a summary and rechecks membership for preparation", async () => {
  const { runner, answer, messages, dependencies } = fixture();
  messages.find.mockResolvedValue({ ...message, sequence: 30 });
  messages.history.mockResolvedValue(
    Array.from({ length: 20 }, (_, index) => ({
      ...message,
      id: `m-${30 - index}`,
      sequence: 30 - index,
    })),
  );
  messages.contextCount.mockResolvedValue(30);
  answer.mockImplementationOnce(async (request: ConversationAgentRequest) => {
    expect(request.prompt).toContain("10 Nachrichten fehlen");
    expect(request.prompt).toContain("keine gültige Zusammenfassung");
    vi.mocked(dependencies.conversations.findForMember).mockResolvedValueOnce(
      null,
    );
    await expect(request.prepareTurn?.(0)).rejects.toMatchObject({
      code: "not_found",
    });
    return "Answer";
  });
  await runner.run(job);
  expect(answer).toHaveBeenCalledOnce();
});

it("PAGE-344 retries an unexpected cancellation once and publishes a complete answer", async () => {
  const { runner, answer, messages } = fixture();
  answer
    .mockRejectedValueOnce(new AgentJobAnswerError("interrupted", "cancelled"))
    .mockResolvedValueOnce("Complete answer");
  await runner.run(job);
  expect(answer).toHaveBeenCalledTimes(2);
  expect(messages.insert).toHaveBeenCalledOnce();
  expect(messages.insert).toHaveBeenCalledWith(
    expect.objectContaining({ notice: null }),
    expect.anything(),
  );
});

it.each([
  ["stopped", null, "abgebrochen", 2],
  ["failed", "cli_not_logged_in", "nicht angemeldet", 1],
  ["failed", "plan_step_failed", "plan_step_failed", 1],
] as const)(
  "PAGE-344 preserves the actual %s/%s reason",
  async (state, code, expected, attempts) => {
    const { runner, answer, messages } = fixture();
    answer.mockRejectedValue(new AgentJobAnswerError(state, code));
    await runner.run(job);
    expect(answer).toHaveBeenCalledTimes(attempts);
    expect(messages.insert).toHaveBeenCalledWith(
      expect.objectContaining({ notice: "agent_failed" }),
      expect.anything(),
    );
    expect(messages.insert.mock.calls[0]?.[0].text).toContain(expected);
    expect(messages.insert.mock.calls[0]?.[0].text).not.toContain(
      "kein Modell nutzbar",
    );
  },
);

it("PAGE-344 never retries an explicit stop of a member", async () => {
  const { runner, answer, messages } = fixture();
  answer.mockImplementationOnce(async () => {
    expect(runner.stop("group", "agent")).toBe(true);
    throw new AgentJobAnswerError("stopped", null);
  });
  await runner.run(job);
  expect(answer).toHaveBeenCalledOnce();
  expect(messages.insert).toHaveBeenCalledWith(
    expect.objectContaining({ notice: "agent_stopped" }),
    expect.anything(),
  );
});

it("PAGE-344 also supplies messages arriving while the round waited and retains an older trigger", async () => {
  const { runner, answer, messages, dependencies } = fixture();
  messages.find.mockResolvedValue({ ...message, sequence: 1 });
  const latest = Array.from({ length: 30 }, (_, index) => ({
    ...message,
    id: `later-${31 - index}`,
    sequence: 31 - index,
    text: `Arrived-${31 - index}`,
  }));
  messages.history.mockImplementation(
    async (id: string, before: number | null, limit: number) =>
      latest
        .filter((item) => before === null || item.sequence < before)
        .slice(0, limit),
  );
  messages.contextCount.mockResolvedValue(31);
  vi.mocked(dependencies.content.describe).mockResolvedValue(new Map());
  answer.mockImplementationOnce(async (request: ConversationAgentRequest) => {
    if (!request.prepareTurn) throw new Error("Missing preparation");
    const continued = await request.prepareTurn(1);
    expect(continued.prompt).toContain("Diese Runde beantwortet Nachricht #1");
    expect(continued.prompt).toContain("Arrived-31");
    expect(continued.prompt).toContain("Arrived-2");
    expect(continued.prompt).toContain("Question");
    expect(continued.throughSequence).toBe(31);
    return "Answer";
  });
  await runner.run(job);
  expect(answer).toHaveBeenCalledOnce();
});

it("PAGE-344 counts only unseen originals when an older trigger is already summarized", async () => {
  const { runner, answer, messages, dependencies } = fixture();
  messages.contextCount.mockResolvedValue(30);
  messages.history.mockResolvedValue(
    Array.from({ length: 20 }, (_, index) => ({
      ...message,
      id: `m-${40 - index}`,
      sequence: 40 - index,
    })),
  );
  vi.mocked(dependencies.contexts.promptContext).mockResolvedValue({
    context: {
      conversationId: "group",
      summary: "Earlier decisions",
      decisions: [],
      openItems: [],
      responsibilities: [],
      sources: [],
      throughSequence: 10,
      hasExcerpts: false,
      status: "behind",
      errorCode: null,
      revision: 1,
      updatedAt: "today",
      attemptedAt: "today",
    },
    view: {
      conversationId: "group",
      summary: "Earlier decisions",
      decisions: [],
      openItems: [],
      responsibilities: [],
      throughSequence: 10,
      pendingMessages: 30,
      hasExcerpts: false,
      status: "behind",
      errorCode: null,
      sources: [],
      updatedAt: "today",
    },
  });
  await runner.run(job);
  expect(answer.mock.calls[0]?.[0].prompt).toContain("11 Nachrichten fehlen");
});

it("PAGE-344 keeps the actual refusal reason and conversation identity in safe log metadata", async () => {
  const event = vi.spyOn(logging, "logEvent");
  try {
    const { runner, answer } = fixture();
    answer.mockRejectedValue(
      new AgentJobAnswerError("failed", "plan_step_failed"),
    );
    await runner.run(job);
    const refused = event.mock.calls
      .map(([entry]) => entry)
      .find((entry) => entry.event === "conversation.agent_reply.refused");
    if (!refused) throw new Error("Missing refusal event");
    const metadata = safeLogMetadata(refused.metadata);
    expect(metadata).toMatchObject({
      sessionId: "group",
      source: "conversation",
      code: "plan_step_failed",
      reason: "agent_failed",
    });
    expect(metadata.truncated).toBeUndefined();
  } finally {
    event.mockRestore();
  }
});

it("copies and binds workspace files inside the job callback before its workspace disappears", async () => {
  const { runner, answer, dependencies, messages } = fixture();
  let workspaceExists = true;
  vi.mocked(dependencies.agentFiles.select).mockImplementation(async () => {
    if (!workspaceExists) throw new Error("Workspace already removed");
    return {
      text: "Answer",
      lines: ["Answer", "![File](file:/workspace/report.txt)"],
      files: [
        {
          path: "/workspace/report.txt",
          name: "report.txt",
          mimeType: "text/plain",
          sizeBytes: 3,
          lineIndex: 1,
        },
      ],
    };
  });
  vi.mocked(dependencies.attachments.stage).mockImplementation(async () => {
    expect(workspaceExists).toBe(true);
    return staged;
  });
  answer.mockImplementation(async (request: ConversationAgentRequest) => {
    await request.consumeAnswer?.("Answer");
    workspaceExists = false;
    return "Answer";
  });
  const result = await runner.run(job);
  expect(result?.id).toBe("answer");
  expect(workspaceExists).toBe(false);
  expect(dependencies.attachments.bind).toHaveBeenCalledWith(
    expect.anything(),
    [staged.id],
  );
  expect(dependencies.attachments.stage).toHaveBeenCalledOnce();
  expect(messages.insert).toHaveBeenCalledOnce();
});
