import { nameOf } from "./automation-labels";
import {
  EMPTY_CELL,
  formatDuration,
  formatPastMoment,
} from "./automation-time-format";

import type {
  Automation,
  AutomationRunResult,
  AutomationRunSummary,
} from "@/definition/Automation";
import type { LabelContext } from "./automation-time-format";

/** The color of a run's status dot. */
export type RunTone = "ok" | "warning" | "error" | "running" | "none";

/** Where a run summary is shown: the panel names the duration, the history the agent. */
export type RunSummaryPlace = "panel" | "history";

/** What a summary of a run is built from. */
export interface RunSummarySource {
  readonly run: AutomationRunSummary;
  /** The automation of the run, when it is still visible. */
  readonly automation: Automation | undefined;
  readonly place: RunSummaryPlace;
}

const LONG_RUN_MS = 60_000;

function isFinished(run: AutomationRunSummary): boolean {
  return run.status === "completed" || run.status === "failed";
}

function hasFailedScript(result: AutomationRunResult): boolean {
  return (
    result.outcome === "failed" ||
    (result.exitCode !== null && result.exitCode !== 0)
  );
}

/**
 * The tone of a run's dot: green for ok, amber for skipped runs and failed
 * scripts that woke their agent, red for failures and missing rights, blue
 * while it runs or waits.
 */
export function runTone(run: AutomationRunSummary | null): RunTone {
  if (!run) return "none";
  if (!isFinished(run)) return "running";
  const result = run.result;
  if (!result) return run.status === "failed" ? "error" : "ok";
  if (result.outcome === "skipped") return "warning";
  if (result.forward === "woken" && hasFailedScript(result)) return "warning";
  if (result.outcome === "ok") return "ok";
  return "error";
}

function pendingText(source: RunSummarySource, context: LabelContext): string {
  const { t } = context;
  if (source.run.status === "queued") return t("automations.runs.queued");
  if (
    source.run.status === "accepted" &&
    source.automation?.action.type !== "script" &&
    source.automation?.action.type !== "plan"
  )
    return t("automations.runs.waitingAgent");
  return t("automations.runs.running");
}

function scriptText(
  result: AutomationRunResult,
  automation: Automation | undefined,
  context: LabelContext,
): string {
  const { t } = context;
  const exit =
    result.exitCode === 0
      ? t("automations.runs.scriptOk")
      : t("automations.runs.scriptExit", { code: result.exitCode ?? "?" });
  if (result.forward === null) return exit;
  if (result.forward === "not_woken")
    return `${exit} · ${t("automations.runs.noAgentWoken")}`;
  const forward =
    automation?.action.type === "script" ? automation.action.forward : null;
  return `${exit} · ${t("automations.runs.agentWoken", {
    agent: nameOf(context, forward?.agentId),
  })}`;
}

function planText(result: AutomationRunResult, context: LabelContext): string {
  const { t } = context;
  if (!result.planRunId) return t("automations.runs.planNotStarted");
  const started = t("automations.runs.planStarted");
  if (!result.planRunStatus) return started;
  return `${started} · ${t(`automations.runs.planRun.${result.planRunStatus}`, {
    defaultValue: t("automations.runs.planRun.other", {
      status: result.planRunStatus,
    }),
  })}`;
}

function agentText(source: RunSummarySource, context: LabelContext): string {
  const { t } = context;
  const result = source.run.result;
  const summary =
    result?.summary ??
    t(
      result?.outcome === "ok"
        ? "automations.runs.done"
        : "automations.runs.failed",
    );
  const lead =
    source.place === "panel"
      ? formatDuration(source.run.duration, t)
      : agentName(source, context);
  return lead === EMPTY_CELL ? summary : `${lead} · ${summary}`;
}

function agentName(source: RunSummarySource, context: LabelContext): string {
  const action = source.automation?.action;
  return action?.type === "agent"
    ? nameOf(context, action.agentId)
    : EMPTY_CELL;
}

function isScriptResult(
  result: AutomationRunResult,
  automation: Automation | undefined,
): boolean {
  return (
    automation?.action.type === "script" ||
    result.exitCode !== null ||
    result.forward !== null
  );
}

function resultText(
  source: RunSummarySource,
  result: AutomationRunResult,
  context: LabelContext,
): string {
  const { t } = context;
  if (result.outcome === "forbidden") {
    const forbidden = t("automations.runs.forbidden");
    return result.paused
      ? `${forbidden} · ${t("automations.runs.paused")}`
      : forbidden;
  }
  if (result.outcome === "skipped")
    return result.summary
      ? `${t("automations.runs.skipped")} · ${result.summary}`
      : t("automations.runs.skipped");
  if (isScriptResult(result, source.automation))
    return scriptText(result, source.automation, context);
  if (source.automation?.action.type === "plan" || result.planRunId)
    return planText(result, context);
  return agentText(source, context);
}

/**
 * Says how a run went: "Skript Exit 1 · All Might geweckt", "9 Min. ·
 * Bericht", "Plan gestartet · Lauf fehlgeschlagen", "Rechte fehlen ·
 * pausiert", "läuft", "vorgemerkt" or "wartet auf Agent".
 */
export function runSummaryText(
  source: RunSummarySource,
  context: LabelContext,
): string {
  if (!isFinished(source.run)) return pendingText(source, context);
  const result = source.run.result;
  if (!result)
    return context.t(
      source.run.status === "failed"
        ? "automations.runs.failed"
        : "automations.runs.ok",
    );
  return resultText(source, result, context);
}

function lastRunOutcome(
  run: AutomationRunSummary,
  context: LabelContext,
): string {
  const { t } = context;
  if (run.status === "queued") return t("automations.runs.queued");
  if (!isFinished(run)) return t("automations.runs.running");
  const outcome =
    run.result?.outcome ?? (run.status === "failed" ? "failed" : "ok");
  if (outcome !== "ok") return t(`automations.runs.${outcome}`);
  if (run.duration !== null && run.duration >= LONG_RUN_MS)
    return formatDuration(run.duration, t);
  return t("automations.runs.ok");
}

/**
 * The last run for the table: "vor 9 Min. · ok", "heute 08:00 · 4 Min.",
 * "gestern 22:00 · fehlgeschlagen" or "—".
 */
export function lastRunText(
  run: AutomationRunSummary | null,
  context: LabelContext,
): string {
  if (!run) return EMPTY_CELL;
  const moment = formatPastMoment(run.startedAt ?? run.queuedAt, context);
  return `${moment} · ${lastRunOutcome(run, context)}`;
}
