import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { isAgentParameterName } from "@/definition/AgentParameters";
import { PLAN_JUMP_VALUE_COUNT } from "@/definition/AgentPlanJump";

import type {
  AgentParameterType,
  AgentParameterValue,
} from "@/definition/AgentParameters";
import type {
  AgentPlanEntryInput,
  AgentPlanEntryValue,
} from "@/definition/AgentPlanJump";

/** The types a declared value may have, in the order of the type choice. */
export const PLAN_ENTRY_VALUE_TYPES: readonly AgentParameterType[] = [
  "text",
  "number",
  "ticket",
  "workspace",
  "wiki",
  "asset",
];

/** The kinds of list the editor serves: the accepted inputs of an entry, or the returns of an end. */
type PlanEntryValueKind = "inputs" | "returns";

/** The types whose default value is typed into the dialog. */
function hasTypedDefault(type: AgentParameterType): boolean {
  return type === "text" || type === "number";
}

/** The first free name `value1`, `value2`, … of a list. */
function freeName(names: readonly string[]): string {
  for (let index = 1; ; index += 1) {
    const name = `value${index}`;
    if (!names.includes(name)) return name;
  }
}

/** Why a name of a declared value cannot be used, as a translation key, or `null`. */
function nameProblem(
  name: string,
  names: readonly string[],
): "plans.entry.nameInvalid" | "plans.entry.nameDuplicate" | null {
  if (!isAgentParameterName(name)) return "plans.entry.nameInvalid";
  return names.filter((entry) => entry === name).length > 1
    ? "plans.entry.nameDuplicate"
    : null;
}

/** The default value of an input as the text field shows it. */
function defaultText(value: AgentParameterValue | null): string {
  if (value?.type === "text") return value.text;
  return value?.type === "number" ? String(value.number) : "";
}

/** The typed default value a text field stands for; an empty or unreadable field means none. */
function defaultValueOf(
  type: AgentParameterType,
  text: string,
): AgentParameterValue | null {
  if (text === "") return null;
  if (type === "text") return { type: "text", text };
  const number = Number(text);
  return type === "number" && Number.isFinite(number)
    ? { type: "number", number }
    : null;
}

interface ValueRowProps {
  readonly kind: PlanEntryValueKind;
  readonly index: number;
  readonly entry: AgentPlanEntryInput;
  readonly names: readonly string[];
  readonly isDisabled: boolean;
  readonly onChange: (entry: AgentPlanEntryInput) => void;
  readonly onRemove: () => void;
}

/** The default value field of an input of a type whose value can be typed. */
function DefaultField(props: ValueRowProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { entry } = props;
  if (props.kind !== "inputs" || !hasTypedDefault(entry.type)) return null;
  return (
    <Input
      size="sm"
      type={entry.type === "number" ? "number" : "text"}
      step={entry.type === "number" ? "any" : undefined}
      value={defaultText(entry.defaultValue)}
      disabled={props.isDisabled}
      placeholder={t("plans.entry.defaultValue")}
      aria-label={t("plans.entry.defaultOf", { index: props.index + 1 })}
      className="min-w-0 flex-1"
      onChange={(event) =>
        props.onChange({
          ...entry,
          defaultValue: defaultValueOf(entry.type, event.target.value),
        })
      }
    />
  );
}

