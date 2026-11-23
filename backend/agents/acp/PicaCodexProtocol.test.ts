import { expect, it } from "vitest";

import {
  PICA_CODEX_METHOD,
  PICA_CODEX_REQUEST,
} from "@/backend/agents/acp/PicaCodexProtocol";

const HEX = "a".repeat(64);
const UUID = "123e4567-e89b-42d3-a456-426614174000";

const READY = {
  requestId: "r1",
  threadId: "t1",
  turnId: "u1",
  nonce: HEX,
  operationId: UUID,
  sequence: 1,
  context: HEX,
  catalog: [
    {
      type: "function",
      name: "tool_a",
      description: "A tool",
      inputSchema: { type: "object" },
    },
  ],
};

it("names every private request under the pages namespace", () => {
  expect(
    Object.values(PICA_CODEX_METHOD).every((name) =>
      name.startsWith("_pages/pica/"),
    ),
  ).toBe(true);
});

it("accepts the strict request shapes", () => {
  expect(PICA_CODEX_REQUEST.catalog.safeParse({}).success).toBe(true);
  expect(PICA_CODEX_REQUEST.thread.safeParse({ threadId: "t1" }).success).toBe(
    true,
  );
  expect(
    PICA_CODEX_REQUEST.policyThread.safeParse({
      threadId: "t1",
      context: HEX,
    }).success,
  ).toBe(true);
  expect(
    PICA_CODEX_REQUEST.policyThread.safeParse({ threadId: "t1" }).success,
  ).toBe(true);
  expect(
    PICA_CODEX_REQUEST.turn.safeParse({ threadId: "t1", turnId: "u1" }).success,
  ).toBe(true);
  expect(
    PICA_CODEX_REQUEST.prepareCancel.safeParse({ threadId: "t1", nonce: HEX })
      .success,
  ).toBe(true);
  expect(PICA_CODEX_REQUEST.ready.safeParse(READY).success).toBe(true);
  expect(
    PICA_CODEX_REQUEST.call.safeParse({
      operationId: UUID,
      nonce: HEX,
      sequence: 2,
      threadId: "t1",
      turnId: "u1",
      callId: "c1",
      tool: "tool_a",
      arguments: {},
    }).success,
  ).toBe(true);
  expect(
    PICA_CODEX_REQUEST.chunk.safeParse({
      operationId: UUID,
      nonce: HEX,
      sequence: 2,
      threadId: "t1",
      turnId: "u1",
      callId: "c1",
      receipt: UUID,
      image: 0,
      offset: 0,
    }).success,
  ).toBe(true);
});

it("refuses unknown keys and malformed values", () => {
  expect(PICA_CODEX_REQUEST.catalog.safeParse({ a: 1 }).success).toBe(false);
  expect(PICA_CODEX_REQUEST.thread.safeParse({ threadId: "a b" }).success).toBe(
    false,
  );
  expect(
    PICA_CODEX_REQUEST.ready.safeParse({ ...READY, catalog: [] }).success,
  ).toBe(false);
  expect(
    PICA_CODEX_REQUEST.ready.safeParse({ ...READY, sequence: 0 }).success,
  ).toBe(false);
  expect(
    PICA_CODEX_REQUEST.call.safeParse({
      threadId: "t1",
      turnId: "u1",
      callId: "c1",
      tool: "bad tool",
      arguments: {},
    }).success,
  ).toBe(false);
  expect(
    PICA_CODEX_REQUEST.chunk.safeParse({
      threadId: "t1",
      turnId: "u1",
      callId: "c1",
      receipt: UUID,
      image: 4,
      offset: 0,
    }).success,
  ).toBe(false);
});
