import { beforeEach, expect, it, vi } from "vitest";

import { action, loader } from "@/app/routes/settings-interpreters";
import { InterpreterSettingsError } from "@/backend/service/interpreters/InterpreterProfiles";

import { accountFixture } from "../../backend/auth/account-fixture";
import { formOf } from "../actions/action-fixtures";
import { EMPLOYEE, thrownResponse } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

import type { FormFields } from "../actions/action-fixtures";
import type { User } from "@/definition/User";

const URL_OF_SETTINGS = "http://pages.invalid/settings/system/interpreters";

const fakes = vi.hoisted(() => ({
  getContext: vi.fn(),
  snapshot: vi.fn(),
  check: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({
    administrationService: { getContext: fakes.getContext },
  }),
}));
vi.mock("@/backend/runtime/PagesRuntime", () => ({
  getPagesRuntime: async () => ({
    interpreterProfiles: {
      snapshot: fakes.snapshot,
      check: fakes.check,
      save: fakes.save,
    },
  }),
}));

beforeEach(() => {
  fakes.getContext.mockResolvedValue(
    accountFixture({ isAdmin: true, mode: "admin" }),
  );
});

function submit(fields: FormFields, method = "POST"): Promise<Response> {
  return action(
    routeArguments(
      new Request(URL_OF_SETTINGS, {
        method,
        body: method === "POST" ? formOf(fields) : null,
      }),
      EMPLOYEE,
      {},
    ),
  );
}

async function answer(
  fields: FormFields,
): Promise<[number, unknown, string | null]> {
  const response = await submit(fields);
  return [
    response.status,
    await response.json(),
    response.headers.get("Cache-Control"),
  ];
}

it("returns the profile snapshot to an administrator", async () => {
  fakes.snapshot.mockResolvedValue({ revision: "r1", profiles: [] });
  const response = await loader(
    routeArguments(new Request(URL_OF_SETTINGS), EMPLOYEE, {}),
  );
  expect(await response.json()).toEqual({ revision: "r1", profiles: [] });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

it.each<[string, User | null]>([
  ["no session", null],
  ["a role-mode administrator", EMPLOYEE],
])("refuses %s", async (scenario, user) => {
  fakes.getContext.mockResolvedValue(accountFixture({ isAdmin: true }));
  const response = await thrownResponse(
    loader(routeArguments(new Request(URL_OF_SETTINGS), user, {})),
  );
  expect(response.status).toBe(403);
  expect(fakes.snapshot).not.toHaveBeenCalled();
});

it("allows only POST for changes", async () => {
  expect((await thrownResponse(submit({}, "PUT"))).status).toBe(405);
});

it("checks one explicit program", async () => {
  fakes.check.mockResolvedValue({ state: "ok", version: "3.12" });
  expect(
    await answer({
      intent: "check",
      id: "python",
      name: "Python",
      path: "/usr/bin/python3",
    }),
  ).toEqual([200, { check: { state: "ok", version: "3.12" } }, "no-store"]);
  expect(fakes.check).toHaveBeenCalledWith("/usr/bin/python3");
});

it("refuses a check of an invalid program path", async () => {
  expect(
    await answer({ intent: "check", id: "python", name: "Python", path: "x" }),
  ).toEqual([400, { error: "invalid", checks: {} }, "no-store"]);
  expect(fakes.check).not.toHaveBeenCalled();
});

it("saves a profile list against its revision", async () => {
  fakes.save.mockResolvedValue({ revision: "r2" });
  expect(
    await answer({ intent: "save", profiles: "[1]", revision: "r1" }),
  ).toEqual([200, { snapshot: { revision: "r2" } }, "no-store"]);
  expect(fakes.save).toHaveBeenCalledWith([1], "r1");
});

it.each<[string, FormFields]>([
  ["an unknown intent", { intent: "other", profiles: "[]", revision: "r" }],
  ["missing profiles", { intent: "save", revision: "r" }],
  [
    "oversized profiles",
    { intent: "save", profiles: "x".repeat(160_001), revision: "r" },
  ],
  ["a missing revision", { intent: "save", profiles: "[]" }],
])("refuses %s as invalid", async (scenario, fields) => {
  expect(await answer(fields)).toEqual([
    400,
    { error: "invalid", checks: {} },
    "no-store",
  ]);
  expect(fakes.save).not.toHaveBeenCalled();
});

it("refuses profiles that are no JSON", async () => {
  expect(
    await answer({ intent: "save", profiles: "{", revision: "r" }),
  ).toEqual([400, { error: "invalid" }, "no-store"]);
});

it("returns the checks of a conflicting save", async () => {
  fakes.save.mockRejectedValue(
    new InterpreterSettingsError("conflict", {
      python: { path: "/usr/bin/python3", status: "error", version: null },
    }),
  );
  expect(
    await answer({ intent: "save", profiles: "[]", revision: "r" }),
  ).toEqual([
    400,
    {
      error: "conflict",
      checks: {
        python: { path: "/usr/bin/python3", status: "error", version: null },
      },
    },
    "no-store",
  ]);
});

it("hides an unexpected failure behind a general code", async () => {
  fakes.save.mockRejectedValue(new Error("disk"));
  expect(
    await answer({ intent: "save", profiles: "[]", revision: "r" }),
  ).toEqual([500, { error: "general" }, "no-store"]);
});
