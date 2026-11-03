import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { FIRST, OWNER } from "../page48-chat-fixture";
import { operatorWorld } from "./pica-operator-world";

import type * as LoggerModule from "@/backend/logging/Logger";
import type { ServerLogEvent } from "@/backend/logging/Logger";
import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";

// The plan tools come from the independent MCP catalog, which Pages unit tests do not load.
vi.mock("@/backend/service/chat/PicaPlanTools", () => ({
  registerPicaPlanTools: vi.fn(),
}));
vi.mock("@/backend/runtime/ProcessLifecycle", () => ({
  registerShutdownTask: vi.fn(),
}));
const events = vi.hoisted(() => ({
  logEvent: vi.fn<(event: ServerLogEvent) => void>(),
}));
vi.mock("@/backend/logging/Logger", async (importOriginal) => ({
  ...(await importOriginal<typeof LoggerModule>()),
  logEvent: events.logEvent,
}));

const CONTEXT: RuntimeExecutionContext = {
  userId: OWNER.id,
  sessionId: FIRST,
  runId: "job",
  signal: new AbortController().signal,
  authorize: async () => undefined,
};

beforeEach(() => {
  events.logEvent.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("tells an administrator from everyone else by the persisted account", async () => {
  const world = operatorWorld();
  expect(await world.service.isAdministrator(OWNER.id)).toBe(true);

  world.person.mode = "role";
  expect(await world.service.isAdministrator(OWNER.id)).toBe(false);
  world.person.mode = "admin";
  world.person.isActive = false;
  expect(await world.service.isAdministrator(OWNER.id)).toBe(false);
  world.person.isActive = true;
  world.person.mustChangePassword = true;
  expect(await world.service.isAdministrator(OWNER.id)).toBe(false);
});

it("treats an unknown answer as an error, never as a denial or a grant", async () => {
  const { PicaAdminService } =
    await import("@/backend/service/chat/admin/PicaAdminService");
  const service = new PicaAdminService({
    users: {
      getById: async () => {
        throw new Error("Accounts unavailable");
      },
    },
    administration: { getContext: async () => Promise.reject(new Error("x")) },
  });

  await expect(service.isAdministrator(OWNER.id)).rejects.toThrow(
    "Accounts unavailable",
  );
  await expect(service.gate()(CONTEXT, "tool")).rejects.toThrow(
    "Accounts unavailable",
  );
});

it("audits a refusal at the gate by tool and person", async () => {
  const world = operatorWorld({ isAdmin: false });

  expect(await world.service.gate()(CONTEXT, "list_admin_users")).toBe(false);

  const denial = events.logEvent.mock.calls
    .map(([event]) => event)
    .find(({ metadata }) => metadata?.status === "denied");
  expect(denial).toMatchObject({
    event: "pica.admin.tool",
    level: "warn",
    metadata: {
      userId: OWNER.id,
      operation: "list_admin_users",
      status: "denied",
    },
  });
});

it("keeps the scope of a long chat job alive and expires only a console task", async () => {
  vi.useFakeTimers();
  vi.spyOn(process, "getuid").mockReturnValue(1000);
  const world = operatorWorld();
  const job = world.service.bind(CONTEXT);
  await world.service.runPrivileged(
    { operation: "admin.users.list" },
    job,
    async () => ({ ok: true, result: "[]", error: null }),
  );
  const taskId = await world.service.startConsole(OWNER.id);
  const console = world.service.consoleContext(OWNER.id, taskId);

  await vi.advanceTimersByTimeAsync(11 * 60_000);

  expect(job.signal.aborted).toBe(false);
  expect(console.signal.aborted).toBe(true);
  expect(() => world.service.consoleContext(OWNER.id, taskId)).toThrow(
    "TASK_REQUIRED",
  );
});

it("uses the administrator account alone for management and demands an unprivileged process for host access", async () => {
  vi.spyOn(process, "getuid").mockReturnValue(0);
  const world = operatorWorld();

  const management = await world.service.runPrivileged(
    { operation: "admin.users.list" },
    world.service.bind(CONTEXT),
    async () => ({ ok: true, result: "[]", error: null }),
  );
  const host = await world.service.runPrivileged(
    { operation: "admin_files_find", isHostAccess: true },
    world.service.bind(CONTEXT),
    async () => ({ ok: true, result: "[]", error: null }),
  );

  expect(management.ok).toBe(true);
  expect(host).toEqual({ ok: false, result: null, error: "OS_RIGHTS_DENIED" });
});

it("answers a failing handler with a stable code and keeps its message out of the log", async () => {
  const world = operatorWorld();

  const outcome = await world.service.runPrivileged(
    { operation: "admin.users.list", input: { secret: "S3CRET" } },
    world.service.bind(CONTEXT),
    async () => {
      throw new Error("raw database failure with S3CRET");
    },
  );

  expect(outcome).toEqual({
    ok: false,
    result: null,
    error: "ADMIN_TOOL_FAILED",
  });
  expect(JSON.stringify(events.logEvent.mock.calls)).not.toContain("S3CRET");
});

it("reports the end of the scope to a running call as a missing right", async () => {
  const world = operatorWorld();
  const bound = world.service.bind(CONTEXT);

  const outcome = await world.service.runPrivileged(
    { operation: "admin.users.list" },
    bound,
    async (guarded) => {
      await world.service.release(guarded);
      guarded.signal.throwIfAborted();
      return { ok: true, result: "[]", error: null };
    },
  );

  expect(outcome.error).toBe("ADMIN_REQUIRED");
});
