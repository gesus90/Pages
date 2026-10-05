// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();

  return {
    ...actual,
    useActionData: vi.fn(),
    useLoaderData: vi.fn(),
    useNavigation: vi.fn(),
    useSubmit: vi.fn(),
  };
});

import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  RouterProvider,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";

import { createI18n } from "@/app/lib/i18n";
import { DEFAULT_USER_SETTINGS } from "@/definition/Settings";
import { LANGUAGE } from "@/language/Language";
import SettingsRoute from "@/app/routes/settings";

import { createSettingsLoaderData } from "../helpers/settings-loader-data";

import type { Language } from "@/language/Language";

const mockedLoaderData = vi.mocked(useLoaderData);
const mockedSubmit = vi.mocked(useSubmit);
const mockedNavigation = vi.mocked(useNavigation);
const mockedActionData = vi.mocked(useActionData);

function renderSettings(
  language: Language = LANGUAGE.GERMAN,
  submit: ReturnType<typeof vi.fn> = vi.fn(),
): ReturnType<typeof vi.fn> {
  mockedLoaderData.mockReturnValue(
    createSettingsLoaderData({
      settings: { ...DEFAULT_USER_SETTINGS, language },
    }),
  );
  mockedSubmit.mockReturnValue(
    submit as unknown as ReturnType<typeof useSubmit>,
  );
  mockedNavigation.mockReturnValue({
    state: "idle",
  } as ReturnType<typeof useNavigation>);
  mockedActionData.mockReturnValue(undefined);

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

  return submit;
}

describe("SettingsRoute", () => {
  it("renders the language selection with the stored choice", () => {
    renderSettings(LANGUAGE.GERMAN);

    expect(
      screen.getByRole("heading", { name: "Einstellungen" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sprache" })).toHaveTextContent(
      "Deutsch",
    );
  });

  it("preselects previously stored English choices", () => {
    renderSettings(LANGUAGE.ENGLISH);

    expect(
      screen.getByRole("combobox", { name: "Language" }),
    ).toHaveTextContent("English");
  });

  it("submits the complete settings when the language selection changes", async () => {
    const user = userEvent.setup();
    const submit = renderSettings(LANGUAGE.GERMAN);

    await user.click(screen.getByRole("combobox", { name: "Sprache" }));
    await user.click(await screen.findByRole("option", { name: "English" }));

    await waitFor(() => {
      expect(submit).toHaveBeenCalledTimes(1);
    });

    const [formData, options] = submit.mock.calls[0] as [
      FormData,
      { method: string },
    ];

    expect(options).toEqual({ method: "post" });
    expect(formData.get("intent")).toBe("update-settings");
    expect(formData.get("language")).toBe("en");
    expect(formData.get("dateFormat")).toBe(DEFAULT_USER_SETTINGS.dateFormat);
    expect(formData.get("notification.email")).toBe("on");
  });

  it("submits the new state when a notification is switched off", async () => {
    const user = userEvent.setup();
    const submit = renderSettings(LANGUAGE.GERMAN);

    await user.click(
      screen.getByRole("switch", { name: "E-Mail-Benachrichtigungen" }),
    );

    await waitFor(() => {
      expect(submit).toHaveBeenCalledTimes(1);
    });

    const [formData] = submit.mock.calls[0] as [FormData];

    expect(formData.get("notification.email")).toBe("off");
    expect(formData.get("notification.desktop")).toBe("on");
  });
});