/** One declared value: its name, its type, whether it is required, a default and its removal. */
function ValueRow(props: ValueRowProps): React.ReactElement {
  const { t } = useTranslation();
  const { entry, index } = props;
  const problem = nameProblem(entry.name, props.names);
  return (
    <li className="space-y-1" data-plan-entry-value={index}>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          size="sm"
          value={entry.name}
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
          disabled={props.isDisabled}
          aria-invalid={problem !== null}
          aria-label={t(`plans.entry.${props.kind}Name`, { index: index + 1 })}
          className="min-w-0 flex-1 font-mono"
          onChange={(event) =>
            props.onChange({ ...entry, name: event.target.value })
          }
        />
        <Select<AgentParameterType>
          value={entry.type}
          disabled={props.isDisabled}
          ariaLabel={t("plans.entry.typeOf", { index: index + 1 })}
          className="w-32"
          options={PLAN_ENTRY_VALUE_TYPES.map((type) => ({
            value: type,
            label: t(`plans.entry.type.${type}`),
          }))}
          onValueChange={(type) =>
            props.onChange({
              ...entry,
              type,
              defaultValue: hasTypedDefault(type) ? entry.defaultValue : null,
            })
          }
        />
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={props.isDisabled}
          aria-label={t("plans.entry.remove", { index: index + 1 })}
          title={t("plans.entry.remove", { index: index + 1 })}
          onClick={props.onRemove}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      </div>
      {props.kind === "inputs" ? (
        <div className="flex items-center gap-3">
          <label className="flex shrink-0 items-center gap-1.5 text-xs">
            <Checkbox
              checked={entry.isRequired}
              disabled={props.isDisabled}
              onChange={(event) =>
                props.onChange({ ...entry, isRequired: event.target.checked })
              }
            />
            {t("plans.entry.required")}
          </label>
          <DefaultField {...props} />
        </div>
      ) : null}
      {problem ? (
        <p role="alert" className="text-xs text-destructive">
          {t(problem)}
        </p>
      ) : null}
    </li>
  );
}

interface PlanEntryValuesProps<Entry extends AgentPlanEntryValue> {
  readonly entries: readonly Entry[];
  readonly isDisabled: boolean;
  readonly onChange: (entries: readonly Entry[]) => void;
}

/** One list of declared values; a return is an input without the required flag and the default. */
function EntryList(
  props: PlanEntryValuesProps<AgentPlanEntryInput> & {
    readonly kind: PlanEntryValueKind;
  },
): React.ReactElement {
  const { t } = useTranslation();
  const { entries, kind } = props;
  const names = entries.map((entry) => entry.name);
  const isFull = entries.length >= PLAN_JUMP_VALUE_COUNT;
  function replace(index: number, entry: AgentPlanEntryInput): void {
    props.onChange(
      entries.map((current, at) => (at === index ? entry : current)),
    );
  }
  function add(): void {
    props.onChange([
      ...entries,
      {
        name: freeName(names),
        type: "text",
        isRequired: false,
        defaultValue: null,
      },
    ]);
  }
  return (
    <fieldset className="space-y-2" data-plan-entry-values={kind}>
      <legend className="text-sm font-medium">
        {t(`plans.entry.${kind}`)}
      </legend>
      <p className="text-xs text-muted-foreground">
        {t(`plans.entry.${kind}Hint`)}
      </p>
      {entries.length > 0 ? (
        <ul className="space-y-2">
          {/* A name is edited in its own row, so the rows are told apart by their place. */}
          {entries.map((entry, index) => (
            <ValueRow
              key={index}
              kind={kind}
              index={index}
              entry={entry}
              names={names}
              isDisabled={props.isDisabled}
              onChange={(next) => replace(index, next)}
              onRemove={() =>
                props.onChange(entries.filter((_, at) => at !== index))
              }
            />
          ))}
        </ul>
      ) : null}
      <Button
        size="xs"
        variant="outline"
        disabled={props.isDisabled || isFull}
        title={
          isFull
            ? t("plans.entry.limit", { count: PLAN_JUMP_VALUE_COUNT })
            : undefined
        }
        onClick={add}
      >
        <Plus className="size-3.5" aria-hidden="true" />
        {t(`plans.entry.add.${kind}`)}
      </Button>
    </fieldset>
  );
}

/** The accepted inputs of an entry: name, type, required flag and a default for text and numbers. */
export function PlanEntryInputsEditor(
  props: PlanEntryValuesProps<AgentPlanEntryInput>,
): React.ReactElement {
  return <EntryList {...props} kind="inputs" />;
}

/** The returns of an end: name and type of each returned value. */
export function PlanEntryReturnsEditor(
  props: PlanEntryValuesProps<AgentPlanEntryValue>,
): React.ReactElement {
  return (
    <EntryList
      kind="returns"
      isDisabled={props.isDisabled}
      entries={props.entries.map((entry) => ({
        ...entry,
        isRequired: false,
        defaultValue: null,
      }))}
      onChange={(entries) =>
        props.onChange(
          entries.map((entry) => ({ name: entry.name, type: entry.type })),
        )
      }
    />
  );
}
