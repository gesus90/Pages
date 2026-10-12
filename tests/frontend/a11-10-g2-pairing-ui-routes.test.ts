import { RouterContextProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  services: vi.fn(),
  user: vi.fn(),
  session: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: stubs.services,
}));
vi.mock("@/app/lib/auth.server", () => ({ getAuthenticatedUser: stubs.user }));
vi.mock("@/app/lib/session.server", () => ({
  getSessionToken: stubs.session,
  destroySessionCookie: stubs.destroy,
}));

import * as device from "@/app/routes/api-v1-pairing";
import * as pair from "@/app/routes/pair";
import {
  pairingBrowserIdentity,
  pairingReturnPath,
} from "@/app/lib/pairing-browser.server";
import { clientSocketAddressContext } from "@/app/lib/client-address.server";
import { pairingFixture, pairingClient } from "../helpers/a11-pairing";
import { createUser } from "../helpers/factories";

let fixture: Awaited<ReturnType<typeof pairingFixture>>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-11T23:00:00Z"));
  fixture = await pairingFixture();
  stubs.services.mockResolvedValue({
    pairingService: fixture.pairing,
    authService: { logout: vi.fn() },
  });
  stubs.user.mockResolvedValue(createUser());
  stubs.session.mockResolvedValue("session");
  stubs.destroy.mockResolvedValue("pages_session=; Max-Age=0");
});
afterEach(async () => {
  await fixture.close();
  vi.useRealTimers();
});

function args(request: Request, endpoint?: string) {
  const context = new RouterContextProvider();
  context.set(clientSocketAddressContext, "127.0.0.1");
  return {
    request,
    context,
    params: { endpoint },
    url: new URL(request.url),
    pattern: "test",
  };
}
function json(input: unknown, endpoint?: string): Request {
  return new Request(
    `https://pages.invalid/api/v1/pairing${endpoint ? `/${endpoint}` : ""}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}
function form(path: string, parameters: Record<string, string>): Request {
  return new Request(`https://pages.invalid${path}`, {
    method: "POST",
    headers: { Origin: "https://pages.invalid" },
    body: new URLSearchParams(parameters),
  });
}
async function startPairing(): Promise<{
  userCode: string;
  deviceSecret: string;
}> {
  const response = await device.action(args(json(pairingClient)));
  const request: unknown = await response.json();
  if (
    typeof request !== "object" ||
    request === null ||
    !("userCode" in request) ||
    typeof request.userCode !== "string" ||
    !("deviceSecret" in request) ||
    typeof request.deviceSecret !== "string"
  )
    throw new Error("Invalid fixture response");
  return { userCode: request.userCode, deviceSecret: request.deviceSecret };
}
async function readCsrf(code: string): Promise<string> {
  const response = await pair.loader(
    args(new Request(`https://pages.invalid/pair?code=${code}`)),
  );
  const view: unknown = await response.json();
  if (
    typeof view !== "object" ||
    view === null ||
    !("csrf" in view) ||
    typeof view.csrf !== "string"
  )
    throw new Error("No browser nonce");
  return view.csrf;
}
async function thrownResponse(promise: Promise<unknown>): Promise<Response> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof Response) return error;
    throw error;
  }
  throw new Error("Expected a thrown response");
}

describe("A11.10 device pairing route", () => {
  it("rejects every method other than POST before reading any input", async () => {
    for (const method of ["GET", "PUT", "DELETE"]) {
      const response = await device.action(
        args(
          new Request("https://pages.invalid/api/v1/pairing", {
            method,
          }),
        ),
      );
      expect(response.status).toBe(405);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }
  });

  it("cancels a request for the device holding the secret and rejects a wrong secret", async () => {
    const request = await startPairing();
    const rejected = await device.action(
      args(
        json({ ...request, deviceSecret: "wrong-secret-value" }, "cancel"),
        "cancel",
      ),
    );
    expect(rejected.status).toBeGreaterThanOrEqual(400);
    expect(rejected.headers.get("Cache-Control")).toBe("no-store");
    const cancelled = await device.action(
      args(json(request, "cancel"), "cancel"),
    );
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toEqual({ cancelled: true });
    const exchanged = await device.action(
      args(json(request, "token"), "token"),
    );
    expect(await exchanged.json()).toEqual({ error: "expired_token" });
    const view = await pair.loader(
      args(new Request(`https://pages.invalid/pair?code=${request.userCode}`)),
    );
    expect(await view.json()).toMatchObject({ status: "invalid", code: "" });
  });
});

