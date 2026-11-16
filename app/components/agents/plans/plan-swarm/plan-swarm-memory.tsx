import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { cn } from "@/app/lib/cn";
import { PLAN_SWARM_MEMORY_FILES } from "@/definition/AgentPlanSwarmMemory";

import {
  PLAN_SWARM_MEMORY_SECTIONS,
  planSwarmKindTone,
  planSwarmMemoryAddress,
  planSwarmReadLags,
  planSwarmSectionEntries,
  planSwarmTextParts,
} from "./plan-swarm-memory-model";
import { PlanSwarmHeading } from "./plan-swarm-sections";

import type {
  AgentPlanSwarmMemoryEntry,
  AgentPlanSwarmMemoryView,
} from "@/definition/AgentPlanSwarmMemory";

/** The kind of an entry as a pill; its name always stands in it, never the color alone. */
export function PlanSwarmKindBadge(props: {
  readonly kind: string;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <span
      data-plan-swarm-kind={props.kind}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-1.5 text-[11px] leading-4 font-semibold",
        planSwarmKindTone(props.kind),
      )}
    >
      {t(`plans.swarm.memory.kind.${props.kind}`, { defaultValue: props.kind })}
    </span>
  );
}

/** The text of an entry; a blacked out secret shows as its mark. */
export function PlanSwarmMemoryText(props: {
  readonly text: string;
  readonly className?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <p className={cn("wrap-anywhere whitespace-pre-wrap", props.className)}>
      {planSwarmTextParts(props.text).map((part) =>
        part.isRedacted ? (
          <span
            key={part.key}
            data-plan-swarm-redacted
            className="rounded bg-muted px-1 text-muted-foreground"
          >
            {t("plans.swarm.memory.redacted")}
          </span>
        ) : (
          <span key={part.key}>{part.text}</span>
        ),
      )}
    </p>
  );
}

/** One entry with author, kind and revision above its quoted text. */
export function PlanSwarmMemoryEntryRow(props: {
  readonly entry: AgentPlanSwarmMemoryEntry;
}): React.ReactElement {
  const { entry } = props;
  return (
    <li
      className="flex flex-col gap-0.5"
      data-plan-swarm-entry={entry.revision}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-semibold">{entry.author}</span>
        <PlanSwarmKindBadge kind={entry.kind} />
        <span className="ml-auto text-muted-foreground tabular-nums">
          r{entry.revision}
        </span>
      </div>
      <PlanSwarmMemoryText text={entry.text} />
    </li>
  );
}

/** The bar on top: the newest revision and the export of both files. */
function MemoryBar(props: {
  readonly memory: AgentPlanSwarmMemoryView;
  readonly runId: string;
  readonly stepId: string;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
      <span className="font-semibold tabular-nums">
        {t("plans.swarm.memory.revision", { revision: props.memory.revision })}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="xs">
            <Download aria-hidden="true" className="size-3.5" />
            {t("plans.swarm.memory.export")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {PLAN_SWARM_MEMORY_FILES.map((file) => (
            <DropdownMenuItem key={file} asChild>
              <a
                href={planSwarmMemoryAddress(props.runId, props.stepId, file)}
                download={file}
              >
                {file}
              </a>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** One section of the snapshot: decisions, interfaces, open blockers or findings. */
function MemorySection(props: {
  readonly memory: AgentPlanSwarmMemoryView;
  readonly section: (typeof PLAN_SWARM_MEMORY_SECTIONS)[number];
}): React.ReactElement | null {
  const { t } = useTranslation();
  const entries = planSwarmSectionEntries(props.memory, props.section);
  if (entries.length === 0) return null;
  return (
    <section
      className="flex flex-col gap-1.5"
      data-plan-swarm-memory-section={props.section}
    >
      <PlanSwarmHeading>
        {t(`plans.swarm.memory.sections.${props.section}`)}
      </PlanSwarmHeading>
      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <PlanSwarmMemoryEntryRow key={entry.revision} entry={entry} />
        ))}
      </ul>
    </section>
  );
}

/** The consolidated text of the main model with its version. */
function MemorySnapshot(props: {
  readonly memory: AgentPlanSwarmMemoryView;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { snapshot } = props.memory;
  if (!snapshot.text) return null;
  return (
    <section className="flex flex-col gap-1" data-plan-swarm-snapshot>
      <PlanSwarmHeading>
        {t("plans.swarm.memory.snapshot", {
          version: snapshot.version,
          revision: snapshot.revision,
        })}
      </PlanSwarmHeading>
      <PlanSwarmMemoryText text={snapshot.text} />
    </section>
  );
}

/** Up to which revision each agent read; a helper behind shows in the warning color. */
function MemoryReads(props: {
  readonly memory: AgentPlanSwarmMemoryView;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const lags = planSwarmReadLags(props.memory);
  if (lags.length === 0) return null;
  return (
    <p
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-border px-3 py-1.5"
      data-plan-swarm-reads
    >
      <span className="text-muted-foreground">
        {t("plans.swarm.memory.readUpTo")}
      </span>
      {lags.map((lag) => (
        <span
          key={lag.agent}
          data-plan-swarm-read={lag.agent}
          className={cn(
            "tabular-nums",
            lag.behind > 0 ? "text-warning" : "text-foreground",
          )}
        >
          {lag.agent === "main" ? t("plans.swarm.mainShort") : lag.agent} r
          {lag.revision}
          {lag.behind > 0 ? ` (−${String(lag.behind)})` : ""}
        </span>
      ))}
    </p>
  );
}

/**
 * The tab Gedächtnis: the bar with revision and export, the snapshot by
 * section, the read state of each agent and the note that entries are data.
 */
export function PlanSwarmMemoryTab(props: {
  readonly memory: AgentPlanSwarmMemoryView;
  readonly runId: string;
  readonly stepId: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { memory } = props;
  const isEmpty = memory.entries.length === 0 && !memory.snapshot.text;
  return (
    <div className="flex flex-col text-xs" data-plan-swarm-memory>
      <MemoryBar {...props} />
      <div className="flex flex-col gap-3 px-3 py-2">
        {isEmpty ? (
          <p className="text-muted-foreground">
            {t("plans.swarm.memory.empty")}
          </p>
        ) : null}
        <MemorySnapshot memory={memory} />
        {PLAN_SWARM_MEMORY_SECTIONS.map((section) => (
          <MemorySection key={section} memory={memory} section={section} />
        ))}
      </div>
      <MemoryReads memory={memory} />
      <p className="border-t border-border px-3 py-1.5 text-muted-foreground">
        {t("plans.swarm.memory.dataNote")}
      </p>
    </div>
  );
}
