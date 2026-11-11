import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { RuntimeToolDeniedError } from "@/backend/agents/runtime/RuntimeToolRegistry";
import { PICA_NATIVE_OPERATIONS } from "@/backend/service/chat/PicaTools";
import {
  isChatWriteOperation,
  listChatOperations,
} from "@/backend/service/chat/ChatToolCatalog";
import {
  PICA_UNOFFERED_OPERATIONS,
  picaOperatorEntries,
} from "@/backend/service/chat/admin/PicaOperatorCatalog";
import {
  PLAN_READ_TOOLS,
  PLAN_WRITE_TOOLS,
} from "@/definition/AgentTools/Plans";
import {
  PLAN_DIAGNOSIS_READ_TOOLS,
  PLAN_RESOURCE_READ_TOOLS,
  PLAN_RESOURCE_WRITE_TOOLS,
} from "@/definition/AgentTools/PlanResources";

import { operatorWorld } from "./pica-operator-world";

import type * as LoggerModule from "@/backend/logging/Logger";
import type { ServerLogEvent } from "@/backend/logging/Logger";

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

beforeEach(() => {
  events.logEvent.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

/** What the audit log recorded for privileged calls, in order. */
function audit(): [string, string][] {
  return events.logEvent.mock.calls
    .map(([event]) => event)
    .filter(({ event }) => event === "pica.admin.tool")
    .map(({ metadata }) => [
      String(metadata?.operation),
      String(metadata?.status),
    ]);
}

it("offers an administrator every operation of the chat catalog, and a person no administrator tool", () => {
  const world = operatorWorld();
  const { registry } = world.turn("turn-1", "Hallo");

  const planOperations = [
    ...PLAN_READ_TOOLS,
    ...PLAN_WRITE_TOOLS,
    ...PLAN_RESOURCE_READ_TOOLS,
    ...PLAN_DIAGNOSIS_READ_TOOLS,
    ...PLAN_RESOURCE_WRITE_TOOLS,
  ].map(({ operation }) => operation);
  const reachable = new Set<string>([
    ...PICA_NATIVE_OPERATIONS,
    ...planOperations,
    ...picaOperatorEntries(PICA_NATIVE_OPERATIONS).map(
      ({ operation }) => operation,
    ),
    ...Object.keys(PICA_UNOFFERED_OPERATIONS),
  ]);
  expect(
    listChatOperations().filter((operation) => !reachable.has(operation)),
  ).toEqual([]);

  const administrator = registry.describe();
  const person = registry.describe({ includeAdministrator: false });
  const names = administrator.map(({ id }) => id);
  for (const operator of picaOperatorEntries(PICA_NATIVE_OPERATIONS))
    expect(names).toContain(operator.tool.name);
  expect(names).toEqual(
    expect.arrayContaining([
      "list_admin_users",
      "set_admin_user_active",
      "save_admin_role",
      "list_admin_connections",
      "set_admin_company_name",
      "assign_project_member",
      "admin_files_read",
    ]),
  );
  expect(person.filter(({ access }) => access === "administrator")).toEqual([]);
  expect(person.map(({ id }) => id)).toContain("projects_list");
  expect(person.map(({ id }) => id)).not.toContain("list_admin_users");
});

it("gives every administrator tool a strict contract without server-owned fields", () => {
  const { registry } = operatorWorld().turn("turn-1", "Hallo");

  const administrator = registry
    .describe()
    .filter(({ access }) => access === "administrator");
  expect(administrator.length).toBeGreaterThan(40);
  for (const tool of administrator) {
    expect(tool.description).toMatch(/^ADMIN ONLY/u);
    expect(tool.inputSchema.additionalProperties).toBe(false);
    const properties = Object.keys(
      (tool.inputSchema.properties as Record<string, unknown> | undefined) ??
        {},
    );
    expect(properties).not.toContain("operationId");
    expect(properties).not.toContain("confirmation");
  }
});

it("gives every changing administrator tool an operation ID and no reading tool one", () => {
  for (const { operation, isWrite } of picaOperatorEntries(
    PICA_NATIVE_OPERATIONS,
  ))
    expect([operation, isChatWriteOperation(operation)]).toEqual([
      operation,
      isWrite,
    ]);
});

it("never offers the operations whose result carries a one-time password", () => {
  const { registry } = operatorWorld().turn("turn-1", "Hallo");

  const operations = picaOperatorEntries(PICA_NATIVE_OPERATIONS).map(
    ({ operation }) => operation,
  );
  expect(operations).not.toContain("admin.users.create");
  expect(operations).not.toContain("admin.users.resetPassword");
  expect(Object.keys(PICA_UNOFFERED_OPERATIONS)).toEqual(
    expect.arrayContaining(["admin.users.create", "admin.users.resetPassword"]),
  );
  expect(registry.describe().map(({ id }) => id)).not.toContain(
    "create_admin_user",
  );
});

it("refuses a person who is no administrator before any service runs", async () => {
  const world = operatorWorld({ isAdmin: false });
  const turn = world.turn("turn-1", "Zeig mir alle Benutzer");

  await expect(world.call(turn, "list_admin_users", {})).rejects.toBeInstanceOf(
    RuntimeToolDeniedError,
  );
  await expect(
    world.call(turn, "set_admin_user_active", {
      userId: "u1",
      isActive: false,
      expectedIsActive: true,
    }),
  ).rejects.toBeInstanceOf(RuntimeToolDeniedError);
  expect(world.router).not.toHaveBeenCalled();
  expect(audit()).toEqual([
    ["list_admin_users", "denied"],
    ["set_admin_user_active", "denied"],
  ]);
});

it.each([
  ["a locked account", { isActive: false }],
  ["an account that must change its password", { mustChangePassword: true }],
  ["an administrator outside the admin mode", { mode: "role" as const }],
])("refuses %s", async (_, overrides) => {
  const world = operatorWorld(overrides);

  await expect(
    world.call(world.turn("turn-1", "Hallo"), "list_admin_roles", {}),
  ).rejects.toBeInstanceOf(RuntimeToolDeniedError);
  expect(world.router).not.toHaveBeenCalled();
});

it("keeps the administrator tools unusable when the registry has no gate", async () => {
  const world = operatorWorld();
  const { context } = world.turn("turn-1", "Hallo");
  const { RuntimeToolRegistry } =
    await import("@/backend/agents/runtime/RuntimeToolRegistry");
  const { z } = await import("zod");
  const registry = new RuntimeToolRegistry();
  const execute = vi.fn(async () => "ran");
  registry.register({
    id: "privileged",
    access: "administrator",
    description: "Privileged",
    inputSchema: z.strictObject({}),
    outputSchema: z.string(),
    execute,
  });

  await expect(
    registry.invoke("privileged", {}, context),
  ).rejects.toBeInstanceOf(RuntimeToolDeniedError);
  expect(execute).not.toHaveBeenCalled();
});
