import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { Button } from "@/app/components/ui/button";

import type { AgentPlanNode, AgentPlanSources } from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

interface SourceProps {
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
}

/** Two independent source filters never widen the server-authorized resource sets. */
export function PlanSources(props: SourceProps): React.ReactElement {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <AgentSources {...props} />
      <TaskSources {...props} />
    </div>
  );
}

function AgentSources(props: SourceProps): React.ReactElement {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [usableOnly, setUsableOnly] = useState(false);
  const agents = props.sources.agents.filter(
    (agent) =>
      `${agent.name} ${agent.model} ${agent.configuration.tag}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!usableOnly || agent.availability.isUsable),
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
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={usableOnly}
          onChange={(event) => setUsableOnly(event.target.checked)}
        />
        {t("plans.usableOnly")}
      </label>
      <VerticalScrollArea
        className="max-h-56"
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

function TaskSources(props: SourceProps): React.ReactElement {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const tasks = props.sources.tasks.filter(
    (task) =>
      `${task.key} ${task.title} ${task.statusName}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!type || task.type === type),
  );
  return (
    <section
      aria-label={t("plans.taskSources")}
      className="space-y-2 rounded-xl border border-border p-3"
    >
      <h2 className="text-base font-semibold">{t("plans.taskSources")}</h2>
      <Input
        aria-label={t("plans.taskFilter")}
        placeholder={t("plans.taskFilter")}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <Select
        ariaLabel={t("plans.taskTypeFilter")}
        value={type}
        onValueChange={setType}
        options={[
          { value: "", label: t("plans.allTasks") },
          { value: "task", label: t("plans.task") },
          { value: "subtask", label: t("plans.subtask") },
        ]}
      />
      <VerticalScrollArea
        className="max-h-56"
        contentClassName="space-y-2 pb-5"
      >
        {tasks.map((task) => (
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
        {tasks.length === 0 ? (
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
      "application/x-pages-plan",
      `${props.kind}:${props.reference}`,
    );
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
