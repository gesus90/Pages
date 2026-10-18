import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { cn } from "@/app/lib/cn";

import { usePlanFlowContext } from "../plan-flow-context";

import type {
  AgentParameterType,
  AgentParameterValue,
} from "@/definition/AgentParameters";

/**
 * A field of a card: no node drag, no pan and no React Flow key from it.
 *
 * @remarks
 * Sized for the 32 px rows that plan-layout.ts counts.
 */
export const PLAN_FIELD_CLASS =
  "nodrag nopan nokey h-8 min-h-8 w-full min-w-0 rounded-lg border border-border bg-surface px-2.5 text-xs shadow-none xl:h-8 xl:px-2.5 xl:text-xs";

interface PlanValueInputProps {
  readonly type: AgentParameterType;
  readonly value: AgentParameterValue | null;
  /** The accessible name of the field. */
  readonly label: string;
  /** Shown while the field is empty, such as the default that then applies. */
  readonly placeholder?: string;
  /** JSON text keeps a monospaced field. */
  readonly isJson?: boolean;
  /** Offers an empty choice in reference lists, which empties the value. */
  readonly isEmptyAllowed?: boolean;
  readonly hasIssue?: boolean;
  readonly disabled: boolean;
  readonly onChange: (value: AgentParameterValue) => void;
}

interface ChoiceOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

/** A controlled input that matches the type of a value: text, number, ticket, workspace or wiki page. */
export function PlanValueInput(props: PlanValueInputProps): React.ReactElement {
  if (props.type === "ticket") return <TicketValueInput {...props} />;
  if (props.type === "workspace") return <WorkspaceValueInput {...props} />;
  if (props.type === "number") return <NumberValueInput {...props} />;
  return <TextValueInput {...props} />;
}

function TextValueInput(props: PlanValueInputProps): React.ReactElement {
  const { value } = props;
  let text = "";
  if (value?.type === "text") text = value.text;
  if (value?.type === "wiki") text = value.pageId;
  return (
    <Input
      size="sm"
      aria-label={props.label}
      aria-invalid={props.hasIssue}
      title={text || undefined}
      placeholder={props.placeholder}
      value={text}
      maxLength={props.type === "wiki" ? 100 : 200000}
      disabled={props.disabled}
      className={cn(
        PLAN_FIELD_CLASS,
        props.isJson && "font-mono",
        props.hasIssue && "border-destructive",
      )}
      onChange={(event) =>
        props.onChange(
          props.type === "wiki"
            ? { type: "wiki", pageId: event.target.value }
            : { type: "text", text: event.target.value },
        )
      }
    />
  );
}

function NumberValueInput(props: PlanValueInputProps): React.ReactElement {
  const number =
    props.value?.type === "number" && Number.isFinite(props.value.number)
      ? props.value.number
      : "";
  return (
    <Input
      size="sm"
      type="number"
      step="any"
      aria-label={props.label}
      aria-invalid={props.hasIssue}
      placeholder={props.placeholder}
      value={number}
      disabled={props.disabled}
      className={cn(PLAN_FIELD_CLASS, props.hasIssue && "border-destructive")}
      onChange={(event) =>
        props.onChange({ type: "number", number: event.target.valueAsNumber })
      }
    />
  );
}

/** A list of references; a reference that is gone stays selected as unavailable, without its content. */
function ChoiceInput(
  props: PlanValueInputProps & {
    readonly selected: string;
    readonly options: readonly ChoiceOption[];
    readonly emptyLabel: string;
    readonly unavailableLabel: string;
    readonly onSelect: (id: string) => void;
  },
): React.ReactElement {
  const options = [...props.options];
  if (
    props.selected &&
    !options.some((option) => option.value === props.selected)
  )
    options.push({
      value: props.selected,
      label: props.unavailableLabel,
      disabled: true,
    });
  const choices =
    props.isEmptyAllowed || !props.selected
      ? [{ value: "", label: props.emptyLabel }, ...options]
      : options;
  return (
    <Select
      ariaLabel={props.label}
      value={props.selected}
      disabled={props.disabled}
      options={choices}
      className={cn(
        PLAN_FIELD_CLASS,
        "[&>span]:min-w-0 [&>span]:truncate",
        props.hasIssue && "border-destructive",
      )}
      onValueChange={props.onSelect}
    />
  );
}

function TicketValueInput(props: PlanValueInputProps): React.ReactElement {
  const { t } = useTranslation();
  const { sources } = usePlanFlowContext();
  return (
    <ChoiceInput
      {...props}
      selected={props.value?.type === "ticket" ? props.value.ticketId : ""}
      options={sources.tasks.map((task) => ({
        value: task.id,
        label: `${task.key}: ${task.title}`,
      }))}
      emptyLabel={props.placeholder ?? t("plans.chooseTicket")}
      unavailableLabel={t("plans.ticketUnavailable")}
      onSelect={(ticketId) => props.onChange({ type: "ticket", ticketId })}
    />
  );
}

function WorkspaceValueInput(props: PlanValueInputProps): React.ReactElement {
  const { t } = useTranslation();
  const { workspaces = [] } = usePlanFlowContext();
  return (
    <ChoiceInput
      {...props}
      selected={
        props.value?.type === "workspace" ? props.value.workspaceId : ""
      }
      options={workspaces.map((workspace) => ({
        value: workspace.id,
        label: workspace.name,
        disabled: !workspace.isUsable,
      }))}
      emptyLabel={props.placeholder ?? t("plans.chooseWorkspace")}
      unavailableLabel={t("plans.workspaceUnavailable")}
      onSelect={(workspaceId) =>
        props.onChange({ type: "workspace", workspaceId })
      }
    />
  );
}
