import { Crosshair } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { Button } from "@/app/components/ui/button";

import { PlanExecutionDetails } from "./plan-execution-details";
import { PlanSwarmRun } from "./plan-swarm/plan-swarm-run";
import {
  hasOpenPlanReport,
  PlanStatusBadge,
  planStatusKey,
} from "./plan-status";
import { PlanStatusConfiguration } from "./plan-status-configuration";
import { isPlanDecisionResult, PlanStatusHistory } from "./plan-status-history";
import { stepTodoList } from "./plan-agent-todo-model";
import { TodoRow } from "./plan-status-todos";
import { PlanStatusRetry, PlanStatusStop } from "./plan-status-retry";
import { PlanRemoteHistory } from "./plan-remote-history";
import { PlanJumpRunLines } from "./plan-jump/plan-jump-run";
import { PlanSignalRunLine } from "./plan-jump/plan-signal-run";

import type { TFunction } from "i18next";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanScriptAssessment } from "@/definition/AgentPlanScriptReport";
import type { AgentPlanAcceptance } from "@/definition/AgentPlanSession";
import type { PlanSequenceBlockKind } from "./plan-step-sequence";

interface StatusDetailsProps {
  readonly step: AgentPlanStepResult | undefined;
  /** The status of the shown run, which says whether a decided Jump waits for the continuation. */
  readonly runStatus?: AgentPlanRun["status"];
  readonly blockedByName?: string | null;
  readonly number: number;
  /** The loop iteration or start of a repeated execution; absent for a node that runs once. */
  readonly pass?: number | null;
  /** Whether the step is only planned or assumed, absent or `actual` once it started. */
  readonly kind?: PlanSequenceBlockKind;
  readonly end: string | null;
  readonly canLocate: boolean;
  readonly onLocate: () => void;
}

function isScript(step: AgentPlanStepResult): boolean {
  return (
    step.script !== undefined ||
    (step.execution?.target.kind === "remote" &&
      step.execution.modelAccess.provider === "script")
  );
}

/** An agent node, as opposed to a script, a decision, a Jump or a signal. */
function isAgentStep(step: AgentPlanStepResult): boolean {
  return (
    !isScript(step) &&
    !isPlanDecisionResult(step) &&
    step.jump === undefined &&
    step.signal === undefined
  );
}

/** The line under the heading: what kind of node the step is. */
function nodeKind(step: AgentPlanStepResult, translate: TFunction): string {
  if (step.jump) return translate("plans.jump.title.out");
  if (step.signal) return translate("plans.signal.title");
  if (isPlanDecisionResult(step)) return translate("plans.nodeType.decision");
  return isScript(step)
    ? translate("plans.nodeType.script")
    : translate("plans.progress.agent", { name: step.name });
}

/** The note of a step whose disabled script skipped its process. */
function PlanStatusSkippedNote(props: {
  readonly isSkipped: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!props.isSkipped) return null;
  return (
    <p className="text-xs leading-4.5 text-success wrap-anywhere">
      {t("plans.run.skipped")}
    </p>
  );
}

