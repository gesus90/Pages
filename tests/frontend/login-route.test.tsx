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
import { LANGUAGE } from "@/language/Language";
import LoginRoute from "@/app/routes/login";

const mockedActionData = vi.mocked(useActionData);
const mockedLoaderData = vi.mocked(useLoaderData);
const mockedNavigation = vi.mocked(useNavigation);
const mockedSubmit = vi.mocked(useSubmit);

function renderLogin(actionError?: string, submitting = false): void {
  mockedActionData.mockReturnValue(
    actionError ? { error: actionError } : undefined,
  );
  mockedLoaderData.mockReturnValue({ language: LANGUAGE.GERMAN });
  mockedNavigation.mockReturnValue({
    location: undefined,
    state: submitting ? "submitting" : "idle",
  } as unknown as ReturnType<typeof useNavigation>);
  mockedSubmit.mockReturnValue(vi.fn());

  const i18n = createI18n(LANGUAGE.GERMAN);
  const router = createMemoryRouter(
    [{ element: <LoginRoute />, path: "/login" }],
    { initialEntries: ["/login"] },
  );

  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

describe("LoginRoute", () => {
  it("renders the German sign-in form", () => {
    renderLogin();

    expect(
      screen.getByRole("heading", { name: "Willkommen zurück" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Benutzername")).toBeInTheDocument();
    expect(screen.getByLabelText("Passwort")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Anmelden" }),
    ).toBeInTheDocument();
  });

  it("renders the setup hint and version footer", () => {
    renderLogin();

    expect(screen.getByText("Erstmalige Einrichtung?")).toBeInTheDocument();
    expect(screen.getByText("Pages v0.1.0")).toBeInTheDocument();
    expect(
      screen.getByText("Einfach. Organisiert. Produktiv."),
    ).toBeInTheDocument();
  });

  it("accepts typed credentials", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText("Benutzername"), "admin");
    await user.type(screen.getByLabelText("Passwort"), "secret");

    expect(screen.getByLabelText("Benutzername")).toHaveValue("admin");
    expect(screen.getByLabelText("Passwort")).toHaveValue("secret");
  });

  it("toggles password visibility", async () => {
    const user = userEvent.setup();
    renderLogin();

    const password = screen.getByLabelText("Passwort");
    expect(password.getAttribute("type")).toBe("password");

    await user.click(screen.getByRole("button", { name: "Passwort anzeigen" }));

    expect(screen.getByLabelText("Passwort").getAttribute("type")).toBe("text");
    expect(
      screen.getByRole("button", { name: "Passwort verbergen" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Passwort verbergen" }),
    );

    expect(screen.getByLabelText("Passwort").getAttribute("type")).toBe(
      "password",
    );
  });

  it("shows the server-side credential error", () => {
    renderLogin("invalidCredentials");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Benutzername oder Passwort ist falsch.",
    );
  });

  it("disables submission while the form is submitting", () => {
    renderLogin(undefined, true);

    const submit = screen.getByRole("button", { name: "Wird angemeldet …" });

    expect(submit).toBeDisabled();
  });

  it("preselects the loader language in the switcher", () => {
    mockedActionData.mockReturnValue(undefined);
    mockedLoaderData.mockReturnValue({ language: LANGUAGE.ENGLISH });
    mockedNavigation.mockReturnValue({
      location: undefined,
      state: "idle",
    } as unknown as ReturnType<typeof useNavigation>);
    mockedSubmit.mockReturnValue(vi.fn());

    const i18n = createI18n(LANGUAGE.ENGLISH);
    const router = createMemoryRouter(
      [{ element: <LoginRoute />, path: "/login" }],
      { initialEntries: ["/login"] },
    );

    render(
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>,
    );

    expect(
      screen.getByRole("combobox", { name: "Language" }),
    ).toHaveTextContent("EN");
  });

  it("submits the language form when the selection changes", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    mockedActionData.mockReturnValue(undefined);
    mockedLoaderData.mockReturnValue({ language: LANGUAGE.GERMAN });
    mockedNavigation.mockReturnValue({
      location: undefined,
      state: "idle",
    } as unknown as ReturnType<typeof useNavigation>);
    mockedSubmit.mockReturnValue(submit);

    const i18n = createI18n(LANGUAGE.GERMAN);
    const router = createMemoryRouter(
      [{ element: <LoginRoute />, path: "/login" }],
      { initialEntries: ["/login"] },
    );

    render(
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>,
    );

    await user.click(screen.getByRole("combobox", { name: "Sprache" }));
    await user.click(await screen.findByRole("option", { name: "EN" }));

    await waitFor(() => {
      expect(submit).toHaveBeenCalledTimes(1);
    });
  });
});
