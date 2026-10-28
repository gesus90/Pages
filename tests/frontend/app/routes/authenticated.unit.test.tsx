import { render, screen } from "@testing-library/react";
import {
  createMemoryRouter,
  RouterContextProvider,
  RouterProvider,
} from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import {
  authenticatedUserContext,
  requireAuthenticatedUser,
} from "@/app/lib/auth.server";
import AuthenticatedRoute, {
  loader,
  middleware,
} from "@/app/routes/authenticated";

import type { User } from "@/definition/User";

const boundaries = vi.hoisted(() => ({
  isOffline: vi.fn<(version: string) => boolean>(),
  services: {
    administrationService: { navigation: vi.fn() },
    settingsService: { getUserSettings: vi.fn() },
    instanceSettingsService: { getBranding: vi.fn() },
    permissionService: { allows: vi.fn() },
    picaSettingsService: { read: vi.fn() },
  },
}));
vi.mock("@/app/lib/auth.server", async () => {
  const router = await import("react-router");
  return {
    authenticatedUserContext: router.createContext<User | null>(null),
    requireAuthenticatedUser: vi.fn(),
  };
});
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => boundaries.services,
}));
vi.mock("@/app/components/common/use-authorization-refresh", () => ({
  useAuthorizationRefresh: boundaries.isOffline,
}));
vi.mock("@/app/components/chat/chat-launcher", () => ({
  ChatLauncher: (): React.ReactElement => <aside>Pica</aside>,
}));
vi.mock("@/app/components/common/app-shell", () => ({
  AppShell: (props: {
    readonly user: User;
    readonly canViewProjects: boolean;
    readonly canViewUsers: boolean;
    readonly isOffline: boolean;
    readonly branding: { readonly companyName: string };
  }): React.ReactElement => (
    <main>
      {[
        props.user.displayName,
        props.branding.companyName,
        `projects:${String(props.canViewProjects)}`,
        `users:${String(props.canViewUsers)}`,
        `offline:${String(props.isOffline)}`,
      ].join(" ")}
    </main>
  ),
}));

const USER: User = {
  id: "user-1",
  username: "ada",
  displayName: "Ada",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const ACCOUNT = { isActive: true, isAdmin: false, mode: "role" };
const BRANDING = { companyName: "Acme", logoUrl: null };

beforeEach(() => {
  const { services } = boundaries;
  services.administrationService.navigation.mockResolvedValue({
    account: ACCOUNT,
    canViewUsers: true,
    version: "v7",
  });
  services.settingsService.getUserSettings.mockResolvedValue({
    dateFormat: "DD.MM.YYYY",
    timezone: "Europe/Berlin",
  });
  services.instanceSettingsService.getBranding.mockResolvedValue(BRANDING);
  services.permissionService.allows.mockResolvedValue(false);
  services.picaSettingsService.read.mockResolvedValue({
    isEnabled: true,
    revision: 3,
  });
  boundaries.isOffline.mockReturnValue(false);
});

/** The loader arguments with a route context that holds the given user. */
function loaderArguments(user: User | null): Parameters<typeof loader>[0] {
  const context = new RouterContextProvider();
  context.set(authenticatedUserContext, user);
  const request = new Request("http://pages.invalid/");
  return {
    context,
    params: {},
    request,
    url: new URL(request.url),
    pattern: "/",
  };
}

it("authenticates every nested workspace route", () => {
  expect(middleware).toEqual([requireAuthenticatedUser]);
});

it("refuses to load without the user of the authentication middleware", async () => {
  await expect(loader(loaderArguments(null))).rejects.toThrow(
    "Authenticated middleware did not provide a user.",
  );
});

it("loads the user, the navigation rights, the region and the branding", async () => {
  await expect(loader(loaderArguments(USER))).resolves.toEqual({
    isPicaEnabled: true,
    branding: BRANDING,
    canViewProjects: false,
    canViewUsers: true,
    region: { dateFormat: "DD.MM.YYYY", timezone: "Europe/Berlin" },
    user: USER,
    authorizationVersion: "v7:pica:3",
    account: ACCOUNT,
  });
  expect(boundaries.services.permissionService.allows).toHaveBeenCalledWith(
    USER,
    "participate_in_projects",
  );
});

/** Renders the route with the given loader data. */
async function renderRoute(isPicaEnabled: boolean): Promise<void> {
  const router = createMemoryRouter([
    {
      path: "/",
      loader: () => ({
        isPicaEnabled,
        branding: BRANDING,
        canViewProjects: true,
        canViewUsers: false,
        region: { dateFormat: "DD.MM.YYYY", timezone: "Europe/Berlin" },
        user: USER,
        authorizationVersion: "v1:pica:1",
        account: ACCOUNT,
      }),
      Component: AuthenticatedRoute,
    },
  ]);
  render(<RouterProvider router={router} />);
  await screen.findByRole("main");
}

it("shows the workspace navigation with Pica when Pica is enabled", async () => {
  boundaries.isOffline.mockReturnValue(true);

  await renderRoute(true);

  expect(screen.getByRole("main").textContent).toBe(
    "Ada Acme projects:true users:false offline:true",
  );
  expect(screen.getByRole("complementary").textContent).toBe("Pica");
  expect(boundaries.isOffline).toHaveBeenCalledWith("v1:pica:1");
});

it("leaves Pica out when it is disabled", async () => {
  await renderRoute(false);

  expect(screen.getByRole("main").textContent).toContain("offline:false");
  expect(screen.queryByRole("complementary")).toBeNull();
});
