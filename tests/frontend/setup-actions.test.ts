import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/services.server", () => ({
  activateApplicationServices: vi.fn(),
}));

vi.mock("@/backend/setup/DatabaseLocation", () => ({
  checkDatabaseLocation: vi.fn(),
}));

vi.mock("@/backend/setup/SetupWizardService", () => ({
  SetupWizardService: vi.fn(),
}));

import { activateApplicationServices } from "@/app/lib/services.server";
import { handleSetupAction } from "@/app/lib/setup/setup-actions.server";
import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { checkDatabaseLocation } from "@/backend/setup/DatabaseLocation";
import { SetupWizardService } from "@/backend/setup/SetupWizardService";

import type { PagesRuntime } from "@/backend/runtime/PagesRuntime";
import type { SetupCompletionResult } from "@/backend/setup/SetupWizardService";

const TOKEN = "valid-token";

const VALID_SETUP = {
  companyName: "Pages GmbH",
  databasePath: "/data/pages.duckdb",
  email: "",
  intent: "complete",
  password: "geheimes-passwort",
  token: TOKEN,
  username: "chef",
};

interface ActionAnswer {
  readonly data: Record<string, unknown>;
  readonly init: { readonly status?: number } | null;
}

function createRuntime(isPending = true): PagesRuntime {
  return {
    getSuggestedDatabasePath: () => "/home/a/.pages/data/pages.duckdb",
    isSetupPending: () => isPending,
    verifySetupToken: (candidate: unknown) => candidate === TOKEN,
  } as unknown as PagesRuntime;
}

function createRequest(fields: Record<string, string>): Request {
  return new Request("http://pages.invalid/setup", {
    body: new URLSearchParams(fields),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Firefox",
    },
    method: "POST",
  });
}

async function act(
  fields: Record<string, string>,
  runtime = createRuntime(),
): Promise<ActionAnswer> {
  return (await handleSetupAction(
    runtime,
    createRequest(fields),
  )) as unknown as ActionAnswer;
}

function stubCompletion(
  result: SetupCompletionResult,
): ReturnType<typeof vi.fn> {
  const complete = vi.fn().mockResolvedValue(result);

  vi.mocked(SetupWizardService).mockImplementation(function (this: unknown) {
    return { complete } as unknown as SetupWizardService;
  });

  return complete;
}

describe("handleSetupAction", () => {
  beforeEach(() => {
    vi.mocked(checkDatabaseLocation).mockResolvedValue({
      databasePath: "/data/pages.duckdb",
      status: "available",
    });
  });

  it("rejects unknown requests", async () => {
    await expect(act({ intent: "drop" })).rejects.toMatchObject({
      status: 400,
    });
  });

  it.each(["verify-token", "check-database-path", "complete"])(
    "refuses %s once the setup finished",
    async (intent) => {
      await expect(
        act({ intent, token: TOKEN }, createRuntime(false)),
      ).resolves.toMatchObject({
        data: { error: "alreadyCompleted", intent },
        init: { status: 409 },
      });
    },
  );

  it("grants access and reveals the suggested path only for the token", async () => {
    await expect(
      act({ intent: "verify-token", token: TOKEN }),
    ).resolves.toMatchObject({
      data: {
        access: {
          suggestedDatabasePath: "/home/a/.pages/data/pages.duckdb",
          token: TOKEN,
        },
      },
    });
    await expect(
      act({ intent: "verify-token", token: "guess" }),
    ).resolves.toMatchObject({
      data: { error: "invalidToken" },
      init: { status: 401 },
    });
    await expect(act({ intent: "verify-token" })).resolves.toMatchObject({
      data: { error: "invalidToken" },
    });
  });

  it("checks a database path for the token holder and names the input", async () => {
    await expect(
      act({
        databasePath: "/data/pages.duckdb",
        intent: "check-database-path",
        token: TOKEN,
      }),
    ).resolves.toMatchObject({
      data: { location: { input: "/data/pages.duckdb", status: "available" } },
    });
    await expect(
      act({ intent: "check-database-path", token: TOKEN }),
    ).resolves.toMatchObject({
      data: { location: { input: "" } },
    });
    expect(checkDatabaseLocation).toHaveBeenCalledWith("");
  });

  it("checks no path without the token", async () => {
    await expect(
      act({ databasePath: "/etc/x.duckdb", intent: "check-database-path" }),
    ).resolves.toMatchObject({ init: { status: 401 } });
    expect(checkDatabaseLocation).not.toHaveBeenCalled();
  });

  it("checks the token before the fields", async () => {
    await expect(
      act({ intent: "complete", token: "guess" }),
    ).resolves.toMatchObject({
      data: { error: "invalidToken" },
    });
    expect(SetupWizardService).not.toHaveBeenCalled();
  });

  it("reports every invalid field of a submitted setup", async () => {
    await expect(
      act({ ...VALID_SETUP, companyName: "", password: "kurz" }),
    ).resolves.toMatchObject({
      data: {
        error: "invalidInput",
        fieldErrors: { companyName: "required", password: "tooShort" },
      },
      init: { status: 400 },
    });
  });

  it("sets a secure session cookie when the wizard runs over HTTPS", async () => {
    stubCompletion({ sessionToken: "session", status: "completed" });

    const response = (await handleSetupAction(
      createRuntime(),
      new Request("https://pages.invalid/setup", {
        body: new URLSearchParams(VALID_SETUP),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
      }),
    )) as Response;

    expect(response.headers.get("Set-Cookie")).toContain("Secure");
  });

  it("finishes the setup and signs the administrator in", async () => {
    const complete = stubCompletion({
      sessionToken: "session",
      status: "completed",
    });
    const response = (await handleSetupAction(
      createRuntime(),
      createRequest(VALID_SETUP),
    )) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/dashboard");
    expect(response.headers.get("Set-Cookie")).toContain("pages_session=");
    expect(response.headers.get("Set-Cookie")).not.toContain("Secure");
    expect(SetupWizardService).toHaveBeenCalledWith({
      activateServices: activateApplicationServices,
      passwordHasher: expect.any(PasswordHasher),
      runtime: expect.any(Object),
    });
    expect(complete).toHaveBeenCalledWith(
      {
        companyName: "Pages GmbH",
        databasePath: "/data/pages.duckdb",
        email: null,
        language: "de",
        password: "geheimes-passwort",
        userAgent: "Firefox",
        username: "chef",
      },
      TOKEN,
    );
  });

  it.each([
    [
      { location: "foreign", status: "databaseLocation" },
      409,
      {
        error: "databaseLocation",
        location: { input: "/data/pages.duckdb", status: "foreign" },
      },
    ],
    [
      { status: "usernameTaken" },
      409,
      { error: "invalidInput", fieldErrors: { username: "usernameTaken" } },
    ],
    [
      { status: "emailTaken" },
      409,
      { error: "invalidInput", fieldErrors: { email: "emailTaken" } },
    ],
    [{ status: "alreadyCompleted" }, 409, { error: "alreadyCompleted" }],
    [{ status: "invalidToken" }, 401, { error: "invalidToken" }],
    [{ status: "failed" }, 500, { error: "failed" }],
  ] as const)("answers a refused setup %j", async (result, status, data) => {
    stubCompletion(result as SetupCompletionResult);

    await expect(act(VALID_SETUP)).resolves.toMatchObject({
      data: { ...data, intent: "complete" },
      init: { status },
    });
  });
});
