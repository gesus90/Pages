// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import Root, {
  ErrorBoundary,
  headers,
  Layout,
  links,
  loader,
  meta,
  middleware,
} from "@/app/root";
import { createSecurityHeaders } from "@/app/lib/security-headers";
import { requireFinishedSetup } from "@/app/lib/setup-gate.server";
import { STANDARD_ACTIVE_DESIGN_THEME } from "@/definition/DesignTheme";
import { DEFAULT_USER_SETTINGS } from "@/definition/Settings";

import type { Root as ReactRoot } from "react-dom/client";
import type * as ReactRouter from "react-router";
import type { RouteObject } from "react-router";
import type { ActiveDesignTheme } from "@/definition/DesignTheme";

const server = vi.hoisted(() => ({
  isSetupPending: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  resolveAnonymousLanguage: vi.fn(),
  resolveSetupLanguage: vi.fn(),
  getUserSettings: vi.fn(),
  getActiveTheme: vi.fn(),
}));

vi.mock("@/app/lib/setup-gate.server", () => ({
  isSetupPending: server.isSetupPending,
  requireFinishedSetup: vi.fn(),
}));
vi.mock("@/app/lib/auth.server", () => ({
  getAuthenticatedUser: server.getAuthenticatedUser,
}));
vi.mock("@/app/lib/language.server", () => ({
  resolveAnonymousLanguage: server.resolveAnonymousLanguage,
  resolveSetupLanguage: server.resolveSetupLanguage,
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({
    settingsService: { getUserSettings: server.getUserSettings },
    designThemeService: { getActiveTheme: server.getActiveTheme },
  }),
}));
// The document scripts and links belong to the framework, not to the root route.
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouter>()),
  Meta: () => null,
  Links: () => null,
  Scripts: () => null,
  ScrollRestoration: () => null,
}));

const REQUEST = new Request("https://pages.example.com/");
const CUSTOM_DESIGN: ActiveDesignTheme = {
  id: "ocean",
  stylesheet: ":root{--color-primary:#036}",
};

let mounted: ReactRoot | null = null;

/** The framework passes more than these route arguments; the root route reads none of them. */
function routeArguments<Arguments>(partial: object): Arguments {
  return partial as unknown as Arguments;
}

/** Calls the loader the way React Router does; only the request is used. */
function load(): ReturnType<typeof loader> {
  return loader(
    routeArguments<Parameters<typeof loader>[0]>({ request: REQUEST }),
  );
}

/** Mounts the root route as the whole document, as the browser hydrates it. */
async function mountDocument(
  route: Partial<RouteObject>,
): Promise<ReturnType<typeof createMemoryRouter>> {
  const router = createMemoryRouter([{ id: "root", path: "/", ...route }]);
  mounted = createRoot(document);
  await act(async () => {
    mounted?.render(<RouterProvider router={router} />);
  });
  return router;
}

beforeEach(() => {
  server.isSetupPending.mockResolvedValue(false);
  server.getAuthenticatedUser.mockResolvedValue(null);
  server.resolveAnonymousLanguage.mockResolvedValue("en");
  server.resolveSetupLanguage.mockResolvedValue("de");
});

afterEach(async () => {
  await act(async () => {
    mounted?.unmount();
  });
  mounted = null;
});

it("keeps every route closed until the setup is finished", () => {
  expect(middleware).toEqual([requireFinishedSetup]);
});

it("registers the stylesheet and the favicon, the title and the security headers", () => {
  expect(links()).toEqual([
    expect.objectContaining({ rel: "stylesheet" }),
    expect.objectContaining({ rel: "icon", type: "image/svg+xml" }),
  ]);
  expect(meta(routeArguments<Parameters<typeof meta>[0]>({}))).toEqual([
    { title: "Pages" },
  ]);
  expect(headers(routeArguments<Parameters<typeof headers>[0]>({}))).toEqual(
    createSecurityHeaders(),
  );
});

it("starts the setup wizard in the chosen language without touching the services", async () => {
  server.isSetupPending.mockResolvedValue(true);

  await expect(load()).resolves.toEqual({
    language: "de",
    theme: DEFAULT_USER_SETTINGS.theme,
    designTheme: STANDARD_ACTIVE_DESIGN_THEME,
    draftOwnerId: null,
  });
  expect(server.getAuthenticatedUser).not.toHaveBeenCalled();
});

