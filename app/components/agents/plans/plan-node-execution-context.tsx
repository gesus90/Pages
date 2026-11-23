import { ChevronDown, ChevronUp } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import {
  effectivePlanTarget,
  isSamePlanTarget,
  scriptLocalPaths,
} from "@/definition/AgentPlanTarget";

import { usePlanFlowContext } from "./plan-flow-context";
import { PLAN_TYPE_COLORS } from "./plan-layout";
import { PLAN_NODE_TEXT } from "./plan-node-text";

import type { AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";

/** Host and workspace of the target a node runs on, the inherited one included. */
function useExecutionRows(
  node: AgentPlanStep | AgentPlanScript | undefined,
): readonly (readonly [string, string])[] {
  const { t } = useTranslation();
  const { draft, sources, workspaces } = usePlanFlowContext();
  const target = node ? effectivePlanTarget(node, draft) : undefined;
  if (target?.kind === "remote") {
    const remote = sources.remoteTargets?.find(
      (entry) => entry.workspaceId === target.workspaceId,
    );
    return [
      ["host", remote?.connectionName ?? t("plans.execution.unavailable")],
      ["workspace", remote?.workspaceName ?? t("plans.execution.unavailable")],
    ];
  }
  const workspace = workspaces?.find((entry) => entry.id === draft.workspaceId);
  return [
    ["host", t("plans.execution.local")],
    ["workspace", workspace?.name ?? t("plans.execution.unavailable")],
  ];
}

/**
 * Marks a node whose own target differs from the plan's, and local paths a
 * script names while it runs remotely.
 * @remarks
 * Both stay visible in the warning color while the line is collapsed.
 */
function PlanTargetNotes({
  node,
}: {
  readonly node: AgentPlanStep | AgentPlanScript | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { draft } = usePlanFlowContext();
  if (!node) return null;
  const isDeviation =
    node.executionTarget !== undefined &&
    !isSamePlanTarget(node.executionTarget, draft.executionTarget);
  const localPaths =
    node.type === "script" && effectivePlanTarget(node, draft).kind === "remote"
      ? scriptLocalPaths(node)
      : [];
  if (!isDeviation && localPaths.length === 0) return null;
  return (
    <div
      data-plan-execution-notes=""
      className={cn(
        "flex flex-col gap-1 px-3.5 pb-2 text-center text-warning",
        PLAN_NODE_TEXT.meta,
      )}
    >
      {isDeviation ? (
        <p className="font-semibold">{t("plans.execution.deviation")}</p>
      ) : null}
      {localPaths.length > 0 ? (
        <p>
          {t("plans.execution.localPaths", { paths: localPaths.join(", ") })}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Names the actual selected host, workspace and access without inferring a live runner.
 * @remarks
 * One 34 px line below the rows reads „host · workspace“ with an arrow; it
 * opens the host, the workspace and, for an agent, the model access below
 * it. A node without a target of its own shows the plan's target it
 * inherits; a deviation from the plan and local paths of a remote script
 * stay visible while the line is collapsed.
 */
export function PlanNodeExecutionContext(props: {
  readonly step?: AgentPlanStep;
  readonly script?: AgentPlanScript;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const detailsId = useId();
  const node = props.step ?? props.script;
  const rows = useExecutionRows(node);
  const summary = rows.map(([, content]) => content).join(" · ");
  const Chevron = isOpen ? ChevronUp : ChevronDown;
  return (
    <div
      role="group"
      data-plan-execution=""
      aria-label={t("plans.execution.target")}
      className={cn("shrink-0 border-t", PLAN_TYPE_COLORS.line)}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={detailsId}
        title={summary}
        className={cn(
          "nodrag nopan flex h-[34px] w-full min-w-0 items-center justify-center gap-1 px-3.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
          PLAN_NODE_TEXT.field,
        )}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="truncate">{summary}</span>
        <Chevron aria-hidden="true" className="size-3.5 shrink-0" />
      </button>
      {isOpen ? (
        <dl
          id={detailsId}
          className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-3.5 pb-2.5 text-xs text-foreground"
        >
          {rows.map(([name, content]) => (
            <div className="contents" key={name}>
              <dt className="text-muted-foreground">
                {t(`plans.execution.${name}`)}
              </dt>
              <dd className="truncate text-right" title={content}>
                {content}
              </dd>
            </div>
          ))}
          {props.step ? <PlanModelAccess step={props.step} /> : null}
        </dl>
      ) : null}
      <PlanTargetNotes node={node} />
    </div>
  );
}
/** Resolves access from authorized catalog metadata, including nodes still using a template. */
function PlanModelAccess({
  step,
}: {
  readonly step: AgentPlanStep;
}): React.ReactElement {
  const { t } = useTranslation();
  const { sources } = usePlanFlowContext();
  const agent = sources.agents.find((entry) => entry.id === step.agentId);
  const configuration =
    step.configuration ?? (agent ? copyPlanConfiguration(agent) : null);
  const model = sources.models?.find(
    (entry) =>
      entry.connectionId === configuration?.connectionId &&
      entry.model === configuration?.model,
  );
  const access = model?.connectionName ?? t("plans.execution.unavailable");
  return (
    <>
      <dt className="text-muted-foreground">
        {t("plans.execution.modelAccess")}
      </dt>
      <dd className="truncate text-right" title={access}>
        {access}
      </dd>
    </>
  );
}
