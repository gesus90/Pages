import { expect, it, vi } from "vitest";

import { AgentChatMemoryRepository } from "./AgentChatMemoryRepository";

import type { Database } from "@/backend/database/Database";

function doubleOf(rows: unknown[][]): {
  repository: AgentChatMemoryRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new AgentChatMemoryRepository({
      query,
      execute,
    } as unknown as Database),
    query,
    execute,
  };
}

it("reads a stored summary", async () => {
  const { repository } = doubleOf([["text", "m1"]]);

  expect(await repository.summary("s")).toEqual({
    summary: "text",
    throughId: "m1",
  });
});

it("reads no summary for a missing row or missing parts", async () => {
  expect(await doubleOf([]).repository.summary("s")).toBeNull();
  expect(await doubleOf([[null, "m"]]).repository.summary("s")).toBeNull();
  expect(await doubleOf([["t", null]]).repository.summary("s")).toBeNull();
});

it("saves a summary", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.saveSummary("s", { summary: "t", throughId: "m" });

  expect(execute.mock.calls[0]?.[1]).toEqual({
    session_id: "s",
    summary: "t",
    through_id: "m",
  });
});

it("reads confidentiality of a person chat and of a conversation", async () => {
  const person = doubleOf([[1]]);
  const conversation = doubleOf([[0]]);

  expect(
    await person.repository.isConfidential("a", {
      kind: "person",
      personId: "p",
    }),
  ).toBe(true);
  expect(person.query.mock.calls[0]?.[1]).toEqual({
    agent_id: "a",
    person_id: "p",
  });
  expect(
    await conversation.repository.isConfidential("a", {
      kind: "conversation",
      conversationId: "c",
    }),
  ).toBe(false);
  expect(conversation.query.mock.calls[0]?.[1]).toEqual({
    conversation_id: "c",
  });
});

it("treats a missing chat as not confidential", async () => {
  const { repository } = doubleOf([]);

  expect(
    await repository.isConfidential("a", { kind: "person", personId: "p" }),
  ).toBe(false);
  expect(await repository.isConfidentialConversation("a", "c")).toBe(false);
});

it("reads confidentiality of a stored conversation", async () => {
  const { repository } = doubleOf([[1]]);

  expect(await repository.isConfidentialConversation("a", "c")).toBe(true);
});

it("marks a direct chat and reports whether it exists", async () => {
  expect(
    await doubleOf([["s"]]).repository.setDirectConfidential("a", "p", true),
  ).toBe(true);
  expect(
    await doubleOf([]).repository.setDirectConfidential("a", "p", false),
  ).toBe(false);
});

it("marks a conversation", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.setConversationConfidential("c", true);

  expect(execute.mock.calls[0]?.[1]).toEqual({
    conversation_id: "c",
    is_confidential: true,
  });
});

it("lists people and confidential sets", async () => {
  const { repository } = doubleOf([["x"], ["y"]]);

  expect(await repository.conversationPeople("c")).toEqual(["x", "y"]);
  expect(await repository.confidentialAgents("p")).toEqual(new Set(["x", "y"]));
  expect(await repository.confidentialConversations("p")).toEqual(
    new Set(["x", "y"]),
  );
  expect(await repository.confidentialPeople("a")).toEqual(new Set(["x", "y"]));
});
