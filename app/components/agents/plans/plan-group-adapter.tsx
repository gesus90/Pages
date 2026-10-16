import { CircleDashed, Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { AcpProviderId } from "@/definition/AgentConfiguration";

/**
 * Names the ACP class of a group in text and with a symbol, never by color alone.
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
  const Icon = adapter === null ? CircleDashed : Workflow;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium",
        adapter === null
          ? "border-border text-muted-foreground"
          : "border-plan-group/40 bg-plan-group-subtle text-plan-group",
        className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      <span className="sr-only">{t("plans.groups.adapterLabel")}: </span>
      {t(`plans.groups.adapter.${adapter ?? "neutral"}`)}
    </span>
  );
}
