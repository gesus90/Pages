import { beforeEach, expect, it, vi } from "vitest";

import { handleSetupAction } from "@/app/lib/setup/setup-actions.server";
import { activateApplicationServices } from "@/app/lib/services.server";
import { sessionCookie } from "@/app/lib/session.server";
import { checkSetupConnection } from "@/backend/setup/SetupConnection";

import type { SetupCompletionResult } from "@/backend/setup/SetupWizardService";
import type { PagesRuntime } from "@/backend/runtime/PagesRuntime";

const wizard = vi.hoisted(() => ({
  complete: vi.fn(),
  options: [] as unknown[],
}));

vi.mock("@/app/lib/services.server", () => ({
  activateApplicationServices: vi.fn(),
}));
vi.mock("@/app/lib/language.server", () => ({
  resolveSetupLanguage: async () => "en",
}));
vi.mock("@/app/lib/cookie-security.server", () => ({
  resolveCookieSecure: () => true,
}));
vi.mock("@/backend/setup/SetupConnection", () => ({
  checkSetupConnection: vi.fn(),
}));
vi.mock("@/backend/auth/PasswordHasher", () => ({
  PasswordHasher: class {
    public readonly kind = "synthetic-hasher";
  },
}));
vi.mock("@/backend/setup/SetupWizardService", () => ({
  SetupWizardService: class {
    public readonly complete = wizard.complete;

    public constructor(options: unknown) {
      wizard.options.push(options);
    }
  },
}));

const TOKEN = "setup-token";

const runtime = {
  isSetupPending: vi.fn(),
  verifySetupToken: vi.fn(),
  getSuggestedDatabasePath: vi.fn(),
};

const COMPLETE_FIELDS = {
  intent: "complete",
  token: TOKEN,
  companyName: " Synthetic Ltd ",
  username: " admin ",
  password: "long secret",
  email: "",
  databaseUrl: "postgresql://localhost/pages",
};

beforeEach(() => {
  vi.resetAllMocks();
  wizard.options.length = 0;
  runtime.isSetupPending.mockReturnValue(true);
  runtime.verifySetupToken.mockImplementation(
    (token: unknown) => token === TOKEN,
  );
  runtime.getSuggestedDatabasePath.mockReturnValue("/suggested/pages.duckdb");
});

// The runtime is a class with private state; the fake offers what setup calls.
function runtimeOf(fake: object): PagesRuntime {
  return fake as PagesRuntime;
}

function requestOf(fields: Readonly<Record<string, string>>): Request {
  const body = new FormData();

  for (const [name, value] of Object.entries(fields)) {
    body.append(name, value);
  }

  return new Request("https://pages.invalid/setup", {
    body,
    headers: { "User-Agent": "Synthetic Browser" },
    method: "POST",
  });
}

interface SetupOutcome {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Headers;
}

async function submit(
  fields: Readonly<Record<string, string>>,
): Promise<SetupOutcome> {
  const result = await handleSetupAction(runtimeOf(runtime), requestOf(fields));

  if (result instanceof Response) {
    return { body: null, headers: result.headers, status: result.status };
  }

  return {
    body: result.data,
    headers: new Headers(result.init?.headers),
    status: result.init?.status ?? 200,
  };
}

async function complete(result: SetupCompletionResult): Promise<SetupOutcome> {
  wizard.complete.mockResolvedValue(result);

  return submit(COMPLETE_FIELDS);
}

it.each<Readonly<Record<string, string>>>([
  {},
  { intent: "unknown" },
  { intent: "constructor" },
])("answers 400 for the form %j", async (fields) => {
  const work = handleSetupAction(runtimeOf(runtime), requestOf(fields));

  await expect(work).rejects.toMatchObject({ status: 400 });
});

it("refuses every intent once the setup finished", async () => {
  runtime.isSetupPending.mockReturnValue(false);

  expect(await submit({ intent: "verify-token", token: TOKEN })).toMatchObject({
    status: 409,
    body: { intent: "verify-token", error: "alreadyCompleted" },
  });
  expect(runtime.verifySetupToken).not.toHaveBeenCalled();
});

it("grants access with the empty connection suggestion for a valid token", async () => {
  expect(await submit({ intent: "verify-token", token: TOKEN })).toEqual({
    status: 200,
    headers: new Headers(),
    body: {
      intent: "verify-token",
      access: {
        token: TOKEN,
        suggestedDatabaseUrl: "",
      },
    },
  });
});