describe("A11.10 browser pairing route failures", () => {
  it("answers a locked browser with a no-store entry view and Retry-After", async () => {
    const lookup = (): Promise<Response> =>
      pair.loader(
        args(new Request("https://pages.invalid/pair?code=BBBBBBBB")),
      );
    for (let attempt = 0; attempt < 10; attempt++) {
      const view = await lookup();
      expect(view.status).toBe(200);
      expect(await view.json()).toMatchObject({ status: "invalid" });
    }
    const locked = await lookup();
    expect(locked.status).toBe(429);
    expect(locked.headers.get("Retry-After")).toBe("900");
    expect(locked.headers.get("Cache-Control")).toBe("no-store");
    expect(await locked.json()).toEqual({
      status: "entry",
      code: "",
      retryAfter: 900,
      account: { displayName: "", username: "", isAdmin: false },
    });
  });

  it("replaces unexpected loader failures with a fixed non-reflecting response", async () => {
    stubs.services.mockRejectedValue(new Error("secret internal detail"));
    const response = await thrownResponse(
      pair.loader(args(new Request("https://pages.invalid/pair"))),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    const text = await response.text();
    expect(text).toContain("temporarily_unavailable");
    expect(text).not.toContain("secret internal detail");
  });

  it("rejects non-POST actions and unauthenticated decisions without deciding", async () => {
    const put = await pair.action(
      args(new Request("https://pages.invalid/pair", { method: "PUT" })),
    );
    expect(put.status).toBe(405);
    expect(put.headers.get("Referrer-Policy")).toBe("no-referrer");
    stubs.user.mockResolvedValue(null);
    const redirected = await thrownResponse(
      pair.action(args(form("/pair?code=BCDF-GHJK", { code: "BCDFGHJK" }))),
    );
    expect(redirected.status).toBe(302);
    expect(redirected.headers.get("Location")).toBe(
      "/login?returnTo=%2Fpair%3Fcode%3DBCDFGHJK",
    );
  });

  it("rejects malformed codes and turns unexpected action failures into a fixed error", async () => {
    for (const code of ["", "not-a-code", "BCDFGHJ", "AEIOUAEI"]) {
      const response = await pair.action(
        args(form("/pair", { intent: "enter-code", code })),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_code" });
    }
    stubs.services.mockRejectedValue(new Error("database exploded"));
    const failed = await pair.action(
      args(form("/pair", { intent: "enter-code", code: "BCDFGHJK" })),
    );
    expect(failed.status).toBe(503);
    expect(failed.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(await failed.json()).toEqual({ error: "temporarily_unavailable" });
  });

  it("forwards a valid entered code to its view without deciding anything", async () => {
    const request = await startPairing();
    const entered = await pair.action(
      args(
        form("/pair", {
          intent: "enter-code",
          code: request.userCode.toLowerCase(),
        }),
      ),
    );
    expect(entered.status).toBe(302);
    expect(entered.headers.get("Location")).toBe(
      `/pair?code=${request.userCode.replace("-", "")}`,
    );
    const view = await pair.loader(
      args(new Request(`https://pages.invalid/pair?code=${request.userCode}`)),
    );
    expect(await view.json()).toMatchObject({ status: "pending" });
  });

  it("accepts only whole-day validity digits and ignores validity for a denial", async () => {
    const request = await startPairing();
    const code = request.userCode.replace("-", "");
    const csrf = await readCsrf(code);
    for (const validityDays of ["abc", "1.5", "01", "1000", "-1", ""]) {
      const response = await pair.action(
        args(
          form("/pair", {
            code,
            csrf,
            decision: "approve",
            name: "Client",
            confirmMatch: "on",
            validityDays,
          }),
        ),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }
    const denied = await pair.action(
      args(
        form("/pair", {
          code,
          csrf,
          decision: "deny",
          validityDays: "not-a-number",
        }),
      ),
    );
    expect(denied.status).toBe(302);
    const view = await pair.loader(
      args(new Request(`https://pages.invalid/pair?code=${code}`)),
    );
    expect(await view.json()).toMatchObject({ status: "denied" });
  });
});

describe("A11.10 browser identity and return paths", () => {
  it("keeps only a normalized pairing code in the return path", () => {
    expect(
      pairingReturnPath(
        new Request("https://pages.invalid/pair?code=bcdf-ghjk"),
      ),
    ).toBe("/pair?code=BCDFGHJK");
    for (const query of ["", "?code=", "?code=bad", "?code=BCDFGHJK%20evil"])
      expect(
        pairingReturnPath(new Request(`https://pages.invalid/pair${query}`)),
      ).toBe("/pair");
  });

  it("redirects anonymous browsers and sessions without a token to login with the safe path", async () => {
    stubs.user.mockResolvedValue(null);
    const anonymous = await thrownResponse(
      pairingBrowserIdentity(new Request("https://pages.invalid/pair")),
    );
    expect(anonymous.status).toBe(302);
    expect(anonymous.headers.get("Location")).toBe("/login?returnTo=%2Fpair");
    expect(anonymous.headers.get("Cache-Control")).toBe("no-store");
    expect(anonymous.headers.get("Referrer-Policy")).toBe("no-referrer");
    stubs.user.mockResolvedValue(createUser());
    stubs.session.mockResolvedValue(null);
    const withoutSession = await thrownResponse(
      pairingBrowserIdentity(
        new Request("https://pages.invalid/pair?code=bcdf-ghjk"),
      ),
    );
    expect(withoutSession.headers.get("Location")).toBe(
      "/login?returnTo=%2Fpair%3Fcode%3DBCDFGHJK",
    );
  });

  it("requires the password change and otherwise returns the user and session", async () => {
    stubs.user.mockResolvedValue(createUser({ mustChangePassword: true }));
    const blocked = await thrownResponse(
      pairingBrowserIdentity(new Request("https://pages.invalid/pair")),
    );
    expect(blocked.headers.get("Location")).toBe("/change-password");
    expect(blocked.headers.get("Cache-Control")).toBe("no-store");
    stubs.user.mockResolvedValue(createUser());
    await expect(
      pairingBrowserIdentity(new Request("https://pages.invalid/pair")),
    ).resolves.toEqual({ userId: "user-1", session: "session" });
  });
});
