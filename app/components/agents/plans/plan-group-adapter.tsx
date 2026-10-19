import { CircleDashed } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { PLAN_NODE_TEXT } from "./plan-node-text";

import type { AcpProviderId } from "@/definition/AgentConfiguration";

/**
 * Names the ACP class in text; a neutral group also carries a distinct symbol.
 *
 * @param adapter - The class of the first member; `null` for a neutral group.
 */
export function PlanGroupAdapterBadge({
  adapter,
  className,
}: {
  readonly adapter: AcpProviderId | null;
  readonly className?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium whitespace-nowrap",
        PLAN_NODE_TEXT.meta,
        adapter === null
          ? "border-border text-muted-foreground"
          : "border-plan-group/40 bg-plan-group-subtle text-plan-group",
        className,
      )}
    >
      {adapter === null ? (
        <CircleDashed className="size-3 shrink-0" aria-hidden="true" />
      ) : null}
      <span className="sr-only">{t("plans.groups.adapterLabel")}: </span>
      {t(`plans.groups.adapter.${adapter ?? "neutral"}`)}
    </span>
  );
}
