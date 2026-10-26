import { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";

import { expect, it, vi } from "vitest";

import { AcpLineChannel } from "@/backend/agents/acp/AcpLineChannel";
import {
  createAcpSessionState,
  readAcpUpdate,
} from "@/backend/agents/acp/AcpEvents";
import { finishAcpTurn } from "@/backend/agents/acp/AcpSessionOutcome";
import { CliSessionProcess } from "@/backend/agents/cli/CliSessionProcess";

it("withholds a local ACP notification read until its consumer explicitly confirms processing", async () => {
  const channel = new AcpLineChannel();
  channel.enableAcknowledgement();
  const reader = channel.stream.readable.getReader();
  let completed = false;
  const received = Promise.resolve(
    channel.receive(
      JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: {} }),
    ),
  ).then(() => {
    completed = true;
  });
  expect((await reader.read()).done).toBe(false);
  expect(completed).toBe(false);
  channel.acknowledge();
  await received;
  expect(completed).toBe(true);
  channel.close();
});

it("pauses a local process pipe for an awaited line sink and decodes split UTF-8 once", async () => {
  const child = new ChildProcess();
  const stdout = new PassThrough();
  Object.defineProperties(child, {
    stdin: { value: new PassThrough() },
    stdout: { value: stdout },
    stderr: { value: new PassThrough() },
  });
  const lines: string[] = [];
  let release: (() => void) | undefined;
  const process = new CliSessionProcess(
    child,
    {
      timeoutMs: 0,
      signal: new AbortController().signal,
      onLine: async (line) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        lines.push(line);
      },
    },
    () => undefined,
  );
  const bytes = Buffer.from('{"message":"🙂"}\n');
  stdout.write(bytes.subarray(0, 14));
  stdout.write(bytes.subarray(14));
  await vi.waitFor(() => expect(release).toBeDefined());
  expect(stdout.isPaused()).toBe(true);
  expect(lines).toEqual([]);
  release?.();
  await vi.waitFor(() => expect(lines).toEqual(['{"message":"🙂"}']));
  child.emit("close", 0, null);
  expect((await process.exited).errorCode).toBeNull();
});

it("keeps a local final answer bounded without applying that bound to previous messages or tool output", () => {
  const state = createAcpSessionState();
  for (let chunk = 0; chunk < 300; chunk += 1)
    readAcpUpdate(
      state,
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "x".repeat(4000) },
      },
      {},
    );
  expect(Buffer.byteLength(state.text)).toBeLessThanOrEqual(200000);
  expect(
    finishAcpTurn(
      state,
      { failure: null, errorCode: null, hasHistoryFailure: false },
      (text) => text,
    ),
  ).toMatchObject({
    failure: "failed",
    errorCode: "acp_result_limit",
    output: "",
  });
  readAcpUpdate(
    state,
    {
      sessionUpdate: "tool_call",
      toolCallId: "tool",
      title: "Synthetic tool",
      status: "completed",
    },
    {},
  );
  readAcpUpdate(
    state,
    {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: '{"ok":true}' },
    },
    {},
  );
  expect(
    finishAcpTurn(
      state,
      { failure: null, errorCode: null, hasHistoryFailure: false },
      (text) => text,
    ).output,
  ).toBe('{"ok":true}');
});

it("never reports local success when the journal writes failed", () => {
  const state = createAcpSessionState();
  state.text = '{"ok":true}';
  expect(
    finishAcpTurn(
      state,
      { failure: null, errorCode: null, hasHistoryFailure: true },
      (text) => text,
    ),
  ).toMatchObject({
    failure: "failed",
    errorCode: "plan_history_unavailable",
    output: "",
  });
});
