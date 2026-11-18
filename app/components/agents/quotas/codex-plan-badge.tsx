import { useTranslation } from "react-i18next";

/*
 * Branding note: the ChatGPT app icon names the vendor of the subscription
 * beside its written name; the file is kept unchanged in `assets/providers/`
 * and only scaled here.
 */
import chatgptUrl from "@/assets/providers/logo-chatgpt.png?no-inline";

import { cn } from "@/app/lib/cn";

import type { CodexPlan } from "@/definition/CodexQuota";

/**
 * The subscription of a Codex card: the ChatGPT logo in a tile and the plan's name.
 * @remarks
 * 24 px high with a 1 px border and a 7 px radius, like the badge of the
 * Claude card: the 18 px tile with a 5 px radius sits 2 px from the top,
 * bottom and left edge. Every known plan is 88 px wide with a border in the
 * ChatGPT colour, so the cards line up. A plan the app server did not name
 * for certain, or named as one this page does not know, reads "Tarif
 * unbekannt" in muted colors with a neutral border and an empty tile, as wide
 * as its text; "Free" appears only when the server names it.
 */
export function CodexPlanBadge({
  plan,
}: {
  readonly plan: CodexPlan | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const isKnown = plan !== null;
  return (
    <span
      data-codex-plan={plan ?? "unknown"}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[7px] border bg-surface py-[2px] pr-2 pl-[2px] text-[11px] leading-none font-semibold",
        isKnown
          ? "w-[88px] border-chatgpt text-foreground"
          : "border-border text-muted-foreground",
      )}
    >
      {isKnown ? (
        <img
          src={chatgptUrl}
          alt=""
          draggable={false}
          className="size-[18px] shrink-0 rounded-[5px]"
        />
      ) : (
        <span
          aria-hidden="true"
          className="size-[18px] shrink-0 rounded-[5px] bg-muted"
        />
      )}
      <span className="whitespace-nowrap">
        {plan === null
          ? t("agentsPage.plan.unknown")
          : t(`agentsPage.codex.plan.${plan}`)}
      </span>
    </span>
  );
}
