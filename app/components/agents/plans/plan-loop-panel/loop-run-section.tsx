import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { PLAN_NODE_TEXT } from "../plan-node-text";

import type { AgentPlanLoopRun } from "@/definition/AgentPlanLoopRun";
import type {
  AgentPlanLoopConditionOutcome,
  AgentPlanLoopIteration,
  AgentPlanLoopSession,
} from "@/definition/AgentPlanLoopRun";

/** What the end condition made of one iteration, in words; absent facts are never invented. */
export function loopConditionText(
  outcome: AgentPlanLoopConditionOutcome,
  translate: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (outcome.state === "failed")
    return translate("plans.loops.run.conditionFailed", {
      reason: translate(`settings.agents.error.${outcome.code}`),
    });
  if (outcome.state === "evaluated")
    return translate(
      outcome.isMet
        ? "plans.loops.run.conditionMet"
        : "plans.loops.run.conditionNotMet",
    );
  return translate(`plans.loops.run.notEvaluated.${outcome.reason}`);
}

function shortId(id: string | null): string {
  return id === null ? "—" : id.slice(0, 18);
}

function SessionRow(props: {
  readonly session: AgentPlanLoopSession;
  readonly name: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { session } = props;
  return (
    <li className="rounded-lg border border-border px-3 py-2">
      <p className="flex items-center justify-between gap-2 text-xs font-medium">
        <span className="truncate">{props.name}</span>
        <span className="shrink-0 text-muted-foreground">
          {t(`plans.loops.run.sessionState.${session.state}`, {
            count: session.turns,
          })}
        </span>
      </p>
      <dl
        className={cn(
          "mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-muted-foreground",
          PLAN_NODE_TEXT.meta,
        )}
      >
        <dt>{t("plans.loops.run.acpSession")}</dt>
        <dd className="truncate font-mono" title={session.acpSessionId ?? ""}>
          {shortId(session.acpSessionId)}
        </dd>
        <dt>{t("plans.loops.run.nativeSession")}</dt>
        <dd className="truncate font-mono">
          {shortId(session.nativeSessionId)}
        </dd>
        <dt>{t("plans.loops.run.process")}</dt>
        <dd className="truncate font-mono" title={session.instanceId ?? ""}>
          {shortId(session.instanceId)}
        </dd>
        <dt>{t("plans.loops.run.created")}</dt>
        <dd>
          {session.createdInIteration === null
            ? "—"
            : t("plans.loops.run.iteration", {
                number: session.createdInIteration,
              })}
          {` · ${t(`plans.loops.run.closeout.${session.closeout}`)}`}
        </dd>
      </dl>
    </li>
  );
}

function IterationRow(props: {
  readonly iteration: AgentPlanLoopIteration;
}): React.ReactElement {
  const { t } = useTranslation();
  const { iteration } = props;
  return (
    <li className="rounded-lg border border-border px-3 py-2">
      <details>
        <summary className="flex cursor-pointer items-center justify-between gap-2 text-xs font-medium">
          <span>
            {t("plans.loops.run.iteration", { number: iteration.number })}
          </span>
          <span className="text-muted-foreground">
            {t(`plans.loops.status.${iteration.status}`)}
          </span>
        </summary>
        <p className={cn("mt-1 text-muted-foreground", PLAN_NODE_TEXT.meta)}>
          {loopConditionText(iteration.condition, t)}
        </p>
        <ul className="mt-2 flex flex-col gap-2">
          {iteration.nodes.map((node) => (
            <li key={node.id} className="text-xs">
              <p className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{node.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {t(`plans.loops.status.${node.status}`)}
                </span>
              </p>
              {node.output ? (
                <pre className="mt-1 max-h-28 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-[11px] leading-4 whitespace-pre-wrap">
                  {node.output}
                </pre>
              ) : null}
              {node.error ? (
                <p className="mt-1 text-destructive">
                  {t(`settings.agents.error.${node.error}`)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

/** What a run did in a loop: the iteration, its condition, the sessions and every iteration with its results. */
export function LoopRunSection(props: {
  readonly record: AgentPlanLoopRun;
  readonly names: ReadonlyMap<string, string>;
}): React.ReactElement {
  const { t } = useTranslation();
  const { record } = props;
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <h3 className="text-xs font-semibold">{t("plans.loops.run.title")}</h3>
      <p className="text-xs text-muted-foreground">
        {record.count
          ? t("plans.loops.run.summary", {
              done: record.iterations.filter(
                (entry) => entry.status === "succeeded",
              ).length,
              count: record.count.effective,
              mode: t(`plans.loops.mode.${record.count.mode}Short`),
              source: t(`plans.loops.source.${record.count.source}`),
            })
          : t("plans.loops.status.notStarted")}
        {record.completion
          ? ` · ${t(`plans.loops.completion.${record.completion}`)}`
          : ""}
        {` · ${t(`plans.loops.run.cleanup.${record.cleanup}`)}`}
      </p>
      {record.error ? (
        <p role="alert" className="text-xs text-destructive">
          {t(`settings.agents.error.${record.error}`)}
        </p>
      ) : null}
      {record.sessions.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {record.sessions.map((session) => (
            <SessionRow
              key={session.key}
              session={session}
              name={props.names.get(session.nodeId) ?? session.nodeId}
            />
          ))}
        </ul>
      ) : null}
      {record.iterations.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {record.iterations.map((iteration) => (
            <IterationRow key={iteration.id} iteration={iteration} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
