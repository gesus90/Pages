import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();

  return {
    ...actual,
    useLoaderData: vi.fn(),
    useSubmit: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
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
import AuthenticatedRoute from "@/app/routes/authenticated";

import type { User } from "@/definition/User";

const mockedLoaderData = vi.mocked(useLoaderData);

function createUser(): User {
  return { displayName: "Admin", id: "user-1", username: "admin" };
}

describe("AuthenticatedRoute", () => {
  it("renders the workspace shell for the loader user", () => {
    mockedLoaderData.mockReturnValue({ user: createUser() });
    const i18n = createI18n(LANGUAGE.GERMAN);
    const router = createMemoryRouter(
      [
        {
          children: [{ element: <p>Kindroute</p>, path: "dashboard" }],
          element: <AuthenticatedRoute />,
          path: "/",
        },
      ],
      { initialEntries: ["/dashboard"] },
    );

    render(
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>,
    );

    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Kindroute")).toBeInTheDocument();
  });
});
