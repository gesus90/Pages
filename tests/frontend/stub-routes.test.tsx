// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();

  return {
    ...actual,
    useActionData: vi.fn(),
    useLoaderData: vi.fn(),
    useNavigation: vi.fn(),
    useSubmit: vi.fn(() => vi.fn()),
  };
});

import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  RouterProvider,
  useLoaderData,
  useNavigation,
} from "react-router";

import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";
import ProjectRoute from "@/app/routes/project";
import SettingsRoute from "@/app/routes/settings-profile";

import { createSettingsLoaderData } from "../helpers/settings-loader-data";

const mockedLoaderData = vi.mocked(useLoaderData);
const mockedNavigation = vi.mocked(useNavigation);

function renderWithRouter(element: React.ReactElement): void {
  const i18n = createI18n(LANGUAGE.GERMAN);
  const router = createMemoryRouter([{ element, path: "/" }], {
    initialEntries: ["/"],
  });

  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

describe("future route boundaries", () => {
  it("renders the settings screen with its language options", () => {
    mockedLoaderData.mockReturnValue(createSettingsLoaderData());
    mockedNavigation.mockReturnValue({
      state: "idle",
    } as ReturnType<typeof useNavigation>);
    renderWithRouter(<SettingsRoute />);

    expect(
      screen.getByRole("heading", { name: "Persönlicher Bereich" }),
    ).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Sprache" })).toBeVisible();
  });

  it("renders an empty project shell", () => {
    const { container } = render(<ProjectRoute />);

    expect(container.querySelector("main")).not.toBeNull();
  });
});
