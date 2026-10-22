import { Plus, Trash2 } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { PLAN_SCRIPT_INPUT_COUNT } from "@/definition/AgentPlanScript";

import { PlanScriptFieldMessage } from "./plan-script-fields";

import type {
  PlanScriptForm,
  PlanScriptInputRow,
} from "./use-plan-script-form";

/** One declared input: its name, whether it is required, and its removal. */
function InputRow(props: {
  readonly form: PlanScriptForm;
  readonly row: PlanScriptInputRow;
  readonly index: number;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const { form, row } = props;
  const issue = form.isRowShown(row.key)
    ? (form.issues.rows.get(row.key) ?? null)
    : null;
  const label = t("plans.scripts.inputName", { index: props.index + 1 });
  return (
    <li className="space-y-1">
      <div className="flex items-center gap-2">
        <Input
          size="sm"
          value={row.name}
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
          aria-label={label}
          aria-invalid={issue !== null}
          aria-describedby={`${id}-message`}
          data-plan-script-input={props.index}
          className="min-w-0 flex-1 font-mono"
          onChange={(event) =>
            form.changeInput(row.key, { name: event.target.value })
          }
        />
        <label className="flex shrink-0 items-center gap-1.5 text-xs">
          <Checkbox
            checked={row.isRequired}
            onChange={(event) =>
              form.changeInput(row.key, { isRequired: event.target.checked })
            }
          />
          {t("plans.scripts.required")}
        </label>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("plans.scripts.removeInput", {
            name: row.name.trim() || String(props.index + 1),
          })}
          title={t("plans.scripts.removeInput", {
            name: row.name.trim() || String(props.index + 1),
          })}
          onClick={() => form.removeInput(row.key)}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <PlanScriptFieldMessage id={`${id}-message`} issue={issue} />
    </li>
  );
}

/**
 * The declared text inputs: each binds like an agent input to a parameter,
 * a ticket or an earlier node's result.
 */
export function PlanScriptInputsField(props: {
  readonly form: PlanScriptForm;
}): React.ReactElement {
  const { t } = useTranslation();
  const { form } = props;
  const isFull = form.values.inputs.length >= PLAN_SCRIPT_INPUT_COUNT;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">
        {t("plans.scripts.inputs")}
      </legend>
      <p className="text-xs text-muted-foreground">
        {t("plans.scripts.inputsHint")}
      </p>
      {form.values.inputs.length > 0 ? (
        <ul className="space-y-2">
          {form.values.inputs.map((row, index) => (
            <InputRow key={row.key} form={form} row={row} index={index} />
          ))}
        </ul>
      ) : null}
      <Button
        size="xs"
        variant="outline"
        disabled={isFull}
        title={
          isFull
            ? t("plans.scripts.inputLimit", { count: PLAN_SCRIPT_INPUT_COUNT })
            : undefined
        }
        onClick={form.addInput}
      >
        <Plus className="size-3.5" aria-hidden="true" />
        {t("plans.scripts.addInput")}
      </Button>
    </fieldset>
  );
}

/** The one declared text output, which the result port hands on. */
export function PlanScriptOutputField(props: {
  readonly form: PlanScriptForm;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const { form } = props;
  const issue = form.isShown("output") ? form.issues.output : null;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {t("plans.scripts.output")}
      </label>
      <Input
        id={id}
        size="sm"
        value={form.values.output}
        maxLength={64}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={issue !== null}
        aria-describedby={`${id}-message`}
        data-plan-script-field="output"
        className="font-mono"
        onChange={(event) => form.change({ output: event.target.value })}
      />
      <PlanScriptFieldMessage id={`${id}-message`} issue={issue} />
    </div>
  );
}
