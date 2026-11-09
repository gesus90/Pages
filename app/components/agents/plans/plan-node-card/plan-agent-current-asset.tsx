import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { planAssetUrl } from "@/app/lib/plan-asset-upload";
import { currentPlanStackEntry } from "@/definition/AgentPlanStack";
import { planAssetTypeMark } from "@/definition/AgentPlanAsset";

import { usePlanFlowContext } from "../plan-flow-context";
import { PLAN_NODE_TEXT } from "../plan-node-text";
import { formatPlanAssetSize, planAssetKindLabel } from "./plan-asset-format";

import type {
  AgentPlanInput,
  AgentPlanRun,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanAssetFile } from "@/definition/AgentPlanAsset";

/** The file the newest trigger of a stack handed to one of the node's inputs, if any. */
function currentAsset(
  step: AgentPlanStep,
  plan: AgentPlanInput,
  run: AgentPlanRun | null,
): AgentPlanAssetFile | null {
  if (!run) return null;
  for (const binding of Object.values(step.bindings)) {
    if (binding.kind !== "stack" || binding.output !== "content") continue;
    const stack = plan.nodes.find((node) => node.id === binding.stackId);
    if (stack?.type !== "stack") continue;
    const entry = currentPlanStackEntry(
      stack,
      run.stacks?.find((record) => record.id === stack.id),
    );
    if (entry?.type === "asset") return entry.file;
  }
  return null;
}

/**
 * While a run is shown: the unchanged task of the agent and the file it receives now.
 *
 * @remarks
 * A stack hands the agent one file per iteration; the task stays the same,
 * so the card names both, such as „Aktuell: hund.jpg“.
 */
export function PlanAgentCurrentAsset(props: {
  readonly step: AgentPlanStep;
}): React.ReactElement | null {
  const { t, i18n } = useTranslation();
  const { draft, runPlan, run } = usePlanFlowContext();
  const file = currentAsset(props.step, runPlan ?? draft, run);
  if (!file) return null;
  const instruction = props.step.instruction.trim();
  return (
    <div
      data-plan-current-asset={file.assetId}
      className="flex flex-col gap-1.5"
    >
      {instruction ? (
        <div className="flex flex-col gap-1">
          <span
            className={cn(
              "font-semibold text-muted-foreground",
              PLAN_NODE_TEXT.meta,
            )}
          >
            {t("plans.asset.taskUnchanged")}
          </span>
          <p
            className={cn(
              "line-clamp-2 rounded-md bg-muted px-2 py-1.5 text-foreground",
              PLAN_NODE_TEXT.field,
            )}
            title={instruction}
          >
            {instruction}
          </p>
        </div>
      ) : null}
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-1.5 py-1">
        <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded bg-plan-asset-subtle">
          {file.kind === "image" ? (
            <img
              src={planAssetUrl(file.assetId)}
              alt=""
              draggable={false}
              className="size-full object-cover"
            />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className={cn("truncate font-semibold", PLAN_NODE_TEXT.field)}>
            {t("plans.asset.current", { name: file.fileName })}
          </span>
          <span
            className={cn(
              "truncate text-muted-foreground",
              PLAN_NODE_TEXT.meta,
            )}
          >
            {[
              planAssetKindLabel(file.kind, t),
              planAssetTypeMark(file),
              formatPlanAssetSize(file.size, i18n.language),
            ].join(" · ")}
          </span>
        </span>
      </div>
    </div>
  );
}
