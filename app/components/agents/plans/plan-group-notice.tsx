import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import type { PlanGroupNotice } from "./use-plan-group-actions";

function useNoticeText(notice: PlanGroupNotice): string {
  const { t } = useTranslation();
  if (notice.kind === "moved")
    return t(`plans.${notice.frame === "loop" ? "loops" : "groups"}.moved`, {
      edges: notice.removedEdges,
      bindings: notice.removedBindings,
    });
  return t(`plans.groups.refusal.${notice.refusal}`, {
    name: notice.name,
    adapter: t(`plans.groups.adapter.${notice.adapter ?? "neutral"}`),
    group: t(`plans.groups.adapter.${notice.groupAdapter ?? "neutral"}`),
  });
}

/** Tells why a group refused an agent, or which connections a move had to drop. */
export function PlanGroupNoticeBar(props: {
  readonly notice: PlanGroupNotice;
  readonly onClose: () => void;
  readonly className?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const text = useNoticeText(props.notice);
  const isRefusal = props.notice.kind === "refused";
  return (
    <div
      role={isRefusal ? "alert" : "status"}
      className={cn(
        "flex max-w-[min(36rem,calc(100%-1rem))] items-start gap-2 rounded-lg border bg-surface p-2 pl-3 text-sm shadow-xs",
        isRefusal ? "border-destructive/40 text-destructive" : "border-border",
        props.className,
      )}
    >
      <p className="min-w-0 flex-1">{text}</p>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t("plans.groups.closeNotice")}
        onClick={props.onClose}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
