import { useTranslation } from "react-i18next";
import { useLoaderData } from "react-router";

import { PicaAdminPanel } from "@/app/components/chat/admin/pica-admin-panel";
import { useLocalStateRoute } from "@/app/components/common/use-local-state-route";
import {
  isCurrentLocalStateAudience,
  isLocalStateAudience,
} from "@/app/lib/local-state/local-state-audience";
import {
  loadLocalFirst,
  localStateRoute,
} from "@/app/lib/local-state/local-state-loader";
import { readRouteData } from "@/app/lib/local-state/route-data";

import type { LocalStateRouteKind } from "@/app/components/common/use-local-state-route";
import type { LocalStateAudience } from "@/app/lib/local-state/local-state-audience";
import type { WithLocalState } from "@/app/lib/local-state/local-state-loader";
import type { Route } from "./+types/pica-tools";

/** Whether the tools are offered; an offer names the account and rights it was checked for. */
export type PicaToolsData =
  | { readonly isAllowed: false }
  | { readonly isAllowed: true; readonly audience: LocalStateAudience };

/** The rights-checked endpoint of the tools page. */
const PICA_TOOLS_ENDPOINT = "/pica-tools-api/access";

function isPicaToolsData(value: unknown): value is PicaToolsData {
  if (typeof value !== "object" || value === null || !("isAllowed" in value))
    return false;
  if (value.isAllowed === false) return true;
  return (
    value.isAllowed === true &&
    "audience" in value &&
    isLocalStateAudience(value.audience)
  );
}

/** Only an offer of the tools is kept, per account and rights; a refusal is not. */
const PICA_TOOLS_STATE: LocalStateRouteKind<PicaToolsData> = {
  schemaVersion: 1,
  isPayload: isPicaToolsData,
  isCurrent: (tools) =>
    tools.isAllowed && isCurrentLocalStateAudience(tools.audience),
  ownerOf: (tools) => (tools.isAllowed ? tools.audience.userId : ""),
  isRefused: (tools) => !tools.isAllowed,
};

/**
 * Opens the tools from the account's kept offer at once and asks the endpoint behind it.
 *
 * @remarks
 * The endpoint checks the administrator right again, as the server loader does.
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<WithLocalState<PicaToolsData>> {
  return loadLocalFirst(
    localStateRoute(new URL(request.url)),
    PICA_TOOLS_STATE,
    () =>
      readRouteData({
        endpoint: PICA_TOOLS_ENDPOINT,
        signal: request.signal,
        isPayload: isPicaToolsData,
      }),
  );
}

/** Renders the administrator tools and a clear refusal for ineligible visitors. */
export default function PicaToolsRoute(): React.ReactElement {
  const { isAllowed } = useLocalStateRoute(
    useLoaderData<typeof clientLoader>(),
    PICA_TOOLS_STATE,
  );
  const { t } = useTranslation();
  return (
    <main className="mx-auto w-full max-w-4xl space-y-5 overflow-auto p-6">
      <h1 className="text-2xl font-semibold">{t("picaAdmin.title")}</h1>
      {isAllowed ? (
        <PicaAdminPanel />
      ) : (
        <p
          role="alert"
          className="rounded-xl border border-border bg-surface p-5 text-foreground"
        >
          {t("picaAdmin.denied")}
        </p>
      )}
    </main>
  );
}
