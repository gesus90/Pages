import { sendRunnerPacket } from "../../../../../scripts/runner/wire.mjs";
import { createHash } from "node:crypto";

import { beforeEach, expect, it, vi } from "vitest";

import {
  ChunkJournal,
  OUTPUT_CHUNK_BYTES,
  journalIndex,
  readJournalChunk,
  readJournalEvents,
  writeAll,
} from "../../../../../scripts/runner/chunks.mjs";
import { ProtocolLines } from "../../../../../scripts/runner/lines.mjs";
import { JobOutput } from "../../../../../scripts/runner/output.mjs";
import { CliTerminalResult } from "../../../../../scripts/runner/result.mjs";

import { journalFiles } from "./page161-files";

import type { RunnerExecution } from "@/definition/RunnerExecution";

vi.mock(
  "node:fs/promises",
  async () => (await import("./page161-files")).journalFiles,
);
const BINDING = {
  jobId: "job-page161",
  sessionId: "transport-page161",
  plan: { runId: "run-page161", stepId: "node", attemptId: "attempt-page161" },
  launchId: "launch-page161",
};
const COMMAND: RunnerExecution = {
  version: 1,
  revision: 1,
  workspace: "/synthetic/page161",
  timeoutSeconds: 0,
  outputBytes: 65536,
  input: "",
  program: {
    kind: "cli",
    route: {
      connectionId: "10000000-0000-4000-8000-000000000001",
      workspaceId: "10000000-0000-4000-8000-000000000002",
      catalogRevision: "synthetic",
      tool: "codex",
    },
    model: "synthetic",
    reasoningEffort: null,
    prompt: "synthetic",
    access: "read_only",
  },
};

beforeEach(() => {
  journalFiles.files.clear();
  journalFiles.descriptors.clear();
  Object.assign(journalFiles.controls, {
    writeLimit: 65536,
    failure: null,
    freeBytes: 1024 * 1024 * 1024,
    writes: 0,
  });
});

function writePacket(
  output: JobOutput,
  contents: Buffer,
  channel = "stdout",
): Promise<void> {
  return new Promise((resolve, reject) =>
    output.write(
      { chunk: contents, channel },
      (error: Error | null | undefined) => (error ? reject(error) : resolve()),
    ),
  );
}

async function writeEvent(output: JobOutput, event: unknown): Promise<void> {
  const bytes = Buffer.from(`${JSON.stringify(event)}\n`);
  for (let start = 0; start < bytes.length; start += 65535)
    await writePacket(output, bytes.subarray(start, start + 65535));
}

