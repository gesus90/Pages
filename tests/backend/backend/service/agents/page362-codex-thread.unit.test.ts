import { afterEach, expect, it, vi } from "vitest";

import { CodexThreadUsage } from "@/backend/agents/acp/CodexThreadUsage";

import type { CodexThreadReport } from "@/definition/CodexPlanUsage";

const filesystem = vi.hoisted(() => ({ open: vi.fn(), readdir: vi.fn() }));
vi.mock("node:fs/promises", () => filesystem);
afterEach(() => vi.useRealTimers());

function tokenLine(input: number): string {
  return (
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: input,
            cached_input_tokens: 20,
            output_tokens: 30,
            reasoning_output_tokens: 10,
          },
        },
      },
    }) + "\n"
  );
}

it("baselines history before prompting, reports new complete records while working and drains the last update", async () => {
  vi.useFakeTimers();
  let contents = tokenLine(100);
  const paths: string[] = [];
  filesystem.readdir.mockImplementation(async (directory: string) => {
    paths.push(directory);
    return [
      {
        name: "rollout-2026-thread-1.jsonl",
        isFile: () => true,
        isDirectory: () => false,
      },
    ];
  });
  const close = vi.fn(async () => undefined);
  filesystem.open.mockImplementation(async () => ({
    close,
    read: async (
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ) => {
      const bytes = Buffer.from(contents).subarray(position, position + length);
      bytes.copy(buffer, offset);
      return { bytesRead: bytes.length };
    },
  }));
  const reports: CodexThreadReport[] = [];
  const reader = new CodexThreadUsage(
    "/synthetic/codex",
    "gpt-6-luna",
    async (report) => {
      reports.push(report);
    },
  );
  await reader.start("thread-1");
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatchObject({
    baseline: true,
    totals: { inputTokens: 100 },
  });
  contents += tokenLine(150);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(reports[1]).toMatchObject({
    baseline: false,
    totals: { inputTokens: 150 },
  });
  contents += tokenLine(180).trimEnd();
  await reader.flush();
  expect(reports).toHaveLength(2);
  contents += "\n";
  await reader.close();
  expect(reports[2]).toMatchObject({
    baseline: false,
    totals: { inputTokens: 180 },
  });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(reports).toHaveLength(3);
  expect(paths).toEqual(["/synthetic/codex/sessions"]);
  expect(
    filesystem.open.mock.calls.every(([file]) =>
      String(file).endsWith("thread-1.jsonl"),
    ),
  ).toBe(true);
  expect(close).toHaveBeenCalledTimes(4);
});

it("keeps a thread with no native usage unreported and rejects path-shaped thread identifiers", async () => {
  filesystem.readdir.mockResolvedValue([]);
  const reported = vi.fn(async (_report: CodexThreadReport) => undefined);
  const reader = new CodexThreadUsage(
    "/synthetic/codex",
    "gpt-6.1-sol",
    reported,
  );
  await expect(reader.start("../auth")).rejects.toThrow(
    "Invalid Codex thread ID",
  );
  await reader.start("thread-2");
  await reader.close();
  expect(reported.mock.calls.every(([report]) => report.baseline)).toBe(true);
});
