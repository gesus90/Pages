import { afterEach, expect, it, vi } from "vitest";

import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { ChatService } from "@/backend/service/chat/ChatService";
import { createChatPrompt } from "@/backend/service/chat/ChatPrompt";

import {
  ASSIGNMENT,
  ContextFixture,
  FIRST,
  OWNER,
  SESSION,
} from "./page48-chat-fixture";

afterEach(() => {
  vi.useRealTimers();
});

it("estimates the bounded context in tokens and exposes the known model limit", async () => {
  const fixture = new ContextFixture();
  const context = await fixture.service.size(OWNER, FIRST);
  expect(context).toMatchObject({ isEstimated: true, limit: 128_000 });
  expect(context.tokens).toBeGreaterThan(1000);
  fixture.messages.splice(0);
  expect(await fixture.service.size(OWNER, FIRST)).toEqual({
    tokens: 0,
    limit: 128_000,
    isEstimated: true,
  });
  fixture.resolve.mockRejectedValueOnce(new TextAssistantError("roleMissing"));
  expect(await fixture.service.size(OWNER, FIRST)).toMatchObject({
    limit: null,
  });
});

it("compacts older messages, retains the newest four, reduces the estimate and preserves every transcript message", async () => {
  const fixture = new ContextFixture();
  const transcript = structuredClone(fixture.messages);
  const before = await fixture.service.size(OWNER, FIRST);
  const result = await fixture.service.compact(OWNER, FIRST);
  expect(result.status).toBe("compacted");
  expect(result.context.tokens).toBeLessThan(before.tokens ?? 0);
  expect(fixture.messages).toEqual(transcript);
  expect(fixture.stored).toMatchObject({
    summary: "Goals, decisions and pending tasks.",
    throughId: "message-5",
    revision: 1,
  });
  expect(
    (await fixture.service.history(OWNER, FIRST)).messages.map(({ id }) => id),
  ).toEqual(["message-6", "message-7", "message-8", "message-9"]);
  expect(await fixture.service.size(OWNER, FIRST)).toEqual(result.context);
  expect((await fixture.service.compact(OWNER, FIRST)).status).toBe(
    "notNeeded",
  );
  expect(fixture.run).toHaveBeenCalledOnce();
});

it("refuses a parallel compaction and a simultaneous send registry request, then releases the lock", async () => {
  const fixture = new ContextFixture();
  let release: ((text: string) => void) | undefined;
  fixture.run.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  const first = fixture.service.compact(OWNER, FIRST);
  await vi.waitFor(() => expect(fixture.run).toHaveBeenCalledOnce());
  await expect(fixture.service.compact(OWNER, FIRST)).rejects.toMatchObject({
    code: "requestBusy",
  });
  await expect(
    fixture.requests.run(OWNER.id, "send", async () => "answer"),
  ).rejects.toMatchObject({ code: "requestBusy" });
  expect(fixture.run).toHaveBeenCalledOnce();
  if (!release) throw new Error("No pending compaction");
  release("Reduced context");
  await first;
  expect((await fixture.service.compact(OWNER, FIRST)).status).toBe(
    "notNeeded",
  );
});

it.each(["", "x".repeat(4_001)])(
  "keeps context and transcript after invalid summary output",
  async (output) => {
    const fixture = new ContextFixture();
    fixture.run.mockResolvedValueOnce(output);
    const before = structuredClone(fixture.messages);
    await expect(fixture.service.compact(OWNER, FIRST)).rejects.toMatchObject({
      code: "compactionFailed",
    });
    expect(fixture.save).not.toHaveBeenCalled();
    expect(fixture.stored.revision).toBe(0);
    expect(fixture.messages).toEqual(before);
  },
);

it("keeps the previous summary and transcript after provider failure or unavailable model", async () => {
  const fixture = new ContextFixture();
  fixture.stored = {
    summary: "Earlier context",
    throughId: "message-0",
    revision: 2,
  };
  const before = structuredClone(fixture.messages);
  fixture.run.mockRejectedValueOnce(new TextAssistantError("providerFailed"));
  await expect(fixture.service.compact(OWNER, FIRST)).rejects.toMatchObject({
    code: "providerFailed",
  });
  fixture.resolve.mockRejectedValueOnce(new TextAssistantError("roleMissing"));
  await expect(fixture.service.compact(OWNER, FIRST)).rejects.toMatchObject({
    code: "roleMissing",
  });
  expect(fixture.stored).toEqual({
    summary: "Earlier context",
    throughId: "message-0",
    revision: 2,
  });
  expect(fixture.messages).toEqual(before);
  expect(fixture.save).not.toHaveBeenCalled();
});

