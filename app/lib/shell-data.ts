import type { RegionPreferences } from "@/app/components/common/region-provider";
import type { AccountAccess } from "@/definition/Authorization";
import type { InstanceBranding } from "@/definition/Instance";
import type { User } from "@/definition/User";

/** The workspace frame, as `/app-api/shell` answers it. */
export interface ShellData {
  readonly account: AccountAccess;
  readonly authorizationVersion: string;
  readonly user: User;
  readonly canViewProjects: boolean;
  readonly canViewUsers: boolean;
  /** How the user wants dates and times shown. */
  readonly region: RegionPreferences;
  /** Company name and logo of the instance. */
  readonly branding: InstanceBranding;
  readonly isPicaEnabled: boolean;
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function hasShellAccount(value: object): boolean {
  return (
    "user" in value &&
    isObject(value.user) &&
    "id" in value.user &&
    typeof value.user.id === "string" &&
    "authorizationVersion" in value &&
    typeof value.authorizationVersion === "string" &&
    "account" in value &&
    isObject(value.account)
  );
}

function hasShellSettings(value: object): boolean {
  return (
    "region" in value &&
    isObject(value.region) &&
    "branding" in value &&
    isObject(value.branding) &&
    "canViewProjects" in value &&
    typeof value.canViewProjects === "boolean" &&
    "canViewUsers" in value &&
    typeof value.canViewUsers === "boolean" &&
    "isPicaEnabled" in value &&
    typeof value.isPicaEnabled === "boolean"
  );
}

/**
 * Whether a value has the shape of {@link ShellData}.
 *
 * @param value - An answer of `/app-api/shell` or a kept one.
 */
export function isShellData(value: unknown): value is ShellData {
  return isObject(value) && hasShellAccount(value) && hasShellSettings(value);
}
