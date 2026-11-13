import { ChevronDown, ChevronRight, Minus, Plus } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { SegmentedControl } from "@/app/components/ui/segmented-control";
import { Select } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import {
  PLAN_SWARM_TEXT_LENGTH,
  PLAN_SWARM_WORKER_LIMIT,
  planSwarmWorkerAt,
  planSwarmWorkerLabel,
} from "@/definition/AgentPlanSwarm";

import { planNodeLabel } from "../plan-layout";
import {
  planSwarmTicketChoices,
  planSwarmTicketNode,
  withPlanSwarmCount,
  withPlanSwarmMode,
  withPlanSwarmTicket,
  withPlanSwarmWorker,
} from "./plan-swarm-form";
import { PlanSwarmModelRow } from "./plan-swarm-model-row";

import type { AgentPlanInput, AgentPlanSources } from "@/definition/AgentPlan";
import type {
  AgentPlanSwarm,
  AgentPlanSwarmWorkerMode,
} from "@/definition/AgentPlanSwarm";

/** What every section of the swarm panel reads and how it changes the swarm. */
export interface PlanSwarmSectionProps {
  readonly swarm: AgentPlanSwarm;
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly isDisabled: boolean;
  readonly onChange: (swarm: AgentPlanSwarm) => void;
}

/** A small caps heading that names one section of the panel. */
export function PlanSwarmHeading(props: {
  readonly children: React.ReactNode;
  readonly action?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {props.children}
      </h3>
      {props.action}
    </div>
  );
}

/** An optional text, closed until it is opened or holds text. */
export function PlanSwarmOptionalText(props: {
  readonly label: string;
  readonly value: string | undefined;
  readonly isDisabled: boolean;
  readonly onChange: (value: string | undefined) => void;
}): React.ReactElement {
  const id = useId();
  const [isOpen, setOpen] = useState(Boolean(props.value));
  const Icon = isOpen ? ChevronDown : ChevronRight;
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={id}
        onClick={() => setOpen(!isOpen)}
        className="flex items-center gap-1 self-start rounded text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Icon aria-hidden="true" className="size-3.5" />
        {props.label}
      </button>
      {isOpen ? (
        <Textarea
          id={id}
          aria-label={props.label}
          rows={3}
          value={props.value ?? ""}
          maxLength={PLAN_SWARM_TEXT_LENGTH.instruction}
          disabled={props.isDisabled}
          onChange={(event) => props.onChange(event.target.value || undefined)}
        />
      ) : null}
    </div>
  );
}

/** Aufgabe: a text or the ticket of a ticket node. */
export function PlanSwarmTaskSection(
  props: PlanSwarmSectionProps,
): React.ReactElement {
  const { t } = useTranslation();
  const { swarm } = props;
  const tickets = planSwarmTicketChoices(props.draft);
  return (
    <section className="flex flex-col gap-2" data-plan-swarm-section="task">
      <PlanSwarmHeading>{t("plans.swarm.sections.task")}</PlanSwarmHeading>
      <SegmentedControl<"text" | "ticket">
        ariaLabel={t("plans.swarm.taskSource")}
        value={swarm.task.source}
        options={[
          { value: "text", label: t("plans.swarm.taskText") },
          { value: "ticket", label: t("plans.swarm.taskTicketOption") },
        ]}
        onValueChange={(source) => {
          if (props.isDisabled) return;
          props.onChange(
            source === "text"
              ? { ...swarm, task: { source: "text", text: "" } }
              : withPlanSwarmTicket(swarm, planSwarmTicketNode(swarm)),
          );
        }}
      />
      {swarm.task.source === "text" ? (
        <Textarea
          aria-label={t("plans.swarm.taskText")}
          rows={4}
          value={swarm.task.text}
          maxLength={PLAN_SWARM_TEXT_LENGTH.task}
          placeholder={t("plans.swarm.taskPlaceholder")}
          disabled={props.isDisabled}
          onChange={(event) =>
            props.onChange({
              ...swarm,
              task: { source: "text", text: event.target.value },
            })
          }
        />
      ) : (
        <Select
          size="sm"
          ariaLabel={t("plans.swarm.taskTicketOption")}
          value={planSwarmTicketNode(swarm)}
          disabled={props.isDisabled}
          placeholder={t("plans.swarm.chooseTicket")}
          options={tickets.map((ticket) => ({
            value: ticket.id,
            label: planNodeLabel(
              {
                id: ticket.id,
                type: "task",
                taskId: ticket.taskId,
                x: 0,
                y: 0,
              },
              props.sources,
            ),
          }))}
          onValueChange={(nodeId) =>
            props.onChange(withPlanSwarmTicket(swarm, nodeId))
          }
        />
      )}
    </section>
  );
}

