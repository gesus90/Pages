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
    useLoaderData: vi.fn(),
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
}));

import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  RouterProvider,
  useLoaderData,
} from "react-router";

import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { resolveAnonymousLanguage } from "@/app/lib/language.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { createI18n } from "@/app/lib/i18n";
import { ROLE } from "@/definition/Role";
import { LANGUAGE } from "@/language/Language";
import Root, { Layout, links, loader, meta } from "@/app/root";

const mockedLoaderData = vi.mocked(useLoaderData);
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
  });

  it("selects the stored language for authenticated visitors", async () => {
    const user = {
      displayName: "Admin",
      id: "user-1",
      isActive: true,
      role: ROLE.ADMIN,
      username: "admin",
    };
    const getUserSettings = vi.fn().mockResolvedValue({ language: "de" });
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
    ).resolves.toEqual({ language: "de" });
    expect(getUserSettings).toHaveBeenCalledWith("user-1");
    expect(mockedAnonymousLanguage).not.toHaveBeenCalled();
  });

  it("selects the anonymous language for visitors without a session", async () => {
    mockedGetUser.mockResolvedValue(null);
    mockedAnonymousLanguage.mockResolvedValue(LANGUAGE.GERMAN);

    const request = createLoaderRequest("de-DE,de;q=0.9");

    await expect(
      loader({
        params: {},
        request,
      } as unknown as Parameters<typeof loader>[0]),
    ).resolves.toEqual({ language: "de" });
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
});