it("streams over 40 MiB into at least ten chunks and retains a single structured native result", async () => {
  const output = new JobOutput(COMMAND, "/job", BINDING, (text) => text);
  await output.initialize("/job");
  await writeEvent(output, {
    type: "thread.started",
    thread_id: "native-page161",
  });
  const expected = createHash("sha256");
  let rawBytes = 0;
  const originalWrite = async (
    contents: Buffer,
    channel: string,
  ): Promise<void> => {
    const header = Buffer.alloc(1);
    header[0] = channel === "stdout" ? 1 : 2;
    expected.update(header).update(contents);
    rawBytes += contents.length;
    await writePacket(output, contents, channel);
    expect(output.writableLength).toBeLessThanOrEqual(2);
  };
  const payload = "ab🙂".repeat(174763);
  for (let index = 0; index < 41; index += 1) {
    const bytes = Buffer.from(
      `${JSON.stringify({ type: "item.completed", item: { id: String(index), type: "command_execution", command: "synthetic", status: "completed", aggregated_output: payload } })}\n`,
    );
    for (let start = 0; start < bytes.length; start += 65535)
      await originalWrite(bytes.subarray(start, start + 65535), "stdout");
    await originalWrite(Buffer.from(`synthetic stderr ${index}\n`), "stderr");
  }
  const answer = JSON.stringify({ ticket: "PAGE-161", ok: true });
  await writeEvent(output, {
    type: "item.completed",
    item: { type: "agent_message", text: answer },
  });
  await writeEvent(output, {
    type: "turn.completed",
    usage: { input_tokens: 7, output_tokens: 5 },
  });
  await writeEvent(output, { type: "diagnostic", text: "after terminal" });
  await new Promise<void>((resolve, reject) => {
    output.once("error", reject);
    output.end(resolve);
  });
  const index = await journalIndex("/job/history/raw", BINDING);
  expect(index.chunk).toBeGreaterThanOrEqual(11);
  expect(index.isClosed).toBe(true);
  expect(rawBytes).toBeGreaterThan(40 * 1024 * 1024);
  const publicIndex = await journalIndex("/job/history/events", BINDING);
  expect(publicIndex.lastSequence).toBeGreaterThan(10_000);
  const beyondOldWindow = await readJournalEvents(
    "/job/history/events",
    BINDING,
    10_000,
  );
  expect(beyondOldWindow.events[0]?.sequence).toBe(10_001);
  expect(beyondOldWindow.length).toBe(publicIndex.lastSequence);
  let reconstructedBytes = 0;
  let pending = Buffer.alloc(0);
  const reconstructed = createHash("sha256");
  for (let sequence = 1; sequence <= index.chunk; sequence += 1) {
    const chunk = await readJournalChunk("/job/history/raw", index, sequence);
    if (sequence < index.chunk)
      expect(chunk.contents.length).toBe(OUTPUT_CHUNK_BYTES);
    pending = Buffer.concat([pending, chunk.contents]);
    while (
      pending.length >= 13 &&
      pending.length >= 13 + pending.readUInt32BE(1)
    ) {
      const length = pending.readUInt32BE(1);
      const contents = pending.subarray(13, 13 + length);
      // The first record identifies the native session; only the synthetic load is hashed above.
      if (pending.readBigUInt64BE(5) > 1n && reconstructedBytes < rawBytes) {
        reconstructed.update(pending.subarray(0, 1)).update(contents);
        reconstructedBytes += length;
      }
      pending = pending.subarray(13 + length);
    }
  }
  expect(pending.length).toBe(0);
  expect(reconstructed.digest("hex")).toBe(expected.digest("hex"));
  expect(output.result()).toMatchObject({
    reason: null,
    terminal: {
      sessionId: "native-page161",
      status: "completed",
      usage: { inputTokens: 7, outputTokens: 5 },
    },
  });
  expect(
    JSON.parse(output.result().output.split("\n\n").slice(1).join("\n\n")),
  ).toEqual({ ticket: "PAGE-161", ok: true });
  expect(journalFiles.descriptors.size).toBe(0);
}, 60_000);

it("handles split UTF-8 and JSON across arbitrary packets with awaited parser backpressure", async () => {
  const lines: string[] = [];
  let release: (() => void) | undefined;
  const parser = new ProtocolLines(async (line) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    lines.push(line);
  });
  const bytes = Buffer.from('{"text":"🙂 €"}\n');
  await parser.receive(bytes.subarray(0, 11));
  const received = parser.receive(bytes.subarray(11));
  expect(lines).toEqual([]);
  await vi.waitFor(() => expect(release).toBeDefined());
  release?.();
  await received;
  await parser.finish();
  expect(JSON.parse(lines[0] ?? "")).toEqual({ text: "🙂 €" });
  const tooLong = new ProtocolLines(() => undefined);
  await expect(
    tooLong.receive(Buffer.alloc(8 * 1024 * 1024 + 1, 120)),
  ).rejects.toThrow("exceeds 8 MiB");
});

