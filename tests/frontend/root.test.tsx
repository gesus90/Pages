// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();

  return {
    ...actual,
    Links: () => null,
    Meta: () => null,
    Scripts: () => null,
    ScrollRestoration: () => null,
    useNavigation: vi.fn(),
    useRouteLoaderData: vi.fn(),
  };
});

vi.mock("@/app/lib/auth.server", () => ({
  authenticatedUserContext: {},
  getAuthenticatedUser: vi.fn(),
  parseCredentials: vi.fn(),
  requireAuthenticatedUser: vi.fn(),
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

vi.mock("@/app/lib/language.server", () => ({
  languageCookie: {
    parse: vi.fn(),
    serialize: vi.fn(),
  },
  resolveAnonymousLanguage: vi.fn(),
  resolveSetupLanguage: vi.fn(),
}));

vi.mock("@/app/lib/setup-gate.server", () => ({
  isSetupPending: vi.fn(),
  requireFinishedSetup: vi.fn(),
}));

import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  RouterProvider,
  useNavigation,
  useRouteLoaderData,
} from "react-router";

import { getAuthenticatedUser } from "@/app/lib/auth.server";
import {
  resolveAnonymousLanguage,
  resolveSetupLanguage,
} from "@/app/lib/language.server";
import {
  isSetupPending,
  requireFinishedSetup,
} from "@/app/lib/setup-gate.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { createI18n } from "@/app/lib/i18n";
import { ROLE } from "@/definition/Role";
import { LANGUAGE } from "@/language/Language";
import Root, {
  ErrorBoundary,
  Layout,
  headers,
  links,
  loader,
  meta,
  middleware,
} from "@/app/root";

import type { Language } from "@/language/Language";

const mockedLoaderData = vi.mocked(useRouteLoaderData);
const mockedNavigation = vi.mocked(useNavigation);
const mockedGetUser = vi.mocked(getAuthenticatedUser);
const mockedServices = vi.mocked(getApplicationServices);
const mockedAnonymousLanguage = vi.mocked(resolveAnonymousLanguage);

function createLoaderRequest(acceptLanguage: string | null): Request {
  const headers = new Headers();

  if (acceptLanguage !== null) {
    headers.set("Accept-Language", acceptLanguage);
  }

  return new Request("http://pages.invalid/", { headers });
}

describe("root loader", () => {
  beforeEach(() => {
    mockedGetUser.mockReset();
    mockedServices.mockReset();
    mockedAnonymousLanguage.mockReset();
    vi.mocked(isSetupPending).mockResolvedValue(false);
  });

  it("keeps every route closed until the setup finished", () => {
    expect(middleware).toEqual([requireFinishedSetup]);
  });

  it("uses the setup language and no services while the setup is pending", async () => {
    vi.mocked(isSetupPending).mockResolvedValue(true);
    vi.mocked(resolveSetupLanguage).mockResolvedValue(LANGUAGE.ENGLISH);

    const request = createLoaderRequest("de");

    await expect(
      loader({
        params: {},
        request,
      } as unknown as Parameters<typeof loader>[0]),
    ).resolves.toEqual({ language: "en", theme: "system" });
    expect(resolveSetupLanguage).toHaveBeenCalledWith(request);
    expect(mockedGetUser).not.toHaveBeenCalled();
    expect(mockedServices).not.toHaveBeenCalled();
  });

  it("selects the stored language and theme for authenticated visitors", async () => {
    const user = {
      displayName: "Admin",
      id: "user-1",
      isActive: true,
      mustChangePassword: false,
      role: ROLE.ADMIN,
      username: "admin",
    };
    const getUserSettings = vi
      .fn()
      .mockResolvedValue({ language: "de", theme: "dark" });
    mockedGetUser.mockResolvedValue(user);
    mockedServices.mockResolvedValue({
      settingsService: { getUserSettings },
    } as unknown as Awaited<ReturnType<typeof mockedServices>>);

    const request = createLoaderRequest("en");

    await expect(
      loader({
        params: {},
        request,
      } as unknown as Parameters<typeof loader>[0]),
    ).resolves.toEqual({ language: "de", theme: "dark" });
    expect(getUserSettings).toHaveBeenCalledWith("user-1");
    expect(mockedAnonymousLanguage).not.toHaveBeenCalled();
  });

  it("selects the anonymous language and the system theme without a session", async () => {
    mockedGetUser.mockResolvedValue(null);
    mockedAnonymousLanguage.mockResolvedValue(LANGUAGE.GERMAN);

    const request = createLoaderRequest("de-DE,de;q=0.9");

    await expect(
      loader({
        params: {},
        request,
      } as unknown as Parameters<typeof loader>[0]),
    ).resolves.toEqual({ language: "de", theme: "system" });
    expect(mockedAnonymousLanguage).toHaveBeenCalledWith(request);
  });
});

describe("root links and meta", () => {
  it("registers the Tailwind stylesheet", () => {
    const descriptors = links();

    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]).toMatchObject({ rel: "stylesheet" });

    const stylesheet = descriptors[0] as unknown as { href?: unknown };

    expect(typeof stylesheet.href).toBe("string");
  });

  it("defines the Pages document title", () => {
    expect(meta({} as unknown as Parameters<typeof meta>[0])).toEqual([
      { title: "Pages" },
    ]);
  });
});

