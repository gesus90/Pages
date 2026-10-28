// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { data } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { handleSettingsAction } from "@/app/lib/settings-actions/settings-actions.server";
import { getSessionToken } from "@/app/lib/session.server";
import SettingsProfileRoute, {
  action,
  loader,
} from "@/app/routes/settings-profile";

import {
  accountAccess,
  ACTOR,
  formPost,
  i18n,
  pagesRequest,
  renderRoute,
  routeArguments,
} from "./route-fixture";

import type { SettingsActionData } from "@/app/lib/settings-actions/settings-action-support.server";

// The Frontend setup registers this cleanup; the Node scope repeats it here.
afterEach(cleanup);

const services = vi.hoisted(() => ({
  settingsService: {
    getUserSettings: vi.fn(),
    getTerminalScreenReader: vi.fn(),
  },
  userService: { findProfileEmail: vi.fn() },
  sessionService: { getSessionSummaries: vi.fn() },
  administrationService: { getContext: vi.fn() },
  designThemeService: { getSelection: vi.fn() },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => services,
}));
vi.mock("@/app/lib/session.server", () => ({ getSessionToken: vi.fn() }));
vi.mock("@/app/lib/settings-actions/settings-actions.server", () => ({
  handleSettingsAction: vi.fn(),
}));
vi.mock("@/app/components/settings/use-user-settings", () => ({
  useUserSettings: (settings: unknown): Record<string, unknown> => ({
    settings,
    persistSettings: vi.fn(),
    toggleNotification: vi.fn(),
  }),
}));
vi.mock("@/app/components/settings/account-mode-card", () => ({
  AccountModeCard: (): React.ReactElement => <p>account mode</p>,
}));
vi.mock("@/app/components/settings/profile-card", () => ({
  ProfileCard: (props: {
    readonly roleName: string | null;
    readonly email: string | null;
    readonly canEditProfile: boolean;
    readonly needsAdminMode: boolean;
  }): React.ReactElement => (
    <p>{`profile ${props.roleName ?? "no role"} ${props.email ?? "no email"} ${String(props.canEditProfile)} ${String(props.needsAdminMode)}`}</p>
  ),
}));
vi.mock("@/app/components/settings/notifications-card", () => ({
  NotificationsCard: (): React.ReactElement => <p>notifications</p>,
}));
vi.mock("@/app/components/settings/security-card", () => ({
  SecurityCard: (props: {
    readonly onChangePassword: () => void;
    readonly onRevokeSession: (sessionId: string) => void;
    readonly onRevokeOtherSessions: () => void;
  }): React.ReactElement => (
    <div>
      <button type="button" onClick={props.onChangePassword}>
        password
      </button>
      <button type="button" onClick={() => props.onRevokeSession("s-2")}>
        revoke
      </button>
      <button type="button" onClick={props.onRevokeOtherSessions}>
        revoke others
      </button>
    </div>
  ),
}));
vi.mock("@/app/components/settings/appearance-card", () => ({
  AppearanceCard: (): React.ReactElement => <p>appearance</p>,
}));
vi.mock("@/app/components/settings/region-card", () => ({
  RegionCard: (): React.ReactElement => <p>region</p>,
}));
vi.mock("@/app/components/settings/terminal-card", () => ({
  TerminalCard: (props: {
    readonly screenReader: string;
  }): React.ReactElement => <p>{`terminal ${props.screenReader}`}</p>,
}));
vi.mock("@/app/components/settings/change-password-dialog", () => ({
  ChangePasswordDialog: (props: {
    readonly open: boolean;
  }): React.ReactElement => <p>{`password dialog ${String(props.open)}`}</p>,
}));
vi.mock("@/app/components/settings/revoke-other-sessions-dialog", () => ({
  RevokeOtherSessionsDialog: (props: {
    readonly open: boolean;
  }): React.ReactElement => <p>{`revoke dialog ${String(props.open)}`}</p>,
}));

const SETTINGS = { notifications: {} };

/**
 * Loader data of the page for an account.
 *
 * @param account - Account facts of the visitor.
 * @param canEditProfile - Whether the visitor may edit the profile.
 */
