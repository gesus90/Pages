import { renderToString } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import { getAuthenticatedUser } from "@/app/lib/auth.server";
import {
  handleUpdatePicaMobilePort,
  loadPicaMobileView,
} from "@/app/lib/settings-actions/settings-pica-mobile-action.server";
import SettingsConnectionsRoute, {
  action,
  ErrorBoundary,
  headers,
  loader,
} from "@/app/routes/settings-connections";

import {
  ACTOR,
  formPost,
  i18n,
  pagesRequest,
  responseOf,
  routeArguments,
} from "./route-fixture";

const services = vi.hoisted(() => ({
  personalAgentTokenService: {
    list: vi.fn(),
    revoke: vi.fn(),
    requestRotation: vi.fn(),
  },
  pairingService: { validity: vi.fn(), setValidity: vi.fn() },
}));
// The server render cannot click; the stub keeps the handler of the button.
const button = vi.hoisted(() => ({ click: (): void => undefined }));
const runtime = vi.hoisted((): { publicUrl: string | undefined } => ({
  publicUrl: undefined,
}));

vi.mock("@/mcp/package.json", () => ({ default: { version: "9.9.9" } }));
vi.mock("@/app/lib/auth.server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAuthenticatedUser: vi.fn(),
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
vi.mock(
  "@/app/lib/settings-actions/settings-pica-mobile-action.server",
  () => ({
    handleUpdatePicaMobilePort: vi.fn(),
    loadPicaMobileView: vi.fn(),
  }),
);
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));
vi.mock("@/app/components/ui/button", () => ({
  Button: (props: {
    readonly children: React.ReactNode;
    readonly onClick: () => void;
  }): React.ReactElement => {
    button.click = props.onClick;
    return (
      <button type="button" name="retry">
        {props.children}
      </button>
    );
  },
}));
vi.mock("@/app/components/settings/connections/connections-panel", () => ({
  ConnectionsPanel: (props: {
    readonly view: { readonly packageVersion: string };
  }): React.ReactElement => <p>{`panel ${props.view.packageVersion}`}</p>,
}));

const TOKENS = [
  { id: "t-1", status: "active" },
  { id: "t-2", status: "revoked" },
];
const PATH = "/settings/connections";

/**
 * A same-origin connections post.
 *
 * @param fields - Submitted fields.
 */
function connectionPost(fields: Record<string, string>): Request {
  return formPost(PATH, fields);
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.publicUrl = undefined;
  vi.mocked(getAuthenticatedUser).mockResolvedValue(ACTOR);
  services.personalAgentTokenService.list.mockResolvedValue(TOKENS);
  services.pairingService.validity.mockResolvedValue(30);
  vi.mocked(loadPicaMobileView).mockResolvedValue(undefined);
});

it("never caches personal connection metadata", () => {
  expect(headers().get("Cache-Control")).toBe("no-store");
  expect(headers().get("Pragma")).toBe("no-cache");
});

it("lists the owner's connections without HTTP or mobile entries", async () => {
  const response = await loader(routeArguments(pagesRequest(PATH)));

  await expect(response.json()).resolves.toEqual({
    origin: "http://pages.invalid",
    packageVersion: "9.9.9",
    tokens: TOKENS,
    validityDays: 30,
  });
  expect(services.personalAgentTokenService.list).toHaveBeenCalledWith(
    "user-1",
  );
});

it("adds the HTTP endpoint and Pica Mobile when they are offered", async () => {
  runtime.publicUrl = "https://pages.example";
  vi.mocked(loadPicaMobileView).mockResolvedValue({
    port: 3200,
    isListening: true,
    listenError: null,
    host: null,
  });

  const response = await loader(routeArguments(pagesRequest(PATH)));

  await expect(response.json()).resolves.toMatchObject({
    httpEndpoint: "https://pages.example/mcp",
    picaMobile: { port: 3200 },
  });
});

it("refuses a visitor who must change the password first", async () => {
  vi.mocked(getAuthenticatedUser).mockResolvedValue({
    ...ACTOR,
    mustChangePassword: true,
  });

  const response = await responseOf(loader(routeArguments(pagesRequest(PATH))));

  expect(response.status).toBe(401);
});

it("refuses other methods than post", async () => {
  const response = await action(routeArguments(pagesRequest(PATH)));

  expect(response.status).toBe(405);
});

