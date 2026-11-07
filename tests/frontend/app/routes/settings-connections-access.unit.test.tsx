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
  ErrorBoundary,
} from "@/app/routes/settings-connections";
import { loader as dataLoader } from "@/app/routes/settings-connections-data";
import { action, loader } from "@/app/routes/settings-connections-server";

import {
  ACTOR,
  formPost,
  i18n,
  pagesRequest,
  responseOf,
  routeArguments,
} from "./route-fixture";

const services = vi.hoisted(() => ({
  mcpDeviceService: { list: async (): Promise<readonly unknown[]> => [] },
}));
// The server render cannot click; the stub keeps the handler of the button.
const button = vi.hoisted(() => ({ click: (): void => undefined }));

vi.mock("@/app/lib/auth.server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAuthenticatedUser: vi.fn(),
}));
const AUDIENCE = vi.hoisted(() => ({
  userId: "user-1",
  authorizationVersion: "account:pica:1",
}));

vi.mock("@/app/lib/local-state/local-state-audience.server", () => ({
  readLocalStateAudience: async (): Promise<unknown> => AUDIENCE,
  readAuthorizationVersion: async (): Promise<string> =>
    AUDIENCE.authorizationVersion,
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => services,
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
  ConnectionsPanel: (): React.ReactElement => <p>panel</p>,
}));

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
  vi.mocked(getAuthenticatedUser).mockResolvedValue(ACTOR);
  vi.mocked(loadPicaMobileView).mockResolvedValue(undefined);
});

it("never caches personal connection metadata", async () => {
  const response = await dataLoader(
    routeArguments(pagesRequest("/settings-api/connections")),
  );

  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Pragma")).toBe("no-cache");
});

it("lists the connections without a Pica Mobile entry", async () => {
  const response = await loader(routeArguments(pagesRequest(PATH)));

  await expect(response.json()).resolves.toEqual({
    audience: AUDIENCE,
    mcpDevices: [],
  });
});

it("adds Pica Mobile when it is offered", async () => {
  vi.mocked(loadPicaMobileView).mockResolvedValue({
    port: 3200,
    isListening: true,
    listenError: null,
    host: null,
  });

  const response = await loader(routeArguments(pagesRequest(PATH)));

  await expect(response.json()).resolves.toMatchObject({
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
    routeArguments(connectionPost({ intent: "update-pica-mobile-port" })),
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

it("refuses unknown intents, also the retired token changes", async () => {
  const unknown = await action(
    routeArguments(connectionPost({ intent: "explode" })),
  );
  const retired = await action(
    routeArguments(connectionPost({ intent: "revoke-token", id: "t-1" })),
  );

  expect(unknown.status).toBe(400);
  expect(retired.status).toBe(400);
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
  expect(renderDocument({ loaderData: { audience: AUDIENCE } })).toContain(
    "panel",
  );
});

it("offers a retry when the connections cannot be loaded", async () => {
  const reload = vi.fn(() => ({ audience: AUDIENCE }));

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
