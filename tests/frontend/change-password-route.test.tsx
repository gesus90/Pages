// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  RouterProvider,
  useActionData,
  useNavigation,
} from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/auth.server", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));
vi.mock("@/app/lib/session.server", () => ({ getSessionToken: vi.fn() }));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useActionData: vi.fn(),
  useNavigation: vi.fn(),
}));

import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { createI18n } from "@/app/lib/i18n";
import { getApplicationServices } from "@/app/lib/services.server";
import { getSessionToken } from "@/app/lib/session.server";
import ChangePasswordRoute, {
  action,
  loader,
} from "@/app/routes/change-password";
import { LANGUAGE } from "@/language/Language";
import { createUser } from "../helpers/factories";

import type { PasswordChangeOutcome } from "@/app/lib/settings-actions/settings-action-support.server";

function requestArguments(method = "POST"): Parameters<typeof action>[0] {
  return {
    context: {},
    params: {},
    request: new Request("http://pages.invalid/change-password", {
      method,
      ...(method === "POST"
        ? {
            body: new URLSearchParams({
              currentPassword: "temporary-secret",
              newPassword: "chosen-password",
              passwordConfirmation: "chosen-password",
            }),
          }
        : {}),
    }),
  } as unknown as Parameters<typeof action>[0];
}

describe("mandatory password route", () => {
  it.each([null, createUser()])(
    "redirects accounts that do not need this route: %j",
    async (user) => {
      vi.mocked(getAuthenticatedUser).mockResolvedValue(user);
      const failure = await loader(requestArguments("GET")).catch(
        (error: unknown) => error,
      );
      expect((failure as Response).headers.get("Location")).toBe(
        user ? "/dashboard" : "/login",
      );
      await expect(action(requestArguments())).rejects.toBeInstanceOf(Response);
    },
  );

  it("admits the required change without exposing account data", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(
      createUser({ mustChangePassword: true }),
    );
    await expect(loader(requestArguments("GET"))).resolves.toBeNull();
  });

  it("rejects unsupported methods", async () => {
    const failure = await action(requestArguments("DELETE")).catch(
      (error: unknown) => error,
    );
    expect((failure as Response).status).toBe(405);
    expect((failure as Response).headers.get("Allow")).toBe("POST");
  });

  it.each(["success", "invalidCurrent", "unchanged"] as const)(
    "handles %s after verifying the current password",
    async (outcome) => {
      vi.mocked(getAuthenticatedUser).mockResolvedValue(
        createUser({ mustChangePassword: true }),
      );
      const changePassword = vi.fn().mockResolvedValue(outcome);
      vi.mocked(getApplicationServices).mockResolvedValue({
        authService: { changePassword },
      } as unknown as Awaited<ReturnType<typeof getApplicationServices>>);
      vi.mocked(getSessionToken).mockResolvedValue("current-session");
      const result = await action(requestArguments());
      expect(changePassword).toHaveBeenCalledWith(
        "admin",
        "temporary-secret",
        "chosen-password",
        "current-session",
      );
      if (result instanceof Response) {
        expect(result.headers.get("Location")).toBe("/dashboard");
      } else {
        expect(result.data.outcome).toBe(outcome);
        expect(result.init?.status).toBe(400);
      }
    },
  );
});

function renderRoute(
  outcome?: PasswordChangeOutcome,
  submitting = false,
): void {
  vi.mocked(useActionData).mockReturnValue(outcome ? { outcome } : undefined);
  vi.mocked(useNavigation).mockReturnValue({
    state: submitting ? "submitting" : "idle",
  } as ReturnType<typeof useNavigation>);
  const router = createMemoryRouter(
    [{ path: "/change-password", element: <ChangePasswordRoute /> }],
    { initialEntries: ["/change-password"] },
  );
  render(
    <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

describe("mandatory password screen", () => {
  it("renders the password fields and logout without workspace links", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Passwort ändern" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Aktuelles Passwort")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expect(screen.getByLabelText("Neues Passwort")).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByLabelText("Neues Passwort bestätigen")).toBeRequired();
    expect(
      screen.getByRole("button", { name: "Logout" }).closest("form"),
    ).toHaveAttribute("action", "/logout");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("shows actionable errors and disables a pending submission", () => {
    renderRoute("invalidCurrent", true);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Das aktuelle Passwort ist falsch.",
    );
    expect(
      screen.getByRole("button", { name: "Wird geändert …" }),
    ).toBeDisabled();
  });

  it("does not display an error for a successful submission", () => {
    renderRoute("success");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
