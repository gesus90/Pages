import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { AGENT_MEMORY_LIMITS } from "@/definition/AgentEmployee";
import {
  AGENT_MEMORY_CHARACTERS,
  countCharacters,
} from "@/definition/AgentMemory";

import type {
  AgentArchiveEntry,
  AgentEmployee,
  AgentLearningResult,
  AgentMemoryDetails,
} from "@/definition/AgentEmployee";
import type { AgentDraft, AgentDraftChange } from "./agent-draft";

interface AgentMemorySectionProps {
  readonly draft: AgentDraft;
  readonly onChange: AgentDraftChange;
  /** The stored agent; `null` while it is created. */
  readonly agent: AgentEmployee | null;
  readonly details: AgentMemoryDetails | null;
  readonly isDisabled: boolean;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** One memory level: its use against its limit, as a bar. */
function UsageBar({
  label,
  used,
  maximum,
  unit,
}: {
  readonly label: string;
  readonly used: number;
  readonly maximum: number;
  readonly unit: "words" | "characters";
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const format = new Intl.NumberFormat(i18n.language);
  const share = Math.min(100, Math.round((used / Math.max(1, maximum)) * 100));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {t(`agentEmployees.memory.${unit}`, {
            used: format.format(used),
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
        aria-valuenow={used}
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
  translate: Translate,
): string {
  if (!result) return translate("agentEmployees.memory.noRun");
  return translate(`agentEmployees.memory.result.${result.status}`, {
    added: result.added,
    merged: result.merged,
    archived: result.archived,
    removed: result.removed,
  });
}

/** The dream run: its switch, its time of day and its last and next run. */
function DreamRunOverview({
  draft,
  onChange,
  agent,
  isDisabled,
}: AgentMemorySectionProps): React.ReactElement {
  const { t } = useTranslation();
  const formatTime = useDateTime();
  const switchId = useId();
  const learning = agent?.learning ?? null;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" htmlFor={switchId}>
            {t("agentEmployees.memory.autoLearn")}
          </label>
          <Select
            id={switchId}
            ariaLabel={t("agentEmployees.memory.autoLearn")}
            className="w-full"
            value={draft.isLearningEnabled ? "on" : "off"}
            disabled={isDisabled}
            onValueChange={(value) =>
              onChange("isLearningEnabled", value === "on")
            }
            options={[
              { value: "on", label: t("agentEmployees.memory.on") },
              { value: "off", label: t("agentEmployees.memory.off") },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">
            {t("agentEmployees.memory.rhythm")}
          </span>
          <span className="text-sm text-muted-foreground">
            {learning
              ? t("agentEmployees.memory.nightly", { time: learning.dreamTime })
              : t("agentEmployees.memory.nightlyDefault")}
          </span>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("agentEmployees.memory.runs", {
          last: formatTime(learning?.lastRunAt ?? null),
          next: learning?.nextRunAt
            ? formatTime(learning.nextRunAt)
            : t("agentEmployees.memory.noNext"),
          result: resultText(learning?.lastResult ?? null, t),
        })}
      </p>
    </div>
  );
}

/** A character limit of one file, as typed. */
function LimitField({
  label,
  value,
  minimum,
  maximum,
  isDisabled,
  onValue,
}: {
  readonly label: string;
  readonly value: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly isDisabled: boolean;
  readonly onValue: (value: string) => void;
}): React.ReactElement {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={minimum}
        max={maximum}
        step={500}
        value={value}
        disabled={isDisabled}
        onChange={(event) => onValue(event.currentTarget.value)}
      />
    </div>
  );
}

/** One of the two files: its use, its text and its reset. */
function MemoryFile({
  file,
  text,
  maximum,
  agent,
  isDisabled,
  onText,
}: {
  readonly file: "memory" | "dream";
  readonly text: string;
  readonly maximum: number;
  readonly agent: AgentEmployee | null;
  readonly isDisabled: boolean;
  readonly onText: (value: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  const id = useId();
  const name = file === "memory" ? "MEMORY.md" : "DREAM.md";
  function reset(): void {
    if (
      !agent ||
      !window.confirm(t("agentEmployees.memory.resetConfirm", { name }))
    )
      return;
    const formData = new FormData();
    formData.set("intent", "reset-agent-memory");
    formData.set("agentId", agent.id);
    formData.set("file", file);
    void submit(formData, { method: "post" });
  }
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{name}</h3>
          <p className="text-sm text-muted-foreground">
            {t(`agentEmployees.memory.${file}Description`)}
          </p>
        </div>
        {agent ? (
          <Button
            size="xs"
            variant="outline"
            disabled={isDisabled}
            onClick={reset}
          >
            {t("agentEmployees.memory.reset")}
          </Button>
        ) : null}
      </div>
      <UsageBar
        label={name}
        used={countCharacters(text)}
        maximum={maximum}
        unit="characters"
      />
      <label className="sr-only" htmlFor={id}>
        {name}
      </label>
      <Textarea
        id={id}
        className="min-h-56 font-mono text-[13px] leading-relaxed"
        value={text}
        disabled={isDisabled}
        spellCheck={false}
        onChange={(event) => onText(event.currentTarget.value)}
      />
    </section>
  );
}

function describeSource(
  entry: AgentArchiveEntry,
  translate: Translate,
): string {
  const { source } = entry;
  if (!source) return translate("agentEmployees.memory.sourceUnknown");
  return [
    ...(source.chat
      ? [
          translate(
            source.chat.kind === "person"
              ? "agentEmployees.memory.sourceDirect"
              : "agentEmployees.memory.sourceConversation",
          ),
        ]
      : []),
    ...source.tickets,
    ...source.wikiPages.map(() => translate("agentEmployees.memory.wikiPage")),
  ].join(" · ");
}

/** The archive entries with their source. */
function ArchiveEntries({
  archive,
}: {
  readonly archive: readonly AgentArchiveEntry[];
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <details className="rounded-xl border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        {t("agentEmployees.memory.archiveEntries", { count: archive.length })}
      </summary>
      <ul className="mt-3 flex flex-col gap-3">
        {archive.map((entry) => (
          <li key={entry.id} className="text-sm">
            <p className="font-medium">{entry.title}</p>
            <p className="text-xs text-muted-foreground">
              {t("agentEmployees.memory.source", {
                source: describeSource(entry, t),
              })}
            </p>
            <p className="whitespace-pre-wrap text-muted-foreground">
              {entry.content}
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The restorable versions of both files and the archive. */
function MemoryVersions({
  agent,
  details,
  isDisabled,
}: {
  readonly agent: AgentEmployee;
  readonly details: AgentMemoryDetails;
  readonly isDisabled: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  const formatTime = useDateTime();
  function restore(versionId: string): void {
    if (!window.confirm(t("agentEmployees.memory.restoreConfirm"))) return;
    const formData = new FormData();
    formData.set("intent", "restore-agent-memory");
    formData.set("agentId", agent.id);
    formData.set("versionId", versionId);
    void submit(formData, { method: "post" });
  }
  return (
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
  );
}

function readLimit(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * The tab "Gedächtnis" (PAGE-266, PAGE-305): the dream run, the limits,
 * the editable `MEMORY.md` and `DREAM.md` with their reset, the archive
 * with the source of each entry and the restorable versions.
 */
export function AgentMemorySection(
  props: AgentMemorySectionProps,
): React.ReactElement {
  const { t } = useTranslation();
  const { draft, onChange, agent, details, isDisabled } = props;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        {t("agentEmployees.memory.description")}
      </p>
      <DreamRunOverview {...props} />
      <div className="grid gap-4 sm:grid-cols-2">
        <LimitField
          label={t("agentEmployees.memory.memoryLimit")}
          value={draft.memoryCharacters}
          minimum={AGENT_MEMORY_CHARACTERS.memoryMinimum}
          maximum={AGENT_MEMORY_CHARACTERS.memoryMaximum}
          isDisabled={isDisabled}
          onValue={(value) => onChange("memoryCharacters", value)}
        />
        <LimitField
          label={t("agentEmployees.memory.dreamLimit")}
          value={draft.dreamCharacters}
          minimum={AGENT_MEMORY_CHARACTERS.dreamMinimum}
          maximum={AGENT_MEMORY_CHARACTERS.dreamMaximum}
          isDisabled={isDisabled}
          onValue={(value) => onChange("dreamCharacters", value)}
        />
      </div>
      <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
        {t("agentEmployees.memory.sharedHint")}
      </p>
      <MemoryFile
        file="memory"
        text={draft.memory}
        maximum={readLimit(
          draft.memoryCharacters,
          AGENT_MEMORY_CHARACTERS.memoryDefault,
        )}
        agent={agent}
        isDisabled={isDisabled}
        onText={(value) => onChange("memory", value)}
      />
      <MemoryFile
        file="dream"
        text={draft.dream}
        maximum={readLimit(
          draft.dreamCharacters,
          AGENT_MEMORY_CHARACTERS.dreamDefault,
        )}
        agent={agent}
        isDisabled={isDisabled}
        onText={(value) => onChange("dream", value)}
      />
      <UsageBar
        label={t("agentEmployees.memory.archive")}
        used={agent?.memoryUsage.archiveWords ?? 0}
        maximum={AGENT_MEMORY_LIMITS.archiveWords}
        unit="words"
      />
      {agent && details ? (
        <div className="flex flex-col gap-4">
          <ArchiveEntries archive={details.archive} />
          <MemoryVersions
            agent={agent}
            details={details}
            isDisabled={isDisabled}
          />
        </div>
      ) : null}
    </div>
  );
}
