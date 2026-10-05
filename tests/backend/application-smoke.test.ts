import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  authenticatedUserContext,
  requireAuthenticatedUser,
} from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { action as loginAction } from "@/app/routes/login";
import { action as logoutAction } from "@/app/routes/logout";
import { headers as rootHeaders } from "@/app/root";

import type { ActionFunctionArgs } from "react-router";

/**
 * Exercises the real composition root against a temporary database: startup,
 * migrations, default administrator, login, session middleware, throttling
 * and logout. Only the process-wide singletons are reset between runs.
 */
const SLOW_SCRYPT_TEST_TIMEOUT_MS = 60_000;

// The session cookie reads its configuration when its module loads.
vi.hoisted(() => {
  process.env.PAGES_COOKIE_SECURE = "true";
});

let databaseDirectory = "";

function resetServiceGlobals(): void {
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
    // Not `vi.stubEnv`: the configuration discards stubs before each test.
    process.env.PAGES_DATABASE_PATH = path.join(
      databaseDirectory,
      "pages.duckdb",
    );
    vi.spyOn(console, "info").mockImplementation(() => {});
    resetServiceGlobals();
  });

  afterAll(async () => {
    resetServiceGlobals();
    delete process.env.PAGES_DATABASE_PATH;
    delete process.env.PAGES_COOKIE_SECURE;
    vi.restoreAllMocks();
    await rm(databaseDirectory, { force: true, recursive: true });
  });

  it("starts on an empty database with the default administrator", async () => {
    const services = await getApplicationServices();
    const credentials =
      await services.userService.findCredentialsByUsername("admin");

    expect(existsSync(path.join(databaseDirectory, "pages.duckdb"))).toBe(true);
    expect(credentials?.user.role).toBe("admin");
    expect(credentials?.user.isActive).toBe(true);
  });

  it(
    "signs in, authenticates later requests and signs out",
    async () => {
      const response = (await login("admin", "admin")) as Response;

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
