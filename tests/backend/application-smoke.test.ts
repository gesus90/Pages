import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  authenticatedUserContext,
  requireAuthenticatedUser,
} from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { requireFinishedSetup } from "@/app/lib/setup-gate.server";
import { action as loginAction } from "@/app/routes/login";
import { action as logoutAction } from "@/app/routes/logout";
import { action as setupAction } from "@/app/routes/setup";
import { headers as rootHeaders } from "@/app/root";
import {
  initializePagesRuntime,
  SetupPendingError,
} from "@/backend/runtime/PagesRuntime";

import type { ActionFunctionArgs } from "react-router";

/**
 * Exercises the real composition root against a temporary instance: start in
 * setup mode, setup wizard, migrations, login, session middleware,
 * throttling and logout. Only the process-wide singletons are reset.
 */
const SLOW_SCRYPT_TEST_TIMEOUT_MS = 60_000;

// The session cookie reads its configuration when its module loads.
vi.hoisted(() => {
  process.env.PAGES_COOKIE_SECURE = "true";
});

let databaseDirectory = "";

function resetServiceGlobals(): void {
  delete globalThis.pagesRuntime;
  delete globalThis.pagesServices;
  delete globalThis.pagesShutdownHandlerRegistered;
  delete globalThis.pagesSyncSchedulerStarted;
}

function createLoginRequest(username: string, password: string): Request {
  return new Request("http://pages.invalid/login", {
    body: new URLSearchParams({ password, username }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0",
    },
    method: "POST",
  });
}

async function login(username: string, password: string): Promise<unknown> {
  return loginAction({
    params: {},
    request: createLoginRequest(username, password),
  } as unknown as ActionFunctionArgs);
}

async function captureFailure(action: () => unknown): Promise<unknown> {
  try {
    await action();
  } catch (error: unknown) {
    return error;
  }

  return null;
}

function readSessionCookie(response: Response): string {
  const header = response.headers.get("Set-Cookie") ?? "";

  return header.split(";")[0] ?? "";
}

describe("application smoke test", () => {
  beforeAll(async () => {
    databaseDirectory = await mkdtemp(path.join(tmpdir(), "pages-smoke-"));
    vi.spyOn(console, "info").mockImplementation(() => {});
    resetServiceGlobals();
    await initializePagesRuntime(path.join(databaseDirectory, "config.toml"));
  });

  afterAll(async () => {
    resetServiceGlobals();
    delete process.env.PAGES_COOKIE_SECURE;
    vi.restoreAllMocks();
    await rm(databaseDirectory, { force: true, recursive: true });
  });

  it("starts in setup mode without any database", async () => {
    await expect(getApplicationServices()).rejects.toThrow(SetupPendingError);
    expect(await readdir(path.join(databaseDirectory, "data"))).toEqual([]);

    const failure = await captureFailure(() =>
      requireFinishedSetup(
        {
          context: new RouterContextProvider(),
          params: {},
          request: new Request("http://pages.invalid/dashboard"),
        } as never,
        vi.fn(),
      ),
    );

    expect((failure as Response).headers.get("Location")).toBe("/setup");
  });

  it(
    "finishes the setup and signs the administrator in",
    async () => {
      const runtime = await initializePagesRuntime("/unused.toml");
      const response = (await setupAction({
        params: {},
        request: new Request("http://pages.invalid/setup", {
          body: new URLSearchParams({
            companyName: "Smoke GmbH",
            databasePath: runtime.getSuggestedDatabasePath(),
            email: "",
            intent: "complete",
            password: "admin-password",
            token: runtime.getSetupToken() ?? "",
            username: "admin",
          }),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          method: "POST",
        }),
      } as unknown as ActionFunctionArgs)) as Response;

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/dashboard");
      expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
      expect(runtime.isSetupPending()).toBe(false);

      const services = await getApplicationServices();
      const credentials =
        await services.userService.findCredentialsByUsername("admin");

      expect(credentials?.user.role).toBe("admin");
    },
    SLOW_SCRYPT_TEST_TIMEOUT_MS,
  );

  it(
    "signs in, authenticates later requests and signs out",
    async () => {
      const response = (await login("admin", "admin-password")) as Response;

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/dashboard");

      const setCookie = response.headers.get("Set-Cookie") ?? "";

      expect(setCookie).toContain("pages_session=");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
      expect(setCookie).toContain("Secure");

      const sessionRequest = new Request("http://pages.invalid/dashboard", {
        headers: { Cookie: readSessionCookie(response) },
      });
      const context = new RouterContextProvider();
      const next = vi.fn().mockResolvedValue("rendered");

      await expect(
        requireAuthenticatedUser(
          { context, params: {}, request: sessionRequest } as never,
          next,
        ),
      ).resolves.toBe("rendered");
      expect(context.get(authenticatedUserContext)?.username).toBe("admin");

      const logout = (await logoutAction({
        params: {},
        request: new Request("http://pages.invalid/logout", {
          headers: { Cookie: readSessionCookie(response) },
          method: "POST",
        }),
      } as unknown as ActionFunctionArgs)) as Response;

      expect(logout.status).toBe(302);
      expect(logout.headers.get("Set-Cookie")).toContain("Max-Age=0");

      expect(
        await captureFailure(() =>
          requireAuthenticatedUser(
            {
              context: new RouterContextProvider(),
              params: {},
              request: sessionRequest,
            } as never,
            next,
          ),
        ),
      ).toBeInstanceOf(Response);
    },
    SLOW_SCRYPT_TEST_TIMEOUT_MS,
  );

  it("redirects anonymous requests for protected routes to the login", async () => {
    const failure = await captureFailure(() =>
      requireAuthenticatedUser(
        {
          context: new RouterContextProvider(),
          params: {},
          request: new Request("http://pages.invalid/dashboard"),
        } as never,
        vi.fn(),
      ),
    );

    expect(failure).toBeInstanceOf(Response);
    expect((failure as Response).status).toBe(302);
    expect((failure as Response).headers.get("Location")).toBe("/login");
  });

  it(
    "rejects wrong passwords and throttles repeated failures",
    async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const result = (await login("ghost", `wrong-${attempt}`)) as {
          data: { error: string };
          init?: { status?: number };
        };

        expect(result.data.error).toBe("invalidCredentials");
        expect(result.init?.status).toBe(401);
      }

      const throttled = (await login("ghost", "wrong-again")) as {
        data: { error: string };
        init?: { headers?: Record<string, string>; status?: number };
      };

      expect(throttled.init?.status).toBe(429);
      expect(throttled.data.error).toBe("tooManyAttempts");
      expect(Number(throttled.init?.headers?.["Retry-After"])).toBeGreaterThan(
        0,
      );
    },
    SLOW_SCRYPT_TEST_TIMEOUT_MS,
  );

  it("sends the security headers with documents", () => {
    const headers = rootHeaders({
      actionHeaders: new Headers(),
      errorHeaders: undefined,
      loaderHeaders: new Headers(),
      parentHeaders: new Headers(),
    }) as Record<string, string>;

    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
  });
});
