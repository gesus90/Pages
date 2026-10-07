import { Outlet, useLoaderData } from "react-router";
import { useTranslation } from "react-i18next";

import { SettingsNavigation } from "@/app/components/settings/settings-navigation";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { canSeeSystemSettings } from "@/app/lib/settings-actions/settings-system-access.server";

import type { Route } from "./+types/settings";

interface SettingsLayoutData {
  /** Whether the navigation lists the system area. */
  readonly canViewSystem: boolean;
}

/** Decides which settings areas the navigation lists for the visitor. */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<SettingsLayoutData> {
  const user = context.get(authenticatedUserContext);

  if (!user) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const services = await getApplicationServices();
  const account = await services.administrationService.getContext(user.id);

  return { canViewSystem: canSeeSystemSettings(account) };
}

/** Renders the settings frame with the navigation between its areas. */
export default function SettingsLayoutRoute(): React.ReactElement {
  const { t } = useTranslation();
  const { canViewSystem } = useLoaderData<typeof loader>();

  return (
    <section className="pages-page-fill mx-auto flex w-full max-w-6xl flex-col">
      <h1 className="shrink-0 text-2xl font-semibold tracking-tight text-foreground">
        {t("settings.title")}
      </h1>
      <SettingsNavigation canViewSystem={canViewSystem} />

      <VerticalScrollArea
        className="mt-6 min-h-0 flex-1"
        contentClassName="pr-4 sm:pr-6 md:pr-8 xl:pr-12 pb-12"
        fadeClassName="z-20"
      >
        <Outlet />
      </VerticalScrollArea>
    </section>
  );
}
