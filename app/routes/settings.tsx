import { Outlet, redirect, useLoaderData, useLocation } from "react-router";
import { useTranslation } from "react-i18next";

import {
  createLocalStateLayoutAnswers,
  useLocalStateLayout,
} from "@/app/components/common/use-local-state-layout";
import { SettingsNavigation } from "@/app/components/settings/settings-navigation";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import {
  isCurrentLocalStateAudience,
  isLocalStateAudience,
} from "@/app/lib/local-state/local-state-audience";
import { loadLocalFirst } from "@/app/lib/local-state/local-state-loader";
import { isLocalStateNavigation } from "@/app/lib/local-state/local-state-navigation";
import { readRouteData } from "@/app/lib/local-state/route-data";

import type { ShouldRevalidateFunctionArgs } from "react-router";
import type { LocalStateLayoutSource } from "@/app/components/common/use-local-state-layout";
import type { LocalStateRouteKind } from "@/app/components/common/use-local-state-route";
import type { LocalStateAudience } from "@/app/lib/local-state/local-state-audience";
import type { WithLocalState } from "@/app/lib/local-state/local-state-loader";
import type { Route } from "./+types/settings";

/** The settings frame as its endpoint answers it. */
export interface SettingsLayoutData {
  /** Whether the navigation lists the admin areas System and Agents. */
  readonly canViewSystem: boolean;
  readonly audience: LocalStateAudience;
}

/** The rights-checked endpoint of the settings frame; the key of its kept answers as well. */
const SETTINGS_LAYOUT_ENDPOINT = "/settings-api/navigation";

function isSettingsLayoutData(value: unknown): value is SettingsLayoutData {
  return (
    typeof value === "object" &&
    value !== null &&
    "canViewSystem" in value &&
    typeof value.canViewSystem === "boolean" &&
    "audience" in value &&
    isLocalStateAudience(value.audience)
  );
}

/** The settings navigation, kept per account and rights. */
const SETTINGS_LAYOUT_STATE: LocalStateRouteKind<SettingsLayoutData> = {
  schemaVersion: 1,
  isPayload: isSettingsLayoutData,
  isCurrent: (layout) => isCurrentLocalStateAudience(layout.audience),
  ownerOf: (layout) => layout.audience.userId,
  isRefused: () => false,
};

function readSettingsLayout(signal: AbortSignal): Promise<SettingsLayoutData> {
  return readRouteData({
    endpoint: SETTINGS_LAYOUT_ENDPOINT,
    signal,
    isPayload: isSettingsLayoutData,
  });
}

/** The settings frame's kept answers do not depend on the address. */
const SETTINGS_LAYOUT_SOURCE: LocalStateLayoutSource<SettingsLayoutData> = {
  route: SETTINGS_LAYOUT_ENDPOINT,
  read: readSettingsLayout,
  answers: createLocalStateLayoutAnswers(),
};

/**
 * Opens the settings frame from the account's kept answer at once; the frame asks the endpoint behind it.
 *
 * @remarks
 * Without a kept answer the frame comes from its rights-checked endpoint,
 * which runs the server loader's checks. The bare `/settings` only sends on
 * to the personal area, as its index does, so the frame is read once, for
 * the address it is shown at.
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<WithLocalState<SettingsLayoutData>> {
  if (new URL(request.url).pathname === "/settings")
    throw redirect("/settings/profile");
  return loadLocalFirst(SETTINGS_LAYOUT_ENDPOINT, SETTINGS_LAYOUT_STATE, () =>
    readSettingsLayout(request.signal),
  );
}

/**
 * Reloads the frame after a change, such as the admin mode, and when the page
 * is refreshed. Moving between settings areas does not wait for it: the frame
 * asks its endpoint behind the shown navigation instead.
 */
export function shouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
  return isLocalStateNavigation(args) ? false : args.defaultShouldRevalidate;
}

/** Renders the settings frame with the navigation between its areas. */
export default function SettingsLayoutRoute(): React.ReactElement {
  const { t } = useTranslation();
  const loaded = useLoaderData<typeof clientLoader>();
  const { pathname } = useLocation();
  const { canViewSystem } =
    useLocalStateLayout(
      loaded,
      SETTINGS_LAYOUT_STATE,
      SETTINGS_LAYOUT_SOURCE,
      pathname,
    ) ?? loaded;

  return (
    <section className="pages-page-fill mx-auto flex w-full max-w-6xl flex-col">
      <h1 className="shrink-0 text-2xl font-semibold tracking-tight text-foreground">
        {t("settings.title")}
      </h1>
      <SettingsNavigation canViewSystem={canViewSystem} />

      <VerticalScrollArea
        className="mt-6 min-h-0 flex-1"
        contentClassName="pt-1 pl-2 pr-4 sm:pr-6 md:pr-8 xl:pr-12 pb-12"
        fadeClassName="z-20"
      >
        <Outlet />
      </VerticalScrollArea>
    </section>
  );
}
