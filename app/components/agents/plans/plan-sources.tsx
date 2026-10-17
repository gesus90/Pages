import { Flag, Play } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { Button } from "@/app/components/ui/button";

import { PLAN_AGENT_DRAG, PLAN_SOURCE_DRAG } from "./plan-drag";
import { usePlanTaskFilter } from "./use-plan-task-filter";

import type { AgentPlanNode, AgentPlanSources } from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

export interface SourceProps {
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
}

// Start and end in the order of the flow, each with the icon of its meaning.
const ENDPOINTS = [
  { kind: "start", Icon: Play },
  { kind: "end", Icon: Flag },
] as const;

/** One endpoint to drag onto the grid or to add with a click. */
function EndpointSource(props: {
  readonly kind: "start" | "end";
  readonly Icon: typeof Play;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { kind, Icon } = props;
  const label = t(`plans.nodeType.${kind}`);
  function startDrag(event: React.DragEvent<HTMLButtonElement>): void {
    event.dataTransfer.setData(PLAN_SOURCE_DRAG, `${kind}:${kind}`);
    event.dataTransfer.effectAllowed = "copy";
  }
  return (
    <Button
      size="sm"
      variant="outline"
      className="cursor-grab justify-start bg-surface"
      draggable={props.canEdit}
      disabled={!props.canEdit}
      onDragStart={startDrag}
      onClick={() => props.graph.add(kind, kind)}
      aria-label={t("plans.addSource", { name: label })}
    >
      <Icon className="size-4" aria-hidden="true" />
      {label}
    </Button>
  );
}

/**
 * Start and end of the flow, offered like the other sources.
 *
 * @remarks
 * A plan may have several starts and ends; Play needs at least one of each.
 * Nothing is added or restored without the user's action.
 */
export function EndpointSources(props: {
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t("plans.endpointSources")}
      className="space-y-2 rounded-xl border border-border p-3"
    >
      <h2 className="text-sm font-semibold">{t("plans.endpointSources")}</h2>
      <div className="grid grid-cols-2 gap-2">
        {ENDPOINTS.map((endpoint) => (
          <EndpointSource
            key={endpoint.kind}
            {...endpoint}
            graph={props.graph}
            canEdit={props.canEdit}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("plans.endpointSourcesHint")}
      </p>
    </section>
  );
}

/** Searches only the server-authorized agent catalog. */
export function AgentSources(props: SourceProps): React.ReactElement {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [usableOnly, setUsableOnly] = useState(true);
  const [sort, setSort] = useState<"name" | "model">("name");
  const agents = props.sources.agents
    .filter(
      (agent) =>
        `${agent.name} ${agent.model} ${agent.configuration.tag}`
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (!usableOnly || agent.availability.isUsable),
    )
    .sort(
      (first, second) =>
        first[sort].localeCompare(second[sort]) ||
        first.id.localeCompare(second.id),
    );
  return (
    <section
      aria-label={t("plans.agentSources")}
      className="space-y-2 rounded-xl border border-border p-3"
    >
      <h2 className="text-base font-semibold">{t("plans.agentSources")}</h2>
      <Input
        aria-label={t("plans.agentFilter")}
        placeholder={t("plans.agentFilter")}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <Select<"name" | "model">
        ariaLabel={t("plans.sort")}
        value={sort}
        onValueChange={setSort}
        options={[
          { value: "name", label: t("plans.sortName") },
          { value: "model", label: t("plans.sortModel") },
        ]}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={usableOnly}
          onChange={(event) => setUsableOnly(event.target.checked)}
        />
        {t("plans.usableOnly")}
      </label>
      <VerticalScrollArea
        className="max-h-[35vh]"
        contentClassName="space-y-2 pb-5"
      >
        {agents.map((agent) => (
          <SourceButton
            key={agent.id}
            kind="agent"
            reference={agent.id}
            label={agent.name}
            detail={`${agent.configuration.tag} · ${agent.model}`}
            disabled={!props.canEdit || !agent.availability.isUsable}
            onAdd={props.graph.add}
            reason={
              agent.availability.reason === null
                ? null
                : t(`settings.agents.error.${agent.availability.reason}`, {
                    defaultValue: t(
                      `assistant.error.${agent.availability.reason}`,
                    ),
                  })
            }
          />
        ))}
        {agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("plans.noSources")}
          </p>
        ) : null}
      </VerticalScrollArea>
    </section>
  );
}

