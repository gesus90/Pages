import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { AgentEmployeeListItem } from "@/definition/AgentEmployee";

/** The saved Pages administrator grant beside the agent's access level. */
export function AgentAccessBadges({
  agent,
}: {
  readonly agent: AgentEmployeeListItem;
}): React.ReactElement {
  const { t } = useTranslation();
  const badge =
    "inline-flex h-6 items-center gap-1 rounded-[7px] border px-2 text-[11px] font-semibold";
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span
        className={cn(
          badge,
          agent.access === "yolo"
            ? "border-warning bg-warning-subtle text-warning"
            : "border-border text-foreground",
        )}
      >
        {t(`agentEmployees.access.${agent.access}`)}
      </span>
      {agent.hasAdministratorRights ? (
        <span className={cn(badge, "border-info bg-info-subtle text-info")}>
          <ShieldCheck aria-hidden="true" className="size-3" />
          {t("agentEmployees.administratorRights.badge")}
        </span>
      ) : null}
    </span>
  );
}
