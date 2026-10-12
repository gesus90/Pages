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
import * as connections from "@/app/routes/settings-connections";
import * as removed from "@/app/routes/api-v1-personal-tokens";
import { clientSocketAddressContext } from "@/app/lib/client-address.server";
import { oauthLoginDestination } from "@/app/lib/oauth-login.server";
import { pairingFixture, pairingClient } from "../helpers/a11-pairing";
import { createUser } from "../helpers/factories";

let fixture: Awaited<ReturnType<typeof pairingFixture>>;
let logout: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-11T23:00:00Z"));
  fixture = await pairingFixture();
  logout = vi.fn();
  stubs.services.mockResolvedValue({
    pairingService: fixture.pairing,
    personalAgentTokenService: fixture.personal,
    oauthGrantService: fixture.grants,
    authService: { logout },
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
function form(
  path: string,
  parameters: Record<string, string>,
  origin = "https://pages.invalid",
): Request {
  return new Request(`https://pages.invalid${path}`, {
    method: "POST",
    headers: { Origin: origin },
    body: new URLSearchParams(parameters),
  });
}
async function startPairing() {
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

describe("A11.2 browser and device routes with temporary data", () => {
  it("completes the real route sequence without putting device secrets or tokens in browser responses", async () => {
    const request = await startPairing();
    const path = `/pair?code=${request.userCode}`;
    const viewResponse = await pair.loader(
      args(new Request(`https://pages.invalid${path}`)),
    );
    expect(viewResponse.headers.get("Cache-Control")).toBe("no-store");
    expect(viewResponse.headers.get("Referrer-Policy")).toBe("no-referrer");
    const viewText = await viewResponse.text();
    expect(viewText).not.toContain(request.deviceSecret);
    const view: unknown = JSON.parse(viewText);
    if (
      typeof view !== "object" ||
      view === null ||
      !("csrf" in view) ||
      typeof view.csrf !== "string"
    )
      throw new Error("No browser nonce");
    const approved = await pair.action(
      args(
        form(path, {
          code: request.userCode,
          csrf: view.csrf,
          decision: "approve",
          name: "Route Client",
          validityDays: "30",
          confirmMatch: "on",
        }),
      ),
    );
    expect(approved.status).toBe(302);
    expect(approved.headers.get("Location")).toBe(
      `/pair?code=${request.userCode.replace("-", "")}`,
    );
    expect(await fixture.personal.list("user-1")).toEqual([]);
    vi.setSystemTime(Date.now() + 5000);
    const exchanged = await device.action(
      args(json(request, "token"), "token"),
    );
    expect(exchanged.status).toBe(200);
    const issued: unknown = await exchanged.json();
    if (
      typeof issued !== "object" ||
      issued === null ||
      !("token" in issued) ||
      typeof issued.token !== "string" ||
      !("tokenId" in issued) ||
      typeof issued.tokenId !== "string"
    )
      throw new Error("No issued token");
    const browserResponses = [
      approved,
      await pair.loader(args(new Request(`https://pages.invalid${path}`))),
      await connections.loader(
        args(new Request("https://pages.invalid/settings/connections")),
      ),
    ];
    for (const response of browserResponses) {
      const text = await response.text();
      expect(text).not.toContain(issued.token);
      expect(text).not.toContain(request.deviceSecret);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    const second = await device.action(args(json(request, "token"), "token"));
    expect(second.status).toBe(400);
    expect(await second.json()).toEqual({ error: "invalid_grant" });
    await fixture.personal.verify(issued.token);
    const revoked = await connections.action(
      args(
        form("/settings/connections", {
          intent: "revoke-token",
          id: issued.tokenId,
        }),
      ),
    );
    expect(revoked.status).toBe(200);
    await expect(fixture.personal.verify(issued.token)).rejects.toMatchObject({
      code: "invalid_token",
    });
  });

  it("preserves only pairing and OAuth login return paths and supports switching accounts", async () => {
    stubs.user.mockResolvedValue(null);
    await expect(
      pair.loader(
        args(new Request("https://pages.invalid/pair?code=bcdf-ghjk")),
      ),
    ).rejects.toMatchObject({ status: 302, headers: expect.any(Headers) });
    try {
      await pair.loader(
        args(new Request("https://pages.invalid/pair?code=bcdf-ghjk")),
      );
    } catch (error: unknown) {
      expect(error instanceof Response && error.headers.get("Location")).toBe(
        "/login?returnTo=%2Fpair%3Fcode%3DBCDFGHJK",
      );
    }
    for (const destination of ["/pair", "/pair?code=BCDFGHJK"])
      expect(
        oauthLoginDestination(
          new Request(
            `https://pages.invalid/login?returnTo=${encodeURIComponent(destination)}`,
          ),
        ),
      ).toBe(destination);
    for (const destination of [
      "/pair?code=bad",
      "/pair?code=BCDFGHJK&next=evil",
      "//evil.invalid/pair",
      "/pair/other",
    ])
      expect(
        oauthLoginDestination(
          new Request(
            `https://pages.invalid/login?returnTo=${encodeURIComponent(destination)}`,
          ),
        ),
      ).toBe("/dashboard");
    stubs.user.mockResolvedValue(createUser({ mustChangePassword: true }));
    await expect(
      pair.loader(args(new Request("https://pages.invalid/pair"))),
    ).rejects.toMatchObject({ status: 302 });
    stubs.user.mockResolvedValue(createUser());
    const switched = await pair.action(
      args(form("/pair?code=BCDF-GHJK", { intent: "switch-account" })),
    );
    expect(logout).toHaveBeenCalledWith("session");
    expect(switched.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(switched.headers.get("Location")).toBe(
      "/login?returnTo=%2Fpair%3Fcode%3DBCDFGHJK",
    );
  });

  it("rejects cross-origin decisions, browser credential issuance, unknown device operations and wrong methods", async () => {
    expect(
      (
        await pair.action(
          args(form("/pair", { code: "BCDFGHJK" }, "https://evil.invalid")),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await connections.action(
          args(
            form(
              "/settings/connections",
              { intent: "set-token-duration", days: "30" },
              "https://evil.invalid",
            ),
          ),
        )
      ).status,
    ).toBe(403);
    expect((await device.action(args(json({}, "other"), "other"))).status).toBe(
      404,
    );
    expect(device.loader().status).toBe(405);
    expect(removed.action().status).toBe(404);
    expect(await removed.action().text()).not.toContain("token");
    expect(
      (
        await connections.action(
          args(
            new Request("https://pages.invalid/settings/connections", {
              method: "PUT",
            }),
          ),
        )
      ).status,
    ).toBe(405);
    expect(pair.headers().get("Referrer-Policy")).toBe("no-referrer");
    expect(connections.headers().get("Cache-Control")).toBe("no-store");
  });

  it("changes only personal validity, rejects invalid ranges and ownership violations, and emits Retry-After", async () => {
    for (const days of ["0", "1", "365"])
      expect(
        (
          await connections.action(
            args(
              form("/settings/connections", {
                intent: "set-token-duration",
                days,
              }),
            ),
          )
        ).status,
      ).toBe(200);
    for (const days of ["", "-1", "366", "1.5"])
      expect(
        (
          await connections.action(
            args(
              form("/settings/connections", {
                intent: "set-token-duration",
                days,
              }),
            ),
          )
        ).status,
      ).toBe(400);
    expect(
      (
        await connections.action(
          args(
            form("/settings/connections", {
              intent: "revoke-token",
              id: "not-owner",
            }),
          ),
        )
      ).status,
    ).toBe(403);
    for (let index = 0; index < 5; index++)
      expect((await device.action(args(json(pairingClient)))).status).toBe(201);
    const limited = await device.action(args(json(pairingClient)));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    stubs.user.mockResolvedValue(null);
    await expect(
      connections.loader(
        args(new Request("https://pages.invalid/settings/connections")),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
});
