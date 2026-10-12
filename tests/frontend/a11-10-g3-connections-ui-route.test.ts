import { RouterContextProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  services: vi.fn(),
  user: vi.fn(),
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: stubs.services,
}));
vi.mock("@/app/lib/auth.server", () => ({ getAuthenticatedUser: stubs.user }));

import * as connections from "@/app/routes/settings-connections";
import {
  pairingAddress,
  pairingClient,
  pairingFixture,
} from "../helpers/a11-pairing";
import { createUser } from "../helpers/factories";
import { browser, issueCode } from "../helpers/mcp-authorization";

const ONE_DAY = 86_400_000;
const OWNER = browser.userId;

let fixture: Awaited<ReturnType<typeof pairingFixture>>;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-11T22:00:00Z"));
  fixture = await pairingFixture();
  stubs.services.mockResolvedValue({
    pairingService: fixture.pairing,
    personalAgentTokenService: fixture.personal,
    oauthGrantService: fixture.grants,
  });
  stubs.user.mockResolvedValue(createUser());
});
afterEach(async () => {
  await fixture.close();
  vi.useRealTimers();
});

function submit(parameters: Record<string, string>): Request {
  return new Request("https://pages.invalid/settings/connections", {
    method: "POST",
    headers: { Origin: "https://pages.invalid" },
    body: new URLSearchParams(parameters),
  });
}

async function run(
  request: Request,
): Promise<{ status: number; body: unknown }> {
  const context = new RouterContextProvider();
  const response = await connections.action({
    request,
    context,
    params: {},
    url: new URL(request.url),
    pattern: "test",
  });
  return { status: response.status, body: await response.json() };
}

async function pairedTokenId(): Promise<string> {
  const request = await fixture.pairing.begin(pairingClient, pairingAddress);
  const view = await fixture.pairing.view(
    request.userCode,
    browser,
    pairingAddress,
  );
  await fixture.pairing.decide(
    {
      code: request.userCode,
      csrf: view.csrf,
      decision: "approve",
      name: "Workstation",
      validityDays: 30,
      confirmMatch: true,
    },
    browser,
  );
  vi.setSystemTime(Date.now() + 5000);
  await fixture.pairing.exchange(request);
  const [token] = await fixture.personal.list(OWNER);
  if (!token) throw new Error("No paired token");
  return token.id;
}

async function firstGrantId(): Promise<string> {
  const [grant] = (await fixture.grants.get(OWNER)).grants;
  if (!grant) throw new Error("No grant");
  return grant.id;
}

describe("A11.10 connections route: OAuth duration", () => {
  it.each([
    ["missing", {}],
    ["empty", { duration: "" }],
    ["text", { duration: "abc" }],
    ["zero", { duration: "0" }],
    ["negative", { duration: "-1" }],
    ["fraction", { duration: "1.5" }],
    ["above the maximum", { duration: "315576001" }],
    ["not a safe integer", { duration: "99999999999999999999" }],
  ])("rejects a %s duration and stores nothing", async (_label, parameters) => {
    await issueCode(fixture);
    const stored = (await fixture.grants.get(OWNER)).durationSeconds;
    const result = await run(
      submit({ intent: "set-oauth-duration", ...parameters }),
    );
    expect(result).toEqual({
      status: 400,
      body: { error: "invalid_request" },
    });
    expect((await fixture.grants.get(OWNER)).durationSeconds).toBe(stored);
  });

  it("stores an accepted duration and unlimited", async () => {
    await issueCode(fixture);
    expect(
      await run(submit({ intent: "set-oauth-duration", duration: "604800" })),
    ).toEqual({ status: 200, body: { updated: true } });
    expect((await fixture.grants.get(OWNER)).durationSeconds).toBe(604_800);
    expect(
      await run(
        submit({ intent: "set-oauth-duration", duration: "unlimited" }),
      ),
    ).toEqual({ status: 200, body: { updated: true } });
    const summary = await fixture.grants.get(OWNER);
    expect(summary.durationSeconds).toBeNull();
    expect(summary.grants[0]?.status).toBe("active");
  });

  it("asks for confirmation before a reduction ends active grants and applies it once confirmed", async () => {
    await issueCode(fixture);
    await fixture.grants.setDuration(OWNER, null);
    vi.setSystemTime(Date.now() + 2 * ONE_DAY);
    expect(
      await run(submit({ intent: "set-oauth-duration", duration: "3600" })),
    ).toEqual({
      status: 409,
      body: { error: "confirmation_required", count: 1 },
    });
    const untouched = await fixture.grants.get(OWNER);
    expect(untouched.durationSeconds).toBeNull();
    expect(untouched.grants[0]?.status).toBe("active");

    expect(
      await run(
        submit({
          intent: "set-oauth-duration",
          duration: "3600",
          confirmShorten: "on",
        }),
      ),
    ).toEqual({ status: 200, body: { updated: true } });
    const reduced = await fixture.grants.get(OWNER);
    expect(reduced.durationSeconds).toBe(3600);
    expect(reduced.grants[0]?.status).not.toBe("active");
  });

  it("does not count revoked grants when the duration is shortened", async () => {
    await issueCode(fixture);
    const id = await firstGrantId();
    expect(await run(submit({ intent: "revoke-oauth-grant", id }))).toEqual({
      status: 200,
      body: { updated: true },
    });
    vi.setSystemTime(Date.now() + 2 * ONE_DAY);
    expect(
      await run(submit({ intent: "set-oauth-duration", duration: "3600" })),
    ).toEqual({ status: 200, body: { updated: true } });
    expect((await fixture.grants.get(OWNER)).durationSeconds).toBe(3600);
  });
});

