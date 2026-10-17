import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
} from "@xyflow/react";
import { Unlink } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { usePlanFlowContext } from "./plan-flow-context";

import type { EdgeProps } from "@xyflow/react";
import type { PlanFlowEdge } from "./plan-flow-model";

/** Flow uses solid curves; parameter bindings use dashed orthogonal paths and a named input. */
export function PlanFlowEdgeView(
  props: EdgeProps<PlanFlowEdge>,
): React.ReactElement | null {
  const { t } = useTranslation();
  const { graph, canEdit } = usePlanFlowContext();
  const details = props.data;
  if (!details) return null;
  const isData = details.link.kind === "data";
  const [path, labelX, labelY] = isData
    ? getSmoothStepPath(props)
    : getBezierPath(props);
  const label =
    details.link.kind === "data"
      ? details.link.parameter
      : t("plans.linkKind.flow");
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        interactionWidth={28}
        style={{
          stroke: props.selected
            ? "var(--color-info)"
            : "var(--color-muted-foreground)",
          strokeWidth: props.selected ? 2.5 : 1.75,
          strokeDasharray: isData ? "6 5" : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute flex items-center gap-1"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          <button
            type="button"
            className={cn(
              "max-w-40 truncate rounded-full border bg-surface px-2 py-0.5 text-[10px] shadow-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              props.selected
                ? "border-info text-info"
                : "border-border text-muted-foreground",
              isData && "border-dashed",
            )}
            title={details.name}
            aria-label={`${t(`plans.linkKind.${details.link.kind}`)}: ${details.name}`}
            aria-pressed={props.selected}
            onClick={() => graph.selectLink(details.link)}
          >
            {isData ? "◇ " : "→ "}
            {label}
          </button>
          {props.selected ? (
            <Button
              size="icon-sm"
              variant="destructive-soft"
              className="bg-surface shadow-xs"
              disabled={!canEdit}
              aria-label={t("plans.removeLink", { name: details.name })}
              onClick={() => graph.disconnect(details.link)}
            >
              <Unlink className="size-3.5" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
