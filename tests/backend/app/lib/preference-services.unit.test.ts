import { beforeEach, expect, it, vi } from "vitest";

import { createPreferenceServices } from "@/app/lib/preference-services.server";
import { UserBoardPreferencesRepository } from "@/backend/database/repositories/UserBoardPreferencesRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { BoardPreferencesService } from "@/backend/service/BoardPreferencesService";
import { DesignThemeService } from "@/backend/service/DesignThemeService";
import { DesignThemeRegistry } from "@/backend/service/design/DesignThemeRegistry";
import { SettingsService } from "@/backend/service/SettingsService";

import type { Database } from "@/backend/database/Database";

const { fakeClasses, opaque } = await vi.hoisted(
  async () => import("./service-wiring-fakes"),
);

vi.mock("@/backend/database/repositories/UserBoardPreferencesRepository", () =>
  fakeClasses({ UserBoardPreferencesRepository: [] }),
);
vi.mock("@/backend/database/repositories/UserSettingsRepository", () =>
  fakeClasses({ UserSettingsRepository: [] }),
);
vi.mock("@/backend/service/BoardPreferencesService", () =>
  fakeClasses({ BoardPreferencesService: [] }),
);
vi.mock("@/backend/service/DesignThemeService", () =>
  fakeClasses({ DesignThemeService: [] }),
);
vi.mock("@/backend/service/design/DesignThemeRegistry", () =>
  fakeClasses({ DesignThemeRegistry: [] }),
);
vi.mock("@/backend/service/SettingsService", () =>
  fakeClasses({ SettingsService: [] }),
);

const DATABASE = opaque<Database>("database");

beforeEach(() => {
  vi.resetAllMocks();
});

it("shares one settings repository between settings and design theme", () => {
  const services = createPreferenceServices(DATABASE, "/srv/pages/pages.db");

  const [settings] = vi.mocked(UserSettingsRepository).mock.instances;
  expect(vi.mocked(UserSettingsRepository).mock.calls).toEqual([[DATABASE]]);
  expect(vi.mocked(SettingsService).mock.calls[0][0]).toBe(settings);
  expect(services.settingsService).toBe(
    vi.mocked(SettingsService).mock.instances[0],
  );
  const [registry, themeSettings] = vi.mocked(DesignThemeService).mock.calls[0];
  expect(themeSettings).toBe(settings);
  expect(registry).toBe(vi.mocked(DesignThemeRegistry).mock.instances[0]);
  expect(services.designThemeService).toBe(
    vi.mocked(DesignThemeService).mock.instances[0],
  );
});

it("reads design themes from the folder next to the database", () => {
  createPreferenceServices(DATABASE, "/srv/pages/pages.db");

  expect(vi.mocked(DesignThemeRegistry).mock.calls).toEqual([
    ["/srv/pages/themes"],
  ]);
});

it("keeps board preferences in their own repository", () => {
  const services = createPreferenceServices(DATABASE, "/srv/pages/pages.db");

  expect(vi.mocked(UserBoardPreferencesRepository).mock.calls).toEqual([
    [DATABASE],
  ]);
  expect(vi.mocked(BoardPreferencesService).mock.calls[0][0]).toBe(
    vi.mocked(UserBoardPreferencesRepository).mock.instances[0],
  );
  expect(services.boardPreferencesService).toBe(
    vi.mocked(BoardPreferencesService).mock.instances[0],
  );
});
