// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();

  return {
    ...actual,
    useLoaderData: vi.fn(),
    useSubmit: vi.fn(),
  };
});

import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  RouterProvider,
  useLoaderData,
  useSubmit,
} from "react-router";

import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";
import SettingsRoute from "@/app/routes/settings";

import type { Language } from "@/language/Language";

const mockedLoaderData = vi.mocked(useLoaderData);
const mockedSubmit = vi.mocked(useSubmit);

function renderSettings(language: Language = LANGUAGE.GERMAN): void {
  mockedLoaderData.mockReturnValue({ language });
  mockedSubmit.mockReturnValue(vi.fn());

  const i18n = createI18n(language);
  const router = createMemoryRouter(
    [{ element: <SettingsRoute />, path: "/settings" }],
    { initialEntries: ["/settings"] },
  );

  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

describe("SettingsRoute", () => {
  it("renders the language selection with the stored choice", () => {
    renderSettings(LANGUAGE.GERMAN);

    expect(
      screen.getByRole("heading", { name: "Einstellungen" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveTextContent("Deutsch");
  });

  it("preselects previously stored English choices", () => {
    renderSettings(LANGUAGE.ENGLISH);

    expect(screen.getByRole("combobox")).toHaveTextContent("English");
  });

  it("submits the form when the selection changes", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    mockedLoaderData.mockReturnValue({ language: LANGUAGE.GERMAN });
    mockedSubmit.mockReturnValue(submit);

    const i18n = createI18n(LANGUAGE.GERMAN);
    const router = createMemoryRouter(
      [{ element: <SettingsRoute />, path: "/settings" }],
      { initialEntries: ["/settings"] },
    );

    render(
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>,
    );

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "English" }));

    await waitFor(() => {
      expect(submit).toHaveBeenCalledTimes(1);
    });
  });
});
