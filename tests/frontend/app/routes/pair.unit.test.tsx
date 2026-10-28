import { screen } from "@testing-library/react";
import { RouterContextProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { clientSocketAddressContext } from "@/app/lib/client-address.server";
import {
  destroySessionCookie,
  getSessionToken,
} from "@/app/lib/session.server";
import PairRoute, {
  action,
  ErrorBoundary,
  headers,
  loader,
} from "@/app/routes/pair";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { logCaughtError } from "@/backend/logging/Logger";
import { PairingRateError } from "@/backend/service/mcp/PairingThrottle";

import {
  ACTOR,
  formPost,
  i18n,
  pagesRequest,
  renderRoute,
  responseOf,
  routeArguments,
} from "./route-fixture";

import type { McpPairingView } from "@/definition/McpPairing";

const services = vi.hoisted(() => ({
  authService: { logout: vi.fn() },
  pairingService: { view: vi.fn(), decide: vi.fn() },
}));
const runtime = vi.hoisted((): { publicUrl: string | undefined } => ({
  publicUrl: undefined,
}));

vi.mock("@/app/lib/auth.server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAuthenticatedUser: vi.fn(),
}));
vi.mock("@/app/lib/session.server", () => ({
  destroySessionCookie: vi.fn(),
  getSessionToken: vi.fn(),
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => services,
}));
vi.mock("@/backend/runtime/PagesRuntime", () => ({
  getPagesRuntime: async (): Promise<unknown> => ({
    getConfig: (): unknown => ({
      mcpHttp:
        runtime.publicUrl === undefined
          ? undefined
          : { publicUrl: runtime.publicUrl },
    }),
  }),
}));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));
vi.mock("@/app/components/pairing/pairing-form", () => ({
  PairingForm: (props: {
    readonly view: McpPairingView;
  }): React.ReactElement => <p>{`form ${props.view.code}`}</p>,
}));
vi.mock("@/app/components/pairing/pairing-state", () => ({
  PairingState: (props: {
    readonly view: McpPairingView;
  }): React.ReactElement => <p>{`state ${props.view.status}`}</p>,
}));
vi.mock("@/app/components/pairing/pairing-entry", () => ({
  PairingEntry: (props: {
    readonly retryAfter?: number;
  }): React.ReactElement => <p>{`entry ${props.retryAfter ?? "now"}`}</p>,
}));

const CODE = "BCDFGHJK";
const ACCOUNT = { displayName: "Ada", username: "ada", isAdmin: false };

/** Loader arguments with the socket address of the browser. */
function pairArguments(request: Request): ReturnType<typeof routeArguments> {
  const context = new RouterContextProvider();
  context.set(clientSocketAddressContext, "192.0.2.1");
  return routeArguments(request, { context });
}

/**
 * A same-origin pairing form post.
 *
 * @param fields - Submitted fields.
 */
function pairPost(fields: Record<string, string>): Request {
  return formPost(`/pair?code=${CODE}`, fields);
}

beforeEach(() => {
  runtime.publicUrl = undefined;
  vi.mocked(getAuthenticatedUser).mockResolvedValue(ACTOR);
  vi.mocked(getSessionToken).mockResolvedValue("session-1");
  vi.mocked(destroySessionCookie).mockResolvedValue("session=; Max-Age=0");
  services.pairingService.view.mockReset();
  services.pairingService.decide.mockReset();
  services.authService.logout.mockReset();
});

it("keeps every pairing state out of caches and referrers", () => {
  expect(headers().get("Cache-Control")).toBe("no-store");
  expect(headers().get("Referrer-Policy")).toBe("no-referrer");
});

it("loads the view with the address of this instance", async () => {
  services.pairingService.view.mockResolvedValue({
    status: "pending",
    code: CODE,
    account: ACCOUNT,
  });

  const response = await loader(
    pairArguments(
      pagesRequest(`/pair?code=${CODE}`, {
        headers: { "X-Forwarded-For": "198.51.100.4" },
      }),
    ),
  );

  await expect(response.json()).resolves.toEqual({
    status: "pending",
    code: CODE,
    account: ACCOUNT,
    instanceOrigin: "http://pages.invalid",
  });
  const forwarded: unknown = expect.anything();
  expect(services.pairingService.view).toHaveBeenCalledWith(
    CODE,
    { userId: "user-1", session: "session-1" },
    { socket: "192.0.2.1", forwarded },
  );
});

it("prefers the configured public MCP address", async () => {
  runtime.publicUrl = "https://pages.example";
  services.pairingService.view.mockResolvedValue({
    status: "entry",
    code: "",
    account: ACCOUNT,
  });

  const response = await loader(pairArguments(pagesRequest("/pair")));

  await expect(response.json()).resolves.toMatchObject({
    instanceOrigin: "https://pages.example",
  });
});

it("sends a signed-out visitor to the login", async () => {
  vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

  const response = await responseOf(
    loader(pairArguments(pagesRequest("/pair"))),
  );

  expect(response.headers.get("Location")).toBe(
    `/login?returnTo=${encodeURIComponent("/pair")}`,
  );
});

