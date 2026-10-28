// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { RouterContextProvider } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { clientSocketAddressContext } from "@/app/lib/client-address.server";
import { requireMcpHttp } from "@/app/lib/mcp-http.server";
import { getSessionToken } from "@/app/lib/session.server";
import McpLogin, {
  action,
  ErrorBoundary,
  headers,
  loader,
} from "@/app/routes/mcp-login";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import {
  ACTOR,
  i18n,
  pagesRequest,
  renderRoute,
  responseOf,
  routeArguments,
} from "./route-fixture";

// The Frontend setup registers this cleanup; the Node scope repeats it here.
afterEach(cleanup);

const services = vi.hoisted(() => ({
  userService: { getById: vi.fn() },
  oauthService: { view: vi.fn(), decide: vi.fn() },
}));

vi.mock("@/app/lib/auth.server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAuthenticatedUser: vi.fn(),
}));
vi.mock("@/app/lib/session.server", () => ({ getSessionToken: vi.fn() }));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => services,
}));
vi.mock("@/app/lib/mcp-http.server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requireMcpHttp: vi.fn(),
}));
vi.mock("@/backend/runtime/PagesRuntime", () => ({ getPagesRuntime: vi.fn() }));

const REQUEST_ID = "a".repeat(43);
const CONSENT = `/mcp-login?request=${REQUEST_ID}`;
const ORIGIN = "http://pages.invalid";

/** Loader or action arguments with the socket address of the browser. */
function consentArguments(request: Request): ReturnType<typeof routeArguments> {
  const context = new RouterContextProvider();
  context.set(clientSocketAddressContext, "127.0.0.1");
  return routeArguments(request, { context });
}

/**
 * The consent decision as the browser posts it.
 *
 * @param path - Consent address with the request id.
 * @param origin - Origin header of the browser.
 */
function decisionPost(path = CONSENT, origin = ORIGIN): Request {
  return pagesRequest(path, {
    method: "POST",
    headers: { Origin: origin },
    body: new URLSearchParams({ csrf: "csrf-1", decision: "approve" }),
  });
}

beforeEach(() => {
  vi.mocked(requireMcpHttp).mockReset();
  vi.mocked(requireMcpHttp).mockResolvedValue({
    origin: ORIGIN,
    resource: `${ORIGIN}/mcp`,
  });
  vi.mocked(getAuthenticatedUser).mockResolvedValue(ACTOR);
  vi.mocked(getSessionToken).mockResolvedValue("session-1");
  services.userService.getById.mockResolvedValue(ACTOR);
  services.oauthService.view.mockResolvedValue({
    csrf: "csrf-1",
    clientName: "Claude",
    resource: `${ORIGIN}/mcp`,
  });
  services.oauthService.decide.mockReset();
});

it("keeps consent pages out of caches and referrers", () => {
  expect(headers().get("Referrer-Policy")).toBe("no-referrer");
  expect(headers().get("Cache-Control")).toBe("no-store");
});

it("sends a visitor without a request to the pairing with a valid code", async () => {
  const withCode = await responseOf(
    loader(consentArguments(pagesRequest("/mcp-login?code=bcdf-ghjk"))),
  );
  const withoutCode = await responseOf(
    loader(consentArguments(pagesRequest("/mcp-login?code=nope"))),
  );

  expect(withCode.headers.get("Location")).toBe("/pair?code=BCDFGHJK");
  expect(withoutCode.headers.get("Location")).toBe("/pair");
  expect(requireMcpHttp).toHaveBeenCalledWith(expect.any(Request), "127.0.0.1");
});

