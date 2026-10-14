import { RequestError } from "@agentclientprotocol/sdk";
import { beforeEach, expect, it, vi } from "vitest";

import { INSTANCE_ID, methodsOf, startAcpSession } from "./acp-harness";
import { FAKE_SESSION_ID } from "./fake-acp-adapter";

import type { StopReason } from "@agentclientprotocol/sdk";
import type { FakeTurn } from "./fake-acp-adapter";

/** The two ACP runners; the session and its closing are the same code for both. */
const RUNNERS = [
  {
    provider: "codex_cli",
    sessionFailed: "plan_acp_session_failed",
    mcpFailure: { isMcpStartFailing: true },
  },
  {
    provider: "claude_code",
    sessionFailed: "plan_claude_acp_session_failed",
    mcpFailure: { mcpStatus: "failed" },
  },
] as const;

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

it.each(RUNNERS)(
  "$provider closes the protocol session, the adapter and every tagged helper, and confirms that none is left",
  async ({ provider }) => {
    const started = startAcpSession({}, { provider });
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
  },
);

it.each(RUNNERS)(
  "$provider ends helpers that outlived the adapter and reports a closeout that left a process",
  async ({ provider }) => {
    scan.endTaggedProcesses.mockImplementationOnce(async () => ({
      found: 2,
      remaining: 1,
    }));
    const started = startAcpSession({}, { provider });
    await started.session.turn;
    const closed = await started.session.close();
    expect(closed).toMatchObject({ leftovers: 2, isConfirmed: false });
  },
);

it.each(RUNNERS)(
  "$provider: a stop ends the running turn with its whole process and the session closes afterwards",
  async ({ provider }) => {
    const controller = new AbortController();
    const started = startAcpSession(
      { turn: endlessTurn },
      { provider, controller },
    );
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
  },
);

it.each(RUNNERS)(
  "$provider: a deadline ends the running turn as a timeout",
  async ({ provider }) => {
    const controller = new AbortController();
    const started = startAcpSession(
      { turn: endlessTurn },
      { provider, controller },
    );
    await vi.waitFor(() =>
      expect(methodsOf(started.calls)).toContain("session/prompt"),
    );
    controller.abort(new DOMException("Deadline", "TimeoutError"));
    const turn = await started.session.turn;
    expect(turn.failure).toBe("timeout");
    expect(started.process.cancelled).toEqual(["check_timeout"]);
    expect((await started.session.close()).isConfirmed).toBe(true);
  },
);

it.each(RUNNERS)(
  "$provider: a deadline of the process that fires before the one of the node still ends as a timeout",
  async ({ provider }) => {
    const started = startAcpSession({ turn: endlessTurn }, { provider });
    await vi.waitFor(() =>
      expect(methodsOf(started.calls)).toContain("session/prompt"),
    );
    // The node's own signal has not aborted; only the runner's deadline ended the process.
    started.process.cancel("check_timeout");
    const turn = await started.session.turn;
    expect(turn).toMatchObject({ failure: "timeout", errorCode: null });
    expect((await started.session.close()).isConfirmed).toBe(true);
  },
);

it.each(RUNNERS)(
  "$provider: an adapter that exits during the turn fails the node with its last error line and leaves no process",
  async ({ provider, sessionFailed }) => {
    scan.endTaggedProcesses.mockImplementationOnce(async () => ({
      found: 1,
      remaining: 0,
    }));
    const started = startAcpSession({ turn: endlessTurn }, { provider });
    await vi.waitFor(() =>
      expect(methodsOf(started.calls)).toContain("session/prompt"),
    );
    started.process.crash("starting\nfatal: app-server exited\n");
    const turn = await started.session.turn;
    expect(turn).toMatchObject({
      failure: "failed",
      errorCode: sessionFailed,
    });
    expect(turn.events).toContain("adapter fatal: app-server exited");
    const closed = await started.session.close();
    expect(closed).toMatchObject({
      exit: { code: 1 },
      leftovers: 1,
      isConfirmed: true,
    });
  },
);

it.each(RUNNERS)(
  "$provider reports a missing sign-in of the connection instead of trying another account",
  async ({ provider }) => {
    const started = startAcpSession(
      { sessionError: RequestError.authRequired() },
      { provider },
    );
    const turn = await started.session.turn;
    expect(turn.errorCode).toBe("cli_not_logged_in");
    expect(methodsOf(started.calls)).not.toContain("session/prompt");
  },
);

it.each(RUNNERS)(
  "$provider fails before the prompt of the node when the Pages MCP server cannot start",
  async ({ provider, mcpFailure }) => {
    const started = startAcpSession(mcpFailure, { provider });
    const turn = await started.session.turn;
    expect(turn.errorCode).toBe("plan_mcp_unavailable");
    // Claude Code is asked for its MCP status with a local command, which is no prompt of the node.
    expect(JSON.stringify(started.calls)).not.toContain("Synthetic agent");
    expect(turn.output).toBe("");
  },
);

it.each(
  RUNNERS.flatMap((runner) =>
    (
      [
        ["max_tokens", "incomplete"],
        ["max_turn_requests", "incomplete"],
        ["refusal", "failed"],
        ["cancelled", "cancelled"],
      ] as const
    ).map(([stopReason, failure]) => ({ ...runner, stopReason, failure })),
  ),
)(
  "$provider: a turn that stops with $stopReason ends as $failure",
  async ({ provider, stopReason, failure }) => {
    const started = startAcpSession(
      { turn: async () => stopReason },
      { provider },
    );
    const turn = await started.session.turn;
    expect(turn).toMatchObject({ failure, errorCode: null });
    expect(turn.events).toContain(`turn ${stopReason}`);
  },
);

it.each(RUNNERS)(
  "$provider reports progress to the run record while the turn runs, also before the turn ends",
  async ({ provider }) => {
    const started = startAcpSession({ turn: endlessTurn }, { provider });
    await vi.waitFor(() =>
      expect(started.observer.progressed).toHaveBeenCalled(),
    );
    expect(started.observer.progressed.mock.calls[0]?.[0]).toContain(
      `session ${FAKE_SESSION_ID}`,
    );
    started.process.crash("");
    const turn = await started.session.turn;
    expect(turn.events).toContain("tool execute cargo test");
  },
);
