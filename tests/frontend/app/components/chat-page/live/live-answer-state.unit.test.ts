import { expect, it } from "vitest";

import {
  activityOf,
  answersOfChat,
  applyLiveAnswerEvent,
  EMPTY_LIVE_STATE,
  endedByMessage,
  formatSeconds,
  shownLiveAnswers,
  toolAction,
  toolsDuration,
  toolTarget,
} from "@/app/components/chat-page/live/live-answer-state";

import type {
  LiveAnswerEventPayload,
  LiveAnswerHead,
  LiveAnswerTool,
} from "@/definition/ConversationLiveAnswer";
import type { LiveAnswerState } from "@/app/components/chat-page/live/live-answer-state";

function head(seq: number, at = "2026-11-14T10:00:00.000Z"): LiveAnswerHead {
  return {
    chatKind: "agent",
    chatId: "ed",
    agentId: "ed",
    answerId: "a1",
    seq,
    at,
  };
}

function text(seq: number, delta: string, isReset = false): LiveAnswerEventPayload {
  return { type: "answer_text", data: { ...head(seq), delta, isReset } };
}

function tool(
  seq: number,
  overrides: Partial<LiveAnswerTool> = {},
): LiveAnswerEventPayload {
  return {
    type: "answer_tool",
    data: {
      ...head(seq),
      tool: {
        callId: "c1",
        name: "Read",
        status: "running",
        startedAt: "2026-11-14T10:00:00.000Z",
        ...overrides,
      },
    },
  };
}

function apply(...payloads: LiveAnswerEventPayload[]): LiveAnswerState {
  return payloads.reduce(applyLiveAnswerEvent, EMPTY_LIVE_STATE);
}

it("grows the text of an answer part by part and starts anew after a reset", () => {
  const state = apply(text(1, "Hallo "), text(2, "Welt"), text(3, "Neu", true));
  expect(state.answers["a1"]?.text).toBe("Neu");
  expect(apply(text(1, "Hallo "), text(2, "Welt")).answers["a1"]?.text).toBe(
    "Hallo Welt",
  );
});

it("keeps a part once when it comes again, also after a snapshot that holds it", () => {
  const snapshot: LiveAnswerEventPayload = {
    type: "answer_snapshot",
    data: {
      ...head(2),
      startedAt: "2026-11-14T09:59:00.000Z",
      text: "Hallo Welt",
      thought: null,
      tools: [],
      end: null,
    },
  };
  // After a reconnect: the snapshot, then the parts the server sent meanwhile.
  const state = apply(text(1, "Hallo "), snapshot, text(2, "Welt"), text(3, "!"));
  expect(state.answers["a1"]?.text).toBe("Hallo Welt!");
  // An older snapshot never takes back what the page already has.
  const later = applyLiveAnswerEvent(
    apply(text(1, "Hallo "), text(2, "Welt"), text(3, "!")),
    snapshot,
  );
  expect(later.answers["a1"]?.text).toBe("Hallo Welt!");
});

it("follows a tool call in its place and remembers how a message went in", () => {
  const state = apply(
    tool(1),
    tool(2, { status: "completed", endedAt: "2026-11-14T10:00:03.100Z" }),
    {
      type: "answer_steer",
      data: { ...head(3), messageId: "m9", delivery: "waiting" },
    },
  );
  expect(state.answers["a1"]?.tools).toEqual([
    expect.objectContaining({ callId: "c1", status: "completed" }),
  ]);
  expect(state.deliveries["m9"]).toEqual({ delivery: "waiting", agentId: "ed" });
  expect(toolsDuration(state.answers["a1"]?.tools ?? [])).toBe(3100);
});

it("shows an answer until its stored message is in the history, and never both", () => {
  const ended = apply(text(1, "Fertig"), {
    type: "answer_end",
    data: { ...head(2), messageId: "m1", state: "answered" },
  });
  const views = answersOfChat(ended, { chatKind: "agent", chatId: "ed" });
  expect(shownLiveAnswers(views, new Set())).toHaveLength(1);
  expect(shownLiveAnswers(views, new Set(["m1"]))).toHaveLength(0);
  expect(endedByMessage(views).get("m1")?.text).toBe("Fertig");
  expect(answersOfChat(ended, { chatKind: "conversation", chatId: "ed" })).toEqual([]);
  // A stopped answer without a stored message leaves the history at once.
  const stopped = apply(text(1, "Halb"), {
    type: "answer_end",
    data: { ...head(2), messageId: null, state: "stopped" },
  });
  expect(
    shownLiveAnswers(
      answersOfChat(stopped, { chatKind: "agent", chatId: "ed" }),
      new Set(),
    ),
  ).toEqual([]);
});

it("names what an agent does: a running tool, thinking, writing or working", () => {
  expect(activityOf(null)).toEqual({ kind: "working" });
  const thinking = apply({
    type: "answer_thought",
    data: { ...head(1), delta: "Hm", startedAt: "2026-11-14T10:00:00.000Z" },
  });
  expect(activityOf(thinking.answers["a1"] ?? null)).toEqual({ kind: "thinking" });
  expect(activityOf(apply(text(1, "Ich")).answers["a1"] ?? null)).toEqual({
    kind: "writing",
  });
  const reading = apply(
    tool(1, { input: "backend/service/conversation/ConversationEvents.ts" }),
  );
  expect(activityOf(reading.answers["a1"] ?? null)).toEqual({
    kind: "tool",
    action: "read",
    target: "ConversationEvents.ts",
    running: 1,
  });
  const ended = apply(text(1, "x"), {
    type: "answer_end",
    data: { ...head(2), messageId: "m", state: "answered" },
  });
  expect(activityOf(ended.answers["a1"] ?? null)).toBeNull();
});

it("tells the action of a tool call from its name and input", () => {
  expect(toolAction({ name: "Bash", input: "pnpm vitest run" })).toBe("test");
  expect(toolAction({ name: "Edit", input: "a.ts" })).toBe("edit");
  expect(toolAction({ name: "Grep", input: "foo" })).toBe("search");
  expect(toolAction({ name: "Bash", input: "ls -la" })).toBe("run");
  expect(toolAction({ name: "list_tickets" })).toBe("search");
  expect(toolAction({ name: "rezept" })).toBe("use");
  expect(toolTarget({ input: "" })).toBe("");
  expect(toolTarget({ input: "x".repeat(50) })).toHaveLength(41);
});

it("writes durations as the reference shows them", () => {
  expect(formatSeconds(3100, "de")).toBe("3,1 s");
  expect(formatSeconds(12_400, "de")).toBe("12 s");
  expect(formatSeconds(125_000, "de")).toBe("2 min 5 s");
});
