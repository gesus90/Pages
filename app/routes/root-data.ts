import { getAuthenticatedUser } from "@/app/lib/auth.server";
import {
  resolveAnonymousLanguage,
  resolveSetupLanguage,
} from "@/app/lib/language.server";
import { routeDataResponse } from "@/app/lib/local-state/route-data.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { isSetupPending } from "@/app/lib/setup-gate.server";
import { STANDARD_ACTIVE_DESIGN_THEME } from "@/definition/DesignTheme";
import { DEFAULT_USER_SETTINGS } from "@/definition/Settings";

import type { RootData } from "@/app/lib/root-data";
import type { Route } from "./+types/root-data";

/**
 * Selects the document language, color mode and design theme.
 *
 * @remarks
 * Signed-in visitors use their persisted personal language, color mode and
 * design theme. Everyone else falls back to their browser's
 * `Accept-Language` preference, to the default mode `system`, which follows
 * the operating system, and to the Standard design. The setup wizard starts
 * in German unless the visitor chose a language; it never touches the
 * services, because no database exists yet.
 */
async function readRootData(request: Request): Promise<RootData> {
  const { theme: defaultTheme } = DEFAULT_USER_SETTINGS;

  if (await isSetupPending()) {
    return {
      language: await resolveSetupLanguage(request),
      theme: defaultTheme,
      designTheme: STANDARD_ACTIVE_DESIGN_THEME,
      draftOwnerId: null,
    };
  }

  const user = await getAuthenticatedUser(request);

  if (user) {
    const services = await getApplicationServices();
    const [settings, designTheme] = await Promise.all([
      services.settingsService.getUserSettings(user.id),
      services.designThemeService.getActiveTheme(user.id),
    ]);

    return {
      language: settings.language,
      theme: settings.theme,
      designTheme,
      draftOwnerId: user.id,
    };
  }

  return {
    language: await resolveAnonymousLanguage(request),
    theme: defaultTheme,
    designTheme: STANDARD_ACTIVE_DESIGN_THEME,
    draftOwnerId: null,
  };
}

/**
 * Answers the document settings of the static app for this visitor (PAGE-235).
 *
 * @remarks
 * Public, because the sign-in page and the setup wizard need them too; it
 * names only the visitor's own account.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return routeDataResponse(await readRootData(request));
}
