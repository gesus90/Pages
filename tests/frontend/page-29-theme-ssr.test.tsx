// @vitest-environment jsdom
import { act, within } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  getAuthenticatedUser: vi.fn(),
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

vi.mock("@/app/lib/language.server", () => ({
  resolveAnonymousLanguage: vi.fn(),
  resolveSetupLanguage: vi.fn(),
}));

vi.mock("@/app/lib/setup-gate.server", () => ({
  isSetupPending: vi.fn(),
  requireFinishedSetup: vi.fn(),
}));

import { useNavigation, useRouteLoaderData } from "react-router";

import { Layout } from "@/app/root";
import { LANGUAGE } from "@/language/Language";

import type { UserTheme } from "@/definition/Settings";

const mockedLoaderData = vi.mocked(useRouteLoaderData);
const mockedNavigation = vi.mocked(useNavigation);

function renderOnServer(theme: UserTheme | undefined): string {
  mockedLoaderData.mockReturnValue(
    theme === undefined
      ? { language: LANGUAGE.GERMAN }
      : { language: LANGUAGE.GERMAN, theme },
  );

  return renderToString(
    <Layout>
      <p>Anwendungsinhalt</p>
    </Layout>,
  );
}

describe("PAGE-29 server rendering of the theme", () => {
  beforeEach(() => {
    mockedNavigation.mockReturnValue({
      formData: undefined,
      state: "idle",
    } as unknown as ReturnType<typeof useNavigation>);
  });

  it.each(["light", "dark", "system"] as const)(
    "writes the %s theme into the document the server sends",
    (theme) => {
      const html = renderOnServer(theme);

      expect(html).toContain(`<html lang="de" data-theme="${theme}">`);
      expect(html).toMatch(/<meta name="color-scheme" content="[^"]+"\/>/u);
    },
  );

  it("starts a visitor without loader data in the system theme", () => {
    expect(renderOnServer(undefined)).toContain('data-theme="system"');
  });

  it("sends the browser colors with the document", () => {
    const html = renderOnServer("system");

    expect(html).toContain(
      '<meta content="#ffffff" media="(prefers-color-scheme: light)" name="theme-color"/>',
    );
    expect(html).toContain(
      '<meta content="#0f1217" media="(prefers-color-scheme: dark)" name="theme-color"/>',
    );
  });
});

describe("PAGE-29 hydration of the theme", () => {
  beforeEach(() => {
    mockedNavigation.mockReturnValue({
      formData: undefined,
      state: "idle",
    } as unknown as ReturnType<typeof useNavigation>);
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it.each(["light", "dark", "system"] as const)(
    "keeps the %s theme of the server document without a hydration conflict",
    (theme) => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const html = renderOnServer(theme);
      const serverDocument = new DOMParser().parseFromString(html, "text/html");

      document.replaceChild(
        document.importNode(serverDocument.documentElement, true),
        document.documentElement,
      );

      mockedLoaderData.mockReturnValue({ language: LANGUAGE.GERMAN, theme });

      let root: ReturnType<typeof hydrateRoot> | undefined;

      act(() => {
        root = hydrateRoot(
          document,
          <Layout>
            <p>Anwendungsinhalt</p>
          </Layout>,
        );
      });

      expect(document.documentElement).toHaveAttribute("data-theme", theme);
      expect(
        within(document.body).getByText("Anwendungsinhalt"),
      ).toBeInTheDocument();
      expect(consoleError).not.toHaveBeenCalled();

      act(() => root?.unmount());
    },
  );
});
