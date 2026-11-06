import { isLanguage } from "@/language/Language";
import { isUserTheme } from "@/definition/Settings";

import type { ActiveDesignTheme } from "@/definition/DesignTheme";
import type { UserTheme } from "@/definition/Settings";
import type { Language } from "@/language/Language";

/** The document settings of the static app, as `/app-api/root` answers them. */
export interface RootData {
  readonly language: Language;
  readonly theme: UserTheme;
  readonly designTheme: ActiveDesignTheme;
  /** The signed-in account, whose drafts and kept answers this document uses. */
  readonly draftOwnerId: string | null;
}

function isActiveDesignTheme(value: unknown): value is ActiveDesignTheme {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "stylesheet" in value &&
    (value.stylesheet === null || typeof value.stylesheet === "string")
  );
}

/**
 * Whether a value has the shape of {@link RootData}.
 *
 * @param value - An answer of `/app-api/root` or a kept one.
 */
export function isRootData(value: unknown): value is RootData {
  return (
    typeof value === "object" &&
    value !== null &&
    "language" in value &&
    isLanguage(value.language) &&
    "theme" in value &&
    isUserTheme(value.theme) &&
    "designTheme" in value &&
    isActiveDesignTheme(value.designTheme) &&
    "draftOwnerId" in value &&
    (value.draftOwnerId === null || typeof value.draftOwnerId === "string")
  );
}
