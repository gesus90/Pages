// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { handleSetupAction } from "@/app/lib/setup/setup-actions.server";
import SetupRoute, {
  action,
  clientAction,
  loader,
  shouldRevalidate,
} from "@/app/routes/setup";

import {
  formPost,
  pagesRequest,
  renderRoute,
  responseOf,
  routeArguments,
} from "./route-fixture";

import type { ShouldRevalidateFunctionArgs } from "react-router";
import type { SetupActionData } from "@/app/lib/setup/setup-action-data";

// The Frontend setup registers this cleanup; the Node scope repeats it here.
afterEach(cleanup);

const runtime = vi.hoisted(() => ({
  isSetupPending: vi.fn(),
  verifySetupToken: vi.fn(),
  getSuggestedDatabasePath: vi.fn(),
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));
vi.mock("@/backend/runtime/PagesRuntime", () => ({
  getPagesRuntime: async (): Promise<unknown> => runtime,
}));
vi.mock("@/app/lib/setup/setup-actions.server", () => ({
  handleSetupAction: vi.fn(),
}));
vi.mock("@/app/components/login/language-switcher", () => ({
  LanguageSwitcher: (props: {
    readonly language: string;
    readonly redirectTo: string;
  }): React.ReactElement => (
    <p>{`language ${props.language} ${props.redirectTo}`}</p>
  ),
}));
vi.mock("@/app/components/auth/auth-footer", () => ({
  AuthFooter: (): React.ReactElement => <footer>footer</footer>,
}));
vi.mock("@/app/components/setup/setup-completed", () => ({
  SetupCompleted: (): React.ReactElement => <p>completed</p>,
}));
vi.mock("@/app/components/setup/setup-wizard", () => ({
  SetupWizard: (props: {
    readonly initialAccess: { readonly token: string } | null;
    readonly hasRejectedToken: boolean;
  }): React.ReactElement => (
    <p>{`wizard ${props.initialAccess?.token ?? "none"} ${String(props.hasRejectedToken)}`}</p>
  ),
}));

beforeEach(() => {
  runtime.isSetupPending.mockReturnValue(true);
  runtime.verifySetupToken.mockImplementation(
    (token: string) => token === "good",
  );
  runtime.getSuggestedDatabasePath.mockReturnValue("/data/pages.duckdb");
  vi.mocked(handleSetupAction).mockReset();
});

/**
 * Revalidation arguments after a submission with one intent.
 *
 * @param intent - The submitted intent, if any.
 */
function revalidation(intent?: string): ShouldRevalidateFunctionArgs {
  const formData = new FormData();
  if (intent !== undefined) formData.set("intent", intent);
  return {
    currentUrl: new URL("http://pages.invalid/setup"),
    currentParams: {},
    nextUrl: new URL("http://pages.invalid/setup"),
    nextParams: {},
    formData,
    defaultShouldRevalidate: true,
  };
}

/**
 * Client action arguments around a server action.
 *
 * @param intent - The submitted intent.
 * @param serverAction - The server round trip.
 */
function clientArguments(
  intent: string,
  serverAction: () => Promise<never>,
): Parameters<typeof clientAction>[0] {
  return {
    ...routeArguments(formPost("/setup", { intent })),
    serverAction,
  };
}

it("offers only the way to sign in after the setup", async () => {
  runtime.isSetupPending.mockReturnValue(false);

  await expect(
    loader(routeArguments(pagesRequest("/setup?token=good"))),
  ).resolves.toEqual({ status: "completed" });
});

it("reveals the database path only with a valid token", async () => {
  await expect(
    loader(routeArguments(pagesRequest("/setup?token=good"))),
  ).resolves.toEqual({
    access: { suggestedDatabasePath: "/data/pages.duckdb", token: "good" },
    hasRejectedToken: false,
    status: "pending",
  });
});

it("tells the wizard whether a token was rejected", async () => {
  await expect(
    loader(routeArguments(pagesRequest("/setup?token=bad"))),
  ).resolves.toEqual({
    access: null,
    hasRejectedToken: true,
    status: "pending",
  });
  await expect(loader(routeArguments(pagesRequest("/setup")))).resolves.toEqual(
    {
      access: null,
      hasRejectedToken: false,
      status: "pending",
    },
  );
  expect(runtime.getSuggestedDatabasePath).not.toHaveBeenCalled();
});

it("accepts only posts", async () => {
  const response = await responseOf(
    action(routeArguments(pagesRequest("/setup"))),
  );

  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("POST");
});

it("hands a post to the setup actions", async () => {
  const outcome = new Response(null, { status: 204 });
  vi.mocked(handleSetupAction).mockResolvedValue(outcome);
  const request = formPost("/setup", { intent: "complete" });

  await expect(action(routeArguments(request))).resolves.toBe(outcome);
  expect(handleSetupAction).toHaveBeenCalledWith(runtime, request);
});

it("returns the server's answer from the client action", async () => {
  const answer: SetupActionData = {
    intent: "verify-token",
    access: { suggestedDatabasePath: "/data", token: "good" },
  };

  await expect(
    clientAction({
      ...routeArguments(formPost("/setup", { intent: "verify-token" })),
      serverAction: async () => answer,
    }),
  ).resolves.toBe(answer);
});

it("turns a lost connection into an inline network error", async () => {
  await expect(
    clientAction(
      clientArguments("complete", async () => {
        throw new TypeError("Failed to fetch");
      }),
    ),
  ).resolves.toEqual({ error: "network", intent: "complete" });
});

it("passes server responses and unknown intents through", async () => {
  const redirect = new Response(null, { status: 302 });

  await expect(
    clientAction(
      clientArguments("complete", async () => {
        throw redirect;
      }),
    ),
  ).rejects.toBe(redirect);
  await expect(
    clientAction(
      clientArguments("unknown", async () => {
        throw new TypeError("Failed to fetch");
      }),
    ),
  ).rejects.toThrow("Failed to fetch");
});

it("skips reloading after token and path checks", () => {
  expect(shouldRevalidate(revalidation("verify-token"))).toBe(false);
  expect(shouldRevalidate(revalidation("check-database-path"))).toBe(false);
  expect(shouldRevalidate(revalidation("complete"))).toBe(true);
});

it("shows the wizard in the language of the root data", () => {
  renderRoute(SetupRoute, {
    loaderData: {
      access: { suggestedDatabasePath: "/data", token: "good" },
      hasRejectedToken: false,
      status: "pending",
    },
    parent: { id: "root", loaderData: { language: "en" } },
    url: "/setup?token=good",
    path: "setup",
  });

  expect(screen.getByText("language en /setup?token=good")).toBeTruthy();
  expect(screen.getByText("wizard good false")).toBeTruthy();
  expect(screen.getByText("footer")).toBeTruthy();
});

it("falls back to German and shows the completed setup", () => {
  renderRoute(SetupRoute, {
    loaderData: { status: "completed" },
    url: "/setup",
    path: "/setup",
  });

  expect(screen.getByText("language de /setup")).toBeTruthy();
  expect(screen.getByText("completed")).toBeTruthy();
});
