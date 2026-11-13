import { ADMINISTRATION_ROLE_ID } from "@/definition/Authorization";

import type { TFunction } from "i18next";

/** Localizes the built-in role while preserving names of user-defined roles. */
export function userRoleLabel(
  role: { readonly id: string; readonly name: string } | null,
  translate: TFunction,
): string {
  if (!role) return "—";
  return role.id === ADMINISTRATION_ROLE_ID
    ? translate("users.management.role")
    : role.name;
}
