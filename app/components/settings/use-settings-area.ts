import { useLocation, useNavigation } from "react-router";

/** The addresses of the settings areas; each one stays its own page. */
const SETTINGS_AREAS = [
  "/settings/profile",
  "/settings/connections",
  "/settings/system",
  "/settings/tools",
  "/settings/agents",
] as const;

/** One area of the settings, named by its address. */
export type SettingsArea = (typeof SETTINGS_AREAS)[number];

/**
 * The settings area an address belongs to, such as the agents area for its subpages.
 * @param pathname - The path of the address.
 * @returns The area, or `null` outside the settings areas.
 */
export function settingsAreaOf(pathname: string): SettingsArea | null {
  return (
    SETTINGS_AREAS.find(
      (area) => pathname === area || pathname.startsWith(`${area}/`),
    ) ?? null
  );
}

/**
 * The settings area the navigation marks: the one being opened, otherwise the shown one.
 * @remarks
 * A move to another area is marked when it starts, not when its data has
 * arrived, and only one area is ever marked. A move away from the settings
 * keeps the shown area marked until the settings are left.
 */
export function useMarkedSettingsArea(): SettingsArea | null {
  const { pathname } = useLocation();
  const navigation = useNavigation();
  const target = navigation.location
    ? settingsAreaOf(navigation.location.pathname)
    : null;
  return target ?? settingsAreaOf(pathname);
}
