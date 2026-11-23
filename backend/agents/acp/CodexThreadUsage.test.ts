import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  CodexThreadUsage,
  readCodexTokenCount,
} from "@/backend/agents/acp/CodexThreadUsage";
import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";
import { logCaughtError } from "@/backend/logging/Logger";

import type { CodexThreadReport } from "@/definition/CodexPlanUsage";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const THREAD = "thread-1";
let home = "";
let reports: CodexThreadReport[] = [];

beforeEach(async () => {
  await mkdir(pagesTempDirectory("codex-usage-test"), { recursive: true });
  home = await mkdtemp(pagesTempDirectory("codex-usage-test", "case-"));
  reports = [];
});

afterEach(async () => {
  vi.useRealTimers();
  vi.clearAllMocks();
  await rm(home, { recursive: true, force: true });
});

function tokenLine(input: number, output = 1): string {
  return `${JSON.stringify({
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: 0,
          output_tokens: output,
          reasoning_output_tokens: 0,
        },
      },
    },
  })}\n`;
}

function usageOf(): CodexThreadUsage {
  return new CodexThreadUsage(home, "model", (report) => {
    reports.push(report);
    return Promise.resolve();
  });
}

async function rollout(content: string, id = THREAD): Promise<string> {
  const folder = path.join(home, "sessions", "2025", "01", "02");
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, `rollout-x-${id}.jsonl`);
  await writeFile(file, content);
  return file;
}

it.each([
  ["invalid json", "{"],
  ["json without object", "[]"],
  ["another event", '{"type":"x","payload":{"type":"token_count"}}'],
  ["another payload", '{"type":"event_msg","payload":{"type":"x"}}'],
  [
    "no totals",
    '{"type":"event_msg","payload":{"type":"token_count","info":{}}}',
  ],
  [
    "only unusable counts",
    '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":-1,"output_tokens":"x"}}}}',
  ],
])("reads no token count from %s", (label, line) => {
  expect(readCodexTokenCount(line)).toBeNull();
});

it("reads the counts of a token event with missing fields", () => {
  expect(
    readCodexTokenCount(
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":5}}}}',
    ),
  ).toEqual({
    inputTokens: 5,
    cacheReadTokens: null,
    outputTokens: null,
    reasoningTokens: null,
  });
});

it("rejects an invalid thread id", async () => {
  await expect(usageOf().start("../x")).rejects.toThrow(
    "Invalid Codex thread ID",
  );
});

it("takes the history of a rollout as baseline", async () => {
  await rollout(`${tokenLine(10)}${tokenLine(20)}not json\n`);
  const usage = usageOf();
  await usage.start(THREAD, true);
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatchObject({
    baseline: true,
    totals: { inputTokens: 20 },
  });
  await usage.close();
});

it("starts without a rollout and without history", async () => {
  const usage = usageOf();
  await usage.start(THREAD);
  expect(reports[0]?.totals.inputTokens).toBe(0);
  await usage.close();
});

