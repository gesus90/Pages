import { expect, it, vi } from "vitest";

import { startAcpSession, methodsOf } from "./acp-harness";

vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  RUN_INSTANCE_VARIABLE: "PAGES_RUN_INSTANCE",
  readServerScope: async () => ({ earliestStart: 0 }),
  endTaggedProcesses: vi.fn(async () => ({ found: 0, remaining: 0 })),
}));

it.each(["codex_cli", "claude_code"] as const)(
  "records %s's actually announced capabilities and adapter version without attempting plan session resume",
  async (provider) => {
    const started = startAcpSession(
      {
        continuation: {
          loadSession: true,
          sessionCapabilities: { resume: {} },
        },
      },
      { provider, hasMcp: false },
    );
    const turn = await started.session.turn;

    expect(turn.failure).toBeNull();
    expect(started.observer.capabilities).toHaveBeenCalledExactlyOnceWith({
      canLoad: true,
      canResume: true,
      adapter:
        provider === "codex_cli"
          ? "@agentclientprotocol/codex-acp 2.2.2"
          : "@agentclientprotocol/claude-agent-acp 0.90.0",
    });
    expect(methodsOf(started.calls)).not.toContain("session/resume");
    expect(methodsOf(started.calls)).not.toContain("session/load");
    await started.session.close();
  },
);

it.each(["codex_cli", "claude_code"] as const)(
  "never infers continuation capabilities from the %s provider name",
  async (provider) => {
    const started = startAcpSession({}, { provider, hasMcp: false });
    await started.session.turn;

    expect(started.observer.capabilities).toHaveBeenCalledWith(
      expect.objectContaining({ canLoad: false, canResume: false }),
    );
    await started.session.close();
  },
);

it("does not certify capabilities announced by an unsupported adapter", async () => {
  const started = startAcpSession(
    {
      agentInfo: { name: "foreign-adapter", version: "999" },
      continuation: { loadSession: true, sessionCapabilities: { resume: {} } },
    },
    { hasMcp: false },
  );

  expect((await started.session.turn).errorCode).toBe(
    "plan_acp_adapter_unsupported",
  );
  expect(started.observer.capabilities).not.toHaveBeenCalled();
  expect(methodsOf(started.calls)).toEqual(["initialize"]);
  await started.session.close();
});
