import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  DEFAULT_SETTINGS,
  mergeSettings,
  parseStoredSettings,
  resolveBuildServerUrl,
} from "@/settings/settings";
import {
  SETTINGS_STORAGE_KEY,
  loadSettings,
  saveSettings,
} from "@/settings/settings-storage";

describe("settings", () => {
  it("starts without a server address because the repository names none", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      theme: "system",
      language: "system",
      serverUrl: null,
    });
  });

  it("falls back to the default for each invalid stored field", () => {
    expect(parseStoredSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(
      parseStoredSettings({ theme: "sepia", language: "fr", serverUrl: 5 }),
    ).toEqual(DEFAULT_SETTINGS);
    expect(
      parseStoredSettings({
        theme: "dark",
        language: "de",
        serverUrl: "https://pages.example.com",
      }),
    ).toEqual({
      theme: "dark",
      language: "de",
      serverUrl: "https://pages.example.com",
    });
  });

  it("changes only the given fields and lets null remove the address", () => {
    const current = {
      theme: "light",
      language: "en",
      serverUrl: "https://pages.example.com",
    } as const;

    expect(mergeSettings(current, { theme: "dark" })).toEqual({
      ...current,
      theme: "dark",
    });
    expect(mergeSettings(current, { serverUrl: null }).serverUrl).toBeNull();
  });

  it("accepts a build-time address only when it is valid", () => {
    expect(resolveBuildServerUrl("https://staging.example.com/")).toBe(
      "https://staging.example.com",
    );
    expect(resolveBuildServerUrl("not a url ://")).toBeNull();
    expect(resolveBuildServerUrl(undefined)).toBeNull();
  });
});

describe("settings storage", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("returns the defaults when nothing is stored", async () => {
    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips the settings", async () => {
    const settings = {
      theme: "dark",
      language: "de",
      serverUrl: "https://pages.example.com",
    } as const;

    await expect(saveSettings(settings)).resolves.toBe(true);
    await expect(loadSettings()).resolves.toEqual(settings);
  });

  it("survives a damaged entry", async () => {
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, "{broken");

    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