it("uses the personal language, mode and design of a signed-in visitor", async () => {
  server.getAuthenticatedUser.mockResolvedValue({ id: "user-1" });
  server.getUserSettings.mockResolvedValue({ language: "en", theme: "dark" });
  server.getActiveTheme.mockResolvedValue(CUSTOM_DESIGN);

  await expect(load()).resolves.toEqual({
    language: "en",
    theme: "dark",
    designTheme: CUSTOM_DESIGN,
    draftOwnerId: "user-1",
  });
  expect(server.getUserSettings).toHaveBeenCalledWith("user-1");
  expect(server.getActiveTheme).toHaveBeenCalledWith("user-1");
});

it("falls back to the browser language and the standard design for anonymous visitors", async () => {
  await expect(load()).resolves.toEqual({
    language: "en",
    theme: DEFAULT_USER_SETTINGS.theme,
    designTheme: STANDARD_ACTIVE_DESIGN_THEME,
    draftOwnerId: null,
  });
  expect(server.getUserSettings).not.toHaveBeenCalled();
});

it("renders the document with the language, mode and design of the loader", async () => {
  await mountDocument({
    loader: () => ({
      language: "en",
      theme: "dark",
      designTheme: CUSTOM_DESIGN,
      draftOwnerId: "user-1",
    }),
    Component: () => (
      <Layout>
        <Root />
        <p>content</p>
      </Layout>
    ),
  });

  const html = document.documentElement;
  expect(html.getAttribute("lang")).toBe("en");
  expect(html.getAttribute("data-design-theme")).toBe("ocean");
  expect(html.getAttribute("data-theme")).toBe("dark");
  expect(
    document
      .querySelector('meta[name="color-scheme"]')
      ?.getAttribute("content"),
  ).toBe("dark");
  expect(
    document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
  ).toBe("#0f1217");
  expect(document.getElementById("design-theme-stylesheet")?.textContent).toBe(
    CUSTOM_DESIGN.stylesheet,
  );
  expect(document.body.textContent).toContain("content");
});

it("renders the standard document without a design stylesheet", async () => {
  await mountDocument({
    loader: () => ({
      language: "de",
      theme: "system",
      designTheme: STANDARD_ACTIVE_DESIGN_THEME,
      draftOwnerId: null,
    }),
    Component: () => <Layout>{null}</Layout>,
  });

  expect(document.documentElement.getAttribute("lang")).toBe("de");
  expect(
    document
      .querySelector('meta[name="color-scheme"]')
      ?.getAttribute("content"),
  ).toBe("light dark");
  expect(document.getElementById("design-theme-stylesheet")).toBeNull();
});

it("starts an isolated draft queue when the signed-in person changes", async () => {
  const owners = ["user-1", "user-2"];
  const router = await mountDocument({
    loader: () => ({
      language: "de",
      theme: "light",
      designTheme: STANDARD_ACTIVE_DESIGN_THEME,
      draftOwnerId: owners.shift() ?? null,
    }),
    Component: () => <Layout>{null}</Layout>,
  });

  await act(async () => {
    await router.revalidate();
  });

  expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  expect(owners).toEqual([]);
});

it("renders an error page around a route that has no root data", async () => {
  await mountDocument({
    loader: () => {
      throw new Error("the root loader failed");
    },
    ErrorBoundary: () => (
      <Layout>
        <ErrorBoundary />
      </Layout>
    ),
  });

  expect(document.documentElement.getAttribute("lang")).toBe("de");
  expect(document.body.textContent).toContain("Etwas ist schiefgelaufen");
});

it.each([
  { status: 403, title: "Zugriff verweigert" },
  { status: 404, title: "Seite nicht gefunden" },
  { status: 500, title: "Etwas ist schiefgelaufen" },
])(
  "answers the status $status with its own copy",
  async ({ status, title }) => {
    await mountDocument({
      loader: () => {
        throw new Response(null, { status });
      },
      ErrorBoundary: () => (
        <Layout>
          <ErrorBoundary />
        </Layout>
      ),
    });

    const text = document.body.textContent;
    expect(text).toContain(String(status));
    expect(text).toContain(title);
    expect(document.querySelector("main a")?.getAttribute("href")).toBe("/");
  },
);

it("never shows the message of an unexpected error", async () => {
  await mountDocument({
    loader: () => {
      throw new Error("secret stack detail");
    },
    ErrorBoundary: () => (
      <Layout>
        <ErrorBoundary />
      </Layout>
    ),
  });

  expect(document.body.textContent).not.toContain("secret stack detail");
  expect(document.querySelector("main p.text-primary")).toBeNull();
});