function loaded(
  account: ReturnType<typeof accountAccess>,
  canEditProfile: boolean,
): Record<string, unknown> {
  return {
    account,
    user: ACTOR,
    email: null,
    settings: SETTINGS,
    terminalScreenReader: "off",
    designThemes: { themes: [] },
    sessions: [],
    canEditProfile,
  };
}

beforeEach(() => {
  vi.mocked(getSessionToken).mockResolvedValue("session-1");
  vi.mocked(handleSettingsAction).mockReset();
  services.settingsService.getUserSettings.mockResolvedValue(SETTINGS);
  services.settingsService.getTerminalScreenReader.mockResolvedValue("off");
  services.userService.findProfileEmail.mockResolvedValue("ada@example.com");
  services.sessionService.getSessionSummaries.mockResolvedValue([]);
  services.designThemeService.getSelection.mockResolvedValue({ themes: [] });
});

it("requires the user of the authentication middleware", async () => {
  await expect(
    loader(routeArguments(pagesRequest("/settings"), { user: null })),
  ).rejects.toThrow("Authenticated middleware did not provide a user.");
});

it("lets an administrator in the admin mode edit the profile", async () => {
  const account = accountAccess({ isAdmin: true, mode: "admin" });
  services.administrationService.getContext.mockResolvedValue(account);

  await expect(
    loader(routeArguments(pagesRequest("/settings"), { user: ACTOR })),
  ).resolves.toEqual({
    account,
    canEditProfile: true,
    designThemes: { themes: [] },
    email: "ada@example.com",
    sessions: [],
    settings: SETTINGS,
    terminalScreenReader: "off",
    user: ACTOR,
  });
  expect(services.sessionService.getSessionSummaries).toHaveBeenCalledWith(
    "user-1",
    "session-1",
  );
  expect(services.designThemeService.getSelection).toHaveBeenCalledWith(
    "user-1",
    { includeSkipped: true },
  );
});

it("keeps the profile read-only for other accounts", async () => {
  services.administrationService.getContext.mockResolvedValue(accountAccess());

  const profile = await loader(
    routeArguments(pagesRequest("/settings"), { user: ACTOR }),
  );

  expect(profile.canEditProfile).toBe(false);
  expect(services.designThemeService.getSelection).toHaveBeenCalledWith(
    "user-1",
    { includeSkipped: false },
  );
});

it("hands a settings post to the settings actions", async () => {
  const outcome = data<SettingsActionData>({ intent: "revoke-session" });
  vi.mocked(handleSettingsAction).mockResolvedValue(outcome);

  await expect(
    action(
      routeArguments(formPost("/settings", { intent: "update-settings" }), {
        user: ACTOR,
      }),
    ),
  ).resolves.toBe(outcome);
  const [call] = vi.mocked(handleSettingsAction).mock.calls;
  expect(call?.[0]).toBe("update-settings");
  expect(call?.[1].user).toBe(ACTOR);
});

it("asks an administrator outside the admin mode to switch it on", () => {
  renderRoute(SettingsProfileRoute, {
    loaderData: loaded(accountAccess({ isAdmin: true }), false),
  });

  expect(screen.getByRole("heading").textContent).toBe(
    i18n.t("settings.personal.title"),
  );
  expect(screen.getByText("profile no role no email false true")).toBeTruthy();
  expect(screen.getByText("terminal off")).toBeTruthy();
});

it("opens the dialogs and revokes a single session", async () => {
  const submitted: FormData[] = [];
  renderRoute(SettingsProfileRoute, {
    loaderData: loaded(
      accountAccess({
        role: {
          id: "lead",
          name: "Lead",
          rank: 2,
          departmentBound: false,
          permissions: [],
        },
      }),
      true,
    ),
    action: async ({ request }) => {
      submitted.push(await request.formData());
      return null;
    },
  });

  expect(screen.getByText("profile Lead no email true false")).toBeTruthy();
  expect(screen.getByText("password dialog false")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "password" }));
  expect(screen.getByText("password dialog true")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "revoke others" }));
  expect(screen.getByText("revoke dialog true")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "revoke" }));
  await vi.waitFor(() => {
    expect(submitted).toHaveLength(1);
  });
  expect(submitted[0]?.get("intent")).toBe("revoke-session");
  expect(submitted[0]?.get("sessionId")).toBe("s-2");
});
