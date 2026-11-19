import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  redirect,
  useLoaderData,
  useLocation,
  useNavigation,
  useSearchParams,
} from "react-router";

import { PlanPage } from "@/app/components/agents/plans/plan-page";
import { useLocalStateRoute } from "@/app/components/common/use-local-state-route";
import { planSelectionCookie } from "@/app/lib/agent-plan-selection";
import {
  isCurrentLocalStateAudience,
  isLocalStateAudience,
} from "@/app/lib/local-state/local-state-audience";
import {
  loadLocalFirst,
  localStateRoute,
} from "@/app/lib/local-state/local-state-loader";
import { localState } from "@/app/lib/local-state/local-state-store";
import { readRouteData } from "@/app/lib/local-state/route-data";
import { sendToBackend } from "@/app/lib/backend-request";
import { invalidatePlanCache } from "@/app/lib/live-changes/plan-cache-invalidation";

import type { AgentPlanOpening } from "@/app/lib/agent-plan-default";
import type { PlanSelectionPreference } from "@/app/lib/agent-plan-selection";
import type { LocalStateRouteKind } from "@/app/components/common/use-local-state-route";
import type { LocalStateAudience } from "@/app/lib/local-state/local-state-audience";
import type { WithLocalState } from "@/app/lib/local-state/local-state-loader";
import type { AgentPlanPage } from "@/definition/AgentPlan";
import type { Route } from "./+types/agent-plans";

/** The plan page together with how the editor came to its plan. */
export interface AgentPlansView extends AgentPlanPage {
  readonly opening: AgentPlanOpening;
  readonly selectionPreference: PlanSelectionPreference;
  readonly audience: LocalStateAudience;
}

/**
 * The rights-checked endpoint of the plan page.
 * @remarks
 * It lies below `/agents`, so the browser sends the plan choice it remembers
 * there, as it does for the page.
 */
const PLAN_PAGE_ENDPOINT = "/agents/plans-api";

function isPlanRouteData(value: unknown): value is AgentPlansView {
  return (
    typeof value === "object" &&
    value !== null &&
    "userId" in value &&
    typeof value.userId === "string" &&
    "opening" in value &&
    typeof value.opening === "string" &&
    "plans" in value &&
    Array.isArray(value.plans) &&
    "selected" in value &&
    typeof value.selected === "object" &&
    "selectionPreference" in value &&
    typeof value.selectionPreference === "object" &&
    "audience" in value &&
    isLocalStateAudience(value.audience)
  );
}

/** The plan page is the first route that opens from the browser's local state. */
const PLAN_PAGE_STATE: LocalStateRouteKind<AgentPlansView> = {
  // 2 names the account's rights; an answer kept without them is not shown.
  schemaVersion: 2,
  isPayload: isPlanRouteData,
  isCurrent: (page) => isCurrentLocalStateAudience(page.audience),
  ownerOf: (page) => page.userId,
  // The server reports a missing and a refused plan alike.
  isRefused: (page) => page.opening === "requestedMissing",
};

/**
 * The kept plan the server would open for the plain address, which names no plan.
 * @remarks
 * The server opens the plan this browser remembers for the account; the
 * address then names it. Only a plan whose answer is kept opens this way.
 */
async function keptRememberedPlan(request: Request): Promise<string | null> {
  const url = new URL(request.url);
  // A document opened without server rendering names its account in the root loader.
  await localState.whenClaimed();
  const userId = localState.currentOwner();
  if (url.search !== "" || !userId) return null;
  const remembered: unknown = await planSelectionCookie({
    userId,
    origin: url.origin,
  }).parse(document.cookie);
  if (typeof remembered !== "string" || remembered.length === 0) return null;
  const address = `/agents/plans?planId=${encodeURIComponent(remembered)}`;
  return (await localState.read(address, PLAN_PAGE_STATE)) ? address : null;
}

/**
 * Opens the plan from the account's kept answer at once and asks the endpoint behind it.
 *
 * @remarks
 * The endpoint's answer replaces the kept one when it arrives. An unreachable
 * backend leaves the kept answer readable and marked. The endpoint runs the
 * server loader with its permission checks and its redirect to the opened plan.
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<WithLocalState<AgentPlansView>> {
  const remembered = await keptRememberedPlan(request);
  if (remembered) throw redirect(remembered);
  const url = new URL(request.url);
  return loadLocalFirst(localStateRoute(url), PLAN_PAGE_STATE, () =>
    readRouteData({
      endpoint: `${PLAN_PAGE_ENDPOINT}${url.search}`,
      signal: request.signal,
      isPayload: isPlanRouteData,
    }),
  );
}

/** Sends a change of a plan to the API, which runs the page's action. */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<unknown> {
  return sendToBackend(request);
}

/** The page shows the plan in the React Flow graph editor and nothing beside it. */
export default function AgentPlansRoute(): React.ReactElement {
  const page = useLocalStateRoute<AgentPlansView>(
    useLoaderData<typeof clientLoader>(),
    PLAN_PAGE_STATE,
  );
  const location = useLocation();
  useEffect(() => {
    if (page.opening === "requestedMissing") void invalidatePlanCache();
  }, [page.opening]);
  usePlanSelectionPreference(page.selectionPreference);
  return (
    <>
      <PlanRetiredNotice />
      <PlanPage
        key={`${page.userId}:${page.selected?.id ?? "new"}:${location.key}:${page.localState?.state ?? "server"}`}
        page={page}
        opening={page.opening}
        localState={page.localState}
      />
    </>
  );
}

function PlanRetiredNotice(): React.ReactElement | null {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  if (searchParams.get("notice") !== "direct-models") return null;
  return (
    <p
      role="status"
      className="fixed top-20 left-4 md:left-[calc(var(--app-sidebar-width)+1rem)] z-40 max-w-sm rounded-xl border border-border bg-surface p-3 text-sm text-foreground shadow-panel"
    >
      {t("picaSettings.retired")}
    </p>
  );
}

function usePlanSelectionPreference(preference: PlanSelectionPreference): void {
  const { state } = useNavigation();
  const { origin, userId, planId, discardedPlanId } = preference;
  useEffect(() => {
    if (state !== "idle" || (!planId && !discardedPlanId)) return;
    let isCurrent = true;
    async function persist(): Promise<void> {
      const cookie = planSelectionCookie({ origin, userId });
      const previous = document.cookie;
      if (!planId && (await cookie.parse(previous)) !== discardedPlanId) return;
      const serialized = await cookie.serialize(planId ?? "", {
        secure: window.location.protocol === "https:",
        ...(planId ? {} : { maxAge: 0, expires: new Date(0) }),
      });
      if (isCurrent && (planId || document.cookie === previous))
        document.cookie = serialized;
    }
    void persist().catch((error: unknown) => {
      console.warn("Pages could not store the last opened plan.", error);
    });
    return () => {
      isCurrent = false;
    };
  }, [origin, userId, planId, discardedPlanId, state]);
}
