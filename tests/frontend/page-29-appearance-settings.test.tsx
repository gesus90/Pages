// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();

  return {
    ...actual,
    useNavigation: vi.fn(),
    useSubmit: vi.fn(),
  };
});

vi.mock("@/app/components/ui/toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/components/ui/toast")>()),
  showSuccessToast: vi.fn(),
}));

import { useNavigation, useSubmit } from "react-router";

import { AppearanceCard } from "@/app/components/settings/appearance-card";
import { useUserSettings } from "@/app/components/settings/use-user-settings";
import { createI18n } from "@/app/lib/i18n";
import { DEFAULT_USER_SETTINGS } from "@/definition/Settings";
import { LANGUAGE } from "@/language/Language";

import type { UserSettings } from "@/definition/Settings";
import type { Language } from "@/language/Language";

const mockedNavigation = vi.mocked(useNavigation);
const mockedSubmit = vi.mocked(useSubmit);

function Harness({
  initial,
}: {
  readonly initial: UserSettings;
}): React.ReactElement {
  const { settings, persistSettings } = useUserSettings(initial);

  return <AppearanceCard onChange={persistSettings} settings={settings} />;
}

function renderCard(
  language: Language = LANGUAGE.GERMAN,
  initial: UserSettings = DEFAULT_USER_SETTINGS,
): ReturnType<typeof vi.fn> {
  const submit = vi.fn();

  mockedSubmit.mockReturnValue(
    submit as unknown as ReturnType<typeof useSubmit>,
  );
  mockedNavigation.mockReturnValue({
    formData: undefined,
    state: "idle",
  } as unknown as ReturnType<typeof useNavigation>);

  render(
    <I18nextProvider i18n={createI18n(language)}>
      <Harness initial={initial} />
    </I18nextProvider>,
  );

  return submit;
}

function readSubmission(
  submit: ReturnType<typeof vi.fn>,
): Record<string, string> {
  const formData = submit.mock.calls[0]?.[0] as FormData;

  return Object.fromEntries(
    [...formData.entries()].map(([name, value]) => [name, String(value)]),
  );
}

describe("PAGE-29 appearance card", () => {
  beforeEach(() => {
    mockedSubmit.mockReset();
    mockedNavigation.mockReset();
  });

  it("offers light, dark and system in German", () => {
    renderCard(LANGUAGE.GERMAN);

    expect(
      screen.getByRole("heading", { name: "Darstellung" }),
    ).toBeInTheDocument();

    const group = screen.getByRole("group", { name: "Farbschema" });

    expect(
      within(group)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Hell", "Dunkel", "System"]);
  });

  it("offers light, dark and system in English", () => {
    renderCard(LANGUAGE.ENGLISH);

    expect(
      screen.getByRole("heading", { name: "Appearance" }),
    ).toBeInTheDocument();

    const group = screen.getByRole("group", { name: "Color scheme" });

    expect(
      within(group)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Light", "Dark", "System"]);
  });

  it("marks the system theme of a new account as chosen", () => {
    renderCard();

    expect(screen.getByRole("button", { name: "System" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Hell" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Dunkel" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("marks the stored theme of the account as chosen", () => {
    renderCard(LANGUAGE.GERMAN, { ...DEFAULT_USER_SETTINGS, theme: "dark" });

    expect(screen.getByRole("button", { name: "Dunkel" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows the choice at once and submits all settings with the new theme", async () => {
    const user = userEvent.setup();
    const submit = renderCard();

    await user.click(screen.getByRole("button", { name: "Dunkel" }));

    expect(screen.getByRole("button", { name: "Dunkel" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[1]).toEqual({ method: "post" });
    expect(readSubmission(submit)).toMatchObject({
      intent: "update-settings",
      language: "de",
      theme: "dark",
    });
  });

  it("can be operated with the keyboard alone", async () => {
    const user = userEvent.setup();
    const submit = renderCard();

    await user.tab();
    expect(screen.getByRole("button", { name: "Hell" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Dunkel" })).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(readSubmission(submit).theme).toBe("dark");

    await user.tab();
    expect(screen.getByRole("button", { name: "System" })).toHaveFocus();

    await user.keyboard(" ");

    expect(submit).toHaveBeenCalledTimes(2);
    expect(
      Object.fromEntries((submit.mock.calls[1]?.[0] as FormData).entries()),
    ).toMatchObject({ theme: "system" });
  });

  it("states how the system theme works", () => {
    renderCard();

    expect(
      screen.getByText(/System übernimmt die Einstellung Ihres Geräts/u),
    ).toBeInTheDocument();
  });
});