/** Hauptmodell: connection, model, reasoning, access and an optional instruction. */
export function PlanSwarmMainSection(
  props: PlanSwarmSectionProps,
): React.ReactElement {
  const { t } = useTranslation();
  const { swarm } = props;
  return (
    <section className="flex flex-col gap-2" data-plan-swarm-section="main">
      <PlanSwarmHeading>{t("plans.swarm.sections.main")}</PlanSwarmHeading>
      <PlanSwarmModelRow
        label={t("plans.swarm.mainModel")}
        choice={{ model: swarm.main.model, access: swarm.main.access }}
        models={props.sources.models ?? []}
        isDisabled={props.isDisabled}
        onChange={(choice) =>
          props.onChange({ ...swarm, main: { ...swarm.main, ...choice } })
        }
      />
      <PlanSwarmOptionalText
        label={t("plans.swarm.mainInstruction")}
        value={swarm.main.instruction}
        isDisabled={props.isDisabled}
        onChange={(instruction) => {
          props.onChange({ ...swarm, main: { ...swarm.main, instruction } });
        }}
      />
    </section>
  );
}

/** The − n + counter of the helpers, 1 to 10. */
function WorkerCounter(props: PlanSwarmSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const { count } = props.swarm.workers;
  return (
    <div
      role="group"
      aria-label={t("plans.swarm.count")}
      className="flex items-center gap-1"
    >
      <Button
        size="icon-sm"
        variant="outline"
        aria-label={t("plans.swarm.fewer")}
        disabled={props.isDisabled || count <= 1}
        onClick={() =>
          props.onChange(withPlanSwarmCount(props.swarm, count - 1))
        }
      >
        <Minus aria-hidden="true" className="size-3.5" />
      </Button>
      <output
        aria-live="polite"
        className="w-6 text-center text-sm font-semibold tabular-nums"
      >
        {count}
      </output>
      <Button
        size="icon-sm"
        variant="outline"
        aria-label={t("plans.swarm.more")}
        disabled={props.isDisabled || count >= PLAN_SWARM_WORKER_LIMIT}
        onClick={() =>
          props.onChange(withPlanSwarmCount(props.swarm, count + 1))
        }
      >
        <Plus aria-hidden="true" className="size-3.5" />
      </Button>
    </div>
  );
}

/** One compact row per helper with its badge, model and access. */
function IndividualWorkers(props: PlanSwarmSectionProps): React.ReactElement {
  const { swarm } = props;
  return (
    <ul className="flex flex-col gap-2" data-plan-swarm-individual>
      {Array.from({ length: swarm.workers.count }, (_, index) => {
        const label = planSwarmWorkerLabel(index);
        return (
          <li
            key={label}
            className="grid min-w-0 grid-cols-[2.25rem_1fr] items-center gap-2"
          >
            <span className="flex h-6 items-center justify-center rounded-md border border-plan-swarm-edge bg-surface text-[11px] font-semibold text-plan-swarm tabular-nums">
              {label}
            </span>
            <PlanSwarmModelRow
              label={label}
              isCompact
              choice={planSwarmWorkerAt(swarm.workers, index)}
              models={props.sources.models ?? []}
              isDisabled={props.isDisabled}
              onChange={(choice) =>
                props.onChange(withPlanSwarmWorker(swarm, index, choice))
              }
            />
          </li>
        );
      })}
    </ul>
  );
}

/** Helfer: their number, one configuration for all or one per helper, and a shared instruction. */
export function PlanSwarmWorkersSection(
  props: PlanSwarmSectionProps,
): React.ReactElement {
  const { t } = useTranslation();
  const { swarm } = props;
  return (
    <section className="flex flex-col gap-2" data-plan-swarm-section="workers">
      <PlanSwarmHeading action={<WorkerCounter {...props} />}>
        {t("plans.swarm.sections.workers")}
      </PlanSwarmHeading>
      <SegmentedControl<AgentPlanSwarmWorkerMode>
        ariaLabel={t("plans.swarm.mode")}
        value={swarm.workers.mode}
        options={[
          { value: "same", label: t("plans.swarm.modeSame") },
          { value: "individual", label: t("plans.swarm.modeIndividual") },
        ]}
        onValueChange={(mode) => {
          if (!props.isDisabled) props.onChange(withPlanSwarmMode(swarm, mode));
        }}
      />
      {swarm.workers.mode === "same" ? (
        <PlanSwarmModelRow
          label={t("plans.swarm.workerModel")}
          choice={swarm.workers.same}
          models={props.sources.models ?? []}
          isDisabled={props.isDisabled}
          onChange={(same) =>
            props.onChange({ ...swarm, workers: { ...swarm.workers, same } })
          }
        />
      ) : (
        <IndividualWorkers {...props} />
      )}
      <PlanSwarmOptionalText
        label={t("plans.swarm.workerInstruction")}
        value={swarm.workers.instruction}
        isDisabled={props.isDisabled}
        onChange={(instruction) => {
          props.onChange({
            ...swarm,
            workers: { ...swarm.workers, instruction },
          });
        }}
      />
    </section>
  );
}
