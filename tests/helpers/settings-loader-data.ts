import { ROLE } from "@/definition/Role";
import { DEFAULT_USER_SETTINGS } from "@/definition/Settings";

import type { Role } from "@/definition/Role";
import type { SessionSummary } from "@/definition/Session";
import type { UserSettings } from "@/definition/Settings";
import type { User } from "@/definition/User";

/** Loader payload of the settings route as the screen consumes it. */
export interface SettingsLoaderFixture {
  readonly user: User;
  readonly email: string | null;
  readonly settings: UserSettings;
  readonly sessions: readonly SessionSummary[];
  readonly canEditProfile: boolean;
  readonly assignableRoles: readonly Role[];
}

/**
 * Builds the complete loader data of an administrator opening the settings.
 *
 * @param overrides - Values replacing the defaults.
 * @returns Loader data matching the current settings screen.
 */
export function createSettingsLoaderData(
  overrides: Partial<SettingsLoaderFixture> = {},
): SettingsLoaderFixture {
  return {
    assignableRoles: [ROLE.ADMIN, ROLE.MANAGER, ROLE.EMPLOYEE],
    canEditProfile: true,
    email: "admin@example.invalid",
    sessions: [],
    settings: DEFAULT_USER_SETTINGS,
    user: {
      avatarColor: null,
      avatarIcon: null,
      avatarImageUrl: null,
      avatarType: "initials",
      displayName: "Admin",
      id: "user-1",
      isActive: true,
      role: ROLE.ADMIN,
      username: "admin",
    },
    ...overrides,
  };
}
