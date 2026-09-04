import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  RouterProvider,
  useLoaderData,
} from "react-router";

import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";
import Root, { Layout, links, loader, meta } from "@/app/root";

const mockedLoaderData = vi.mocked(useLoaderData);

function createLoaderRequest(acceptLanguage: string | null): Request {
  const headers = new Headers();

  if (acceptLanguage !== null) {
    headers.set("Accept-Language", acceptLanguage);
  }

  return new Request("http://pages.invalid/", { headers });
}

describe("root loader", () => {
  it("selects German from the request preference", () => {
    expect(
      loader({
        params: {},
        request: createLoaderRequest("de-DE,de;q=0.9"),
      } as unknown as Parameters<typeof loader>[0]),
    ).toEqual({ language: "de" });
  });

  it("defaults to English without a language header", () => {
    expect(
      loader({
        params: {},
        request: createLoaderRequest(null),
      } as unknown as Parameters<typeof loader>[0]),
    ).toEqual({ language: "en" });
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
});
