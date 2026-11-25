import { describe, expect, it, vi } from "vitest";

import {
  AcpBackgroundCommands,
  acpBackgroundCommands,
  readAcpExitCode,
} from "@/backend/agents/acp/AcpBackgroundCommands";
import { logEvent } from "@/backend/logging/Logger";

import type {
  SessionUpdate,
  ToolCall,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";

vi.mock("@/backend/logging/Logger", () => ({ logEvent: vi.fn() }));

function session(permissionDenials = 0): {
  sessionId: string;
  permissionDenials: number;
  events: string[];
} {
  return { sessionId: "s1", permissionDenials, events: [] };
}

function start(id: string, fields: Partial<ToolCall> = {}): SessionUpdate {
  return {
    sessionUpdate: "tool_call",
    toolCallId: id,
    kind: "execute",
    title: "sleep 60",
    status: "in_progress",
    ...fields,
  };
}

function end(id: string, fields: Partial<ToolCallUpdate> = {}): SessionUpdate {
  return {
    sessionUpdate: "tool_call_update",
    toolCallId: id,
    status: "completed",
    rawOutput: { exit_code: 0 },
    ...fields,
  };
}

function noteText(note: unknown): string {
  return JSON.stringify(note);
}

describe("readAcpExitCode", () => {
  it("reads only a numeric exit code of an object output", () => {
    const read = (rawOutput: unknown): number | null =>
      readAcpExitCode({ toolCallId: "1", rawOutput });
    expect(read({ exit_code: 2 })).toBe(2);
    expect(read({ exit_code: "2" })).toBeNull();
    expect(read({})).toBeNull();
    expect(read("text")).toBeNull();
    expect(read(null)).toBeNull();
    expect(read(undefined)).toBeNull();
  });
});

describe("settle", () => {
  it("returns nothing without a running or unread command", async () => {
    const tracker = new AcpBackgroundCommands(session());
    await expect(
      tracker.settle(new AbortController().signal),
    ).resolves.toBeNull();
  });

  it("returns nothing after a refused request", async () => {
    const tracker = new AcpBackgroundCommands(session(1));
    tracker.receive(start("1"));
    await expect(
      tracker.settle(new AbortController().signal),
    ).resolves.toBeNull();
  });

  it("notes a command that ended unread", async () => {
    const tracker = new AcpBackgroundCommands(session());
    tracker.receive(start("1", { title: undefined }));
    tracker.receive(end("1", { rawOutput: undefined, status: "failed" }));
    const note = await tracker.settle(new AbortController().signal);
    expect(noteText(note)).toContain(
      "`command`: ended as failed, without an exit code",
    );
  });

  it("waits for a running command and continues with its exit code", async () => {
    const state = session();
    const tracker = new AcpBackgroundCommands(state);
    tracker.receive(start("1"));
    tracker.receive(start("2", { title: "b".repeat(300) }));
    tracker.receive(start("1", { status: "in_progress" }));
    const pending = tracker.settle(new AbortController().signal);
    tracker.receive(end("1", { status: "in_progress" }));
    tracker.receive(end("1", { rawOutput: { exit_code: 4 } }));
    expect(state.events).toContain("turn waits for 2 background command(s)");
    tracker.receive(end("2", { rawOutput: {} }));
    const text = noteText(await pending);
    expect(text).toContain("`sleep 60`: ended with exit code 4");
    expect(text).toContain(
      `\`${"b".repeat(200)}\`: ended, without an exit code`,
    );
    expect(state.events).toContain(
      "turn continues after 2 background command(s) ended",
    );
    expect(logEvent).toHaveBeenCalled();
  });

  it("does not count a command that ran on the agent's later activity", async () => {
    const tracker = new AcpBackgroundCommands(session());
    tracker.receive(start("1"));
    tracker.receive(end("1"));
    tracker.receive({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "read" },
    });
    tracker.receive(start("2", { kind: "read" }));
    tracker.receive(end("3", { status: "completed" }));
    await expect(
      tracker.settle(new AbortController().signal),
    ).resolves.toBeNull();
  });

  it("ends the wait when the signal aborts, also an aborted one", async () => {
    const tracker = new AcpBackgroundCommands(session());
    tracker.receive(start("1"));
    const controller = new AbortController();
    const pending = tracker.settle(controller.signal);
    controller.abort(new Error("stop"));
    await expect(pending).rejects.toThrow("stop");
    tracker.receive(end("1"));
    tracker.receive(start("2"));
    const aborted = new AbortController();
    aborted.abort(new Error("late"));
    await expect(tracker.settle(aborted.signal)).rejects.toThrow("late");
  });
});

describe("acpBackgroundCommands", () => {
  it("tracks only plan sessions of an adapter that runs commands on", () => {
    const make = (
      runs: boolean | undefined,
      input: boolean | undefined,
    ): AcpBackgroundCommands | null =>
      acpBackgroundCommands(
        { driver: { runsCommandsInBackground: runs }, acceptsTurnInput: input },
        session(),
      );
    expect(make(true, true)).toBeInstanceOf(AcpBackgroundCommands);
    expect(make(true, undefined)).toBeNull();
    expect(make(undefined, true)).toBeNull();
  });
});