describe("A11.10 connections route: grants and credentials", () => {
  it("revokes an own grant and refuses unknown grants and a missing identifier", async () => {
    await issueCode(fixture);
    expect(
      await run(submit({ intent: "revoke-oauth-grant", id: "unknown" })),
    ).toEqual({ status: 403, body: { error: "access_denied" } });
    expect(await run(submit({ intent: "revoke-oauth-grant" }))).toEqual({
      status: 400,
      body: { error: "invalid_request" },
    });
    expect((await fixture.grants.get(OWNER)).grants[0]?.status).toBe("active");

    const id = await firstGrantId();
    expect(await run(submit({ intent: "revoke-oauth-grant", id }))).toEqual({
      status: 200,
      body: { updated: true },
    });
    expect((await fixture.grants.get(OWNER)).grants[0]?.status).toBe("revoked");
  });

  it("requests rotation only for an active paired credential of the owner", async () => {
    const id = await pairedTokenId();
    expect(
      await run(submit({ intent: "request-rotation", id: "other" })),
    ).toEqual({ status: 403, body: { error: "access_denied" } });
    expect(await run(submit({ intent: "request-rotation" }))).toEqual({
      status: 400,
      body: { error: "invalid_request" },
    });
    expect(
      (await fixture.personal.list(OWNER))[0]?.rotationRequestedAt,
    ).toBeNull();

    expect(await run(submit({ intent: "request-rotation", id }))).toEqual({
      status: 200,
      body: { updated: true },
    });
    const [token] = await fixture.personal.list(OWNER);
    expect(token?.rotationRequestedAt).toBe(Date.now());
    expect(token?.status).toBe("active");
  });

  it("refuses a credential change without an identifier and unknown intents", async () => {
    expect(await run(submit({ intent: "revoke-token" }))).toEqual({
      status: 400,
      body: { error: "invalid_request" },
    });
    expect(await run(submit({ intent: "explode", id: "x" }))).toEqual({
      status: 400,
      body: { error: "invalid_request" },
    });
    expect(await run(submit({}))).toEqual({
      status: 400,
      body: { error: "invalid_request" },
    });
  });

  it("answers an unexpected service failure with a fixed unavailable error", async () => {
    stubs.services.mockRejectedValue(new Error("secret internal detail"));
    expect(
      await run(submit({ intent: "set-token-duration", days: "30" })),
    ).toEqual({ status: 503, body: { error: "temporarily_unavailable" } });
  });
});

describe("A11.10 connections route: loader", () => {
  it("returns only the public facts of the owner's grants with the client name", async () => {
    await issueCode(fixture);
    const request = new Request("https://pages.invalid:4567/settings");
    const response = await connections.loader({
      request,
      context: new RouterContextProvider(),
      params: {},
      url: new URL(request.url),
      pattern: "test",
    });
    const stored = (await fixture.grants.get(OWNER)).grants[0];
    expect(await response.json()).toEqual({
      origin: "https://pages.invalid:4567",
      packageVersion: expect.any(String),
      validityDays: 30,
      tokens: [],
      oauth: {
        durationSeconds: 86_400,
        grants: [
          {
            id: stored?.id,
            clientName: "Test client",
            verifiedAt: stored?.verifiedAt,
            expiresAt: stored?.expiresAt,
            status: "active",
          },
        ],
      },
    });
  });
});