it("disables native counts for a thread with history but no rollout", async () => {
  const usage = usageOf();
  await usage.start(THREAD, true);
  expect(reports).toEqual([]);
  await usage.flush();
  await usage.finish({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
  expect(reports).toEqual([]);
  await usage.close();
});

it("reports new records on flush and the prompt usage on finish", async () => {
  const file = await rollout(tokenLine(1));
  const usage = usageOf();
  await usage.start(THREAD);
  await appendFile(file, `${tokenLine(5)}\n${tokenLine(7)}`);
  await usage.flush();
  expect(reports.at(-1)).toMatchObject({
    baseline: false,
    totals: { inputTokens: 7 },
  });
  await usage.finish(null);
  await usage.finish({ inputTokens: 1, outputTokens: 2, totalTokens: 10 });
  const count = reports.length;
  await usage.finish({
    inputTokens: 1,
    outputTokens: 2,
    totalTokens: 10,
    thoughtTokens: 1,
  });
  expect(reports).toHaveLength(count + 1);
  expect(reports.at(-1)).toMatchObject({
    baseline: false,
    promptTokens: { inputTokens: 8, outputTokens: 2, reasoningTokens: 1 },
  });
  await usage.close();
});

it("publishes a new baseline when a started thread starts again", async () => {
  const usage = usageOf();
  await usage.start(THREAD);
  await usage.start(THREAD);
  expect(reports.map((report) => report.baseline)).toEqual([true, true]);
  await usage.close();
});

it("does not publish a second baseline when native counts are off", async () => {
  const usage = usageOf();
  await usage.start(THREAD, true);
  await usage.start(THREAD, true);
  expect(reports).toEqual([]);
  await usage.close();
});

it("finishes without a started thread", async () => {
  const usage = usageOf();
  await usage.finish({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
  expect(reports).toEqual([]);
});

it("skips an oversized line", async () => {
  const file = await rollout("");
  const usage = usageOf();
  await usage.start(THREAD);
  await appendFile(file, "x".repeat(9 * 1024 * 1024));
  await usage.flush();
  await appendFile(file, `tail\n${tokenLine(99)}`);
  await usage.flush();
  expect(reports.map((report) => report.totals.inputTokens)).toEqual([0, 99]);
  await usage.close();
});

it("finds a rollout only in dated folders and by thread", async () => {
  await mkdir(path.join(home, "sessions", "other"), { recursive: true });
  await mkdir(path.join(home, "sessions", "2025", "01", "02", "03", "04"), {
    recursive: true,
  });
  await writeFile(
    path.join(
      home,
      "sessions",
      "2025",
      "01",
      "02",
      "03",
      "04",
      `rollout-x-${THREAD}.jsonl`,
    ),
    tokenLine(3),
  );
  await writeFile(path.join(home, "sessions", "2025", "note.txt"), "x");
  await mkdir(path.join(home, "sessions", "2024"), { recursive: true });
  const usage = usageOf();
  await usage.start(THREAD, true);
  expect(reports).toEqual([]);
  await usage.close();
});

it("polls the rollout on a timer and logs a failing read", async () => {
  const file = await rollout(tokenLine(1));
  const usage = usageOf();
  await usage.start(THREAD);
  await appendFile(file, tokenLine(4));
  await vi.waitFor(() => expect(reports.at(-1)?.totals.inputTokens).toBe(4), {
    timeout: 4_000,
  });
  await rm(file);
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  await mkdir(file);
  await vi.waitFor(() => expect(logCaughtError).toHaveBeenCalled(), {
    timeout: 4_000,
  });
  await expect(usage.close()).rejects.toThrow("EISDIR");
}, 15_000);

it("does not schedule a poll when the instance closes during a read", async () => {
  vi.useFakeTimers();
  await rollout(tokenLine(1));
  const usage = usageOf();
  await usage.start(THREAD);
  vi.advanceTimersByTime(1_000);
  await usage.close();
  await vi.advanceTimersByTimeAsync(3_000);
  expect(vi.getTimerCount()).toBe(0);
});

it("reads a record that arrives in pieces", async () => {
  const file = await rollout("");
  const usage = usageOf();
  await usage.start(THREAD);
  const line = tokenLine(6);
  await appendFile(file, line.slice(0, 20));
  await usage.flush();
  await appendFile(file, line.slice(20));
  await usage.flush();
  expect(reports.at(-1)?.totals.inputTokens).toBe(6);
  await usage.close();
});

it("schedules no further poll after closing", async () => {
  vi.useFakeTimers();
  await rollout(tokenLine(1));
  const usage = usageOf();
  await usage.start(THREAD);
  await usage.close();
  await vi.advanceTimersByTimeAsync(3_000);
  expect(vi.getTimerCount()).toBe(0);
});

it("closes an instance that never started", async () => {
  await expect(usageOf().close()).resolves.toBeUndefined();
});
