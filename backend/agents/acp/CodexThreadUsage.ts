import { constants } from "node:fs";
import { open, readdir } from "node:fs/promises";
import path from "node:path";

import { logCaughtError } from "@/backend/logging/Logger";
import { codexHighWater } from "@/backend/service/agents/usage/CodexUsageCalculation";
import { codexPromptTokens } from "@/backend/service/agents/usage/CodexPromptTokens";

import type { Usage } from "@agentclientprotocol/sdk";
import type { FileHandle } from "node:fs/promises";

import type {
  CodexThreadReport,
  CodexTokenCounts,
} from "@/definition/CodexPlanUsage";

const POLL_MS = 1_000;
const CHUNK_BYTES = 64 * 1024;
const MAX_LINE_BYTES = 8 * 1024 * 1024;

function record(input: unknown): Record<string, unknown> | null {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? Object.fromEntries(Object.entries(input))
    : null;
}

function count(input: unknown): number | null {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 0
    ? input
    : null;
}

/** Reads only structured native token_count events, including genuinely absent breakdowns. */
export function readCodexTokenCount(line: string): CodexTokenCounts | null {
  let input: unknown;
  try {
    input = JSON.parse(line);
  } catch {
    // A concurrently written last line is read after its newline, never as a partial report.
    return null;
  }
  const entry = record(input);
  const payload = record(entry?.payload);
  if (entry?.type !== "event_msg" || payload?.type !== "token_count")
    return null;
  const totals = record(record(payload.info)?.total_token_usage);
  if (!totals) return null;
  const tokens = {
    inputTokens: count(totals.input_tokens),
    cacheReadTokens: count(totals.cached_input_tokens),
    outputTokens: count(totals.output_tokens),
    reasoningTokens: count(totals.reasoning_output_tokens),
  };
  return Object.values(tokens).every((value) => value === null) ? null : tokens;
}

async function findRollout(
  directory: string,
  threadId: string,
  depth = 0,
): Promise<string | null> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.isFile() &&
      entry.name.startsWith("rollout-") &&
      entry.name.endsWith(`-${threadId}.jsonl`)
    )
      return path.join(directory, entry.name);
    if (entry.isDirectory() && depth < 3 && /^\d{2,4}$/u.test(entry.name)) {
      const found = await findRollout(
        path.join(directory, entry.name),
        threadId,
        depth + 1,
      );
      if (found) return found;
    }
  }
  return null;
}

/**
 * Follows the assigned connection's native rollout, without reading credentials or changing isolation.
 * Only numeric usage enters the journal. Existing history establishes a baseline before the prompt.
 */
