import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Select } from "@/app/components/ui/select";
import { AGENT_FUNCTIONS } from "@/definition/AgentAssignment";

import { AgentModelField } from "./agent-model-field";
import { AgentReasoningField } from "./agent-reasoning-field";
import { AgentAssignmentResult } from "./agent-assignment-result";
import { useAgentAssignment } from "./use-agent-assignment";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type {
  AgentAssignment,
  AgentFunction,
} from "@/definition/AgentAssignment";
import type { AgentConnectionSummary } from "@/definition/AgentConnection";
import type { AgentModelCatalog } from "@/definition/AgentModelCatalog";

/** An assignment form creates configuration only; saving never invokes a provider. */
export function AgentAssignmentForm(props: {
  readonly assignment: AgentAssignment | null;
  readonly availableFunctions: readonly AgentFunction[];
  readonly connections: readonly AgentConnectionSummary[];
  readonly catalogs: Readonly<Record<string, AgentModelCatalog>>;
  readonly onSaved: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<AgentActionResult>();
  const [assignedFunction, setAssignedFunction] = useState<string>(
    props.assignment?.function ?? "",
  );
  const selection = useAgentAssignment(props);
  const isPending = fetcher.state !== "idle";
  const { onSaved } = props;
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onSaved();
  }, [fetcher.state, fetcher.data, onSaved]);
  const functions = props.assignment
    ? AGENT_FUNCTIONS
    : props.availableFunctions;
  return (
    <DialogContent size="md" className="overflow-y-auto">
      <DialogTitle className="font-semibold">
        {t("settings.agents.assignments.title")}
      </DialogTitle>
      <DialogDescription className="mt-2 text-sm text-muted-foreground">
        {t("settings.agents.assignments.description")}
      </DialogDescription>
      <fetcher.Form
        action="/settings/agents"
        method="post"
        className="mt-4 space-y-4"
      >
        <input
          type="hidden"
          name="intent"
          value={props.assignment ? "update-assignment" : "create-assignment"}
        />
        <input type="hidden" name="function" value={assignedFunction} />
        <input
          type="hidden"
          name="connectionId"
          value={selection.connectionId}
        />
        <input type="hidden" name="model" value={selection.modelId} />
        <input type="hidden" name="reasoningEffort" value={selection.effort} />
        <AssignmentFunctionField
          value={assignedFunction}
          onChange={setAssignedFunction}
          functions={functions}
          disabled={isPending || props.assignment !== null}
        />
        <AgentModelField selection={selection} isPending={isPending} />
        <AgentReasoningField selection={selection} isPending={isPending} />
        <p className="text-sm text-muted-foreground">
          {t("settings.agents.assignments.verifyHint")}
        </p>
        {selection.error && selection.connectionId ? (
          <p role="alert" className="text-sm text-destructive">
            {t(`assistant.error.${selection.error}`)}
          </p>
        ) : null}
        <AgentAssignmentResult result={fetcher.data} />
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {t("settings.agents.cancel")}
            </Button>
          </DialogClose>
          <Button
            type="submit"
            disabled={
              isPending || !assignedFunction || selection.error !== null
            }
          >
            {t("settings.agents.assignments.save")}
          </Button>
        </div>
      </fetcher.Form>
    </DialogContent>
  );
}

function AssignmentFunctionField(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly functions: readonly AgentFunction[];
  readonly disabled: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <label htmlFor="agent-function" className="block text-sm font-medium">
        {t("settings.agents.assignments.function")}
      </label>
      <Select
        className="w-full"
        id="agent-function"
        ariaLabel={t("settings.agents.assignments.function")}
        value={props.value}
        onValueChange={props.onChange}
        disabled={props.disabled}
        options={[
          {
            value: "",
            label: t("settings.agents.assignments.chooseFunction"),
          },
          ...props.functions.map((entry) => ({
            value: entry,
            label: t(`settings.agents.assignments.functions.${entry}`),
          })),
        ]}
      />
    </div>
  );
}