it("refuses a malformed request id", async () => {
  const response = await responseOf(
    loader(consentArguments(pagesRequest("/mcp-login?request=short"))),
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({ error: "invalid_request" });
});

it("answers a refused MCP address with a sanitized failure", async () => {
  vi.mocked(requireMcpHttp).mockRejectedValue(
    new McpAuthorizationError("not_found", 404),
  );

  const response = await responseOf(
    loader(consentArguments(pagesRequest(CONSENT))),
  );

  expect(response.status).toBe(404);
});

it("passes a response of the address check through", async () => {
  const refusal = new Response(null, { status: 418 });
  vi.mocked(requireMcpHttp).mockRejectedValue(refusal);

  await expect(loader(consentArguments(pagesRequest(CONSENT)))).rejects.toBe(
    refusal,
  );
});

it("sends a signed-out visitor to the login with the consent as way back", async () => {
  vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

  const response = await responseOf(
    loader(consentArguments(pagesRequest(CONSENT))),
  );

  expect(response.headers.get("Location")).toBe(
    `/login?returnTo=${encodeURIComponent(CONSENT)}`,
  );
});

it("requires a browser session as well as a user", async () => {
  vi.mocked(getSessionToken).mockResolvedValue(null);

  const response = await responseOf(
    loader(consentArguments(pagesRequest(CONSENT))),
  );

  expect(response.headers.get("Location")).toMatch(/^\/login\?/u);
});

it("requires a pending password change first", async () => {
  vi.mocked(getAuthenticatedUser).mockResolvedValue({
    ...ACTOR,
    mustChangePassword: true,
  });

  const response = await responseOf(
    loader(consentArguments(pagesRequest(CONSENT))),
  );

  expect(response.headers.get("Location")).toBe(
    `/change-password?returnTo=${encodeURIComponent(CONSENT)}`,
  );
});

it("describes the consent with client, instance and account", async () => {
  const response = await loader(consentArguments(pagesRequest(CONSENT)));

  await expect(response.json()).resolves.toEqual({
    id: REQUEST_ID,
    csrf: "csrf-1",
    clientName: "Claude",
    resource: `${ORIGIN}/mcp`,
    account: "Ada Lovelace (ada)",
  });
  expect(services.oauthService.view).toHaveBeenCalledWith(REQUEST_ID, {
    userId: "user-1",
    session: "session-1",
  });
});

it("describes an account the directory no longer knows without a name", async () => {
  services.userService.getById.mockResolvedValue(null);

  const response = await loader(consentArguments(pagesRequest(CONSENT)));

  await expect(response.json()).resolves.toMatchObject({ account: " ()" });
});

it("refuses a cross-origin decision", async () => {
  const response = await responseOf(
    action(consentArguments(decisionPost(CONSENT, "https://evil.invalid"))),
  );

  expect(response.status).toBe(403);
  expect(services.oauthService.decide).not.toHaveBeenCalled();
});

it("refuses other methods", async () => {
  const response = await responseOf(
    action(
      consentArguments(
        pagesRequest(CONSENT, { method: "PUT", headers: { Origin: ORIGIN } }),
      ),
    ),
  );

  expect(response.status).toBe(405);
});

it("refuses a decision without a request id", async () => {
  const response = await responseOf(
    action(consentArguments(decisionPost("/mcp-login"))),
  );

  expect(response.status).toBe(400);
  expect(services.oauthService.decide).not.toHaveBeenCalled();
});

it("sends a signed-out decision to the login", async () => {
  vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

  const response = await responseOf(action(consentArguments(decisionPost())));

  expect(response.headers.get("Location")).toMatch(/^\/login\?/u);
});

it("sends the decision and redirects to the bound client", async () => {
  services.oauthService.decide.mockResolvedValue(
    "http://127.0.0.1:7777/callback?code=one-use",
  );

  const response = await responseOf(action(consentArguments(decisionPost())));

  expect(response.headers.get("Location")).toBe(
    "http://127.0.0.1:7777/callback?code=one-use",
  );
  expect(services.oauthService.decide).toHaveBeenCalledWith(
    { id: REQUEST_ID, csrf: "csrf-1", decision: "approve" },
    { userId: "user-1", session: "session-1" },
  );
});

it("shows client, instance and account with both decisions", async () => {
  let finish: () => void = () => undefined;
  renderRoute(McpLogin, {
    loaderData: {
      id: REQUEST_ID,
      csrf: "csrf-1",
      clientName: "Claude",
      resource: `${ORIGIN}/mcp`,
      account: "Ada Lovelace (ada)",
    },
    action: async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return null;
    },
  });

  expect(screen.getByText("Claude")).toBeTruthy();
  expect(screen.getByText("Ada Lovelace (ada)")).toBeTruthy();
  const approve = screen.getByRole("button", {
    name: i18n.t("mcpHttp.approve"),
  });
  expect(approve.hasAttribute("disabled")).toBe(false);

  fireEvent.click(approve);
  await vi.waitFor(() => {
    expect(approve.hasAttribute("disabled")).toBe(true);
  });
  finish();
  await vi.waitFor(() => {
    expect(approve.hasAttribute("disabled")).toBe(false);
  });
});

it("keeps an invalid consent inside the authentication card", () => {
  renderRoute(McpLogin, { ErrorBoundary, error: new Error("expired") });

  expect(screen.getByText(i18n.t("mcpHttp.error"))).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: i18n.t("mcpHttp.pair") })
      .getAttribute("href"),
  ).toBe("/mcp-login");
});
