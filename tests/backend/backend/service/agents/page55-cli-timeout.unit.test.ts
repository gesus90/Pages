import { ChildProcess } from "node:child_process";

import { afterEach, expect, it, vi } from "vitest";

import { CliSessionProcess } from "@/backend/agents/cli/CliSessionProcess";
import { AgentRunCredentialRepository } from "@/backend/database/repositories/mcp/AgentRunCredentialRepository";
import { AgentRunCredentialService } from "@/backend/service/mcp/AgentRunCredentialService";
import { AgentPlanSessionAccess } from "@/backend/service/agents/AgentPlanSessionAccess";

import type { Database } from "@/backend/database/Database";

vi.mock("node:fs/promises", () => ({ access: async () => {} }));

afterEach(() => vi.useRealTimers());

it("keeps CLI sessions without a deadline alive until their process completes", async () => {
  vi.useFakeTimers();
  const child = new ChildProcess();
  Object.defineProperty(child, "pid", { value: 1234 });
  const signalGroup = vi.fn();
  const process = new CliSessionProcess(
    child,
    { timeoutMs: 0, signal: new AbortController().signal, onLine: vi.fn() },
    signalGroup,
  );
  await vi.advanceTimersByTimeAsync(121 * 60_000);
  expect(signalGroup).not.toHaveBeenCalled();
  child.emit("close", 0, null);
  expect(await process.exited).toMatchObject({ code: 0, errorCode: null });
});

it("kills the entire CLI group at the exact timeout without a SIGTERM grace period", async () => {
  vi.useFakeTimers();
  const child = new ChildProcess();
  Object.defineProperty(child, "pid", { value: 1234 });
  const signalGroup = vi.fn();
  const process = new CliSessionProcess(
    child,
    {
      timeoutMs: 60_000,
      signal: new AbortController().signal,
      onLine: vi.fn(),
    },
    signalGroup,
  );
  await vi.advanceTimersByTimeAsync(59_999);
  expect(signalGroup).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(signalGroup).toHaveBeenCalledExactlyOnceWith(-1234, "SIGKILL");
  child.emit("close", null, "SIGKILL");
  expect(await process.exited).toMatchObject({
    signal: "SIGKILL",
    errorCode: "check_timeout",
  });
  expect(vi.getTimerCount()).toBe(0);
});

it("also kills immediately when the shared deadline signal interrupts a CLI session", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const child = new ChildProcess();
  Object.defineProperty(child, "pid", { value: 1234 });
  const signalGroup = vi.fn();
  const process = new CliSessionProcess(
    child,
    { timeoutMs: 0, signal: controller.signal, onLine: vi.fn() },
    signalGroup,
  );
  controller.abort(new DOMException("Timeout", "TimeoutError"));
  expect(signalGroup).toHaveBeenCalledExactlyOnceWith(-1234, "SIGKILL");
  child.emit("close", null, "SIGKILL");
  expect((await process.exited).errorCode).toBe("check_timeout");
});

it("issues unlimited run credentials until revocation, rather than expiring after five minutes", async () => {
  const execute = vi.fn<Database["execute"]>(async () => {});
  const query = vi.fn<Database["query"]>(async () => []);
  const repository = new AgentRunCredentialRepository({
    query,
    execute,
  });
  const credentials = new AgentRunCredentialService(repository);
  const scope = {
    runId: "run",
    stepId: "step",
    operations: ["ticket.read"],
    tickets: [{ id: "ticket", key: "SYN-55" }],
  };
  const issued = await credentials.issue("owner", scope, 0);
  expect(issued.expiresAt).toBe(Number.MAX_SAFE_INTEGER);
  const sessionAccess = new AgentPlanSessionAccess(credentials, {
    bundle: "/synthetic/mcp.mjs",
    node: "/synthetic/node",
    url: "http://synthetic.invalid",
  });
  await sessionAccess.grant({ userId: "owner", ...scope, lifetimeMs: 0 });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    expires_at: Number.MAX_SAFE_INTEGER,
  });
  await sessionAccess.revoke("run", "step");
  expect(query.mock.calls[0]?.[1]).toMatchObject({
    run_id: "run",
    step_id: "step",
  });
});
