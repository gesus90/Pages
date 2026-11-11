import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { readParameterRecord } from "@/backend/service/agents/AgentParameterReader";
import { CHAT_MAXIMUM_ACTIONS } from "@/backend/service/chat/ChatExecutionLimits";

import { OWNER } from "../page48-chat-fixture";
import { operatorWorld } from "./pica-operator-world";

import type * as LoggerModule from "@/backend/logging/Logger";
import type { ServerLogEvent } from "@/backend/logging/Logger";
import type { AgentAdminChanged } from "@/definition/AgentAdministration";

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

const CHANGED: AgentAdminChanged = {
  id: "department-1",
  targetType: "department",
  changed: true,
  affectedUserIds: [],
};

/** Tells whether the call carried the typed confirmation. */
function isConfirmed(parameters: unknown): boolean {
  return (
    typeof parameters === "object" &&
    parameters !== null &&
    "confirmation" in parameters
  );
}

const DEACTIVATE = {
  userId: "user-7",
  isActive: false,
  expectedIsActive: true,
};

beforeEach(() => {
  events.logEvent.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

function audited(): { operation: string; status: string }[] {
  return events.logEvent.mock.calls
    .map(([event]) => event)
    .filter(({ event }) => event === "pica.admin.tool")
    .map(({ metadata }) => ({
      operation: String(metadata?.operation),
      status: String(metadata?.status),
    }));
}

it("runs an administration read with the fresh identity of the person and audits it", async () => {
  const world = operatorWorld();
  const turn = world.turn("turn-1", "Zeig die Benutzer");

  const outcome = await world.call(turn, "list_admin_users", {});

  expect(outcome).toMatchObject({ ok: true, error: null });
  expect(outcome.result).toContain("admin.users.list");
  expect(world.router).toHaveBeenCalledTimes(1);
  const [identity, request] = world.router.mock.calls[0];
  expect(identity.userId).toBe(OWNER.id);
  expect(request).toEqual({ operation: "admin.users.list", parameters: {} });
  expect(audited()).toEqual([
    { operation: "admin.users.list", status: "started" },
    { operation: "admin.users.list", status: "executed" },
    { operation: "admin.users.list", status: "completed" },
  ]);
});

it("adds a stable operation ID itself and never a confirmation to an uncritical change", async () => {
  const world = operatorWorld();
  const turn = world.turn("turn-1", "Benenne die Abteilung um");
  const input = {
    departmentId: "dep-1",
    name: "Einkauf",
    expectedName: "Beschaffung",
  };

  await world.call(turn, "rename_admin_department", input);
  await world.call(turn, "rename_admin_department", input);

  const [, first] = world.router.mock.calls[0];
  const [, second] = world.router.mock.calls[1];
  expect(first.operation).toBe("admin.departments.rename");
  const { operationId, ...rest } = readParameterRecord(first.parameters);
  expect(rest).toEqual(input);
  expect(operationId).toMatch(/^[0-9a-f]{64}$/u);
  expect(second.parameters).toEqual(first.parameters);
});

it("takes neither an operation ID nor a confirmation from the model", async () => {
  const world = operatorWorld();
  const turn = world.turn("turn-1", "Sperre den Benutzer");

  for (const forged of [{ operationId: "mine" }, { confirmation: "LÖSCHEN" }])
    expect(
      await turn.registry.invoke(
        "set_admin_user_active",
        { ...DEACTIVATE, ...forged },
        turn.context,
      ),
    ).toEqual({ isValid: false, output: null });
  expect(world.router).not.toHaveBeenCalled();
});

it("reaches the other administration of the shared catalog through the same path", async () => {
  const world = operatorWorld();
  const turn = world.turn("turn-1", "Nimm Anna ins Projekt auf");

  await world.call(turn, "list_groups", {});
  await world.call(turn, "assign_project_member", {
    projectId: "project",
    targetType: "person",
    targetId: "anna",
    role: "member",
  });

  expect(
    world.router.mock.calls.map(([, request]) => request.operation),
  ).toEqual(["groups.list", "projects.member.assign"]);
});

it("asks for a confirmation before a critical change and runs it only after the person's later reply", async () => {
  const world = operatorWorld();

  const asking = world.turn("turn-1", "Sperre Benutzer user-7");
  const prompt = await world.call(asking, "set_admin_user_active", DEACTIVATE);
  const again = await world.call(asking, "set_admin_user_active", DEACTIVATE);
  expect(prompt).toMatchObject({ ok: false, error: "CONFIRMATION_REQUIRED" });
  expect(JSON.parse(prompt.result ?? "null")).toMatchObject({
    result: {
      operation: "admin.users.setActive",
      parameters: DEACTIVATE,
    },
  });
  expect(JSON.parse(prompt.result ?? "null").result).not.toHaveProperty(
    "confirmation",
  );
  expect(again.error).toBe("RETRY_REFUSED");

  const chatty = world.turn("turn-2", "Erkläre mir erst die Folgen");
  expect(
    (await world.call(chatty, "set_admin_user_active", DEACTIVATE)).error,
  ).toBe("CONFIRMATION_REQUIRED");
  expect(world.router).not.toHaveBeenCalled();

  const confirmed = world.turn("turn-3", "Ja, bitte");
  const outcome = await world.call(
    confirmed,
    "set_admin_user_active",
    DEACTIVATE,
  );
  expect(outcome.ok).toBe(true);
  expect(world.router).toHaveBeenCalledTimes(1);
  const [, request] = world.router.mock.calls[0];
  expect(request.operation).toBe("admin.users.setActive");
  const { operationId, ...rest } = readParameterRecord(request.parameters);
  expect(rest).toEqual({ ...DEACTIVATE, confirmation: "LÖSCHEN" });
  expect(typeof operationId).toBe("string");
});

it("never takes the confirmation in the turn that asked, and binds it to the exact call", async () => {
  const world = operatorWorld();

  const asking = world.turn("turn-1", "Ja, sperre Benutzer user-7");
  expect(
    (await world.call(asking, "set_admin_user_active", DEACTIVATE)).error,
  ).toBe("CONFIRMATION_REQUIRED");

  const confirmed = world.turn("turn-2", "Ja, bitte");
  const other = { ...DEACTIVATE, userId: "user-8" };
  expect(
    (await world.call(confirmed, "set_admin_user_active", other)).error,
  ).toBe("CONFIRMATION_REQUIRED");
  expect(world.router).not.toHaveBeenCalled();
});

it("asks the person as well when a service holds a change back for a confirmation", async () => {
  const world = operatorWorld();
  world.router.mockImplementation(async (_, request) => {
    if (!isConfirmed(request.parameters))
      throw new AgentOperationError("CONFIRMATION_REQUIRED");
    return { apiVersion: "1", result: CHANGED };
  });
  const input = {
    roleId: "role-1",
    permissions: [],
    expectedPermissions: ["manage_users"],
  };

  const asking = world.turn("turn-1", "Entzieh der Rolle die Rechte");
  expect(
    (await world.call(asking, "set_admin_role_permissions", input)).error,
  ).toBe("CONFIRMATION_REQUIRED");

  const confirmed = world.turn("turn-2", "Ja, bitte");
  const outcome = await world.call(
    confirmed,
    "set_admin_role_permissions",
    input,
  );
  expect(outcome.ok).toBe(true);
  const [withoutConfirmation, withConfirmation] =
    world.router.mock.calls.slice(-2);
  expect(withoutConfirmation[1].parameters).not.toHaveProperty("confirmation");
  expect(withConfirmation[1].parameters).toMatchObject({
    confirmation: "LÖSCHEN",
  });
});

it("does not repeat a failed change unchanged within one turn", async () => {
  const world = operatorWorld();
  world.router.mockRejectedValue(new AgentOperationError("CONFLICT"));
  const turn = world.turn("turn-1", "Benenne um");
  const input = { departmentId: "d", name: "Neu", expectedName: "Alt" };

  expect((await world.call(turn, "rename_admin_department", input)).error).toBe(
    "CONFLICT",
  );
  expect((await world.call(turn, "rename_admin_department", input)).error).toBe(
    "RETRY_REFUSED",
  );
  expect(world.router).toHaveBeenCalledTimes(1);
});

it("counts administrator calls against the budget of the turn", async () => {
  const world = operatorWorld();
  const turn = world.turn("turn-1", "Liste alles");

  for (let call = 0; call < CHAT_MAXIMUM_ACTIONS; call += 1)
    await world.call(turn, "list_admin_roles", {});
  const refused = await world.call(turn, "list_admin_roles", {});

  expect(refused).toMatchObject({ ok: false, error: "STEP_LIMIT" });
  expect(world.router).toHaveBeenCalledTimes(CHAT_MAXIMUM_ACTIONS);
});

it("records who did what without parameters or results", async () => {
  const world = operatorWorld();
  const turn = world.turn("turn-1", "Benenne um");

  await world.call(turn, "rename_admin_department", {
    departmentId: "d",
    name: "Streng geheimer Name 4711",
    expectedName: "Alt",
  });

  const logged = JSON.stringify(events.logEvent.mock.calls);
  expect(logged).not.toContain("Streng geheimer Name");
  const completed = events.logEvent.mock.calls
    .map(([event]) => event)
    .find(({ metadata }) => metadata?.status === "completed");
  expect(completed?.metadata).toMatchObject({
    userId: OWNER.id,
    operation: "admin.departments.rename",
  });
  expect(completed?.metadata?.source).toMatch(/^[0-9a-f]{64}$/u);
});

it("refuses a call once the right was withdrawn and never reaches a service", async () => {
  const world = operatorWorld();
  const turn = world.turn("turn-1", "Zeig die Benutzer");
  await world.call(turn, "list_admin_users", {});

  world.person.isAdmin = false;

  await expect(world.call(turn, "list_admin_users", {})).rejects.toThrow(
    "administrator",
  );
  expect(world.router).toHaveBeenCalledTimes(1);
});

it("reports a withdrawal during a running action instead of its result", async () => {
  const world = operatorWorld();
  world.router.mockImplementation(async () => {
    world.person.isAdmin = false;
    return { apiVersion: "1", result: CHANGED };
  });
  const turn = world.turn("turn-1", "Benenne um");

  const outcome = await world.call(turn, "rename_admin_department", {
    departmentId: "d",
    name: "Neu",
    expectedName: "Alt",
  });

  expect(outcome).toEqual({ ok: false, result: null, error: "ADMIN_REQUIRED" });
  expect(audited().map(({ status }) => status)).toEqual([
    "started",
    "executed",
    "ADMIN_REQUIRED",
  ]);
});

it("aborts the whole job when the administrator right is withdrawn", async () => {
  vi.useFakeTimers();
  const world = operatorWorld();
  const turn = world.turn("turn-1", "Zeig die Benutzer");
  await world.call(turn, "list_admin_users", {});
  expect(turn.context.signal.aborted).toBe(false);

  world.person.isAdmin = false;
  await vi.advanceTimersByTimeAsync(300);

  expect(turn.context.signal.aborted).toBe(true);
  expect(turn.context.signal.reason).toBe("adminRevoked");
  expect(audited()).toContainEqual({
    operation: "scope.revoke",
    status: "denied",
  });
});

it("stops an action in flight when the person stops the job", async () => {
  const world = operatorWorld();
  world.router.mockImplementation(async () => {
    world.signal.abort();
    return { apiVersion: "1", result: CHANGED };
  });
  const turn = world.turn("turn-1", "Benenne um");

  const outcome = await world.call(turn, "rename_admin_department", {
    departmentId: "d",
    name: "Neu",
    expectedName: "Alt",
  });

  expect(outcome).toEqual({ ok: false, result: null, error: "CANCELLED" });
});

it("starts nothing for a job that was stopped before the call", async () => {
  const world = operatorWorld();
  const turn = world.turn("turn-1", "Zeig die Benutzer");

  world.signal.abort();

  await expect(world.call(turn, "list_admin_users", {})).rejects.toThrow();
  expect(world.router).not.toHaveBeenCalled();
});
