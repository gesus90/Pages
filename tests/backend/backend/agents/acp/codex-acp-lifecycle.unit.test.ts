import { RequestError } from "@agentclientprotocol/sdk";
import { beforeEach, expect, it, vi } from "vitest";

import { INSTANCE_ID, methodsOf, startCodexSession } from "./codex-acp-harness";
import { FAKE_SESSION_ID } from "./fake-codex-adapter";

import type { StopReason } from "@agentclientprotocol/sdk";
import type { FakeTurn } from "./fake-codex-adapter";

const scan = vi.hoisted(() => ({
  endTaggedProcesses: vi.fn(async () => ({ found: 0, remaining: 0 })),
}));
vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  RUN_INSTANCE_VARIABLE: "PAGES_RUN_INSTANCE",
  endTaggedProcesses: scan.endTaggedProcesses,
}));

beforeEach(() => {
  scan.endTaggedProcesses.mockImplementation(async () => ({
    found: 0,
    remaining: 0,
  }));
});

/** A turn that runs until the process ends; it reports one tool call first. */
async function endlessTurn(turn: FakeTurn): Promise<StopReason> {
  await turn.update({
    sessionUpdate: "tool_call",
    toolCallId: "call",
    title: "cargo test",
    kind: "execute",
    status: "in_progress",
  });
  return new Promise<StopReason>(() => {});
}

it("closes the protocol session, the adapter and every tagged helper, and confirms that none is left", async () => {
  const started = startCodexSession({ initialMode: "read-only" });
  await started.session.turn;
  const closed = await started.session.close();
  expect(closed).toMatchObject({
    exit: { code: 0, signal: null },
    leftovers: 0,
    isConfirmed: true,
  });
  expect(methodsOf(started.calls).at(-1)).toBe("session/close");
  expect(started.process.inputClosings).toBe(1);
  expect(scan.endTaggedProcesses).toHaveBeenCalledWith(INSTANCE_ID);
  expect(started.secure).toHaveBeenCalledTimes(1);
  expect(await started.session.close()).toBe(closed);
});

it("ends helpers that outlived the adapter and reports a closeout that left a process", async () => {
  scan.endTaggedProcesses.mockImplementationOnce(async () => ({
    found: 2,
    remaining: 1,
  }));
  const started = startCodexSession();
  await started.session.turn;
  const closed = await started.session.close();
  expect(closed).toMatchObject({ leftovers: 2, isConfirmed: false });
});

it("a stop ends the running turn with its whole process and the session closes afterwards", async () => {
  const controller = new AbortController();
  const started = startCodexSession({ turn: endlessTurn }, { controller });
  await vi.waitFor(() =>
    expect(methodsOf(started.calls)).toContain("session/prompt"),
  );
  controller.abort();
  const turn = await started.session.turn;
  expect(turn).toMatchObject({ failure: "cancelled", errorCode: null });
  expect(started.process.cancelled).toEqual(["login_cancelled"]);
  const closed = await started.session.close();
  expect(closed.isConfirmed).toBe(true);
  expect(scan.endTaggedProcesses).toHaveBeenCalledWith(INSTANCE_ID);
});

it("a deadline ends the running turn as a timeout", async () => {
  const controller = new AbortController();
  const started = startCodexSession({ turn: endlessTurn }, { controller });
  await vi.waitFor(() =>
    expect(methodsOf(started.calls)).toContain("session/prompt"),
  );
  controller.abort(new DOMException("Deadline", "TimeoutError"));
  const turn = await started.session.turn;
  expect(turn.failure).toBe("timeout");
  expect(started.process.cancelled).toEqual(["check_timeout"]);
  expect((await started.session.close()).isConfirmed).toBe(true);
});

it("an adapter that exits during the turn fails the node with its last error line and leaves no process", async () => {
  scan.endTaggedProcesses.mockImplementationOnce(async () => ({
    found: 1,
    remaining: 0,
  }));
  const started = startCodexSession({ turn: endlessTurn });
  await vi.waitFor(() =>
    expect(methodsOf(started.calls)).toContain("session/prompt"),
  );
  started.process.crash("starting\nfatal: codex app-server exited\n");
  const turn = await started.session.turn;
  expect(turn).toMatchObject({
    failure: "failed",
    errorCode: "plan_acp_session_failed",
  });
  expect(turn.events).toContain("adapter fatal: codex app-server exited");
  const closed = await started.session.close();
  expect(closed).toMatchObject({
    exit: { code: 1 },
    leftovers: 1,
    isConfirmed: true,
  });
});

it("reports a missing ChatGPT sign-in of the connection instead of trying another account", async () => {
  const started = startCodexSession({
    sessionError: RequestError.authRequired(),
  });
  const turn = await started.session.turn;
  expect(turn.errorCode).toBe("cli_not_logged_in");
  expect(methodsOf(started.calls)).not.toContain("session/prompt");
});

it("fails before the prompt when the Pages MCP server cannot start", async () => {
  const started = startCodexSession({ isMcpStartFailing: true });
  const turn = await started.session.turn;
  expect(turn.errorCode).toBe("plan_mcp_unavailable");
  expect(methodsOf(started.calls)).not.toContain("session/prompt");
});

it.each([
  ["max_tokens", "incomplete"],
  ["max_turn_requests", "incomplete"],
  ["refusal", "failed"],
  ["cancelled", "cancelled"],
] as const)(
  "a turn that stops with %s ends as %s",
  async (stopReason, failure) => {
    const started = startCodexSession({ turn: async () => stopReason });
    const turn = await started.session.turn;
    expect(turn).toMatchObject({ failure, errorCode: null });
    expect(turn.events).toContain(`turn ${stopReason}`);
  },
);

it("reports progress to the run record while the turn runs, also before the turn ends", async () => {
  const started = startCodexSession({ turn: endlessTurn });
  await vi.waitFor(() =>
    expect(started.observer.progressed).toHaveBeenCalled(),
  );
  expect(started.observer.progressed.mock.calls[0]?.[0]).toEqual(
    expect.arrayContaining([
      `session ${FAKE_SESSION_ID}`,
      "tool execute cargo test",
    ]),
  );
  started.process.crash("");
  await started.session.turn;
});
