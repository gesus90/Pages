// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  data,
  Form,
  RouterContextProvider,
  RouterProvider,
} from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { createI18n } from "@/app/lib/i18n";
import { handleChangePassword } from "@/app/lib/settings-actions/settings-account-actions.server";
import ChangePasswordRoute, {
  action,
  loader,
} from "@/app/routes/change-password";

import type { PasswordChangeActionData } from "@/app/lib/settings-actions/settings-account-actions.server";
import type { User } from "@/definition/User";

// The Frontend setup registers this cleanup; the Node scope repeats it here.
afterEach(cleanup);

const services = vi.hoisted(() => ({ marker: "services" }));
vi.mock("@/app/lib/auth.server", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => services,
}));
vi.mock("@/app/lib/settings-actions/settings-account-actions.server", () => ({
  handleChangePassword: vi.fn(),
}));
vi.mock("@/app/components/auth/required-password-form", () => ({
  RequiredPasswordForm: (props: {
    readonly outcome: string | undefined;
    readonly isSubmitting: boolean;
  }): React.ReactElement => (
    <Form method="post">
      <output>{`${props.outcome ?? "none"} ${props.isSubmitting ? "submitting" : "idle"}`}</output>
      <button type="submit">Save</button>
    </Form>
  ),
}));

const i18n = createI18n("en");
const USER: User = {
  id: "user-1",
  username: "ada",
  displayName: "Ada",
  role: "employee",
  isActive: true,
  mustChangePassword: true,
};

beforeEach(() => {
  vi.mocked(getAuthenticatedUser).mockReset();
  vi.mocked(handleChangePassword).mockReset();
});

/** The arguments React Router hands to the loader and the action. */
function routeArguments(
  request: Request,
): Parameters<typeof loader>[0] & Parameters<typeof action>[0] {
  return {
    request,
    params: {},
    context: new RouterContextProvider(),
    url: new URL(request.url),
    pattern: "/change-password",
  };
}

/** Runs a route function and returns the response it threw or returned. */
async function responseOf(work: Promise<unknown>): Promise<Response> {
  try {
    const result = await work;
    if (result instanceof Response) return result;
  } catch (error: unknown) {
    if (error instanceof Response) return error;
    throw error;
  }
  throw new Error("Expected a response.");
}

/** A form post of the password change. */
function post(path = "/change-password"): Request {
  return new Request(`http://pages.invalid${path}`, {
    method: "POST",
    body: new URLSearchParams({ currentPassword: "old", newPassword: "new" }),
  });
}

it("sends a signed-out visitor to the login with the way back", async () => {
  vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

  const response = await responseOf(
    loader(
      routeArguments(
        new Request("http://pages.invalid/change-password?returnTo=/pair"),
      ),
    ),
  );

  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("/login?returnTo=%2Fpair");
});

it("sends a user without a required change on to the destination", async () => {
  vi.mocked(getAuthenticatedUser).mockResolvedValue({
    ...USER,
    mustChangePassword: false,
  });

  const response = await responseOf(
    loader(routeArguments(new Request("http://pages.invalid/change-password"))),
  );

  expect(response.headers.get("Location")).toBe("/dashboard");
});

it("lets a user whose password must be replaced see the page", async () => {
  vi.mocked(getAuthenticatedUser).mockResolvedValue(USER);

  await expect(
    loader(routeArguments(new Request("http://pages.invalid/change-password"))),
  ).resolves.toBeNull();
});

it("accepts only form posts", async () => {
  const response = await responseOf(
    action(routeArguments(new Request("http://pages.invalid/change-password"))),
  );

  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("POST");
  expect(getAuthenticatedUser).not.toHaveBeenCalled();
});

it("redirects to the destination after a successful change", async () => {
  vi.mocked(getAuthenticatedUser).mockResolvedValue(USER);
  vi.mocked(handleChangePassword).mockResolvedValue(
    data({ intent: "change-password", outcome: "success" }),
  );

  const response = await responseOf(
    action(routeArguments(post("/change-password?returnTo=/pair"))),
  );

  expect(response.headers.get("Location")).toBe("/pair");
  const [call] = vi.mocked(handleChangePassword).mock.calls;
  expect(call?.[0].user).toBe(USER);
  expect(call?.[0].services).toBe(services);
  expect(call?.[0].formData.get("newPassword")).toBe("new");
});

it("returns a refused change to the form", async () => {
  const refusal = data<PasswordChangeActionData>(
    { intent: "change-password", outcome: "invalidCurrent" },
    { status: 400 },
  );
  vi.mocked(getAuthenticatedUser).mockResolvedValue(USER);
  vi.mocked(handleChangePassword).mockResolvedValue(refusal);

  await expect(action(routeArguments(post()))).resolves.toBe(refusal);
});

it("refuses a post from a signed-out visitor before changing anything", async () => {
  vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

  const response = await responseOf(action(routeArguments(post())));

  expect(response.headers.get("Location")).toBe("/login?returnTo=%2Fdashboard");
  expect(handleChangePassword).not.toHaveBeenCalled();
});

it("shows the required change with the outcome of the last submission", async () => {
  let finish: () => void = () => undefined;
  const router = createMemoryRouter([
    {
      path: "/",
      Component: ChangePasswordRoute,
      action: async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { intent: "change-password", outcome: "invalidCurrent" };
      },
    },
  ]);
  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );

  expect(
    screen.getByText(i18n.t("settings.security.password.dialogTitle")),
  ).toBeTruthy();
  expect(
    screen.getByText(i18n.t("settings.security.password.requiredChange")),
  ).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("none idle");

  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByText("none submitting")).tagName).toBe("OUTPUT");

  finish();
  expect((await screen.findByText("invalidCurrent idle")).tagName).toBe(
    "OUTPUT",
  );
});
