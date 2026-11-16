import { expect, it, vi } from "vitest";

import { AgentSessionRecorder } from "@/backend/service/agents/sessions/AgentSessionRecorder";
import { AgentSessionJournal } from "@/backend/service/agents/sessions/AgentSessionJournal";
import { UNKNOWN_CONTEXT } from "@/backend/service/agents/sessions/AgentSessionUsage";

import { partial } from "../../../app/lib/service-wiring-fakes";
import { MemorySessionStore } from "./page85-session-fixture";

import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { AgentSessionAttemptRecord } from "@/backend/service/agents/sessions/AgentSessionStore";

function attempt(): AgentSessionAttemptRecord {
  return partial<AgentSessionAttemptRecord>({
    key: { planId: "plan", runId: "run", stepId: "step", attemptId: "attempt" },
    provider: "opencode",
    requestedModel: null,
    context: UNKNOWN_CONTEXT,
    confirmedModel: { value: null, source: null, reportedAt: null },
  });
}

it("persists message, thought and tool boundaries in their original order", async () => {
  const store = new MemorySessionStore();
  const recorder = new AgentSessionRecorder(
    { store, journal: new AgentSessionJournal(store) },
    attempt(),
  );
  recorder.update(
    partial<SessionUpdate>({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "hello" },
    }),
  );
  recorder.update(
    partial<SessionUpdate>({
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "thinking" },
    }),
  );
  recorder.update(
    partial<SessionUpdate>({
      sessionUpdate: "tool_call",
      toolCallId: "call",
      title: "Read",
      kind: "read",
      rawInput: { path: "file.txt" },
    }),
  );
  recorder.update(
    partial<SessionUpdate>({
      sessionUpdate: "tool_call_update",
      toolCallId: "call",
      status: "completed",
      rawOutput: "done",
    }),
  );
  recorder.closed();
  await recorder.settled();
  const events = (await store.readEvents("attempt", 0, 20)).events;
  expect(events.map((event) => event.kind)).toEqual([
    "agent_message",
    "thought",
    "tool_started",
    "tool_completed",
    "status",
  ]);
  expect(events.map((event) => event.text).join("\n")).toContain("file.txt");
  expect(events.map((event) => event.text).join("\n")).toContain("done");
});

it("reports failed durable writes to the caller", async () => {
  const store = new MemorySessionStore();
  vi.spyOn(store, "saveAttempt").mockRejectedValue(new Error("offline"));
  const recorder = new AgentSessionRecorder(
    { store, journal: new AgentSessionJournal(store) },
    attempt(),
  );
  await expect(recorder.drained()).rejects.toThrow();
});
