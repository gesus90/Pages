import { expect, it, vi, type Mock } from "vitest";

import { ChatSteerRepository } from "./ChatSteerRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { ChatSelection } from "@/definition/ChatJob";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: Pick<Database, "query" | "execute">;
  readonly execute: Mock<Database["execute"]>;
  readonly query: Mock<Database["query"]>;
} {
  const execute = vi.fn<Database["execute"]>(async () => {});
  const query = vi.fn<Database["query"]>(async () => rows);
  return { database: { execute, query }, execute, query };
}

it("records a steer as pending", async () => {
  const { database, execute } = databaseOf();
  await new ChatSteerRepository(database).create(
    { messageId: "m1", jobId: "j1" },
    "s1",
  );
  expect(execute.mock.calls[0]?.[1]).toEqual({
    message_id: "m1",
    job_id: "j1",
    session_id: "s1",
  });
});

it("moves a steer to a status", async () => {
  const { database, execute } = databaseOf();
  await new ChatSteerRepository(database).update("m1", "accepted");
  expect(execute.mock.calls[0]?.[1]).toEqual({
    message_id: "m1",
    status: "accepted",
  });
});

it("records the answer of a follow-up turn", async () => {
  const { database, execute } = databaseOf();
  await new ChatSteerRepository(database).answer("m1", "a1");
  expect(execute.mock.calls[0]?.[1]).toEqual({
    message_id: "m1",
    answer_message_id: "a1",
  });
});

it("lists the steers of a conversation", async () => {
  const { database, query } = databaseOf([["m1", "j1", "followUp"]]);
  await expect(new ChatSteerRepository(database).list("s1")).resolves.toEqual([
    { messageId: "m1", jobId: "j1", status: "followUp" },
  ]);
  expect(query.mock.calls[0]?.[1]).toEqual({ session_id: "s1" });
});

it("rejects an unknown steer status", async () => {
  const { database } = databaseOf([["m1", "j1", "unknown"]]);
  await expect(new ChatSteerRepository(database).list("s1")).rejects.toThrow(
    "Invalid chat steer status",
  );
});

it("writes the selection snapshot as JSON", async () => {
  const { database, execute } = databaseOf();
  const selection: ChatSelection = {
    messageId: "m1",
    items: [
      {
        attachmentId: "a1",
        fileName: "f.txt",
        contentType: "text/plain",
        size: 3,
        transfer: "full",
      },
    ],
  };
  await new ChatSteerRepository(database).select("s1", selection);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    message_id: "m1",
    session_id: "s1",
    items: JSON.stringify(selection.items),
  });
});

it("lists the selection snapshots of a conversation", async () => {
  const items = [
    {
      attachmentId: "a1",
      fileName: "f.txt",
      contentType: "text/plain",
      size: 3,
      transfer: "extracted",
      scope: { characters: 3 },
    },
  ];
  const { database } = databaseOf([["m1", JSON.stringify(items)]]);
  await expect(
    new ChatSteerRepository(database).selections("s1"),
  ).resolves.toEqual([{ messageId: "m1", items }]);
});
