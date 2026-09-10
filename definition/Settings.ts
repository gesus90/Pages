import type { Language } from "@/language/Language";

/**
 * Settings that belong to a single user.
 *
 * @remarks
 * Distinct from future server-wide settings, which apply to every user and
 * are restricted to administrators.
 */
export interface UserSettings {
  readonly language: Language;
}
