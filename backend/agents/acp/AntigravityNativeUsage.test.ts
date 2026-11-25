import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AntigravityTurnCalls,
  antigravityTurnCalls,
  readAntigravityCall,
  readAntigravityCalls,
  sumAntigravityCalls,
} from "@/backend/agents/acp/AntigravityNativeUsage";
import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";
import { logCaughtError } from "@/backend/logging/Logger";

import type { PromptResponse } from "@agentclientprotocol/sdk";
import type { AntigravityPromptCalls } from "@/backend/agents/acp/AntigravityNativeUsage";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const SESSION = "11111111-2222-3333-4444-555555555555";
let home = "";

beforeEach(() => {
  mkdirSync(pagesTempDirectory("antigravity-usage-test"), { recursive: true });
  home = mkdtempSync(pagesTempDirectory("antigravity-usage-test", "case-"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  rmSync(home, { recursive: true, force: true });
});

function varint(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  out.push(rest);
  return out;
}

function numberField(field: number, value: number): number[] {
  return [...varint(field * 8), ...varint(value)];
}

function bytesField(field: number, bytes: readonly number[]): number[] {
  return [...varint(field * 8 + 2), ...varint(bytes.length), ...bytes];
}

function text(value: string): number[] {
  return [...new TextEncoder().encode(value)];
}

function call(
  counts: { input?: number; output?: number; cache?: number },
  requestId?: string,
): Uint8Array {
  const usage = [
    ...(counts.input === undefined ? [] : numberField(2, counts.input)),
    ...(counts.output === undefined ? [] : numberField(3, counts.output)),
    ...(counts.cache === undefined ? [] : numberField(5, counts.cache)),
  ];
  const entries = [
    ...bytesField(20, [
      ...bytesField(1, text("other")),
      ...bytesField(2, text("x")),
    ]),
    ...bytesField(20, bytesField(1, text("request_id"))),
    ...numberField(20, 1),
    ...(requestId === undefined
      ? []
      : bytesField(20, [
          ...bytesField(1, text("request_id")),
          ...bytesField(2, text(requestId)),
        ])),
  ];
  return Uint8Array.from(bytesField(1, [...bytesField(4, usage), ...entries]));
}

function databasePath(): string {
  return path.join(home, "antigravity-acp", "conversations", `${SESSION}.db`);
}

function conversation(rows: readonly (readonly [unknown, unknown])[]): void {
  mkdirSync(path.dirname(databasePath()), { recursive: true });
  const database = new DatabaseSync(databasePath());
  database.exec("CREATE TABLE gen_metadata (idx, data);");
  insert(database, rows);
  database.close();
}

function insert(
  database: DatabaseSync,
  rows: readonly (readonly [unknown, unknown])[],
): void {
  const statement = database.prepare("INSERT INTO gen_metadata VALUES (?, ?);");
  for (const [idx, payload] of rows)
    statement.run(idx as number, payload as Uint8Array);
}

function append(rows: readonly (readonly [unknown, unknown])[]): void {
  const database = new DatabaseSync(databasePath());
  insert(database, rows);
  database.close();
}

describe("readAntigravityCall", () => {
  it("reads the counts and the request id", () => {
    expect(
      readAntigravityCall(4, call({ input: 300, output: 5, cache: 7 }, "r1")),
    ).toEqual({
      callId: "r1",
      inputTokens: 300,
      outputTokens: 5,
      cacheReadTokens: 7,
    });
  });

  it("takes absent counts as zero and names a call without id by its index", () => {
    expect(readAntigravityCall(9, call({}))).toEqual({
      callId: "index:9",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
    });
  });

  it("skips rows without counts or with malformed bytes", () => {
    const rows: number[][] = [
      [],
      numberField(1, 1),
      bytesField(1, numberField(2, 1)),
      bytesField(1, bytesField(4, bytesField(2, [1]))),
      bytesField(1, bytesField(4, [0x80])),
      bytesField(1, bytesField(4, numberField(2, 2 ** 60))),
      [0x01, 0x00],
      [0x08],
      [...varint(8 + 3), 0],
      [...varint(8 + 1), 1, 2],
      [...varint(8 + 5), 1, 2],
      [...varint(8 + 2), 5, 1],
      [...varint(8 + 2), 0x80],
    ];
    for (const row of rows)
      expect(readAntigravityCall(0, Uint8Array.from(row))).toBeNull();
  });

  it("skips fixed-width fields of a row", () => {
    const usage = [
      ...varint(1 * 8 + 1),
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      ...varint(6 * 8 + 5),
      0,
      0,
      0,
      0,
      ...numberField(2, 3),
    ];
    const row = Uint8Array.from(bytesField(1, bytesField(4, usage)));
    expect(readAntigravityCall(0, row)?.inputTokens).toBe(3);
  });
});

describe("sumAntigravityCalls", () => {
  it("counts each call once, the later reading winning", () => {
    const base = { outputTokens: 1, cacheReadTokens: 2 };
    expect(
      sumAntigravityCalls([
        { callId: "a", inputTokens: 1, ...base },
        { callId: "b", inputTokens: 10, ...base },
        { callId: "a", inputTokens: 5, ...base },
      ]),
    ).toEqual({
      calls: 2,
      inputTokens: 15,
      outputTokens: 2,
      cacheReadTokens: 4,
    });
  });
});

describe("readAntigravityCalls", () => {
  it("reads nothing for an invalid id or a missing conversation", () => {
    expect(readAntigravityCalls(home, "bad", 3)).toEqual({
      lastIndex: 3,
      calls: [],
    });
    expect(readAntigravityCalls(home, SESSION, -1)).toEqual({
      lastIndex: -1,
      calls: [],
    });
  });

  it("reads the rows after an index and ignores unusable rows", () => {
    conversation([
      [1, call({ input: 1 }, "a")],
      [2, call({ input: 2 }, "b")],
      ["x", call({ input: 3 }, "c")],
      [3, "text"],
      [4, new Uint8Array([1])],
    ]);
    const all = readAntigravityCalls(home, SESSION, -1);
    expect(all.lastIndex).toBe(4);
    expect(all.calls.map((entry) => entry.callId)).toEqual(["a", "b"]);
    expect(readAntigravityCalls(home, SESSION, 1).calls).toHaveLength(1);
  });
});

describe("AntigravityTurnCalls", () => {
  function tracker(reports: AntigravityPromptCalls[]): AntigravityTurnCalls {
    return new AntigravityTurnCalls(home, (sum) => reports.push(sum));
  }

  it("reports only the calls after the prompt began, each changed sum once", async () => {
    conversation([[1, call({ input: 1 }, "old")]]);
    const reports: AntigravityPromptCalls[] = [];
    const turn = tracker(reports);
    turn.observe();
    turn.begin(SESSION);
    turn.observe();
    append([[2, call({ input: 5, output: 2 }, "new")]]);
    turn.observe();
    turn.observe();
    expect(reports).toEqual([
      { calls: 1, inputTokens: 5, outputTokens: 2, cacheReadTokens: 0 },
    ]);
    const answer: PromptResponse = { stopReason: "end_turn" };
    await expect(turn.follow(Promise.resolve(answer))).resolves.toBe(answer);
    turn.begin(SESSION);
    turn.finish();
  });

  it("reads on a timer and keeps the calls of a failed prompt", async () => {
    vi.useFakeTimers();
    conversation([[1, call({ input: 1 }, "old")]]);
    const reports: AntigravityPromptCalls[] = [];
    const turn = tracker(reports);
    turn.begin(SESSION);
    append([[2, call({ input: 5 }, "new")]]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(reports).toHaveLength(1);
    await expect(
      turn.follow(Promise.reject(new Error("closed"))),
    ).rejects.toThrow("closed");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(reports).toHaveLength(1);
  });

  it("logs a failing report of a regular reading", async () => {
    vi.useFakeTimers();
    conversation([]);
    const turn = new AntigravityTurnCalls(home, () => {
      throw new Error("report");
    });
    turn.begin(SESSION);
    append([[1, call({ input: 1 }, "a")]]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(logCaughtError).toHaveBeenCalledWith(
      "AntigravityTurnCalls",
      expect.any(Error),
    );
  });

  it("skips a failed read and logs it once", () => {
    mkdirSync(path.dirname(databasePath()), { recursive: true });
    writeFileSync(databasePath(), "not a database");
    const turn = tracker([]);
    turn.begin(SESSION);
    turn.begin(SESSION);
    turn.observe();
    expect(logCaughtError).toHaveBeenCalledTimes(1);
  });

  it("reports no calls when a later reading fails", () => {
    conversation([[1, call({ input: 1 }, "a")]]);
    const reports: AntigravityPromptCalls[] = [];
    const turn = tracker(reports);
    turn.begin(SESSION);
    writeFileSync(databasePath(), "not a database");
    turn.observe();
    expect(reports).toEqual([]);
  });

  it("reads nothing before a session is known", () => {
    const turn = tracker([]);
    turn.finish();
    turn.observe();
    expect(logCaughtError).not.toHaveBeenCalled();
  });

  it("starts again at the first row for another session", () => {
    conversation([[1, call({ input: 1 }, "a")]]);
    const turn = tracker([]);
    turn.begin("99999999-2222-3333-4444-555555555555");
    turn.begin(SESSION);
    turn.finish();
  });
});

describe("antigravityTurnCalls", () => {
  it("exists only for Antigravity with a data home and a listener", () => {
    const listener = { antigravityCalls: vi.fn() };
    const make = (
      provider: string,
      dataHome: string | undefined,
      hasListener: boolean,
    ): AntigravityTurnCalls | null =>
      antigravityTurnCalls({
        driver: { provider },
        antigravityDataHome: dataHome,
        listener: hasListener ? listener : undefined,
      } as unknown as Parameters<typeof antigravityTurnCalls>[0]);
    expect(make("antigravity", "/home", true)).toBeInstanceOf(
      AntigravityTurnCalls,
    );
    expect(make("codex", "/home", true)).toBeNull();
    expect(make("antigravity", undefined, true)).toBeNull();
    expect(make("antigravity", "/home", false)).toBeNull();
  });
});
