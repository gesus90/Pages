import { screen } from "@testing-library/react";
import { data } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import { requireUserManagement } from "@/app/lib/auth.server";
import { handleUsersAction } from "@/app/lib/user-actions/user-actions.server";
import UsersRoute, { action, loader, middleware } from "@/app/routes/users";

import {
  ACTOR,
  formPost,
  pagesRequest,
  renderRoute,
  responseOf,
  routeArguments,
} from "./route-fixture";

import type { UsersActionData } from "@/app/lib/user-actions/user-action-support.server";

const services = vi.hoisted(() => ({
  administrationService: { pageData: vi.fn() },
  wikiService: { listAllPlaceholders: vi.fn() },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => services,
}));
vi.mock("@/app/lib/user-actions/user-actions.server", () => ({
  handleUsersAction: vi.fn(),
}));
vi.mock("@/app/components/users/management-workspace", () => ({
  ManagementWorkspace: (props: {
    readonly directory: { readonly users: readonly unknown[] };
    readonly privateWikiPages: unknown;
  }): React.ReactElement => (
    <output>{`${props.directory.users.length} ${JSON.stringify(props.privateWikiPages)}`}</output>
  ),
}));

beforeEach(() => {
  vi.mocked(handleUsersAction).mockReset();
});

it("checks management access in its middleware", () => {
  expect(middleware).toEqual([requireUserManagement]);
});

it("requires the user of the authentication middleware", async () => {
  await expect(
    loader(routeArguments(pagesRequest("/users"), { user: null })),
  ).rejects.toThrow("Authenticated middleware did not provide a user.");
});

it("loads the directory together with the private wiki pages", async () => {
  services.administrationService.pageData.mockResolvedValue({ users: [] });
  services.wikiService.listAllPlaceholders.mockResolvedValue({ "user-2": [] });

  await expect(
    loader(routeArguments(pagesRequest("/users"), { user: ACTOR })),
  ).resolves.toEqual({ users: [], privateWikiPages: { "user-2": [] } });
  expect(services.administrationService.pageData).toHaveBeenCalledWith(
    "user-1",
  );
});

it("accepts only posts", async () => {
  const response = await responseOf(
    action(routeArguments(pagesRequest("/users"), { user: ACTOR })),
  );

  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("POST");
});

it("refuses a post without a signed-in user", async () => {
  const response = await responseOf(
    action(routeArguments(formPost("/users"), { user: null })),
  );

  expect(response.status).toBe(403);
  expect(handleUsersAction).not.toHaveBeenCalled();
});

it("hands the intent and the form to the user actions", async () => {
  const outcome = data<UsersActionData>({ ok: true, intent: "save-group" });
  vi.mocked(handleUsersAction).mockResolvedValue(outcome);

  await expect(
    action(
      routeArguments(formPost("/users", { intent: "create-user" }), {
        user: ACTOR,
      }),
    ),
  ).resolves.toBe(outcome);
  const [call] = vi.mocked(handleUsersAction).mock.calls;
  expect(call?.[0]).toBe("create-user");
  expect(call?.[1].actor).toBe(ACTOR);
  expect(call?.[1].services).toBe(services);
});

it("renders the management workspace", () => {
  renderRoute(UsersRoute, {
    loaderData: { users: [{ id: "user-2" }], privateWikiPages: {} },
  });

  expect(screen.getByRole("status").textContent).toBe("1 {}");
});
