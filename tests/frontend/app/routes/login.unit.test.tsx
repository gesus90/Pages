import { fireEvent, screen } from "@testing-library/react";
import { Form } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { sessionCookie } from "@/app/lib/session.server";
import LoginRoute, { action, loader } from "@/app/routes/login";
import { TooManyLoginAttemptsError } from "@/backend/auth/LoginThrottle";
import { logCaughtError } from "@/backend/logging/Logger";

import {
  ACTOR,
  formPost,
  i18n,
  pagesRequest,
  renderRoute,
  responseOf,
  routeArguments,
} from "./route-fixture";

const services = vi.hoisted(() => ({
  authService: { login: vi.fn() },
  instanceSettingsService: { getBranding: vi.fn() },
}));

vi.mock("@/app/lib/auth.server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAuthenticatedUser: vi.fn(),
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => services,
}));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));
vi.mock("@/app/components/login/login-form", () => ({
  LoginForm: (props: {
    readonly error: string | undefined;
    readonly isSubmitting: boolean;
  }): React.ReactElement => (
    <Form method="post">
      <output>{`${props.error ?? "none"} ${props.isSubmitting ? "submitting" : "idle"}`}</output>
      <button type="submit">Sign in</button>
    </Form>
  ),
}));
vi.mock("@/app/components/login/language-switcher", () => ({
  LanguageSwitcher: (props: {
    readonly language: string;
    readonly redirectTo: string;
  }): React.ReactElement => (
    <p>{`language ${props.language} ${props.redirectTo}`}</p>
  ),
}));
vi.mock("@/app/components/common/instance-brand", () => ({
  InstanceBrand: (props: {
    readonly branding: { readonly companyName: string };
  }): React.ReactElement => <p>{props.branding.companyName}</p>,
}));
vi.mock("@/app/components/auth/auth-footer", () => ({
  AuthFooter: (): React.ReactElement => <footer>footer</footer>,
}));
vi.mock("@/app/components/login/login-setup-hint", () => ({
  LoginSetupHint: (): React.ReactElement => <p>setup hint</p>,
}));

const BRANDING = { companyName: "Acme", logoUrl: null };
const PAIR = "/pair?code=BCDFGHJK";

beforeEach(() => {
  vi.mocked(getAuthenticatedUser).mockReset();
  vi.mocked(getAuthenticatedUser).mockResolvedValue(null);
  services.authService.login.mockReset();
  services.instanceSettingsService.getBranding.mockResolvedValue(BRANDING);
});

/**
 * A login post with the given credentials.
 *
 * @param fields - Submitted fields.
 * @param path - Login address with its query.
 */
function loginPost(
  fields: Record<string, string> = { username: "ada", password: "secret" },
  path = "/login",
): Request {
  return formPost(path, fields);
}

it("sends a signed-in visitor on to the validated destination", async () => {
  vi.mocked(getAuthenticatedUser).mockResolvedValue(ACTOR);

  const response = await responseOf(
    loader(
      routeArguments(
        pagesRequest(`/login?returnTo=${encodeURIComponent(PAIR)}`),
      ),
    ),
  );

  expect(response.headers.get("Location")).toBe(PAIR);
});

it("offers the sign-in in the visitor's language", async () => {
  await expect(
    loader(
      routeArguments(
        pagesRequest("/login", { headers: { "Accept-Language": "en" } }),
      ),
    ),
  ).resolves.toEqual({
    branding: BRANDING,
    language: "en",
    loginPath: "/login",
  });
});

it("keeps a pairing destination in the sign-in path", async () => {
  const loaded = await loader(
    routeArguments(pagesRequest(`/login?returnTo=${encodeURIComponent(PAIR)}`)),
  );

  expect(loaded).toMatchObject({
    loginPath: `/login?returnTo=${encodeURIComponent(PAIR)}`,
  });
});

it("accepts only posts", async () => {
  const response = await responseOf(
    action(routeArguments(pagesRequest("/login"))),
  );

  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("POST");
});

it("refuses incomplete credentials before asking the service", async () => {
  const result = await action(routeArguments(loginPost({ username: "ada" })));

  expect(result).toMatchObject({
    data: { error: "invalidCredentials" },
    init: { status: 400 },
  });
  expect(services.authService.login).not.toHaveBeenCalled();
});

it("tells a throttled visitor when to try again", async () => {
  const throttled = new TooManyLoginAttemptsError(42);
  services.authService.login.mockRejectedValue(throttled);

  const result = await action(routeArguments(loginPost()));

  expect(result).toMatchObject({
    data: { error: "tooManyAttempts" },
    init: { status: 429, headers: { "Retry-After": "42" } },
  });
  expect(logCaughtError).toHaveBeenCalledWith("login", throttled);
});

it("passes unexpected login failures on", async () => {
  services.authService.login.mockRejectedValue(new Error("database down"));

  await expect(action(routeArguments(loginPost()))).rejects.toThrow(
    "database down",
  );
});

it("refuses wrong credentials", async () => {
  services.authService.login.mockResolvedValue(null);

  const result = await action(
    routeArguments(
      pagesRequest("/login", {
        method: "POST",
        headers: { "User-Agent": "Browser", "X-Forwarded-For": "192.0.2.7" },
        body: new URLSearchParams({ username: " ada ", password: "secret" }),
      }),
    ),
  );

  expect(result).toMatchObject({
    data: { error: "invalidCredentials" },
    init: { status: 401 },
  });
  expect(services.authService.login.mock.calls[0]?.slice(0, 3)).toEqual([
    "ada",
    "secret",
    "Browser",
  ]);
});

it("signs a valid login in with a session cookie", async () => {
  services.authService.login.mockResolvedValue({ sessionToken: "token-1" });

  const response = await responseOf(
    action(
      routeArguments(
        loginPost(undefined, `/login?returnTo=${encodeURIComponent(PAIR)}`),
      ),
    ),
  );

  expect(response.headers.get("Location")).toBe(PAIR);
  await expect(
    sessionCookie.parse(response.headers.get("Set-Cookie")),
  ).resolves.toBe("token-1");
});

it("renders the sign-in with switcher, brand and the last error", async () => {
  let finish: () => void = () => undefined;
  renderRoute(LoginRoute, {
    loaderData: { branding: BRANDING, language: "en", loginPath: "/login" },
    actionData: { error: "invalidCredentials" },
    action: async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { error: "tooManyAttempts" };
    },
  });

  expect(screen.getByText("language en /login")).toBeTruthy();
  expect(screen.getByText("Acme")).toBeTruthy();
  expect(screen.getByRole("heading").textContent).toBe(i18n.t("login.title"));
  expect(screen.getByText("setup hint")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe(
    "invalidCredentials idle",
  );

  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(
    (await screen.findByText("invalidCredentials submitting")).tagName,
  ).toBe("OUTPUT");
  finish();
  expect((await screen.findByText("tooManyAttempts idle")).tagName).toBe(
    "OUTPUT",
  );
});