/** Consistent run-step details, with honest empty states when the runner reports no live activity. */
export function PlanStatusDetails({
  step,
  runStatus,
  blockedByName,
  number,
  pass,
  kind,
  end,
  canLocate,
  onLocate,
}: StatusDetailsProps): React.ReactElement {
  const { t } = useTranslation();
  if (!step)
    return (
      <p className="px-4 py-3 text-xs leading-4.5 text-muted-foreground">
        {t("plans.progress.noSelection")}
      </p>
    );
  const hasAgentList = isAgentStep(step);
  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border @2xl/status:flex-row">
      <ScrollViewport
        axis="vertical"
        tabIndex={0}
        role="region"
        aria-label={t("plans.progress.open")}
        containerClassName="min-h-0 min-w-0 flex-1"
        className="flex flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-3 text-xs leading-4.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
      >
        <section aria-label={t("plans.progress.step", { number })}>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm leading-5 font-semibold wrap-anywhere">
                {t("plans.progress.step", { number })} · {step.name}
                {pass ? ` · ${t("plans.progress.pass", { pass })}` : null}
              </h3>
              <p className="text-xs leading-4.5 text-muted-foreground wrap-anywhere">
                {nodeKind(step, t)}
              </p>
            </div>
            <PlanStatusBadge
              status={step.status}
              isBlocked={step.isBlocked}
              hasOpenReport={hasOpenPlanReport(step)}
              className="rounded-sm px-1.5 py-0.5 text-[0.6875rem] leading-4"
            />
          </div>
          <PlanStatusSkippedNote isSkipped={step.skipped === true} />
          {kind && kind !== "actual" ? (
            <p className="text-xs leading-4.5 text-muted-foreground wrap-anywhere">
              {t(`plans.progress.outlook.${kind}`)}
            </p>
          ) : null}
          {hasOpenPlanReport(step) ? (
            <p className="text-xs leading-4.5 text-warning wrap-anywhere">
              {t("plans.progress.reportOpenHint")}
            </p>
          ) : null}
          {step.isBlocked && blockedByName ? (
            <p className="text-xs leading-4.5 text-destructive wrap-anywhere">
              {t("plans.progress.blockedBy", { name: blockedByName })}
            </p>
          ) : null}
          <PlanStatusStop stop={step.failureStop} />
          {step.isDisplayFiltered ? (
            <p className="text-xs text-muted-foreground">
              {t("plans.progress.filteredOutput")}
            </p>
          ) : null}
          <PlanStatusHistory step={step} />
          <PlanStatusReport acceptance={step.session?.acceptance} />
          <PlanScriptReport report={step.report} />
          <PlanExecutionDetails step={step} />
          <StepConfiguration step={step} end={end} runStatus={runStatus} />
          {hasAgentList ? <PlanStatusActivity step={step} /> : null}
          <PlanRemoteHistory step={step} />
          <Button
            size="sm"
            variant="ghost"
            className="mt-2 h-auto min-h-8 max-w-full justify-start rounded-md px-0 text-xs leading-4.5 text-muted-foreground whitespace-normal xl:min-h-8 xl:px-0 xl:text-xs [@media(pointer:coarse)]:min-h-11"
            onClick={onLocate}
            disabled={!canLocate}
          >
            <Crosshair aria-hidden="true" className="size-4 shrink-0" />
            {t(
              canLocate
                ? "plans.progress.locate"
                : "plans.progress.nodeMissing",
            )}
          </Button>
        </section>
      </ScrollViewport>
      {hasAgentList ? <PlanStatusAgentTodos step={step} /> : null}
    </div>
  );
}

function StepConfiguration({
  step,
  end,
  runStatus,
}: Pick<
  StatusDetailsProps,
  "step" | "end" | "runStatus"
>): React.ReactElement | null {
  const { t } = useTranslation();
  if (!step) return null;
  if (isPlanDecisionResult(step)) return null;
  if (step.jump)
    return (
      <PlanJumpRunLines
        jump={step.jump}
        stepStatus={step.status}
        runStatus={runStatus}
      />
    );
  if (step.signal) return <PlanSignalRunLine signal={step.signal} />;
  if (step.swarm)
    return (
      <PlanSwarmRun
        run={step.swarm}
        workerCount={step.swarm.workers.length}
        error={step.status === "failed" ? step.error : null}
      />
    );
  if (step.script) return <PlanScriptRun step={step} />;
  if (isScript(step)) return <PlanRemoteScriptRun step={step} />;
  if (step.session)
    return (
      <>
        <PlanStatusRetry session={step.session} />
        <PlanStatusConfiguration
          session={step.session}
          end={end}
          isRunning={step.status === "running"}
        />
      </>
    );
  return (
    <p className="text-xs leading-4.5 text-muted-foreground">
      {t("plans.progress.noConfiguration")}
    </p>
  );
}

function PlanScriptReport({
  report,
}: {
  readonly report: AgentPlanScriptAssessment | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!report) return null;
  return (
    <section
      className="mb-3 space-y-1"
      aria-label={t("plans.scripts.reportTitle")}
    >
      <h4 className="font-semibold">
        {t("plans.scripts.reportTitle")} ·{" "}
        {t(`plans.scripts.reportStatus.${report.status}`)}
      </h4>
      <p className="wrap-anywhere">{report.summary}</p>
      <p className="text-xs text-muted-foreground">
        {t("plans.scripts.reportCounts", {
          total: report.checkCount,
          failed: report.failedCount,
          partial: report.partialCount,
        })}
      </p>
    </section>
  );
}

const REPORT_ISSUES: Readonly<Record<string, string>> = {
  report_missing: "missing",
  report_invalid: "invalid",
  todo_open: "todoOpen",
  todo_missing: "todoMissing",
  criterion_missing: "criterionMissing",
  criterion_unmet: "criterionUnmet",
  evidence_missing: "evidenceMissing",
  ticket_unchecked: "ticketUnchecked",
  ticket_unreadable: "ticketUnreadable",
  ticket_changed: "ticketChanged",
};

