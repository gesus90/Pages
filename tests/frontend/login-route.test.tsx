import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/auth.server", () => ({
  authenticatedUserContext: {},
  getAuthenticatedUser: vi.fn(),
  parseCredentials: vi.fn(),
  requireAuthenticatedUser: vi.fn(),
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

vi.mock("@/app/lib/session.server", () => ({
  destroySessionCookie: vi.fn(),
  getSessionToken: vi.fn(),
  sessionCookie: {
    serialize: vi.fn(),
  },
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();

  return {
    ...actual,
    useActionData: vi.fn(),
    useNavigation: vi.fn(),
  };
});

import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  RouterProvider,
  useActionData,
  useNavigation,
} from "react-router";

import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";
import LoginRoute from "@/app/routes/login";

const mockedActionData = vi.mocked(useActionData);
const mockedNavigation = vi.mocked(useNavigation);

function renderLogin(actionError?: string, submitting = false): void {
  mockedActionData.mockReturnValue(
    actionError ? { error: actionError } : undefined,
  );
  mockedNavigation.mockReturnValue({
    location: undefined,
    state: submitting ? "submitting" : "idle",
  } as unknown as ReturnType<typeof useNavigation>);

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
});