it("detects partial writes, a crash tail, foreign attempts, missing chunks and corrupt cursors", async () => {
  journalFiles.controls.writeLimit = 7;
  const journal = new ChunkJournal("/events", BINDING, { recordAligned: true });
  await journal.initialize();
  const event = {
    sequence: 1,
    kind: "status",
    text: "🙂",
    channel: "stdout",
    createdAt: new Date().toISOString(),
    isTruncated: false,
  };
  await journal.append(Buffer.from(`${JSON.stringify(event)}\n`), 1);
  await journal.checkpoint();
  const file = "/events/000000000001.part";
  journalFiles.files.set(
    file,
    Buffer.concat([
      journalFiles.files.get(file) ?? Buffer.alloc(0),
      Buffer.from("crash tail"),
    ]),
  );
  const index = await journalIndex("/events", BINDING);
  expect((await readJournalChunk("/events", index, 1)).hasUncommittedTail).toBe(
    true,
  );
  expect((await readJournalEvents("/events", BINDING, 0)).events).toEqual([
    event,
  ]);
  await expect(
    readJournalEvents("/events", { ...BINDING, launchId: "foreign" }, 0),
  ).rejects.toThrow("identity");
  await expect(readJournalEvents("/events", BINDING, 2)).rejects.toThrow(
    "cursor",
  );
  journalFiles.files.delete(file);
  await expect(readJournalChunk("/events", index, 1)).rejects.toThrow();
  await journal.close();
});

it.each(["ENOSPC", "EACCES", "EIO"])(
  "propagates %s without pretending to have stored the next packet",
  async (code) => {
    const journal = new ChunkJournal("/raw", BINDING);
    await journal.initialize();
    await journal.append(Buffer.from("confirmed"), 1);
    await journal.checkpoint();
    journalFiles.controls.failure = code;
    await expect(
      journal.append(Buffer.from("unconfirmed"), 2),
    ).rejects.toMatchObject({ code });
    expect((await journalIndex("/raw", BINDING)).lastSequence).toBe(1);
    journalFiles.controls.failure = null;
    await journal.close();
    expect(journalFiles.descriptors.size).toBe(0);
  },
);

it("checks free space and rejects a zero-byte write without spinning", async () => {
  journalFiles.controls.freeBytes = 0;
  const journal = new ChunkJournal("/raw", BINDING);
  await journal.initialize();
  await expect(journal.append(Buffer.from("payload"), 1)).rejects.toMatchObject(
    { code: "ENOSPC" },
  );
  await expect(
    writeAll({ write: async () => ({ bytesWritten: 0 }) }, Buffer.from("x")),
  ).rejects.toThrow("no write progress");
});

it.each(["codex", "claude", "opencode"] as const)(
  "requires a native %s terminal event independently of trailing logs",
  (tool) => {
    if (COMMAND.program.kind !== "cli") throw new Error("Fixture invalid");
    const command: RunnerExecution = {
      ...COMMAND,
      program: {
        ...COMMAND.program,
        route: { ...COMMAND.program.route, tool },
      },
    };
    const result = new CliTerminalResult(command, (text) => text);
    expect(result.result().reason).toBe("protocol");
    const terminals = {
      claude: {
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: "native",
        result: '{"ok":true}',
      },
      opencode: {
        type: "pages.result",
        sessionId: "native",
        stopReason: "end_turn",
        answer: '{"ok":true}',
      },
      codex: { type: "turn.completed", usage: { input_tokens: 1 } },
    };
    const terminal = terminals[tool];
    result.receive({ type: "thread.started", thread_id: "native" });
    result.receive({
      type: "item.completed",
      item: { type: "agent_message", text: '{"ok":true}' },
    });
    result.receive(terminal);
    result.receive(terminal);
    result.receive({ type: "diagnostic" });
    expect(result.result().output).toContain('{"ok":true}');
    expect(result.result().terminal?.sessionId).toBe("native");
    expect(() =>
      result.receive({ ...terminal, usage: { input_tokens: 99 } }),
    ).toThrow("Contradictory");
  },
);

it("keeps a versioned remote answer byte-exact and digests only its payload", () => {
  const command = { ...COMMAND, resultPayloadVersion: 1 as const };
  const result = new CliTerminalResult(command, (text) => text);
  const payload = '{"status":"partial","message":"synthetic"}';
  result.receive({ type: "thread.started", thread_id: "native" });
  result.receive({
    type: "item.completed",
    item: { type: "agent_message", text: payload },
  });
  result.receive({ type: "turn.completed" });
  expect(result.result().output).toBe(payload);
  expect(result.result().terminal?.answerDigest).toBe(
    createHash("sha256").update(payload).digest("hex"),
  );
});

