import { expect, it } from "vitest";

import {
  toPicaMobileChatJob,
  toPicaMobileChatSessions,
  toPicaMobileChatView,
} from "@/backend/service/mobile/chat/PicaMobileChatPayloads";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type {
  ChatMessage,
  ChatSession,
  ChatSessionView,
} from "@/definition/Chat";
import type { ChatJobUpdate } from "@/definition/ChatJob";

const session = partial<ChatSession>({
  id: "session",
  createdAt: "start",
  lastMessageAt: "end",
  preview: "Preview",
});

it("pages messages from newest to oldest and rejects unknown cursors", () => {
  const messages = Array.from({ length: 35 }, (_, index) =>
    partial<ChatMessage>({
      id: String(index),
      role: "user",
      content: `Message ${index}`,
      createdAt: "now",
      attachments: [],
    }),
  );
  const view = partial<ChatSessionView>({
    session,
    messages,
    pending: [],
    activity: null,
  });
  const page = toPicaMobileChatView(view);
  expect(page.messages).toHaveLength(30);
  expect(page.messages[0]?.id).toBe("5");
  expect(page.hasOlder).toBe(true);
  expect(
    toPicaMobileChatView(view, "5").messages.map((message) => message.id),
  ).toEqual(["0", "1", "2", "3", "4"]);
  expect(() => toPicaMobileChatView(view, "missing")).toThrow();
});

it("truncates previews by Unicode characters and limits session lists", () => {
  const sessions = Array.from({ length: 205 }, (_, index) => ({
    ...session,
    id: String(index),
    preview: "😀".repeat(130),
  }));
  const result = toPicaMobileChatSessions(sessions);
  expect(result.sessions).toHaveLength(200);
  expect(Array.from(result.sessions[0]?.preview ?? "")).toHaveLength(120);
});

it("transfers supported job events while preserving the journal cursor", () => {
  expect(toPicaMobileChatJob(null)).toEqual({ jobId: null });
  const update = partial<ChatJobUpdate>({
    job: { id: "job", state: "running", errorCode: null },
    cursor: 3,
    hasMore: false,
    events: [
      { sequence: 1, event: { kind: "phase", phase: "thinking" } },
      {
        sequence: 2,
        event: { kind: "text", turn: 1, delta: "hello", isReset: false },
      },
      {
        sequence: 3,
        event: { kind: "end", state: "completed", errorCode: null },
      },
    ],
  });
  expect(toPicaMobileChatJob(update)).toMatchObject({
    jobId: "job",
    cursor: 3,
    hasMore: false,
    events: [
      { sequence: 2, event: { kind: "text", delta: "hello" } },
      { sequence: 3, event: { kind: "end", state: "completed" } },
    ],
  });
});