it("reports short or non-reducing context as not needed without saving", async () => {
  const fixture = new ContextFixture();
  fixture.messages.splice(4);
  expect((await fixture.service.compact(OWNER, FIRST)).status).toBe(
    "notNeeded",
  );
  expect(fixture.run).not.toHaveBeenCalled();
  fixture.messages.push(
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `extra-${index}`,
      role: "user" as const,
      content: "short",
      createdAt: "today",
    })),
  );
  fixture.messages.splice(0, 4);
  fixture.stored = {
    summary: "x".repeat(2000),
    throughId: "extra-0",
    revision: 1,
  };
  fixture.run.mockResolvedValueOnce("y".repeat(4000));
  expect((await fixture.service.compact(OWNER, FIRST)).status).toBe(
    "notNeeded",
  );
  expect(fixture.save).not.toHaveBeenCalled();
});

it("does not overwrite context or new messages that changed during compaction", async () => {
  const fixture = new ContextFixture();
  fixture.run.mockImplementationOnce(async () => {
    fixture.messages.push({
      id: "new-message",
      role: "user",
      content: "Concurrent message",
      createdAt: "today",
    });
    return "Summary";
  });
  await expect(fixture.service.compact(OWNER, FIRST)).rejects.toMatchObject({
    code: "contextChanged",
  });
  expect(fixture.stored.revision).toBe(0);
  expect(fixture.messages.at(-1)?.id).toBe("new-message");
});

it("never hides history for a stale summary boundary and checks ownership", async () => {
  const fixture = new ContextFixture();
  fixture.stored = {
    summary: "Stale",
    throughId: "missing-message",
    revision: 1,
  };
  expect(await fixture.service.history(OWNER, FIRST)).toEqual({
    summary: null,
    messages: fixture.messages,
  });
  await expect(
    fixture.service.compact({ ...OWNER, id: "foreign" }, FIRST),
  ).rejects.toMatchObject({ code: "sessionMissing" });
  await expect(
    fixture.service.compact({ ...OWNER, isActive: false }, FIRST),
  ).rejects.toMatchObject({ code: "accessDenied" });
  expect(fixture.run).not.toHaveBeenCalled();
});

it("uses the summary in the next real chat turn while the stored transcript stays complete", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
  const fixture = new ContextFixture();
  await fixture.service.compact(OWNER, FIRST);
  const run = vi.fn(async () => "Answer after compaction");
  const append = vi.fn(
    async (
      userId: string,
      sessionId: string,
      message: { role: "user" | "assistant"; content: string },
    ) => ({
      ...message,
      id: `new-${userId}-${sessionId}-${message.role}`,
      createdAt: "today",
    }),
  );
  const chat = new ChatService({
    sessions: { require: async () => SESSION },
    context: fixture.service,
    messages: { messages: async () => fixture.messages, append },
    attachments: {
      pending: async () => [],
      link: async () => undefined,
      readText: async () => "",
    },
    settings: { instruction: async () => "Pica" },
    protectedInstructions: async () => ({ soul: "Soul", agents: "Rules" }),
    agents: { resolve: async () => ASSIGNMENT },
    execution: { run },
    tools: { run: async () => ({ ok: false, error: "INVALID_REQUEST" }) },
    requests: fixture.requests,
    languages: { findByUserId: async () => null },
  });
  await chat.send(OWNER, {
    sessionId: FIRST,
    requestId: "after-compact",
    text: "Continue",
  });
  const effective = await fixture.service.history(OWNER, FIRST);
  const prompt = createChatPrompt({
    personName: OWNER.displayName,
    interfaceLanguage: "de",
    today: "2026-10-15",
    history: effective.messages,
    summary: effective.summary,
    message: "Continue",
    attachments: [],
    steps: [],
    isLastStep: false,
  });
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({ prompt }),
    expect.any(AbortSignal),
  );
  expect(prompt).toContain("Goals, decisions and pending tasks.");
  expect(prompt).not.toContain("Fact 0");
  expect(prompt).toContain("Fact 9");
  expect(fixture.messages).toHaveLength(10);
});
