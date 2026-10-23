import { useTranslation } from "react-i18next";

import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import {
  effectivePlanTarget,
  isSamePlanTarget,
  scriptLocalPaths,
} from "@/definition/AgentPlanTarget";

import { usePlanFlowContext } from "./plan-flow-context";

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
  return (
    <>
      {isDeviation ? (
        <dd className="col-span-2 font-semibold text-status-active">
          {t("plans.execution.deviation")}
        </dd>
      ) : null}
      {localPaths.length > 0 ? (
        <dd className="col-span-2 text-warning">
          {t("plans.execution.localPaths", { paths: localPaths.join(", ") })}
        </dd>
      ) : null}
    </>
  );
}

/**
 * Names the actual selected host, workspace and access without inferring a live runner.
 *
 * @remarks
 * A node without a target of its own shows the plan's target it inherits;
 * a node with another target than the plan is marked as a deviation.
 */
export function PlanNodeExecutionContext(props: {
  readonly step?: AgentPlanStep;
  readonly script?: AgentPlanScript;
}): React.ReactElement {
  const { t } = useTranslation();
  const node = props.step ?? props.script;
  const rows = useExecutionRows(node);
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 py-2 text-xs text-foreground">
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
      <PlanTargetNotes node={node} />
    </dl>
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
