// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { listsAdminSettings } from "@/app/lib/settings-actions/settings-system-access.server";
import SettingsLayoutRoute, { loader } from "@/app/routes/settings";

import {
  ACTOR,
  i18n,
  pagesRequest,
  renderRoute,
  routeArguments,
} from "./route-fixture";

// The Frontend setup registers this cleanup; the Node scope repeats it here.
afterEach(cleanup);

const getContext = vi.hoisted(() => vi.fn());

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => ({
    administrationService: { getContext },
  }),
}));
vi.mock("@/app/lib/settings-actions/settings-system-access.server", () => ({
  listsAdminSettings: vi.fn(),
}));
vi.mock("@/app/components/settings/settings-navigation", () => ({
  SettingsNavigation: (props: {
    readonly canViewSystem: boolean;
  }): React.ReactElement => (
    <nav>{props.canViewSystem ? "with system" : "personal only"}</nav>
  ),
}));

vi.mock("@/app/components/ui/vertical-scroll-area", () => ({
  VerticalScrollArea: (props: {
    readonly children: React.ReactNode;
  }): React.ReactElement => <div>{props.children}</div>,
}));

const ACCOUNT = { userId: "user-1", isAdmin: true };

beforeEach(() => {
  getContext.mockReset();
  getContext.mockResolvedValue(ACCOUNT);
  vi.mocked(listsAdminSettings).mockReset();
});

it("requires the user of the authentication middleware", async () => {
  await expect(
    loader(routeArguments(pagesRequest("/settings"), { user: null })),
  ).rejects.toThrow("Authenticated middleware did not provide a user.");
});

it("lists the admin areas for the visitor's account", async () => {
  vi.mocked(listsAdminSettings).mockReturnValue(true);

  await expect(
    loader(routeArguments(pagesRequest("/settings"), { user: ACTOR })),
  ).resolves.toEqual({ canViewSystem: true });
  expect(getContext).toHaveBeenCalledWith("user-1");
  expect(listsAdminSettings).toHaveBeenCalledWith(ACCOUNT);
});

it("renders the title, the navigation and the open area", () => {
  renderRoute(SettingsLayoutRoute, {
    loaderData: { canViewSystem: false },
    children: [
      { index: true, Component: (): React.ReactElement => <p>area</p> },
    ],
  });

  expect(screen.getByRole("heading").textContent).toBe(
    i18n.t("settings.title"),
  );
  expect(screen.getByRole("navigation").textContent).toBe("personal only");
  expect(screen.getByText("area")).toBeTruthy();
});
