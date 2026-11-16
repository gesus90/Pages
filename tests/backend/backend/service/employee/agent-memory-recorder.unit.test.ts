import { expect, it, vi } from "vitest";

import { AgentMemoryRecorder } from "@/backend/service/employee/AgentMemoryRecorder";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type {
  AgentAnswerRecord,
  AgentMemoryRecorderDependencies,
} from "@/backend/service/employee/AgentMemoryRecorder";

const ANSWER = partial<AgentAnswerRecord>({
  agent: { id: "agent", displayName: "Agent" },
  chat: { kind: "direct", personId: "person" },
  chatLabel: "Chat",
  personName: "Person",
  message: "Question",
  answer: "Answer",
  sessionId: "session",
});

it("never sends confidential chat contents to the memory model", async () => {
  const topics = vi.fn();
  const recorder = new AgentMemoryRecorder(
    partial<AgentMemoryRecorderDependencies>({
      store: { chats: () => ({ isConfidential: async () => true }) },
      model: { topics },
    }),
  );
  await recorder.record(ANSWER);
  expect(topics).not.toHaveBeenCalled();
});

it("records topic updates and summarizes only older messages", async () => {
  const updateMemory = vi.fn(
    async (
      agentId: string,
      change: (current: AgentMemoryDocument) => {
        document: AgentMemoryDocument;
      },
    ) => {
      expect(agentId).toBe("agent");
      const result = change({ preamble: "", entries: [] });
      expect(result.document.entries).toHaveLength(1);
      expect(result.document.entries[0]?.title).toBe("Topic");
      return 0;
    },
  );
  const saveSummary = vi.fn(async () => {});
  const transcript = Array.from({ length: 24 }, (_, index) => ({
    id: `message-${index}`,
    role: "user",
    content: `text ${index}`,
  }));
  const topics = vi.fn(async () => [
    {
      title: "Topic",
      about: "About",
      status: "open",
      nextStep: "Next",
      tickets: [],
      wikiPages: [],
      isDone: false,
    },
  ]);
  const summarize = vi.fn(async () => "Summary");
  const recorder = new AgentMemoryRecorder(
    partial<AgentMemoryRecorderDependencies>({
      store: {
        chats: () => ({
          isConfidential: async () => false,
          summary: async () => null,
          saveSummary,
        }),
        employees: () => ({ find: async () => ({ memory: "" }) }),
      },
      messages: { messages: async () => transcript },
      memory: { updateMemory },
      model: { topics, summarize },
      today: () => "2026-01-01",
    }),
  );
  await recorder.record(ANSWER);
  expect(updateMemory).toHaveBeenCalledOnce();
  expect(summarize).toHaveBeenCalledOnce();
  expect(saveSummary).toHaveBeenCalledWith("session", {
    summary: "Summary",
    throughId: "message-13",
  });
});
