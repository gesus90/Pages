import { useTranslation } from "react-i18next";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";

/** Shows only the frozen requested context and the actual attempt identity, without credentials. */
export function PlanExecutionDetails({
  step,
}: {
  readonly step: AgentPlanStepResult;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const execution = step.execution;
  if (!execution) return null;
  const target = execution.target;
  const rows: readonly (readonly [string, string])[] = [
    ["revision", String(execution.planRevision)],
    [
      "target",
      target.kind === "remote"
        ? target.connectionName
        : t("plans.execution.local"),
    ],
    [
      "workspace",
      target.kind === "remote"
        ? `${target.workspaceName} · ${target.path}`
        : execution.workspace.path,
    ],
    [
      "modelAccess",
      execution.modelAccess.provider === "script"
        ? t("plans.progress.notApplicable")
        : `${execution.modelAccess.connectionName} · ${execution.modelAccess.provider}`,
    ],
    ["model", execution.modelAccess.model || t("plans.progress.notApplicable")],
    [
      "reasoning",
      execution.modelAccess.provider === "script"
        ? t("plans.progress.notApplicable")
        : t("plans.execution.frozenReasoning", {
            reasoning:
              execution.modelAccess.reasoningEffort ??
              t("pageAgents.defaultReasoning"),
          }),
    ],
  ];
  const identifiers: readonly (readonly [string, string])[] = [
    ["planId", execution.planId],
    ["runId", execution.runId],
    ["stepId", step.id],
    [
      "attemptId",
      step.script?.attemptId ?? step.session?.attemptId ?? execution.attemptId,
    ],
    [
      "workspace",
      target.kind === "remote"
        ? `${target.workspaceId} · r${target.workspaceRevision}`
        : `${execution.workspace.id} · r${execution.workspace.revision}`,
    ],
    [
      "modelAccess",
      execution.modelAccess.connectionId ?? t("plans.progress.notApplicable"),
    ],
    ...(target.kind === "remote"
      ? [
          [
            "target",
            `${target.connectionId} · r${target.connectionRevision}`,
          ] as const,
        ]
      : []),
  ];
  return (
    <section className="mb-3 space-y-2">
      <h4 className="font-semibold">{t("plans.execution.snapshot")}</h4>
      <ExecutionRows rows={rows} />
      <details className="pt-1">
        <summary className="cursor-pointer text-muted-foreground">
          {t("plans.execution.identifiers")}
        </summary>
        <div className="pt-2">
          <ExecutionRows rows={identifiers} />
        </div>
      </details>
    </section>
  );
}

/** Keeps long identifiers readable without displacing the frozen execution context. */
function ExecutionRows({
  rows,
}: {
  readonly rows: readonly (readonly [string, string])[];
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <dl className="grid grid-cols-[minmax(0,6.5625rem)_minmax(0,1fr)] gap-x-3 gap-y-1">
      {rows.map(([name, content]) => (
        <div className="contents" key={name}>
          <dt className="text-muted-foreground wrap-anywhere">
            {t(`plans.execution.${name}`)}
          </dt>
          <dd className="min-w-0 wrap-anywhere">{content}</dd>
        </div>
      ))}
    </dl>
  );
}
