import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";

import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import {
  AGENT_LEARNING_INTERVAL_HOURS,
  AGENT_MEMORY_LIMITS,
  countWords,
} from "@/definition/AgentEmployee";

import type {
  AgentEmployee,
  AgentLearningResult,
  AgentMemoryDetails,
} from "@/definition/AgentEmployee";

interface AgentMemorySectionProps {
  readonly memory: string;
  readonly onMemory: (value: string) => void;
  readonly isLearningEnabled: boolean;
  readonly onLearning: (isEnabled: boolean) => void;
  /** The stored agent; `null` while it is created. */
  readonly agent: AgentEmployee | null;
  readonly details: AgentMemoryDetails | null;
  readonly isDisabled: boolean;
}

/** One memory level: its words against its limit, as a bar. */
function UsageBar({
  label,
  words,
  maximum,
}: {
  readonly label: string;
  readonly words: number;
  readonly maximum: number;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const format = new Intl.NumberFormat(i18n.language);
  const share = Math.min(100, Math.round((words / maximum) * 100));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {t("agentEmployees.memory.words", {
            words: format.format(words),
            maximum: format.format(maximum),
          })}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={maximum}
        aria-valuenow={words}
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${share}%` }}
        />
      </div>
    </div>
  );
}

function useDateTime(): (iso: string | null) => string {
  const { t, i18n } = useTranslation();
  const format = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (iso) =>
    iso === null
      ? t("agentEmployees.memory.never")
      : format.format(new Date(iso));
}

function resultText(
  result: AgentLearningResult | null,
  translate: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!result) return translate("agentEmployees.memory.noRun");
  return translate(`agentEmployees.memory.result.${result.status}`, {
    added: result.added,
    merged: result.merged,
    archived: result.archived,
    removed: result.removed,
  });
}

/** Learning switch, rhythm, both levels and the last and next run. */
function LearningOverview(props: AgentMemorySectionProps): React.ReactElement {
  const { t } = useTranslation();
  const formatTime = useDateTime();
  const learningId = useId();
  const rhythmId = useId();
  const learning = props.agent?.learning ?? null;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" htmlFor={learningId}>
            {t("agentEmployees.memory.autoLearn")}
          </label>
          <Select
            id={learningId}
            ariaLabel={t("agentEmployees.memory.autoLearn")}
            className="w-full"
            value={props.isLearningEnabled ? "on" : "off"}
            disabled={props.isDisabled}
            onValueChange={(value) => props.onLearning(value === "on")}
            options={[
              { value: "on", label: t("agentEmployees.memory.on") },
              { value: "off", label: t("agentEmployees.memory.off") },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" htmlFor={rhythmId}>
            {t("agentEmployees.memory.rhythm")}
          </label>
          <Select
            id={rhythmId}
            ariaLabel={t("agentEmployees.memory.rhythm")}
            className="w-full"
            value="12"
            disabled
            onValueChange={() => undefined}
            options={[
              {
                value: "12",
                label: t("agentEmployees.memory.every", {
                  hours: AGENT_LEARNING_INTERVAL_HOURS,
                }),
              },
            ]}
          />
        </div>
      </div>
      <UsageBar
        label={t("agentEmployees.memory.core")}
        words={countWords(props.memory)}
        maximum={AGENT_MEMORY_LIMITS.coreWords}
      />
      <UsageBar
        label={t("agentEmployees.memory.archive")}
        words={props.agent?.memoryUsage.archiveWords ?? 0}
        maximum={AGENT_MEMORY_LIMITS.archiveWords}
      />
      <p className="text-sm text-muted-foreground">
        {t("agentEmployees.memory.runs", {
          last: formatTime(learning?.lastRunAt ?? null),
          next: learning?.nextRunAt
            ? formatTime(learning.nextRunAt)
            : t("agentEmployees.memory.noNext"),
          result: resultText(learning?.lastResult ?? null, t),
        })}
      </p>
      <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
        {t("agentEmployees.memory.sharedHint")}
      </p>
    </div>
  );
}

/** The archive entries and the restorable versions, for authorized people. */
function MemoryHistory({
  agent,
  details,
  isDisabled,
}: Pick<
  AgentMemorySectionProps,
  "agent" | "details" | "isDisabled"
>): React.ReactElement | null {
  const { t } = useTranslation();
  const submit = useSubmit();
  const formatTime = useDateTime();
  if (!agent || !details) return null;
  function restore(versionId: string): void {
    if (!agent || !window.confirm(t("agentEmployees.memory.restoreConfirm")))
      return;
    const formData = new FormData();
    formData.set("intent", "restore-agent-memory");
    formData.set("agentId", agent.id);
    formData.set("versionId", versionId);
    void submit(formData, { method: "post" });
  }
  return (
    <div className="flex flex-col gap-4">
      <details className="rounded-xl border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          {t("agentEmployees.memory.archiveEntries", {
            count: details.archive.length,
          })}
        </summary>
        <ul className="mt-3 flex flex-col gap-3">
          {details.archive.map((entry) => (
            <li key={entry.id} className="text-sm">
              <p className="font-medium">{entry.title}</p>
              <p className="whitespace-pre-wrap text-muted-foreground">
                {entry.content}
              </p>
            </li>
          ))}
        </ul>
      </details>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">
          {t("agentEmployees.memory.versions")}
        </h3>
        <ul className="flex flex-col divide-y divide-border/60 rounded-xl border border-border">
          {details.versions.map((version, index) => (
            <li
              key={version.id}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <span>
                {formatTime(version.createdAt)} ·{" "}
                {t(`agentEmployees.memory.reason.${version.reason}`)} ·{" "}
                <span className="text-muted-foreground">
                  {t("agentEmployees.memory.versionWords", {
                    core: version.coreWords,
                    archive: version.archiveWords,
                  })}
                </span>
              </span>
              {index === 0 ? (
                <span className="text-xs text-muted-foreground">
                  {t("agentEmployees.memory.current")}
                </span>
              ) : (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={isDisabled}
                  onClick={() => restore(version.id)}
                >
                  {t("agentEmployees.memory.restore")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/**
 * The tab "Gedächtnis" (PAGE-266): learning, both memory levels, the
 * editable `MEMORY.md`, the archive and the restorable versions.
 */
export function AgentMemorySection(
  props: AgentMemorySectionProps,
): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-sm font-semibold">MEMORY.md</h3>
        <p className="text-sm text-muted-foreground">
          {t("agentEmployees.memory.description")}
        </p>
      </div>
      <LearningOverview {...props} />
      <label className="sr-only" htmlFor={id}>
        MEMORY.md
      </label>
      <Textarea
        id={id}
        className="min-h-72 font-mono text-[13px] leading-relaxed"
        value={props.memory}
        disabled={props.isDisabled}
        spellCheck={false}
        onChange={(event) => props.onMemory(event.currentTarget.value)}
      />
      <MemoryHistory {...props} />
    </div>
  );
}