export class CodexThreadUsage {
  private readonly home: string;
  private readonly model: string;
  private readonly reported: (report: CodexThreadReport) => Promise<void>;
  private threadId: string | null = null;
  private latest: CodexTokenCounts = {
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
  private isNativeEnabled = true;
  private file: string | null = null;
  private offset = 0;
  private pending = "";
  private isSkipping = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private reading: Promise<void> = Promise.resolve();
  private isClosed = false;

  public constructor(
    home: string,
    model: string,
    reported: (report: CodexThreadReport) => Promise<void>,
  ) {
    this.home = home;
    this.model = model;
    this.reported = reported;
  }

  /** Captures historical counters once, before any new provider request can write tokens. */
  public async start(threadId: string, hasHistory = false): Promise<void> {
    if (this.threadId !== null) {
      await this.flush();
      if (this.isNativeEnabled)
        await this.publish({
          threadId,
          totals: this.latest,
          baseline: true,
          model: this.model,
        });
      return;
    }
    if (!/^[a-zA-Z0-9-]{1,100}$/u.test(threadId))
      throw new Error("Invalid Codex thread ID");
    this.threadId = threadId;
    await this.scan(true);
    // Without the original baseline, absolute native totals cannot be mixed with per-prompt ACP counts.
    this.isNativeEnabled = !hasHistory || this.file !== null;
    if (this.isNativeEnabled) {
      await this.publish({
        threadId,
        totals: this.latest,
        baseline: true,
        model: this.model,
      });
      this.schedule();
    }
  }

  /** Reconciles ACP's prompt delta before delayed rollout entries can repeat the same tokens. */
  public async finish(usage: Usage | null): Promise<void> {
    await this.flush();
    if (!usage || !this.isNativeEnabled || !this.threadId) return;
    const prompt = codexPromptTokens(usage).tokens;
    await this.publish({
      threadId: this.threadId,
      totals: this.latest,
      promptTokens: {
        inputTokens: prompt.inputTokens,
        cacheReadTokens: prompt.cacheReadTokens,
        outputTokens: prompt.outputTokens,
        reasoningTokens: prompt.reasoningTokens ?? null,
      },
      baseline: false,
      model: this.model,
    });
  }

  /** Waits for all current records, including the final native update before the ACP result. */
  public async flush(): Promise<void> {
    if (!this.isNativeEnabled) return;
    this.reading = this.reading.then(() => this.scan(false));
    await this.reading;
  }

  /** Stops the timer and drains the last records before the owning session is released. */
  public async close(): Promise<void> {
    this.isClosed = true;
    if (this.timer) clearTimeout(this.timer);
    await this.flush();
  }

  private schedule(): void {
    if (this.isClosed) return;
    this.timer = setTimeout(() => {
      this.reading = this.reading
        .then(() => this.scan(false))
        .finally(() => this.schedule());
      void this.reading.catch((error: unknown) =>
        logCaughtError("CodexThreadUsage", error),
      );
    }, POLL_MS);
    this.timer.unref();
  }

  private async scan(baseline: boolean): Promise<void> {
    if (!this.threadId) return;
    try {
      this.file ??= await findRollout(
        path.join(this.home, "sessions"),
        this.threadId,
      );
      if (!this.file) return;
      const handle = await open(
        this.file,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        await this.readRecords(handle, this.threadId, baseline);
      } finally {
        await handle.close();
      }
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return;
      throw error;
    }
  }

  private async readRecords(
    handle: FileHandle,
    threadId: string,
    baseline: boolean,
  ): Promise<void> {
    const bytes = Buffer.alloc(CHUNK_BYTES);
    for (;;) {
      const chunk = await handle.read(bytes, 0, bytes.length, this.offset);
      if (chunk.bytesRead === 0) return;
      this.offset += chunk.bytesRead;
      await this.applyCounts(
        threadId,
        this.consume(bytes.subarray(0, chunk.bytesRead).toString("utf8")),
        baseline,
      );
    }
  }

  private async applyCounts(
    threadId: string,
    counts: readonly CodexTokenCounts[],
    baseline: boolean,
  ): Promise<void> {
    for (const totals of counts) {
      if (baseline) this.latest = codexHighWater(this.latest, totals);
      else
        await this.publish({
          threadId,
          totals,
          baseline: false,
          model: this.model,
        });
    }
  }

  private async publish(report: CodexThreadReport): Promise<void> {
    this.latest = codexHighWater(this.latest, report.totals);
    await this.reported(report);
  }

  private consume(chunk: string): CodexTokenCounts[] {
    const text = this.pending + chunk;
    const end = text.lastIndexOf("\n");
    this.pending = text.slice(end + 1);
    const lines = end < 0 ? [] : text.slice(0, end).split("\n");
    const counts: CodexTokenCounts[] = [];
    for (const line of lines) {
      if (!this.isSkipping) {
        const tokens = readCodexTokenCount(line);
        if (tokens) counts.push(tokens);
      }
      this.isSkipping = false;
    }
    if (this.pending.length > MAX_LINE_BYTES) {
      this.pending = "";
      this.isSkipping = true;
    }
    return counts;
  }
}
