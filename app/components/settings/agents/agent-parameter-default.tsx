import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Select } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";

import type {
  AgentParameter,
  AgentTicketChoice,
} from "@/definition/AgentParameters";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";

interface TicketChoicesResponse {
  readonly tickets?: readonly AgentTicketChoice[];
  readonly error?: string;
}

function AgentNumberDefault(props: {
  readonly parameter: AgentParameter;
  readonly onChange: (parameter: AgentParameter) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { parameter } = props;
  const number =
    parameter.defaultValue?.type === "number"
      ? parameter.defaultValue.number
      : null;
  return (
    <label className="block space-y-1.5 text-sm font-medium">
      <span className="block">
        {t("settings.agents.definition.defaultValue")}
      </span>
      <InputNumberField
        number={number}
        onChange={(next) =>
          props.onChange({ ...parameter, defaultValue: next })
        }
      />
    </label>
  );
}

function InputNumberField(props: {
  readonly number: number | null;
  readonly onChange: (value: AgentParameter["defaultValue"]) => void;
}): React.ReactElement {
  return (
    <input
      className="flex h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-sm text-foreground shadow-xs outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary xl:h-9"
      type="number"
      step="any"
      value={
        props.number !== null && Number.isFinite(props.number)
          ? props.number
          : ""
      }
      onChange={(event) =>
        props.onChange(
          event.target.value === "" && !event.target.validity.badInput
            ? null
            : { type: "number", number: event.target.valueAsNumber },
        )
      }
    />
  );
}

function AgentTicketValue(props: {
  readonly ticketId: string;
  readonly disabled: boolean;
  readonly onChange: (ticketId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<TicketChoicesResponse>();
  const { load } = fetcher;
  useEffect(() => {
    void load("/agent-api/ticket-choices");
  }, [load]);
  const options = (fetcher.data?.tickets ?? []).map((ticket) => ({
    value: ticket.id,
    label: `${ticket.key}: ${ticket.title}`,
    disabled: false,
  }));
  if (
    props.ticketId &&
    !options.some((option) => option.value === props.ticketId)
  )
    options.push({
      value: props.ticketId,
      label: t("settings.agents.definition.unavailableTicket"),
      disabled: true,
    });
  return (
    <div className="space-y-1.5">
      <Select
        size="default"
        className="w-full"
        ariaLabel={t("settings.agents.definition.ticket")}
        value={props.ticketId}
        disabled={props.disabled || fetcher.state !== "idle"}
        options={[
          { value: "", label: t("settings.agents.definition.chooseTicket") },
          ...options,
        ]}
        onValueChange={props.onChange}
      />
      {fetcher.data?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {t("settings.agents.error.parameter_ticket_unavailable")}
        </p>
      ) : null}
    </div>
  );
}

function AgentWorkspaceDefault(props: {
  readonly parameter: AgentParameter;
  readonly onChange: (parameter: AgentParameter) => void;
  readonly disabled: boolean;
  readonly workspaceChoices: readonly AgentWorkspaceChoice[];
}): React.ReactElement {
  const { t } = useTranslation();
  const { parameter } = props;
  const workspaceId =
    parameter.defaultValue?.type === "workspace"
      ? parameter.defaultValue.workspaceId
      : "";
  const options = props.workspaceChoices.map((workspace) => ({
    value: workspace.id,
    label: `${workspace.name} · ${workspace.projectName}`,
    disabled: !workspace.isUsable,
    description: workspace.reason
      ? t(`settings.agents.error.${workspace.reason}`)
      : workspace.path,
  }));
  if (workspaceId && !options.some((option) => option.value === workspaceId))
    options.push({
      value: workspaceId,
      label: t("workspaces.unavailableDefault"),
      disabled: true,
      description: t("settings.agents.error.workspace_access_denied"),
    });
  return (
    <label className="block space-y-1.5 text-sm font-medium">
      <span className="block">
        {t("settings.agents.definition.defaultValue")}
      </span>
      <Select
        size="default"
        className="w-full"
        disabled={props.disabled}
        value={workspaceId}
        onValueChange={(id) =>
          props.onChange({
            ...parameter,
            defaultValue: id ? { type: "workspace", workspaceId: id } : null,
          })
        }
        options={[{ value: "", label: t("workspaces.noDefault") }, ...options]}
      />
    </label>
  );
}

function AgentTextDefault(props: {
  readonly parameter: AgentParameter;
  readonly onChange: (parameter: AgentParameter) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { parameter } = props;
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={parameter.defaultValue !== null}
          onChange={(event) =>
            props.onChange({
              ...parameter,
              defaultValue: event.target.checked
                ? { type: "text", text: "" }
                : null,
            })
          }
        />
        {t("settings.agents.definition.useDefault")}
      </label>
      {parameter.defaultValue?.type === "text" ? (
        <label className="block space-y-1.5 text-sm font-medium">
          <span className="block">
            {t("settings.agents.definition.defaultValue")}
          </span>
          <Textarea
            value={parameter.defaultValue.text}
            maxLength={200000}
            onChange={(event) =>
              props.onChange({
                ...parameter,
                defaultValue: { type: "text", text: event.target.value },
              })
            }
          />
        </label>
      ) : null}
    </div>
  );
}

/** Defaults retain workspace IDs; directory paths are resolved by the server at preparation. */
export function AgentParameterDefault(props: {
  readonly parameter: AgentParameter;
  readonly onChange: (parameter: AgentParameter) => void;
  readonly disabled: boolean;
  readonly workspaceChoices: readonly AgentWorkspaceChoice[];
}): React.ReactElement {
  const { t } = useTranslation();
  if (props.parameter.type === "text") return <AgentTextDefault {...props} />;
  if (props.parameter.type === "number")
    return <AgentNumberDefault {...props} />;
  if (props.parameter.type === "ticket")
    return (
      <AgentTicketValue
        ticketId={
          props.parameter.defaultValue?.type === "ticket"
            ? props.parameter.defaultValue.ticketId
            : ""
        }
        disabled={props.disabled}
        onChange={(ticketId) =>
          props.onChange({
            ...props.parameter,
            defaultValue: ticketId ? { type: "ticket", ticketId } : null,
          })
        }
      />
    );
  if (props.parameter.type === "workspace")
    return <AgentWorkspaceDefault {...props} />;
  return (
    <p className="text-xs text-muted-foreground">
      {t("settings.agents.definition.referenceLater")}
    </p>
  );
}
