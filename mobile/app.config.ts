import { version } from "./package.json";

import type { ConfigContext, ExpoConfig } from "expo/config";

/** The builds that can be installed next to each other on one device. */
export type AppVariant = "development" | "preview" | "production";

interface VariantSettings {
  readonly name: string;
  readonly applicationId: string;
  readonly scheme: string;
}

/**
 * Reverse-domain base of the application identifiers.
 *
 * @remarks
 * Android and iOS keep an identifier for the whole life of an app in the
 * stores, so confirm this value before the first store build.
 */
const BASE_APPLICATION_ID = "io.github.gesus90.pica";

const VARIANTS: Readonly<Record<AppVariant, VariantSettings>> = {
  development: {
    name: "Pica (Dev)",
    applicationId: `${BASE_APPLICATION_ID}.dev`,
    scheme: "pica-dev",
  },
  preview: {
    name: "Pica (Preview)",
    applicationId: `${BASE_APPLICATION_ID}.preview`,
    scheme: "pica-preview",
  },
  production: {
    name: "Pica",
    applicationId: BASE_APPLICATION_ID,
    scheme: "pica",
  },
};

const IMAGES = "./assets/images";

/**
 * Window backgrounds of the splash screen.
 *
 * @remarks
 * The same values as `background` in `src/theme/tokens.ts`; the Expo config
 * loader cannot import that file, so `tests/app-config.test.ts` compares them.
 */
export const SPLASH_BACKGROUNDS = {
  light: "#f2f4f7",
  dark: "#0f1217",
} as const;

/**
 * The Pica accent, which Android uses for the text cursor and the task view.
 *
 * @remarks
 * The same value as `primary` in `src/theme/tokens.ts`; see `SPLASH_BACKGROUNDS`.
 */
export const PRIMARY_COLOR = "#f97316";

/**
 * Permissions Expo adds by default that the foundation does not use. Later
 * features add what they need through their own config plugin; the development
 * build keeps the overlay permission its dev menu needs.
 */
const UNUSED_ANDROID_PERMISSIONS = [
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.SYSTEM_ALERT_WINDOW",
];

/**
 * Selects the build variant.
 *
 * @param name - Value of `APP_VARIANT`, which the profiles of `eas.json` set.
 * @returns The variant; a local start without a profile is a development build.
 */
export function resolveVariant(name: string | undefined): AppVariant {
  return name === "preview" || name === "production" ? name : "development";
}

/**
 * Builds the Expo configuration of one variant.
 *
 * @param variant - The build variant.
 * @param base - Configuration Expo passes in, such as the project path.
 * @param easProjectId - The id `eas init` prints, or `undefined` before it ran.
 * @returns The complete Expo configuration.
 */
export function createConfig(
  variant: AppVariant,
  base: Partial<ExpoConfig>,
  easProjectId: string | undefined,
): ExpoConfig {
  const { name, applicationId, scheme } = VARIANTS[variant];

  return {
    ...base,
    name,
    slug: "pica-mobile",
    platforms: ["ios", "android"],
    scheme,
    version,
    orientation: "default",
    icon: `${IMAGES}/icon.png`,
    userInterfaceStyle: "automatic",
    primaryColor: PRIMARY_COLOR,
    ios: {
      bundleIdentifier: applicationId,
      supportsTablet: true,
      icon: { light: `${IMAGES}/icon.png`, dark: `${IMAGES}/icon-dark.png` },
      // Pica talks to Pages over HTTPS only, which is exempt from the export
      // compliance questions; TestFlight would otherwise ask them per upload.
      config: { usesNonExemptEncryption: false },
    },
    android: {
      package: applicationId,
      adaptiveIcon: {
        foregroundImage: `${IMAGES}/adaptive-icon-foreground.png`,
        backgroundImage: `${IMAGES}/adaptive-icon-background.png`,
        monochromeImage: `${IMAGES}/adaptive-icon-monochrome.png`,
      },
      allowBackup: false,
      blockedPermissions:
        variant === "development" ? [] : UNUSED_ANDROID_PERMISSIONS,
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          image: `${IMAGES}/pica-mascot.png`,
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: SPLASH_BACKGROUNDS.light,
          dark: { backgroundColor: SPLASH_BACKGROUNDS.dark },
          // Android 12 masks the icon with a circle, so it gets the adaptive
          // icon artwork, which keeps its content inside the safe zone.
          android: {
            image: `${IMAGES}/adaptive-icon-foreground.png`,
            imageWidth: 288,
          },
        },
      ],
      [
        "expo-localization",
        {
          supportedLocales: { ios: ["de", "en"], android: ["de", "en"] },
        },
      ],
    ],
    extra: {
      variant,
      ...(easProjectId === undefined
        ? {}
        : { eas: { projectId: easProjectId } }),
    },
  };
}

/** Expo configuration; `APP_VARIANT` selects the variant, `eas.json` sets it. */
export default function config({ config: base }: ConfigContext): ExpoConfig {
  return createConfig(
    resolveVariant(process.env.APP_VARIANT),
    base,
    process.env.EAS_PROJECT_ID,
  );
}
