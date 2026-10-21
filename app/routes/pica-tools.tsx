import { useTranslation } from "react-i18next";
import { useLoaderData } from "react-router";

import { PicaAdminPanel } from "@/app/components/chat/admin/pica-admin-panel";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { CHAT_NO_STORE } from "@/app/lib/chat-response.server";
import { getApplicationServices } from "@/app/lib/services.server";
import type { Route } from "./+types/pica-tools";

/** Offers an explicit task surface; eligibility is resolved from current persisted rights on every load. */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<{ isAllowed: boolean }> {
  const actor = context.get(authenticatedUserContext);
  if (!actor) return { isAllowed: false };
  try {
    await (
      await getApplicationServices()
    ).picaAdminService.requireAdministrator(actor.id);
    return { isAllowed: true };
  } catch {
    return { isAllowed: false };
  }
}

/** Prevents task observations from being stored in intermediary caches. */
export const headers: Route.HeadersFunction = () => CHAT_NO_STORE;

/** Renders the administrator tools and a clear refusal for ineligible visitors. */
export default function PicaToolsRoute(): React.ReactElement {
  const { isAllowed } = useLoaderData<typeof loader>();
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