it("asks a throttled visitor to wait before entering a code", async () => {
  services.pairingService.view.mockRejectedValue(new PairingRateError(30));

  const response = await loader(pairArguments(pagesRequest("/pair")));

  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe("30");
  await expect(response.json()).resolves.toMatchObject({
    status: "entry",
    retryAfter: 30,
  });
});

it("turns other failures into a sanitized refusal", async () => {
  const failure = new Error("database down");
  services.pairingService.view.mockRejectedValue(failure);

  const response = await responseOf(
    loader(pairArguments(pagesRequest("/pair"))),
  );

  expect(response.status).toBe(503);
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(logCaughtError).toHaveBeenCalledWith("pair", failure);
});

it("refuses other methods than post", async () => {
  const response = await action(routeArguments(pagesRequest("/pair")));

  expect(response.status).toBe(405);
});

it("refuses a cross-origin post", async () => {
  const response = await action(
    routeArguments(
      pagesRequest("/pair", {
        method: "POST",
        headers: { Origin: "https://evil.invalid" },
      }),
    ),
  );

  expect(response.status).toBe(403);
});

it("sends a signed-out post to the login", async () => {
  vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

  const response = await responseOf(
    action(routeArguments(pairPost({ intent: "enter-code", code: CODE }))),
  );

  expect(response.headers.get("Location")).toBe(
    `/login?returnTo=${encodeURIComponent(`/pair?code=${CODE}`)}`,
  );
});

it("signs out to switch the account and keeps the pairing", async () => {
  const response = await action(
    routeArguments(pairPost({ intent: "switch-account" })),
  );

  expect(services.authService.logout).toHaveBeenCalledWith("session-1");
  expect(response.headers.get("Location")).toBe(
    `/login?returnTo=${encodeURIComponent(`/pair?code=${CODE}`)}`,
  );
  expect(response.headers.get("Set-Cookie")).toBe("session=; Max-Age=0");
});

it("refuses a post without a valid code", async () => {
  const response = await action(
    routeArguments(pairPost({ intent: "enter-code", code: "nope" })),
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({ error: "invalid_code" });
});

it("opens an entered code without deciding", async () => {
  const response = await action(
    routeArguments(pairPost({ intent: "enter-code", code: "bcdf-ghjk" })),
  );

  expect(response.headers.get("Location")).toBe(`/pair?code=${CODE}`);
  expect(services.pairingService.decide).not.toHaveBeenCalled();
});

it("applies a decision with a valid validity", async () => {
  const response = await action(
    routeArguments(
      pairPost({
        code: CODE,
        csrf: "csrf-1",
        decision: "approve",
        name: "Laptop",
        validityDays: "30",
        confirmMatch: "on",
      }),
    ),
  );

  expect(response.headers.get("Location")).toBe(`/pair?code=${CODE}`);
  expect(services.pairingService.decide).toHaveBeenCalledWith(
    {
      code: CODE,
      csrf: "csrf-1",
      decision: "approve",
      name: "Laptop",
      validityDays: 30,
      confirmMatch: true,
    },
    { userId: "user-1", session: "session-1" },
  );
});

it("drops a malformed validity and an unconfirmed match", async () => {
  await action(
    routeArguments(
      pairPost({ code: CODE, decision: "deny", validityDays: "1000" }),
    ),
  );

  expect(services.pairingService.decide.mock.calls[0]?.[0]).toMatchObject({
    validityDays: undefined,
    confirmMatch: false,
  });
});

it("answers a refused decision with its code", async () => {
  services.pairingService.decide.mockRejectedValue(
    new McpAuthorizationError("expired_code", 410),
  );

  const response = await action(
    routeArguments(pairPost({ code: CODE, decision: "approve" })),
  );

  expect(response.status).toBe(410);
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
});

it("shows the approval form for a pending request", () => {
  renderRoute(PairRoute, {
    loaderData: { status: "pending", code: CODE, account: ACCOUNT },
  });

  expect(screen.getByRole("heading").textContent).toBe(
    i18n.t("mcpPairing.title"),
  );
  expect(screen.getByText(`form ${CODE}`)).toBeTruthy();
  expect(screen.queryByText(/^entry/u)).toBeNull();
});

it("offers the code entry beside the entry and invalid states", () => {
  renderRoute(PairRoute, {
    loaderData: {
      status: "invalid",
      code: "",
      account: ACCOUNT,
      retryAfter: 9,
    },
  });

  expect(screen.getByText("state invalid")).toBeTruthy();
  expect(screen.getByText("entry 9")).toBeTruthy();
});

it("shows a final state without the code entry", () => {
  renderRoute(PairRoute, {
    loaderData: { status: "approved", code: CODE, account: ACCOUNT },
  });

  expect(screen.getByText("state approved")).toBeTruthy();
  expect(screen.queryByText(/^entry/u)).toBeNull();
});

it("keeps unexpected failures inside the pairing card", () => {
  renderRoute(PairRoute, { ErrorBoundary, error: new Error("boom") });

  expect(screen.getByRole("alert").textContent).toBe(
    i18n.t("mcpPairing.error.decision"),
  );
  expect(screen.getByText("entry now")).toBeTruthy();
});