it("applies the versioned result limit to the actual answer rather than a transport banner", () => {
  const command = { ...COMMAND, resultPayloadVersion: 1 as const };
  const result = new CliTerminalResult(command, (text) => text);
  const payload = "x".repeat(command.outputBytes);
  result.receive({ type: "thread.started", thread_id: "native" });
  result.receive({
    type: "item.completed",
    item: { type: "agent_message", text: payload },
  });
  result.receive({ type: "turn.completed" });
  expect(result.result().reason).toBeNull();
  expect(result.result().output).toHaveLength(payload.length);
  expect(result.result().output).toBe(payload);
});

it("refuses a result that exceeds its bound after redaction", () => {
  const command = {
    ...COMMAND,
    outputBytes: 10,
    resultPayloadVersion: 1 as const,
  };
  const result = new CliTerminalResult(command, (text) =>
    text.replaceAll("x", "[redacted]"),
  );
  result.receive({ type: "thread.started", thread_id: "native" });
  result.receive({
    type: "item.completed",
    item: { type: "agent_message", text: "xxxxxxxxxx" },
  });
  result.receive({ type: "turn.completed" });
  expect(result.result()).toMatchObject({ output: "", reason: "result_limit" });
});

it("keeps the legacy framing for an already-dispatched unversioned job", () => {
  const result = new CliTerminalResult(COMMAND, (text) => text);
  result.receive({ type: "thread.started", thread_id: "native" });
  result.receive({
    type: "item.completed",
    item: { type: "agent_message", text: "legacy" },
  });
  result.receive({ type: "turn.completed" });
  expect(result.result().output).toMatch(/^Remote host: [^\n]+\n/u);
  expect(result.result().output.endsWith("\n\nlegacy")).toBe(true);
});

it("fails a missing native session identity or a superseded intermediate answer instead of handing off success", () => {
  const missing = new CliTerminalResult(COMMAND, (text) => text);
  missing.receive({
    type: "item.completed",
    item: { type: "agent_message", text: "answer" },
  });
  missing.receive({ type: "turn.completed" });
  expect(missing.result().reason).toBe("protocol");
  const intermediate = new CliTerminalResult(COMMAND, (text) => text);
  intermediate.receive({ type: "thread.started", thread_id: "native" });
  intermediate.receive({
    type: "item.completed",
    item: { type: "agent_message", text: "intermediate" },
  });
  intermediate.receive({
    type: "item.started",
    item: { type: "command_execution", command: "synthetic" },
  });
  intermediate.receive({ type: "turn.completed" });
  expect(intermediate.result().reason).toBe("protocol");
});

it("publishes a last small live packet during a quiet process without waiting for 4 MiB or process exit", async () => {
  vi.useFakeTimers();
  try {
    const output = new JobOutput(COMMAND, "/quiet", BINDING, (text) => text);
    await output.initialize("/quiet");
    await writeEvent(output, {
      type: "thread.started",
      thread_id: "quiet-native",
    });
    await writeEvent(output, { type: "turn.started" });
    await vi.advanceTimersByTimeAsync(250);
    expect(
      (await readJournalEvents("/quiet/history/events", BINDING, 0)).events[0]
        ?.text,
    ).toBe("Agent started");
    await new Promise<void>((resolve) => output.end(resolve));
  } finally {
    vi.useRealTimers();
  }
});

it("bounds queued wire bytes and individual messages without imposing a lifetime transfer cap", () => {
  const send = vi.fn();
  const socket = { bufferedAmount: 0, send };
  for (let batch = 0; batch < 2000; batch += 1)
    sendRunnerPacket(socket, { text: "x".repeat(32700) });
  expect(send).toHaveBeenCalledTimes(2000);
  expect(() =>
    sendRunnerPacket(
      { ...socket, bufferedAmount: 4194304 },
      { text: "progress" },
    ),
  ).toThrow("transport buffer full");
  expect(() => sendRunnerPacket(socket, { text: "x".repeat(2097152) })).toThrow(
    "2 MiB wire budget",
  );
});
