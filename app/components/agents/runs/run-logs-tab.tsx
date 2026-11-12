import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { cn } from "@/app/lib/cn";
import { formatLocalTime } from "@/app/components/agents/plans/plan-agent-console/console-time";

import { RUN_DIAGNOSIS_ENDPOINT } from "./run-diagnosis-model";

import type {
  AgentRunLogEntry,
  AgentRunLogLevel,
  AgentRunLogPage,
} from "@/definition/AgentRunDiagnosis";

const LEVELS: readonly AgentRunLogLevel[] = ["debug", "info", "warn", "error"];

const LEVEL_TONES: Readonly<Record<AgentRunLogLevel, string>> = {
  debug: "text-muted-foreground",
  info: "text-foreground",
  warn: "text-warning",
  error: "text-destructive",
};

function isLevel(value: string): value is AgentRunLogLevel {
  return LEVELS.some((level) => level === value);
}

function isLogPage(value: unknown): value is AgentRunLogPage {
  return typeof value === "object" && value !== null && "entries" in value;
}

interface LogState {
  readonly entries: readonly AgentRunLogEntry[];
  readonly nextCursor: string | null;
  readonly isTruncated: boolean;
}

async function readLogs(
  parameters: Readonly<Record<string, string>>,
  signal: AbortSignal,
): Promise<AgentRunLogPage> {
  const query = new URLSearchParams({ view: "logs", ...parameters });
  const response = await fetch(
    `${RUN_DIAGNOSIS_ENDPOINT}?${query.toString()}`,
    {
      signal,
      cache: "no-store",
    },
  );
  const body: unknown = await response.json();
  if (!response.ok || !isLogPage(body)) throw new Error("run logs");
  return body;
}

function LogLine({
  entry,
}: {
  readonly entry: AgentRunLogEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <li className="flex gap-2 border-b border-border/60 px-2 py-1 font-mono text-xs last:border-0">
      <span className="shrink-0 text-muted-foreground">
        {formatLocalTime(entry.at) ?? entry.at}
      </span>
      <span className={cn("w-10 shrink-0 uppercase", LEVEL_TONES[entry.level])}>
        {entry.level}
      </span>
      <span className="w-14 shrink-0 text-muted-foreground">
        {entry.source}
      </span>
      <span
        className={cn(
          "min-w-0 break-words whitespace-pre-wrap",
          LEVEL_TONES[entry.level],
        )}
      >
        {entry.message ?? t("runDiagnosis.logs.hiddenMessage")}
        {entry.isFiltered ? (
          <span className="ml-1 text-muted-foreground">
            ({t("runDiagnosis.logs.filtered")})
          </span>
        ) : null}
      </span>
    </li>
  );
}

function useRunLogs(
  runId: string,
  level: AgentRunLogLevel,
  stepId: string,
): {
  readonly state: LogState | null;
  readonly isLoading: boolean;
  readonly isFailed: boolean;
  readonly loadMore: () => void;
} {
  const [state, setState] = useState<LogState | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [isFailed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    readLogs(
      { runId, level, ...(stepId === "" ? {} : { stepId }) },
      controller.signal,
    )
      .then(setState)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [runId, level, stepId]);

  const loadMore = useCallback((): void => {
    if (state?.nextCursor == null) return;
    setLoading(true);
    void readLogs(
      {
        runId,
        level,
        ...(stepId === "" ? {} : { stepId }),
        cursor: state.nextCursor,
      },
      new AbortController().signal,
    )
      .then((page) =>
        setState({ ...page, entries: [...state.entries, ...page.entries] }),
      )
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [runId, level, stepId, state]);

  return { state, isLoading, isFailed, loadMore };
}

/** The log of a run or of one step, with level and step filters; credentials are already removed. */
export function RunLogsTab({
  runId,
}: {
  readonly runId: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const [level, setLevel] = useState<AgentRunLogLevel>("info");
  const [stepId, setStepId] = useState("");
  const { state, isLoading, isFailed, loadMore } = useRunLogs(
    runId,
    level,
    stepId,
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-36 space-y-1">
          <span className="block text-xs font-medium text-muted-foreground">
            {t("runDiagnosis.logs.level")}
          </span>
          <Select
            size="sm"
            value={level}
            onValueChange={(value) => {
              if (isLevel(value)) setLevel(value);
            }}
            ariaLabel={t("runDiagnosis.logs.level")}
            options={LEVELS.map((entry) => ({
              value: entry,
              label: t(`runDiagnosis.logs.levels.${entry}`),
            }))}
          />
        </div>
        <div className="min-w-48 flex-1 space-y-1">
          <label
            htmlFor="run-log-step"
            className="text-xs font-medium text-muted-foreground"
          >
            {t("runDiagnosis.logs.step")}
          </label>
          <Input
            id="run-log-step"
            value={stepId}
            placeholder={t("runDiagnosis.filters.stepPlaceholder")}
            onChange={(event) => setStepId(event.target.value.trim())}
          />
        </div>
      </div>
      {isFailed ? (
        <p role="alert" className="text-sm text-destructive">
          {t("runDiagnosis.loadFailed")}
        </p>
      ) : null}
      {state && state.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("runDiagnosis.logs.empty")}
        </p>
      ) : null}
      <ul className="max-h-[32rem] overflow-auto rounded-xl border border-border bg-surface">
        {(state?.entries ?? []).map((entry, index) => (
          <LogLine key={`${entry.at}:${String(index)}`} entry={entry} />
        ))}
      </ul>
      {state?.isTruncated ? (
        <p className="text-xs text-muted-foreground">
          {t("runDiagnosis.logs.truncated")}
        </p>
      ) : null}
      {state?.nextCursor ? (
        <Button
          size="sm"
          variant="outline"
          disabled={isLoading}
          onClick={loadMore}
        >
          {t("runDiagnosis.logs.loadMore")}
        </Button>
      ) : null}
      {isLoading && !state ? (
        <p className="text-sm text-muted-foreground">
          {t("runDiagnosis.loading")}
        </p>
      ) : null}
    </div>
  );
}