/** Project tickets retain their visibility and can be searched, filtered by type and status, and sorted. */
export function TaskSources(props: SourceProps): React.ReactElement {
  const { t } = useTranslation();
  const filter = usePlanTaskFilter(props.sources.tasks);
  return (
    <section
      aria-label={t("plans.taskSources")}
      className="space-y-2 rounded-xl border border-border p-3"
    >
      <h2 className="text-base font-semibold">{t("plans.taskSources")}</h2>
      <Input
        aria-label={t("plans.taskFilter")}
        placeholder={t("plans.taskFilter")}
        value={filter.search}
        onChange={(event) => filter.setSearch(event.target.value)}
      />
      <Select<"key" | "title" | "statusName">
        ariaLabel={t("plans.sort")}
        value={filter.sort}
        onValueChange={filter.setSort}
        options={[
          { value: "key", label: t("plans.sortKey") },
          { value: "title", label: t("plans.sortName") },
          { value: "statusName", label: t("plans.sortStatus") },
        ]}
      />
      <Select
        ariaLabel={t("plans.taskTypeFilter")}
        value={filter.type}
        onValueChange={filter.setType}
        options={[
          { value: "", label: t("plans.allTasks") },
          { value: "task", label: t("plans.task") },
          { value: "subtask", label: t("plans.subtask") },
        ]}
      />
      <Select
        ariaLabel={t("plans.taskStatusFilter")}
        value={filter.status}
        onValueChange={filter.setStatus}
        options={[
          { value: "", label: t("plans.allStatuses") },
          { value: "open", label: t("plans.openTasks") },
          { value: "done", label: t("plans.doneTasks") },
          ...filter.statuses.map((status) => ({
            value: status.value,
            label: status.name,
          })),
        ]}
      />
      <VerticalScrollArea
        className="max-h-[35vh]"
        contentClassName="space-y-2 pb-5"
      >
        {filter.tasks.map((task) => (
          <SourceButton
            key={task.id}
            kind="task"
            reference={task.id}
            label={`${task.key}: ${task.title}`}
            detail={`${t(`plans.${task.type}`)} · ${task.statusName}`}
            disabled={!props.canEdit}
            onAdd={props.graph.add}
          />
        ))}
        {filter.tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("plans.noSources")}
          </p>
        ) : null}
      </VerticalScrollArea>
    </section>
  );
}

function SourceButton(props: {
  readonly kind: AgentPlanNode["type"];
  readonly reference: string;
  readonly label: string;
  readonly detail: string;
  readonly disabled: boolean;
  readonly reason?: string | null;
  readonly onAdd: PlanGraphActions["add"];
}): React.ReactElement {
  const { t } = useTranslation();
  function startDrag(event: React.DragEvent<HTMLButtonElement>): void {
    event.dataTransfer.setData(
      PLAN_SOURCE_DRAG,
      `${props.kind}:${props.reference}`,
    );
    if (props.kind === "agent")
      event.dataTransfer.setData(PLAN_AGENT_DRAG, props.reference);
    event.dataTransfer.effectAllowed = "copy";
  }
  return (
    <div className="rounded-lg bg-surface p-2">
      <Button
        size="sm"
        variant="ghost"
        className="h-auto max-w-full text-left whitespace-normal"
        draggable={!props.disabled}
        disabled={props.disabled}
        onDragStart={startDrag}
        onClick={() => props.onAdd(props.kind, props.reference)}
        aria-label={t("plans.addSource", { name: props.label })}
      >
        {props.label}
      </Button>
      <p className="text-xs text-muted-foreground">{props.detail}</p>
      {props.reason ? (
        <p className="text-xs text-warning">{props.reason}</p>
      ) : null}
    </div>
  );
}