function PlanStatusReport({
  acceptance,
}: {
  readonly acceptance: AgentPlanAcceptance | null | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!acceptance) return null;
  return (
    <section className="mb-3 space-y-1" aria-label={t("plans.progress.report")}>
      <h4 className="font-semibold">
        {t("plans.progress.report")} ·{" "}
        {t(`plans.progress.reportVerdict.${acceptance.verdict}`)}
      </h4>
      {acceptance.message ? (
        <p className="wrap-anywhere">{acceptance.message}</p>
      ) : null}
      {acceptance.summary ? (
        <p className="wrap-anywhere">{acceptance.summary}</p>
      ) : null}
      {acceptance.issues.length ? (
        <ul className="list-inside list-disc text-warning">
          {acceptance.issues.map((issue, index) => {
            const separator = issue.indexOf(":");
            const code = separator < 0 ? issue : issue.slice(0, separator);
            const id = separator < 0 ? "" : issue.slice(separator + 1);
            const key = REPORT_ISSUES[code];
            return (
              <li key={`${issue}-${index}`} className="wrap-anywhere">
                {key
                  ? t(`plans.progress.reportIssue.${key}`, { id })
                  : t("plans.progress.reportIssue.other", { issue })}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function PlanScriptRun({
  step,
}: {
  readonly step: AgentPlanStepResult;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const script = step.script;
  if (!script) return null;
  const details: readonly [string, string | number | null][] = [
    ["profile", script.interpreterProfileId],
    ["directory", script.directory],
    ["identity", `${script.userId} · uid ${script.uid} · gid ${script.gid}`],
    ["attempt", script.attemptId],
    ["process", script.processId],
    ["started", script.startedAt],
    ["ended", script.endedAt],
    ["exit", script.exitCode],
    ["signal", script.signal],
    [
      "cause",
      script.failure
        ? t(`settings.agents.error.plan_script_${script.failure}`)
        : null,
    ],
    ["closeout", t(`plans.scripts.run.${script.closeout}`)],
  ];
  return (
    <section className="min-w-0 space-y-3">
      <h4 className="font-medium">{t("plans.scripts.run.title")}</h4>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 wrap-anywhere">
        {details.map(([label, text]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">
              {t(`plans.scripts.run.${label}`)}
            </dt>
            <dd className="whitespace-pre-wrap">{text ?? "—"}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground">
        {t("plans.scripts.run.lifecycle")}
      </p>
      {step.error ? (
        <p role="alert" className="text-destructive">
          {t(`settings.agents.error.${step.error}`, {
            defaultValue: step.error,
          })}
        </p>
      ) : null}
      <PlanScriptStream name="stdout" text={script.stdout} />
      <PlanScriptStream name="stderr" text={script.stderr} />
    </section>
  );
}

function PlanStatusAgentTodos({
  step,
}: {
  readonly step: AgentPlanStepResult;
}): React.ReactElement {
  const { t } = useTranslation();
  const agent = stepTodoList(step);
  const isListed = agent.total > 0;
  const heading = t("plans.progress.agentTodos.heading");
  return (
    <section
      aria-label={heading}
      data-agent-todos=""
      className="flex max-h-44 min-h-0 shrink-0 flex-col border-t border-border px-4 py-3 @2xl/status:max-h-none @2xl/status:w-72 @2xl/status:border-t-0 @2xl/status:border-l"
    >
      <div className="flex shrink-0 items-baseline justify-between gap-2">
        <h3 className="text-sm leading-5 font-semibold">{heading}</h3>
        {isListed ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {t("plans.progress.agentTodos.count", {
              done: agent.done,
              total: agent.total,
            })}
          </span>
        ) : null}
      </div>
      {isListed ? (
        <ScrollViewport
          as="ul"
          axis="vertical"
          aria-label={heading}
          containerClassName="mt-1 min-h-0 flex-1"
          className="overscroll-contain py-1"
        >
          {agent.todos.map((todo) => (
            <TodoRow key={todo.id} item={todo} />
          ))}
        </ScrollViewport>
      ) : (
        <p className="py-2 text-xs leading-4.5 text-muted-foreground">
          {t("plans.progress.agentTodos.empty")}
        </p>
      )}
    </section>
  );
}

function PlanStatusActivity({
  step,
}: {
  readonly step: AgentPlanStepResult;
}): React.ReactElement | null {
  if (
    step.remote?.liveHistoryVersion === 1 &&
    !step.session?.activity?.titles.length &&
    !step.isBlocked
  )
    return null;
  return <ReportedActivity step={step} />;
}

function ReportedActivity({
  step,
}: {
  readonly step: AgentPlanStepResult;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const reportedAt = step.session?.activity?.reportedAt;
  const timestamp = reportedAt ? new Date(reportedAt) : null;
  const time =
    timestamp && Number.isFinite(timestamp.getTime())
      ? `${new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "medium", timeZone: "UTC" }).format(timestamp)} UTC`
      : t("plans.progress.notReported");
  const titles = step.session?.activity?.titles ?? [];
  const isRunning = step.status === "running";
  const heading = isRunning
    ? "plans.progress.activity"
    : "plans.progress.lastActivity";
  return (
    <section className="mt-4 border-t border-border/80 pt-3">
      <h4 className="border-l-4 border-primary pl-3 text-xs leading-4.5 font-medium text-muted-foreground">
        {t(heading)}
      </h4>
      {titles.length ? (
        <ul className="mt-2 space-y-2">
          {titles.map((content, index) => {
            const [title, ...description] = content.split("\n");
            return (
              <li key={`${index}:${title}`}>
                <p className="text-xs leading-4.5 font-semibold wrap-anywhere">
                  {title}
                </p>
                {description.length ? (
                  <p className="mt-1 text-xs leading-4.5 whitespace-pre-wrap text-muted-foreground wrap-anywhere">
                    {description.join("\n")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-xs leading-4.5 text-muted-foreground">
          {t(
            isRunning
              ? "plans.progress.noActivity"
              : "plans.progress.noLiveActivity",
          )}
        </p>
      )}
      {titles.length ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("plans.progress.activitySource", { time })}
        </p>
      ) : null}
      {step.isBlocked && step.error ? (
        <p className="mt-2 text-xs leading-4.5 text-destructive">
          {t(`settings.agents.error.${step.error}`, {
            defaultValue: t(planStatusKey(step.status, step.isBlocked)),
          })}
        </p>
      ) : null}
    </section>
  );
}

function remoteScriptDetails(
  step: AgentPlanStepResult,
  translate: TFunction,
): readonly [string, string | number | null][] {
  const { execution } = step;
  return [
    ["profile", execution?.interpreterProfileId ?? null],
    ["directory", execution?.workspace.path ?? null],
    ["attempt", execution?.attemptId ?? null],
    ...processDetails(step.remote, translate),
  ];
}

function processDetails(
  remote: AgentPlanStepResult["remote"],
  translate: TFunction,
): readonly [string, string | number | null][] {
  return [
    ["observedStart", remote?.startedAt ?? null],
    ["observedEnd", remote?.endedAt ?? null],
    ["exit", remote?.exitCode ?? null],
    ["signal", remote?.signal ?? null],
    [
      "closeout",
      remote ? translate(`plans.scripts.run.${remote.closeout}`) : null,
    ],
  ];
}

function hasPartialOutput(step: AgentPlanStepResult): boolean {
  return ["timeout", "cancelled", "output_limit", "lost", "storage"].includes(
    step.remote?.reason ?? "",
  );
}

function PlanRemoteScriptRun({
  step,
}: {
  readonly step: AgentPlanStepResult;
}): React.ReactElement {
  const { t } = useTranslation();
  const remote = step.remote;
  const rows = remoteScriptDetails(step, t);
  return (
    <section className="min-w-0 space-y-3">
      <h4 className="font-medium">{t("plans.scripts.run.title")}</h4>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 wrap-anywhere">
        {rows.map(([label, text]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">
              {t(`plans.scripts.run.${label}`)}
            </dt>
            <dd className="whitespace-pre-wrap">{text ?? "—"}</dd>
          </div>
        ))}
      </dl>
      {step.error ? (
        <p role="alert" className="text-destructive">
          {t(`settings.agents.error.${step.error}`, {
            defaultValue: step.error,
          })}
        </p>
      ) : null}
      <p className="text-muted-foreground">
        {t("plans.scripts.run.remoteTail")}
      </p>
      {hasPartialOutput(step) ? (
        <p className="text-muted-foreground">
          {t("plans.scripts.run.remotePartial")}
        </p>
      ) : null}
      <PlanScriptStream name="stdout" text={remote?.stdout ?? step.output} />
      <PlanScriptStream name="stderr" text={remote?.stderr ?? null} />
    </section>
  );
}

function PlanScriptStream({
  name,
  text,
}: {
  readonly name: string;
  readonly text: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  let content = text;
  if (content === null) content = t("plans.scripts.run.missing");
  else if (content === "") content = t("plans.scripts.run.empty");
  return (
    <div className="space-y-1">
      <h5 className="font-medium">{name}</h5>
      <ScrollViewport
        as="pre"
        axis="both"
        tabIndex={0}
        aria-label={name}
        isShell
        containerClassName="max-h-64 rounded-md border border-border bg-muted"
        className="overflow-auto p-2 font-mono text-xs whitespace-pre-wrap wrap-anywhere"
      >
        {content}
      </ScrollViewport>
    </div>
  );
}