it.each([
  ["a wrong token", { intent: "verify-token", token: "wrong" }],
  ["no token", { intent: "verify-token" }],
])("answers 401 for %s", async (caseName, fields) => {
  expect(await submit(fields)).toMatchObject({
    status: 401,
    body: { intent: "verify-token", error: "invalidToken" },
  });
});

it("checks the entered connection", async () => {
  vi.mocked(checkSetupConnection).mockResolvedValue("available");

  const outcome = await submit({
    intent: "check-database-connection",
    token: TOKEN,
    databaseUrl: " postgresql://localhost/pages",
  });

  expect(checkSetupConnection).toHaveBeenCalledWith(
    " postgresql://localhost/pages",
  );
  expect(outcome).toMatchObject({
    status: 200,
    body: {
      intent: "check-database-connection",
      location: { input: "", status: "available" },
    },
  });
});

it("checks an empty connection when the form carries none", async () => {
  vi.mocked(checkSetupConnection).mockResolvedValue("empty");

  const outcome = await submit({
    intent: "check-database-connection",
    token: TOKEN,
  });

  expect(checkSetupConnection).toHaveBeenCalledWith("");
  expect(outcome.body).toEqual({
    intent: "check-database-connection",
    location: { input: "", status: "empty" },
  });
});

it("checks no connection without a valid token", async () => {
  const outcome = await submit({
    intent: "check-database-connection",
    token: "wrong",
    databaseUrl: "/data",
  });

  expect(outcome).toMatchObject({
    status: 401,
    body: { intent: "check-database-connection", error: "invalidToken" },
  });
  expect(checkSetupConnection).not.toHaveBeenCalled();
});

it("checks the token before the fields of the completion", async () => {
  const outcome = await submit({ intent: "complete", token: "wrong" });

  expect(outcome).toMatchObject({
    status: 401,
    body: { intent: "complete", error: "invalidToken" },
  });
  expect(wizard.options).toEqual([]);
});

it("reports invalid fields without starting the wizard", async () => {
  const outcome = await submit({ ...COMPLETE_FIELDS, username: " " });

  expect(outcome).toEqual({
    status: 400,
    headers: new Headers(),
    body: {
      intent: "complete",
      error: "invalidInput",
      fieldErrors: { username: "required" },
    },
  });
  expect(wizard.complete).not.toHaveBeenCalled();
});

it("finishes the setup and signs the administrator in", async () => {
  const outcome = await complete({
    status: "completed",
    sessionToken: "session-1",
  });

  expect(wizard.options).toEqual([
    {
      activateServices: activateApplicationServices,
      passwordHasher: { kind: "synthetic-hasher" },
      runtime,
    },
  ]);
  expect(wizard.complete).toHaveBeenCalledExactlyOnceWith(
    {
      companyName: "Synthetic Ltd",
      databaseUrl: "postgresql://localhost/pages",
      email: null,
      language: "en",
      password: "long secret",
      userAgent: "Synthetic Browser",
      username: "admin",
    },
    TOKEN,
  );
  expect(outcome.status).toBe(302);
  expect(outcome.headers.get("Location")).toBe("/dashboard");
  const cookie = outcome.headers.get("Set-Cookie") ?? "";
  expect(cookie).toContain("Secure");
  expect(await sessionCookie.parse(cookie.split(";")[0] ?? "")).toBe(
    "session-1",
  );
});

it("reports a database location that became unusable", async () => {
  expect(
    await complete({ status: "databaseLocation", location: "notWritable" }),
  ).toMatchObject({
    status: 409,
    body: {
      intent: "complete",
      error: "databaseLocation",
      location: { input: "", status: "notWritable" },
    },
  });
});

it.each([
  ["usernameTaken", { username: "usernameTaken" }],
  ["emailTaken", { email: "emailTaken" }],
] as const)("names the field of %s", async (status, fieldErrors) => {
  expect(await complete({ status })).toMatchObject({
    status: 409,
    body: { intent: "complete", error: "invalidInput", fieldErrors },
  });
});

it.each([
  ["alreadyCompleted", 409],
  ["invalidToken", 401],
  ["failed", 500],
] as const)("answers %s with %i", async (status, httpStatus) => {
  expect(await complete({ status })).toMatchObject({
    status: httpStatus,
    body: { intent: "complete", error: status },
  });
});
