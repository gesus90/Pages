import { beforeEach, expect, it, vi } from "vitest";

import { action } from "@/app/routes/pica-tools-api";
import { PicaAdminError } from "@/backend/service/chat/admin/PicaAdminContracts";

import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

import type * as LoggerModule from "@/backend/logging/Logger";
import type { User } from "@/definition/User";

const ORIGIN = "https://pages.invalid";

const fakes = vi.hoisted(() => ({
  logEvent: vi.fn(),
  protectOrigin: vi.fn(),
  requireAdministrator: vi.fn(),
  startConsole: vi.fn(),
  consoleContext: vi.fn(),
  release: vi.fn(),
  run: vi.fn(),
}));
vi.mock("@/backend/logging/Logger", async (importOriginal) => ({
  ...(await importOriginal<typeof LoggerModule>()),
  logEvent: fakes.logEvent,
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({
    picaAdminService: {
      protectOrigin: fakes.protectOrigin,
      requireAdministrator: fakes.requireAdministrator,
      startConsole: fakes.startConsole,
      consoleContext: fakes.consoleContext,
      release: fakes.release,
      run: fakes.run,
    },
  }),
}));

const EXECUTION = {
  signal: new AbortController().signal,
  authorize: async (): Promise<void> => undefined,
};

beforeEach(() => {
  fakes.requireAdministrator.mockResolvedValue(undefined);
  fakes.startConsole.mockResolvedValue("started-task");
  fakes.consoleContext.mockReturnValue(EXECUTION);
});

interface CallOptions {
  readonly user?: User | null;
  readonly method?: string;
  readonly origin?: string;
}

async function call(
  input: unknown,
  options: CallOptions = {},
): Promise<[number, unknown]> {
  const method = options.method ?? "POST";
  const response = await action(
    routeArguments(
      new Request(`${ORIGIN}/pica-tools-api`, {
        method,
        headers: { Origin: options.origin ?? ORIGIN },
        body: method === "GET" ? null : JSON.stringify(input),
      }),
      options.user === undefined ? EMPLOYEE : options.user,
      {},
    ),
  );
  return [response.status, await response.json()];
}

function lastDenial(): unknown {
  return fakes.logEvent.mock.calls.at(-1)?.[0]?.metadata;
}

it.each<[string, CallOptions, string | null]>([
  ["no signed-in person", { user: null }, null],
  ["another method", { method: "PUT" }, EMPLOYEE.id],
  ["a foreign origin", { origin: "https://foreign.invalid" }, EMPLOYEE.id],
])("refuses %s as ADMIN_REQUIRED", async (scenario, options, userId) => {
  expect(await call({ tool: "admin_files_find" }, options)).toEqual([
    403,
    { ok: false, error: "ADMIN_REQUIRED" },
  ]);
  expect(lastDenial()).toEqual({ userId, code: "ADMIN_REQUIRED" });
  expect(fakes.requireAdministrator).not.toHaveBeenCalled();
});

it("refuses a person who is no administrator", async () => {
  fakes.requireAdministrator.mockRejectedValue(
    new PicaAdminError("ADMIN_REQUIRED"),
  );
  expect((await call({ tool: "admin_files_find" }))[0]).toBe(403);
  expect(fakes.protectOrigin).toHaveBeenCalledWith(ORIGIN);
  expect(fakes.requireAdministrator).toHaveBeenCalledWith(EMPLOYEE.id);
});

it("closes the given console task", async () => {
  expect(await call({ tool: "task_close", taskId: "task-1" })).toEqual([
    200,
    { ok: true, taskId: null },
  ]);
  expect(fakes.startConsole).not.toHaveBeenCalled();
  expect(fakes.consoleContext).toHaveBeenCalledWith(EMPLOYEE.id, "task-1");
  expect(fakes.release).toHaveBeenCalledWith(EXECUTION);
});

it("releases a freshly started console task when closing without a task id", async () => {
  expect(await call({ tool: "task_close" })).toEqual([
    200,
    { ok: true, taskId: null },
  ]);
  expect(fakes.startConsole).toHaveBeenCalledWith(EMPLOYEE.id);
  expect(fakes.consoleContext).toHaveBeenCalledWith(
    EMPLOYEE.id,
    "started-task",
  );
  expect(fakes.release).toHaveBeenCalledWith(EXECUTION);
});

it("starts a console task and runs a known tool with valid arguments", async () => {
  fakes.run.mockResolvedValue({ ok: true, result: "listing", error: null });
  expect(
    await call({ tool: "admin_files_find", parameters: { directory: "/srv" } }),
  ).toEqual([
    200,
    {
      taskId: "started-task",
      outcome: { ok: true, result: "listing", error: null },
    },
  ]);
  expect(fakes.run).toHaveBeenCalledWith(
    "admin_files_find",
    { directory: "/srv" },
    expect.objectContaining({ signal: EXECUTION.signal }),
  );
});

it.each([
  [{ tool: "unknown_tool" }, "UNKNOWN_TOOL"],
  [{ tool: 7 }, "UNKNOWN_TOOL"],
  [
    { tool: "admin_files_find", parameters: { directory: 1 } },
    "INVALID_ARGUMENTS",
  ],
])("refuses the request %j as %s", async (input, code) => {
  expect(await call(input)).toEqual([400, { ok: false, error: code }]);
  expect(fakes.run).not.toHaveBeenCalled();
});

it("reports an unexpected failure with a generic code", async () => {
  fakes.startConsole.mockRejectedValue(new Error("console"));
  expect(await call({ tool: "admin_files_find" })).toEqual([
    400,
    { ok: false, error: "ADMIN_TOOL_FAILED" },
  ]);
  expect(lastDenial()).toEqual({
    userId: EMPLOYEE.id,
    code: "ADMIN_TOOL_FAILED",
  });
});
