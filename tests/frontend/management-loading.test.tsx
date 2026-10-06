// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  RouterProvider,
  useNavigation,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ManagementTable } from "@/app/components/users/management-table";
import { createI18n } from "@/app/lib/i18n";

vi.mock("react-router", async (original) => ({
  ...(await original<typeof import("react-router")>()),
  useNavigation: vi.fn(),
}));

describe("management loading state", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("delays placeholders by 200 ms and retains the current table while loading", () => {
    vi.useFakeTimers();
    const idle = {
      state: "idle" as const,
      location: undefined,
      formAction: undefined,
      formMethod: undefined,
      formEncType: undefined,
      formData: undefined,
      json: undefined,
      text: undefined,
    };
    vi.mocked(useNavigation).mockReturnValue(idle);
    const router = createMemoryRouter([
      {
        path: "/",
        element: (
          <ManagementTable>
            <tbody>
              <tr>
                <td>Stored user</td>
              </tr>
            </tbody>
          </ManagementTable>
        ),
      },
    ]);
    const view = render(
      <I18nextProvider i18n={createI18n("de")}>
        <RouterProvider router={router} />
      </I18nextProvider>,
    );
    vi.mocked(useNavigation).mockReturnValue({
      ...idle,
      state: "loading",
      location: {
        pathname: "/",
        search: "",
        hash: "",
        state: null,
        key: "loading",
      },
    });
    view.rerender(
      <I18nextProvider i18n={createI18n("de")}>
        <RouterProvider router={router} />
      </I18nextProvider>,
    );
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("status")).toHaveAccessibleName(
      "Benutzerverwaltung wird geladen …",
    );
    expect(screen.getByText("Stored user")).toBeInTheDocument();
    vi.mocked(useNavigation).mockReturnValue(idle);
    view.rerender(
      <I18nextProvider i18n={createI18n("de")}>
        <RouterProvider router={router} />
      </I18nextProvider>,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