it("refuses a cross-origin post", async () => {
  const response = await action(
    routeArguments(
      pagesRequest(PATH, {
        method: "POST",
        headers: { Origin: "https://evil.invalid" },
      }),
    ),
  );

  expect(response.status).toBe(403);
});

it("refuses a post from a signed-out visitor", async () => {
  vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

  const response = await action(
    routeArguments(connectionPost({ intent: "set-token-duration", days: "7" })),
  );

  expect(response.status).toBe(401);
});

it("hands the Pica Mobile port to its handler", async () => {
  const outcome = Response.json({ updated: true });
  vi.mocked(handleUpdatePicaMobilePort).mockResolvedValue(outcome);

  await expect(
    action(
      routeArguments(connectionPost({ intent: "update-pica-mobile-port" })),
    ),
  ).resolves.toBe(outcome);
});

it("stores a valid token duration", async () => {
  const response = await action(
    routeArguments(
      connectionPost({ intent: "set-token-duration", days: "90" }),
    ),
  );

  await expect(response.json()).resolves.toEqual({ updated: true });
  expect(services.pairingService.setValidity).toHaveBeenCalledWith(
    "user-1",
    90,
  );
});

it("refuses a malformed token duration", async () => {
  const malformed = await action(
    routeArguments(
      connectionPost({ intent: "set-token-duration", days: "07" }),
    ),
  );
  const missing = await action(
    routeArguments(connectionPost({ intent: "set-token-duration" })),
  );

  expect(malformed.status).toBe(400);
  expect(missing.status).toBe(400);
  expect(services.pairingService.setValidity).not.toHaveBeenCalled();
});

it("revokes or rotates an active token of the owner", async () => {
  await action(
    routeArguments(connectionPost({ intent: "revoke-token", id: "t-1" })),
  );
  await action(
    routeArguments(connectionPost({ intent: "request-rotation", id: "t-1" })),
  );

  expect(services.personalAgentTokenService.revoke).toHaveBeenCalledWith(
    "user-1",
    "t-1",
  );
  expect(
    services.personalAgentTokenService.requestRotation,
  ).toHaveBeenCalledWith("user-1", "t-1");
});

it("refuses a token that is not active", async () => {
  const response = await action(
    routeArguments(connectionPost({ intent: "revoke-token", id: "t-2" })),
  );

  expect(response.status).toBe(403);
  expect(services.personalAgentTokenService.revoke).not.toHaveBeenCalled();
});

it("refuses unknown intents and token changes without an id", async () => {
  const unknown = await action(
    routeArguments(connectionPost({ intent: "explode" })),
  );
  const withoutId = await action(
    routeArguments(connectionPost({ intent: "revoke-token" })),
  );

  expect(unknown.status).toBe(400);
  expect(withoutId.status).toBe(400);
});

/**
 * Renders the route on the server, as the first document request does.
 *
 * @param options - Loader data or a load failure, and the revalidating loader.
 * @returns The HTML of the page.
 */
function renderDocument(options: {
  readonly loaderData?: unknown;
  readonly error?: unknown;
  readonly loader?: () => unknown;
}): string {
  const router = createMemoryRouter(
    [
      {
        id: "route",
        path: "/",
        Component: SettingsConnectionsRoute,
        ErrorBoundary,
        loader: options.loader ?? ((): unknown => options.loaderData),
      },
    ],
    {
      hydrationData: {
        loaderData: { route: options.loaderData },
        ...(options.error === undefined
          ? {}
          : { errors: { route: options.error } }),
      },
    },
  );
  return renderToString(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

it("renders the connections panel", () => {
  expect(
    renderDocument({ loaderData: { packageVersion: "9.9.9", tokens: [] } }),
  ).toContain("panel 9.9.9");
});

it("offers a retry when the connections cannot be loaded", async () => {
  const reload = vi.fn(() => ({ packageVersion: "9.9.9", tokens: [] }));

  const html = renderDocument({ error: new Error("down"), loader: reload });

  expect(html).toContain(i18n.t("settings.connections.error.load"));
  expect(html).toContain(
    `name="retry">${i18n.t("settings.connections.error.retry")}<`,
  );
  button.click();
  await vi.waitFor(() => {
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