describe("Root", () => {
  it("renders the active child route through the outlet", () => {
    const router = createMemoryRouter(
      [
        {
          children: [{ element: <p>Kindroute aktiv</p>, path: "kind" }],
          element: <Root />,
          path: "/",
        },
      ],
      { initialEntries: ["/kind"] },
    );

    render(<RouterProvider router={router} />);

    expect(screen.getByText("Kindroute aktiv")).toBeInTheDocument();
  });
});

describe("Layout", () => {
  beforeEach(() => {
    mockedNavigation.mockReturnValue({
      formData: undefined,
      state: "idle",
    } as ReturnType<typeof useNavigation>);
  });

  it("renders localized children inside the document shell", () => {
    mockedLoaderData.mockReturnValue({ language: LANGUAGE.GERMAN });
    const i18n = createI18n(LANGUAGE.GERMAN);

    render(
      <I18nextProvider i18n={i18n}>
        <Layout>
          <p>Anwendungsinhalt</p>
        </Layout>
      </I18nextProvider>,
    );

    expect(screen.getByText("Anwendungsinhalt")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("de");
  });

  it("renders the English shell", () => {
    mockedLoaderData.mockReturnValue({ language: LANGUAGE.ENGLISH });
    const i18n = createI18n(LANGUAGE.ENGLISH);

    render(
      <I18nextProvider i18n={i18n}>
        <Layout>
          <p>Application content</p>
        </Layout>
      </I18nextProvider>,
    );

    expect(screen.getByText("Application content")).toBeInTheDocument();
  });

  it("falls back to German without loader data", () => {
    mockedLoaderData.mockReturnValue(undefined);
    const i18n = createI18n(LANGUAGE.GERMAN);

    render(
      <I18nextProvider i18n={i18n}>
        <Layout>
          <p>Anwendungsinhalt</p>
        </Layout>
      </I18nextProvider>,
    );

    expect(screen.getByText("Anwendungsinhalt")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("de");
  });

  function renderLayout(): void {
    render(
      <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
        <Layout>
          <p>Anwendungsinhalt</p>
        </Layout>
      </I18nextProvider>,
    );
  }

  function readThemeColors(): {
    content: string | null;
    media: string | null;
  }[] {
    return [...document.querySelectorAll('meta[name="theme-color"]')].map(
      (tag) => ({
        content: tag.getAttribute("content"),
        media: tag.getAttribute("media"),
      }),
    );
  }

  it.each([
    ["light", "light", "#ffffff"],
    ["dark", "dark", "#0f1217"],
  ] as const)(
    "renders the %s theme on the document root with one browser color",
    (theme, colorScheme, color) => {
      mockedLoaderData.mockReturnValue({ language: LANGUAGE.GERMAN, theme });

      renderLayout();

      expect(document.documentElement).toHaveAttribute("data-theme", theme);
      expect(
        document.querySelector('meta[name="color-scheme"]'),
      ).toHaveAttribute("content", colorScheme);
      expect(readThemeColors()).toEqual([{ content: color, media: null }]);
    },
  );

  it("lets the operating system choose in the system theme", () => {
    mockedLoaderData.mockReturnValue({
      language: LANGUAGE.GERMAN,
      theme: "system",
    });

    renderLayout();

    expect(document.documentElement).toHaveAttribute("data-theme", "system");
    expect(document.querySelector('meta[name="color-scheme"]')).toHaveAttribute(
      "content",
      "light dark",
    );
    expect(readThemeColors()).toEqual([
      { content: "#ffffff", media: "(prefers-color-scheme: light)" },
      { content: "#0f1217", media: "(prefers-color-scheme: dark)" },
    ]);
  });

  it("defaults to the system theme where the router has no loader data", () => {
    mockedLoaderData.mockReturnValue(undefined);

    renderLayout();

    expect(document.documentElement).toHaveAttribute("data-theme", "system");
  });

  it("applies a theme at once while its settings submission is pending", () => {
    const formData = new FormData();
    formData.set("intent", "update-settings");
    formData.set("theme", "dark");
    mockedLoaderData.mockReturnValue({
      language: LANGUAGE.GERMAN,
      theme: "light",
    });
    mockedNavigation.mockReturnValue({
      formData,
      state: "submitting",
    } as unknown as ReturnType<typeof useNavigation>);

    renderLayout();

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });
});

function renderErrorBoundary(
  thrown: Response | Error,
  language: Language = LANGUAGE.GERMAN,
): void {
  const router = createMemoryRouter(
    [
      {
        ErrorBoundary,
        Component: Root,
        loader: () => {
          throw thrown;
        },
        path: "/",
      },
    ],
    { initialEntries: ["/"] },
  );

  render(
    <I18nextProvider i18n={createI18n(language)}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

describe("ErrorBoundary", () => {
  it("explains a forbidden response", async () => {
    renderErrorBoundary(new Response("Forbidden", { status: 403 }));

    expect(
      await screen.findByRole("heading", { name: "Zugriff verweigert" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Sie haben keine Berechtigung, diese Seite anzusehen."),
    ).toBeInTheDocument();
    expect(screen.getByText("403")).toBeInTheDocument();
  });

  it("explains a missing page in English", async () => {
    renderErrorBoundary(
      new Response("Not Found", { status: 404 }),
      LANGUAGE.ENGLISH,
    );

    expect(
      await screen.findByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The page you are looking for doesn't exist or has been moved.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("404")).toBeInTheDocument();
  });

  it("shows the generic copy and status for other responses", async () => {
    renderErrorBoundary(new Response("Method Not Allowed", { status: 405 }));

    expect(
      await screen.findByRole("heading", { name: "Etwas ist schiefgelaufen" }),
    ).toBeInTheDocument();
    expect(screen.getByText("405")).toBeInTheDocument();
  });

  it("hides the details of an unexpected error", async () => {
    renderErrorBoundary(new Error("connection to /srv/pages/secret.db failed"));

    expect(
      await screen.findByRole("heading", { name: "Etwas ist schiefgelaufen" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/secret\.db/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d{3}$/u)).not.toBeInTheDocument();
  });

  it("links back to the start page", async () => {
    renderErrorBoundary(new Response("Forbidden", { status: 403 }));

    expect(
      await screen.findByRole("link", { name: "Zur Startseite" }),
    ).toHaveAttribute("href", "/");
  });

  it("renders the translated link in English", async () => {
    renderErrorBoundary(new Error("boom"), LANGUAGE.ENGLISH);

    expect(
      await screen.findByRole("link", { name: "Back to the start page" }),
    ).toHaveAttribute("href", "/");
  });
});

describe("root headers", () => {
  it("sends the security headers with every document", () => {
    const result = headers({
      actionHeaders: new Headers(),
      errorHeaders: undefined,
      loaderHeaders: new Headers(),
      parentHeaders: new Headers(),
    }) as Record<string, string>;

    expect(result["X-Frame-Options"]).toBe("DENY");
    expect(result["X-Content-Type-Options"]).toBe("nosniff");
    expect(result["Content-Security-Policy"]).toContain("default-src 'self'");
  });
});
