import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Outlet,
  redirect,
  useLoaderData,
  useLocation,
  useNavigationType,
} from "react-router";

import {
  createLocalStateLayoutAnswers,
  useLocalStateLayout,
} from "@/app/components/common/use-local-state-layout";
import { SettingsHeaderSlotContext } from "@/app/components/settings/settings-header-slot";
import { SettingsNavigation } from "@/app/components/settings/settings-navigation";
import { settingsAreaOf } from "@/app/components/settings/use-settings-area";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import {
  isCurrentLocalStateAudience,
  isLocalStateAudience,
} from "@/app/lib/local-state/local-state-audience";
import { loadLocalFirst } from "@/app/lib/local-state/local-state-loader";
import { isLocalStateNavigation } from "@/app/lib/local-state/local-state-navigation";
import { readRouteData } from "@/app/lib/local-state/route-data";

import type { LocalStateLayoutSource } from "@/app/components/common/use-local-state-layout";
import type { LocalStateRouteKind } from "@/app/components/common/use-local-state-route";
import type { ScrollMaskEdge } from "@/app/components/ui/scroll-viewport/scroll-mask";
import type { LocalStateAudience } from "@/app/lib/local-state/local-state-audience";
import type { WithLocalState } from "@/app/lib/local-state/local-state-loader";
import type { RefObject, UIEvent } from "react";
import type { ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/settings";

/** The settings frame as its endpoint answers it. */
export interface SettingsLayoutData {
  /** Whether the navigation lists the admin areas System, Tools and Agents. */
  readonly canViewSystem: boolean;
  readonly audience: LocalStateAudience;
}

interface SettingsScroll {
  readonly viewportRef: RefObject<HTMLElement | null>;
  readonly onScroll: (event: UIEvent<HTMLElement>) => void;
}

/** The settings content fades out where more of it waits above or below. */
const SETTINGS_FADE_EDGES: readonly ScrollMaskEdge[] = ["top", "bottom"];

/** The upper fade is shorter, so it ends close below the fixed heading. */
const SETTINGS_FADE_TOP = 24;

/** The rights-checked endpoint of the settings frame; the key of its kept answers as well. */
const SETTINGS_LAYOUT_ENDPOINT = "/settings-api/navigation";

const MAX_REMEMBERED_POSITIONS = 100;

const rememberedPositions = new Map<string, number>();

function rememberPosition(historyKey: string, top: number): void {
  rememberedPositions.delete(historyKey);
  rememberedPositions.set(historyKey, top);
  if (rememberedPositions.size <= MAX_REMEMBERED_POSITIONS) return;
  const oldest = rememberedPositions.keys().next();
  if (!oldest.done) rememberedPositions.delete(oldest.value);
}

function useSettingsScroll(): SettingsScroll {
  const { key, pathname } = useLocation();
  const navigationType = useNavigationType();
  const viewportRef = useRef<HTMLElement | null>(null);
  const shownKey = useRef(key);
  const shownPathname = useRef<string | null>(null);

  useLayoutEffect(() => {
    const isNewPage = shownPathname.current !== pathname;
    shownKey.current = key;
    shownPathname.current = pathname;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const remembered = rememberedPositions.get(key);
    if (navigationType === "POP" && remembered !== undefined) {
      viewport.scrollTop = remembered;
      return;
    }
    if (isNewPage) viewport.scrollTop = 0;
  }, [key, pathname, navigationType]);

  function handleScroll(event: UIEvent<HTMLElement>): void {
    rememberPosition(shownKey.current, event.currentTarget.scrollTop);
  }

  return { viewportRef, onScroll: handleScroll };
}

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

/**
 * Renders the settings frame with the navigation between its areas.
 * @remarks
 * The shown area stays unchanged until the next one has loaded and is then
 * swapped once. Each area gets a scrolling element of its own, so the edge
 * fades of the previous area never show over the next one; the scrollbar's
 * gutter is always reserved, so the width does not change with the height.
 * The scrolling element spans the whole content area, so its only scrollbar
 * sits at the content area's edge; title, navigation and the area's content
 * keep the centred column, and the document itself never scrolls.
 * The area's heading stands in a place between the navigation and the
 * scrolling element, so it never scrolls and needs no surface of its own.
 * The scrolling element masks its own content at the edges instead of laying
 * a coloured fade over it, so a design's painting shows through unbroken.
 */
export default function SettingsLayoutRoute(): React.ReactElement {
  const { t } = useTranslation();
  const loaded = useLoaderData<typeof clientLoader>();
  const { pathname } = useLocation();
  const scroll = useSettingsScroll();
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const { canViewSystem } =
    useLocalStateLayout(
      loaded,
      SETTINGS_LAYOUT_STATE,
      SETTINGS_LAYOUT_SOURCE,
      pathname,
    ) ?? loaded;

  return (
    <section className="pages-page-fill pages-page-fixed flex w-full flex-col">
      <header className="mx-auto flex w-full max-w-6xl shrink-0 flex-col">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("settings.title")}
        </h1>
        <SettingsNavigation canViewSystem={canViewSystem} />
      </header>

      <div
        ref={setHeaderSlot}
        className="mx-auto mt-6 min-h-14 w-full max-w-6xl shrink-0 pl-2"
      />

      <SettingsHeaderSlotContext value={headerSlot}>
        <VerticalScrollArea
          key={settingsAreaOf(pathname) ?? pathname}
          className="min-h-0 flex-1"
          contentClassName="mx-auto w-full max-w-6xl pt-2 pl-2 pr-4 sm:pr-6 md:pr-8 xl:pr-12 pb-12"
          fadeMode="mask"
          fadeEdges={SETTINGS_FADE_EDGES}
          fadeTop={SETTINGS_FADE_TOP}
          viewportClassName="[scrollbar-gutter:stable]"
          viewportRef={scroll.viewportRef}
          onScroll={scroll.onScroll}
        >
          <Outlet />
        </VerticalScrollArea>
      </SettingsHeaderSlotContext>
    </section>
  );
}
