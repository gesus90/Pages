import { DARK_COLORS, LIGHT_COLORS } from "@/theme/tokens";

import {
  PRIMARY_COLOR,
  SPLASH_BACKGROUNDS,
  createConfig,
  resolveVariant,
} from "../app.config";

describe("app configuration", () => {
  it("selects the variant from APP_VARIANT and defaults to development", () => {
    expect(resolveVariant("preview")).toBe("preview");
    expect(resolveVariant("production")).toBe("production");
    expect(resolveVariant("development")).toBe("development");
    expect(resolveVariant(undefined)).toBe("development");
    expect(resolveVariant("staging")).toBe("development");
  });

  it("gives every variant its own identifiers so they install side by side", () => {
    const configs = (["development", "preview", "production"] as const).map(
      (variant) => createConfig(variant, {}, undefined),
    );
    const bundleIds = configs.map((config) => config.ios?.bundleIdentifier);
    const packages = configs.map((config) => config.android?.package);

    expect(new Set(bundleIds).size).toBe(3);
    expect(packages).toEqual(bundleIds);
    expect(new Set(configs.map((config) => config.scheme)).size).toBe(3);
    expect(bundleIds[2]).toBe("io.github.gesus90.pica");
    expect(configs[2]?.name).toBe("Pica");
  });

  it("builds for Android and iOS only and adapts to the system theme", () => {
    const config = createConfig("production", {}, undefined);

    expect(config.platforms).toEqual(["ios", "android"]);
    expect(config.userInterfaceStyle).toBe("automatic");
    expect(config.ios?.config?.usesNonExemptEncryption).toBe(false);
  });

  it("links the EAS project only when its id is known", () => {
    expect(createConfig("preview", {}, undefined).extra).toEqual({
      variant: "preview",
    });
    expect(createConfig("preview", {}, "project-id").extra).toEqual({
      variant: "preview",
      eas: { projectId: "project-id" },
    });
  });

  it("names no server address and no credentials", () => {
    const text = JSON.stringify(createConfig("production", {}, undefined));

    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/token|secret|password/i);
  });

  it("keeps the splash backgrounds equal to the theme tokens", () => {
    expect(SPLASH_BACKGROUNDS.light).toBe(LIGHT_COLORS.background);
    expect(SPLASH_BACKGROUNDS.dark).toBe(DARK_COLORS.background);
    expect(PRIMARY_COLOR).toBe(LIGHT_COLORS.primary);
    expect(PRIMARY_COLOR).toBe(DARK_COLORS.primary);
  });

  it("blocks unused Android permissions outside the development build", () => {
    expect(
      createConfig("development", {}, undefined).android?.blockedPermissions,
    ).toEqual([]);
    expect(
      createConfig("production", {}, undefined).android?.blockedPermissions,
    ).toContain("android.permission.SYSTEM_ALERT_WINDOW");
  });
});
