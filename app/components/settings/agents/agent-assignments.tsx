import { Bot, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";
import { Dialog } from "@/app/components/ui/dialog";
import { HorizontalScrollArea } from "@/app/components/ui/horizontal-scroll-area";
import { AGENT_FUNCTIONS } from "@/definition/AgentAssignment";
import { AGENT_PROVIDERS } from "@/definition/AgentConnection";

import { AgentAssignmentForm } from "./agent-assignment-form";
import { AgentAssignmentResult } from "./agent-assignment-result";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type { AgentAssignmentView } from "@/definition/AgentAssignment";
import type { AgentConnectionSummary } from "@/definition/AgentConnection";
import type { AgentModelCatalog } from "@/definition/AgentModelCatalog";

/** Renders predefined function assignments below connection management. */
export function AgentAssignments(props: {
  readonly assignments: readonly AgentAssignmentView[];
  readonly connections: readonly AgentConnectionSummary[];
  readonly catalogs: Readonly<Record<string, AgentModelCatalog>>;
}): React.ReactElement {
  const { t } = useTranslation();
  const [selection, setSelection] = useState<
    AgentAssignmentView | "new" | null
  >(null);
  const availableFunctions = AGENT_FUNCTIONS.filter(
    (entry) =>
      !props.assignments.some((assignment) => assignment.function === entry),
  );
  function close(): void {
    setSelection(null);
  }
  return (
    <SettingsCard
      icon={<Bot className="size-4" aria-hidden="true" />}
      wrapHeader
      title={t("settings.agents.assignments.title")}
      description={t("settings.agents.assignments.description")}
      action={
        <Button
          size="sm"
          variant="outline"
          aria-label={t("settings.agents.assignments.add")}
          disabled={availableFunctions.length === 0}
          onClick={() => setSelection("new")}
        >
          <Plus className="size-4" aria-hidden="true" />
          {t("settings.agents.assignments.add")}
        </Button>
      }
    >
      <p className="mb-4 text-sm text-muted-foreground">
        {t("settings.agents.assignments.skillsHint")}
      </p>
      {props.assignments.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("settings.agents.assignments.empty")}
        </p>
      ) : (
        <HorizontalScrollArea>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                {[
                  "function",
                  "connection",
                  "model",
                  "reasoning",
                  "status",
                  "actions",
                ].map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className="px-3 py-3 font-medium whitespace-nowrap"
                  >
                    {t(`settings.agents.assignments.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {props.assignments.map((assignment) => (
                <AssignmentRow
                  key={assignment.function}
                  assignment={assignment}
                  connections={props.connections}
                  onEdit={() => setSelection(assignment)}
                />
              ))}
            </tbody>
          </table>
        </HorizontalScrollArea>
      )}
      <Dialog open={selection !== null} onOpenChange={close}>
        {selection ? (
          <AgentAssignmentForm
            assignment={selection === "new" ? null : selection}
            availableFunctions={availableFunctions}
            connections={props.connections}
            catalogs={props.catalogs}
            onSaved={close}
          />
        ) : null}
      </Dialog>
    </SettingsCard>
  );
}

function AssignmentRow({
  assignment,
  connections,
  onEdit,
}: {
  readonly assignment: AgentAssignmentView;
  readonly connections: readonly AgentConnectionSummary[];
  readonly onEdit: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<AgentActionResult>();
  const connection = connections.find(
    (entry) => entry.id === assignment.connectionId,
  );
  const functionName = t(
    `settings.agents.assignments.functions.${assignment.function}`,
  );
  return (
    <tr className="border-b border-border/60 last:border-0">
      <th scope="row" className="px-3 py-3">
        {functionName}
      </th>
      <td className="px-3 py-3">
        {connection
          ? `${connection.name} · ${t(AGENT_PROVIDERS[connection.provider].labelKey)}`
          : assignment.connectionId}
      </td>
      <td className="px-3 py-3">{assignment.model}</td>
      <td className="px-3 py-3">
        {assignment.reasoningEffort ?? t("settings.agents.reasoning.default")}
      </td>
      <td className="px-3 py-3">
        {assignment.error ? (
          <p role="alert" className="text-destructive">
            {t(`assistant.error.${assignment.error}`)}
          </p>
        ) : (
          t("settings.agents.assignments.ready")
        )}
      </td>
      <td className="px-3 py-3">
        <div className="flex gap-2">
          <Button
            size="xs"
            variant="ghost"
            disabled={fetcher.state !== "idle"}
            onClick={onEdit}
            aria-label={t("settings.agents.assignments.editNamed", {
              function: functionName,
            })}
          >
            {t("settings.agents.edit")}
          </Button>
          <fetcher.Form action="/settings/agents" method="post">
            <input type="hidden" name="intent" value="delete-assignment" />
            <input type="hidden" name="function" value={assignment.function} />
            <Button
              size="xs"
              variant="ghost"
              type="submit"
              disabled={fetcher.state !== "idle"}
              aria-label={t("settings.agents.assignments.removeNamed", {
                function: functionName,
              })}
            >
              {t("settings.agents.remove")}
            </Button>
          </fetcher.Form>
        </div>
        <AgentAssignmentResult result={fetcher.data} />
      </td>
    </tr>
  );
}
