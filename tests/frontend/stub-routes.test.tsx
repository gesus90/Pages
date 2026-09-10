// @vitest-environment jsdom
import { render } from "@testing-library/react";
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
} from "react-router";

import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";
import ProjectRoute from "@/app/routes/project";
import SettingsRoute from "@/app/routes/settings";
import WikiRoute from "@/app/routes/wiki";

const mockedLoaderData = vi.mocked(useLoaderData);

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
    mockedLoaderData.mockReturnValue({ language: LANGUAGE.GERMAN });
    renderWithRouter(<SettingsRoute />);

    expect(document.querySelector('[role="heading"], h1')).not.toBeNull();
  });

  it("renders an empty project shell", () => {
    const { container } = render(<ProjectRoute />);

    expect(container.querySelector("main")).not.toBeNull();
  });

  it("renders an empty wiki shell", () => {
    const { container } = render(<WikiRoute />);

    expect(container.querySelector("main")).not.toBeNull();
  });
});
