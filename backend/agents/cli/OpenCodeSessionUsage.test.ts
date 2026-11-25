import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";
import {
  readOpenCodeMessage,
  readOpenCodeSessionUsage,
} from "@/backend/agents/cli/OpenCodeSessionUsage";

let directory = "";

beforeEach(async () => {
  await mkdir(pagesTempDirectory("opencode-usage-test"), { recursive: true });
  directory = await mkdtemp(pagesTempDirectory("opencode-usage-test", "run-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function assistant(parts: object = {}): string {
  return JSON.stringify({
    role: "assistant",
    providerID: "google",
    modelID: "flash",
    cost: 0.5,
    tokens: {
      input: 1,
      output: 2,
      reasoning: 3,
      cache: { read: 4, write: 5 },
    },
    ...parts,
  });
}

it("reads a complete assistant row", () => {
  expect(
    readOpenCodeMessage({ id: "m", session_id: "s", data: assistant() }),
  ).toEqual({
    id: "m",
    sessionId: "s",
    model: "google/flash",
    inputTokens: 1,
    outputTokens: 2,
    reasoningTokens: 3,
    cacheReadTokens: 4,
    cacheWriteTokens: 5,
    costUsd: 0.5,
  });
});

it("does not trust a missing or malformed shape", () => {
  expect(
    readOpenCodeMessage({
      id: "m",
      session_id: "s",
      data: JSON.stringify({
        role: "assistant",
        providerID: 1,
        tokens: { input: -1, output: 1.5, cache: [] },
        cost: Number.NaN,
      }),
    }),
  ).toEqual({
    id: "m",
    sessionId: "s",
    model: null,
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    costUsd: null,
  });
  expect(
    readOpenCodeMessage({
      id: "m",
      session_id: "s",
      data: JSON.stringify({ role: "assistant", cost: "1" }),
    })?.costUsd,
  ).toBeNull();
});

it("skips rows that are no usable assistant message", () => {
  expect(
    readOpenCodeMessage({ id: 1, session_id: "s", data: "{}" }),
  ).toBeNull();
  expect(
    readOpenCodeMessage({ id: "m", session_id: 1, data: "{}" }),
  ).toBeNull();
  expect(
    readOpenCodeMessage({ id: "m", session_id: "s", data: "{" }),
  ).toBeNull();
  expect(
    readOpenCodeMessage({ id: "m", session_id: "s", data: "[]" }),
  ).toBeNull();
  expect(
    readOpenCodeMessage({
      id: "m",
      session_id: "s",
      data: JSON.stringify({ role: "user" }),
    }),
  ).toBeNull();
});

it("returns no usage without a database", () => {
  expect(
    readOpenCodeSessionUsage(path.join(directory, "missing.db"), "s"),
  ).toEqual([]);
});

it("reads the session and its descendants in message order", () => {
  const file = path.join(directory, "opencode.db");
  const database = new DatabaseSync(file);
  database.exec(
    `CREATE TABLE session (id TEXT, parent_id TEXT);
     CREATE TABLE message (id TEXT, session_id TEXT, data TEXT, time_created INTEGER);
     INSERT INTO session VALUES ('root', NULL), ('child', 'root'), ('other', NULL);`,
  );
  const insert = database.prepare("INSERT INTO message VALUES (?, ?, ?, ?)");
  insert.run("m2", "child", assistant({ cost: 2 }), 2);
  insert.run("m1", "root", assistant({ cost: 1 }), 1);
  insert.run("skip", "root", JSON.stringify({ role: "user" }), 3);
  insert.run("foreign", "other", assistant(), 4);
  database.close();
  expect(
    readOpenCodeSessionUsage(file, "root").map((usage) => [
      usage.id,
      usage.costUsd,
    ]),
  ).toEqual([
    ["m1", 1],
    ["m2", 2],
  ]);
});

it("skips a model step that has reported nothing yet", () => {
  const zeros = {
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
  const read = (parts: object): ReturnType<typeof readOpenCodeMessage> =>
    readOpenCodeMessage({
      id: "m",
      session_id: "s",
      data: assistant({ ...zeros, ...parts }),
    });
  expect(read({})).toBeNull();
  expect(read({ finish: "stop" })).toMatchObject({ id: "m" });
  expect(read({ tokens: { ...zeros.tokens, total: 0 } })).toMatchObject({
    id: "m",
  });
  expect(read({ cost: 0.1 })).toMatchObject({ id: "m" });
});
