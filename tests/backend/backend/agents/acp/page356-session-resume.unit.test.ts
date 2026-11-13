import { RequestError } from "@agentclientprotocol/sdk";
import { expect, it, vi } from "vitest";

import { methodsOf, startCodexSession } from "./acp-harness";
import { FAKE_SESSION_ID } from "./fake-acp-adapter";

vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  RUN_INSTANCE_VARIABLE: "PAGES_RUN_INSTANCE",
  readServerScope: async () => ({ earliestStart: 0 }),
  endTaggedProcesses: vi.fn(async () => ({ found: 0, remaining: 0 })),
}));

it("continues an existing native session without opening a replacement", async () => {
  const started = startCodexSession(
    {},
    { resumeSessionId: FAKE_SESSION_ID, canReplaceMissingSession: true },
  );
  expect((await started.session.turn).failure).toBeNull();
  expect(methodsOf(started.calls)).toContain("session/resume");
  expect(methodsOf(started.calls)).not.toContain("session/new");
  await started.session.close();
});

it("replaces a missing native session during explicit recovery and sends the complete saved-context prompt", async () => {
  const started = startCodexSession(
    { resumeError: RequestError.invalidParams() },
    { resumeSessionId: "missing-session", canReplaceMissingSession: true },
  );
  expect((await started.session.turn).failure).toBeNull();
  const methods = methodsOf(started.calls);
  expect(methods.indexOf("session/resume")).toBeLessThan(
    methods.indexOf("session/new"),
  );
  expect(methods).toContain("session/prompt");
  await started.session.close();
});

it("preserves refusal of missing native sessions outside explicit plan recovery", async () => {
  const started = startCodexSession(
    { resumeError: RequestError.invalidParams() },
    { resumeSessionId: "missing-session" },
  );
  expect((await started.session.turn).errorCode).toBe(
    "acp_session_resume_failed",
  );
  expect(methodsOf(started.calls)).not.toContain("session/new");
  await started.session.close();
});
