// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/auth.server", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/app/lib/session.server", () => ({ getSessionToken: vi.fn() }));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("react-router", async (original) => ({
  ...(await original<typeof import("react-router")>()),
  useLoaderData: () => ({
    id: "flow",
    csrf: "nonce",
    clientName: "Public client",
    clientId: "public",
    resource: "https://mcp.invalid/mcp",
  }),
  Form: ({ children, ...props }: React.ComponentProps<"form">) => (
    <form {...props}>{children}</form>
  ),
}));

import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { getSessionToken } from "@/app/lib/session.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  oauthFailure,
  oauthResponse,
  readOAuthJson,
  requireOAuthOrigin,
} from "@/app/lib/oauth-response.server";
import { oauthLoginDestination } from "@/app/lib/oauth-login.server";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import * as personal from "@/app/routes/api-v1-personal-tokens";
import * as settings from "@/app/routes/api-v1-mcp-settings";
import * as endpoint from "@/app/routes/oauth-endpoint";
import * as metadata from "@/app/routes/oauth-server-metadata";
import OAuthConsentRoute, * as consent from "@/app/routes/oauth-consent";
import { createUser } from "../helpers/factories";
import type { ApplicationServices } from "@/app/lib/services.server";

const id = "01234567-0123-4567-89ab-0123456789ab";
const services = {
  personalAgentTokenService: {
    list: vi.fn(),
    create: vi.fn(),
    rotate: vi.fn(),
    revoke: vi.fn(),
  },
  oauthGrantService: { get: vi.fn(), setDuration: vi.fn(), revoke: vi.fn() },
  oauthClientService: { register: vi.fn() },
  oauthTokenService: { exchange: vi.fn(), delegate: vi.fn() },
  oauthConsentService: { begin: vi.fn(), view: vi.fn(), decide: vi.fn() },
};
function args(request: Request, routeEndpoint = "test") {
  return {
    request,
    params: { endpoint: routeEndpoint },
    context: new RouterContextProvider(),
    url: new URL(request.url),
    pattern: "test",
  };
}
function jsonRequest(
  input: unknown,
  method = "POST",
  path = "/api/v1/personal-tokens",
): Request {
  return new Request(`https://pages.invalid${path}`, {
    method,
    headers: {
      Origin: "https://pages.invalid",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}
beforeEach(() => {
  vi.mocked(getApplicationServices).mockResolvedValue(
    services as unknown as ApplicationServices,
  );
  vi.mocked(getAuthenticatedUser).mockResolvedValue(createUser());
  vi.mocked(getSessionToken).mockResolvedValue("isolated-session");
  vi.stubEnv("PAGES_OAUTH_ISSUER", "https://pages.invalid");
  vi.stubEnv("PAGES_MCP_RESOURCE", "https://mcp.invalid/mcp");
  services.personalAgentTokenService.list.mockResolvedValue([]);
  services.personalAgentTokenService.rotate.mockResolvedValue({
    token: "shown-once",
  });
  services.oauthTokenService.delegate.mockResolvedValue({
    delegationToken: "shown-once",
  });
  services.oauthGrantService.get.mockResolvedValue({
    durationSeconds: 86400,
    grants: [],
  });
  services.oauthConsentService.begin.mockResolvedValue(id);
  services.oauthConsentService.view.mockResolvedValue({
    id,
    csrf: "nonce",
    clientName: "Public client",
    clientId: "public",
    resource: "https://mcp.invalid/mcp",
  });
  services.oauthConsentService.decide.mockResolvedValue(
    "https://client.invalid/callback?code=isolated-code",
  );
});

describe("owner token and consent settings APIs", () => {
  it("lists only owner facts and handles create, rotate, revoke and duration mutations", async () => {
    expect(
      (
        await personal.loader(
          args(new Request("https://pages.invalid/api/v1/personal-tokens")),
        )
      ).status,
    ).toBe(200);
    expect(services.personalAgentTokenService.list).toHaveBeenCalledWith(
      "user-1",
    );
    expect(
      (
        await settings.loader(
          args(new Request("https://pages.invalid/api/v1/mcp-settings")),
        )
      ).status,
    ).toBe(200);
    services.personalAgentTokenService.create.mockResolvedValue({
      token: "shown-once",
    });
    expect(
      (
        await personal.action(
          args(
            jsonRequest({
              operation: "create",
              name: "local",
              expiresAt: null,
            }),
          ),
        )
      ).status,
    ).toBe(201);
    expect(services.personalAgentTokenService.create).toHaveBeenCalledWith(
      "user-1",
      "local",
      null,
    );
    expect(
      (
        await personal.action(
          args(jsonRequest({ operation: "rotate", id: "token-id" })),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await personal.action(
          args(jsonRequest({ operation: "revoke", id: "token-id" })),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await settings.action(
          args(
            jsonRequest({ operation: "set-duration", durationSeconds: null }),
          ),
        )
      ).status,
    ).toBe(200);
    expect(services.oauthGrantService.setDuration).toHaveBeenCalledWith(
      "user-1",
      null,
    );
    expect(
      (
        await settings.action(
          args(jsonRequest({ operation: "revoke", id: "grant-id" })),
        )
      ).status,
    ).toBe(200);
    expect(services.oauthGrantService.revoke).toHaveBeenCalledWith(
      "user-1",
      "grant-id",
    );
  });
  it("rejects anonymous/mandatory-password callers, wrong methods, cross-origin requests and bad operations", async () => {
    for (const route of [personal, settings]) {
      for (const user of [null, createUser({ mustChangePassword: true })]) {
        vi.mocked(getAuthenticatedUser).mockResolvedValue(user);
        expect(
          (await route.loader(args(new Request("https://pages.invalid/api"))))
            .status,
        ).toBe(401);
        expect(
          (
            await route.action(
              args(jsonRequest({ operation: "revoke", id: "id" })),
            )
          ).status,
        ).toBe(401);
      }
      vi.mocked(getAuthenticatedUser).mockResolvedValue(createUser());
      expect((await route.action(args(jsonRequest({}, "PUT")))).status).toBe(
        405,
      );
      expect(
        (
          await route.action(
            args(new Request("https://pages.invalid/api", { method: "POST" })),
          )
        ).status,
      ).toBe(403);
      expect((await route.action(args(jsonRequest({})))).status).toBe(400);
      expect(
        (
          await route.action(
            args(jsonRequest({ operation: "unknown", id: "id" })),
          )
        ).status,
      ).toBe(400);
      expect(
        (await route.action(args(jsonRequest({ operation: "revoke", id: 3 }))))
          .status,
      ).toBe(400);
    }
    services.personalAgentTokenService.list.mockRejectedValue(
      new Error("sentinel-secret"),
    );
    const response = await personal.loader(
      args(new Request("https://pages.invalid/api")),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("sentinel-secret");
  });
});

describe("OAuth protocol endpoints", () => {
  it("publishes discovery, starts consent and keeps registration separate from the login link", async () => {
    expect(await metadata.loader().json()).toMatchObject({
      issuer: "https://pages.invalid",
      code_challenge_methods_supported: ["S256"],
    });
    services.oauthClientService.register.mockResolvedValue({
      client_id: "public",
    });
    expect(
      (
        await endpoint.action(
          args(jsonRequest({ client_name: "client" }), "register"),
        )
      ).status,
    ).toBe(201);
    const response = await endpoint.loader(
      args(
        new Request("https://pages.invalid/oauth/authorize?client_id=public"),
        "authorize",
      ),
    );
    expect(response.headers.get("Location")).toBe(`/oauth/consent?id=${id}`);
    expect(services.oauthConsentService.begin).toHaveBeenCalledWith(
      expect.any(URLSearchParams),
    );
    expect(
      (
        await endpoint.loader(
          args(new Request("https://pages.invalid/oauth/token"), "token"),
        )
      ).status,
    ).toBe(405);
    vi.stubEnv("PAGES_OAUTH_ISSUER", "");
    expect(metadata.loader().status).toBe(503);
  });
  it("exchanges form-encoded public-client credentials and uses a dedicated delegation body", async () => {
    services.oauthTokenService.exchange.mockResolvedValue({
      access_token: "shown-once",
    });
    const response = await endpoint.action(
      args(
        new Request("https://pages.invalid/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "grant_type=authorization_code",
        }),
        "token",
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(services.oauthTokenService.exchange).toHaveBeenCalledWith(
      expect.any(URLSearchParams),
    );
    expect(
      (
        await endpoint.action(
          args(
            jsonRequest({
              subject_token: "isolated-token",
              resource: "https://mcp.invalid/mcp",
            }),
            "delegate",
          ),
        )
      ).status,
    ).toBe(200);
    expect(services.oauthTokenService.delegate).toHaveBeenCalledWith(
      "isolated-token",
      "https://mcp.invalid/mcp",
    );
    expect(
      (
        await endpoint.action(
          args(
            jsonRequest({ resource: "https://mcp.invalid/mcp" }),
            "delegate",
          ),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await endpoint.action(
          args(
            jsonRequest({ subject_token: "isolated", resource: "wrong" }),
            "delegate",
          ),
        )
      ).status,
    ).toBe(401);
    expect(
      (await endpoint.action(args(jsonRequest({}), "unknown"))).status,
    ).toBe(400);
    expect((await endpoint.action(args(jsonRequest({}), "token"))).status).toBe(
      400,
    );
    expect(
      (await endpoint.action(args(jsonRequest({}, "PUT"), "token"))).status,
    ).toBe(400);
    expect(
      (
        await endpoint.action(
          args(
            new Request("https://pages.invalid/oauth/token", {
              method: "POST",
              headers: { Authorization: "Bearer isolated" },
            }),
            "token",
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await endpoint.action(
          args(
            new Request("https://pages.invalid/oauth/token", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: "x".repeat(65537),
            }),
            "token",
          ),
        )
      ).status,
    ).toBe(400);
  });
});

describe("Pages login and explicit consent", () => {
  it("uses the existing login with a restricted return path and renders client/resource before approval", async () => {
    const request = new Request(`https://pages.invalid/oauth/consent?id=${id}`);
    expect(await consent.loader(args(request))).toMatchObject({
      clientName: "Public client",
      resource: "https://mcp.invalid/mcp",
    });
    expect(services.oauthConsentService.view).toHaveBeenCalledWith(id, {
      userId: "user-1",
      session: "isolated-session",
    });
    render(<OAuthConsentRoute />);
    expect(screen.getByText(/Public client/)).toBeInTheDocument();
    expect(screen.getByText("https://mcp.invalid/mcp")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "mcpConsent.approve" }),
    ).toHaveAttribute("value", "approve");
    expect(
      screen.getByRole("button", { name: "mcpConsent.deny" }),
    ).toHaveAttribute("value", "deny");
    await consent.loader(
      args(new Request("https://pages.invalid/oauth/consent")),
    );
    expect(services.oauthConsentService.view).toHaveBeenLastCalledWith("", {
      userId: "user-1",
      session: "isolated-session",
    });
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);
    await expect(consent.loader(args(request))).rejects.toMatchObject({
      status: 302,
    });
    await expect(
      consent.loader(args(new Request("https://pages.invalid/oauth/consent"))),
    ).rejects.toMatchObject({ status: 400 });
    vi.mocked(getAuthenticatedUser).mockResolvedValue(createUser());
    vi.mocked(getSessionToken).mockResolvedValue(null);
    await expect(consent.loader(args(request))).rejects.toMatchObject({
      status: 302,
    });
    vi.mocked(getSessionToken).mockResolvedValue("session");
    vi.mocked(getAuthenticatedUser).mockResolvedValue(
      createUser({ mustChangePassword: true }),
    );
    await expect(consent.loader(args(request))).rejects.toMatchObject({
      status: 302,
    });
    const destination = `/oauth/consent?id=${id}`;
    expect(
      oauthLoginDestination(
        new Request(
          `https://pages.invalid/login?returnTo=${encodeURIComponent(destination)}`,
        ),
      ),
    ).toBe(destination);
    for (const suffix of [
      "",
      "?returnTo=https://evil.invalid",
      "?returnTo=//evil.invalid",
      "?returnTo=/oauth/consent?id=bad",
    ])
      expect(
        oauthLoginDestination(
          new Request(`https://pages.invalid/login${suffix}`),
        ),
      ).toBe("/dashboard");
  });
  it("accepts explicit approve/deny and rejects bad form submissions or stale consent without leaking errors", async () => {
    const formRequest = (body: string, method = "POST", query = `?id=${id}`) =>
      new Request(`https://pages.invalid/oauth/consent${query}`, {
        method,
        headers: {
          Origin: "https://pages.invalid",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
    for (const decision of ["approve", "deny"]) {
      const response = await consent.action(
        args(formRequest(`csrf=nonce&decision=${decision}`)),
      );
      expect(response.headers.get("Location")).toBe(
        "https://client.invalid/callback?code=isolated-code",
      );
      expect(services.oauthConsentService.decide).toHaveBeenLastCalledWith(
        { id, csrf: "nonce", approved: decision === "approve" },
        { userId: "user-1", session: "isolated-session" },
      );
    }
    for (const body of ["", "decision=approve", "csrf=nonce&decision=unknown"])
      expect((await consent.action(args(formRequest(body)))).status).toBe(400);
    expect((await consent.action(args(formRequest("", "PUT")))).status).toBe(
      405,
    );
    expect(
      (
        await consent.action(
          args(formRequest("csrf=nonce&decision=approve", "POST", "")),
        )
      ).status,
    ).toBe(302);
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);
    await expect(
      consent.action(args(formRequest("csrf=nonce&decision=approve"))),
    ).rejects.toMatchObject({ status: 302 });
    vi.mocked(getAuthenticatedUser).mockResolvedValue(createUser());
    services.oauthConsentService.decide.mockRejectedValue(
      new Error("sentinel-secret"),
    );
    const failed = await consent.action(
      args(formRequest("csrf=nonce&decision=approve")),
    );
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("sentinel-secret");
  });
});

describe("bounded credential-safe request/response support", () => {
  it("rejects wrong media type, oversized, invalid or non-object JSON", async () => {
    for (const request of [
      new Request("https://pages.invalid", { method: "POST", body: "{}" }),
      jsonRequest("x".repeat(65537)),
      jsonRequest(null),
      jsonRequest(3),
      jsonRequest([]),
      new Request("https://pages.invalid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    ])
      await expect(readOAuthJson(request)).rejects.toMatchObject({
        code: "invalid_request",
      });
    expect(await readOAuthJson(jsonRequest({ operation: "test" }))).toEqual({
      operation: "test",
    });
    expect(oauthResponse({}).status).toBe(200);
    expect(oauthFailure(new Error("secret")).status).toBe(503);
    expect(
      oauthFailure(new McpAuthorizationError("invalid_token", 401)).status,
    ).toBe(401);
    expect(() =>
      requireOAuthOrigin(
        new Request("https://pages.invalid", {
          headers: { Origin: "https://evil.invalid" },
        }),
      ),
    ).toThrow(McpAuthorizationError);
  });
});
