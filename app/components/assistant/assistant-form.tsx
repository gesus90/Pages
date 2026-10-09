import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";

import type {
  TextAssistantAction,
  TextAssistantChange,
  TextAssistantScope,
} from "@/definition/TextAssistant";

/** Explicit action, context and write intent; opening the form performs no generation. */
export interface AssistantFormState {
  readonly action: TextAssistantAction;
  readonly scope: TextAssistantScope;
  readonly change: TextAssistantChange;
  readonly instruction: string;
  readonly targetLanguage: string;
  readonly autoApply: boolean;
}

interface AssistantFieldsProps {
  readonly state: AssistantFormState;
  readonly isRunning: boolean;
  readonly canWrite: boolean;
  readonly onChange: (
    state: AssistantFormState,
    savePreferences?: boolean,
  ) => void;
}

const ACTIONS: readonly TextAssistantAction[] = [
  "chat",
  "translate",
  "proofread",
  "generate",
  "summarize",
  "explain",
  "instruct",
];
const SCOPES: readonly TextAssistantScope[] = ["none", "selection", "document"];

function defaultChange(action: TextAssistantAction): TextAssistantChange {
  if (["chat", "explain", "summarize"].includes(action)) return "answer";
  return action === "generate" ? "insert" : "replace";
}

function AssistantActionFields({
  state,
  isRunning,
  canWrite,
  onChange,
}: AssistantFieldsProps): React.ReactElement {
  const { t } = useTranslation();
  function chooseAction(action: TextAssistantAction): void {
    onChange({ ...state, action, change: defaultChange(action) });
  }
  function chooseScope(scope: TextAssistantScope): void {
    onChange({ ...state, scope });
  }
  function chooseChange(change: TextAssistantChange): void {
    onChange({ ...state, change });
  }
  return (
    <>
      <label className="block text-sm" htmlFor="assistant-action">
        {t("assistant.action")}
      </label>
      <Select
        id="assistant-action"
        value={state.action}
        disabled={isRunning}
        onValueChange={chooseAction}
        ariaLabel={t("assistant.action")}
        options={ACTIONS.filter(
          (entry) =>
            canWrite || ["chat", "explain", "summarize"].includes(entry),
        ).map((entry) => ({
          value: entry,
          label: t(`assistant.actions.${entry}`),
        }))}
      />
      <label className="block text-sm" htmlFor="assistant-scope">
        {t("assistant.context")}
      </label>
      <Select
        id="assistant-scope"
        value={state.scope}
        disabled={isRunning}
        onValueChange={chooseScope}
        ariaLabel={t("assistant.context")}
        options={SCOPES.map((entry) => ({
          value: entry,
          label: t(`assistant.scope.${entry}`),
        }))}
      />
      <p className="text-xs text-muted-foreground">
        {t("assistant.contextHint")}
      </p>
      {state.action === "chat" && canWrite ? (
        <>
          <label className="block text-sm" htmlFor="assistant-change">
            {t("assistant.writeIntent")}
          </label>
          <Select
            id="assistant-change"
            value={state.change}
            disabled={isRunning}
            onValueChange={chooseChange}
            ariaLabel={t("assistant.writeIntent")}
            options={(["answer", "replace", "insert"] as const).map(
              (entry) => ({
                value: entry,
                label: t(`assistant.change.${entry}`),
              }),
            )}
          />
        </>
      ) : null}
    </>
  );
}

function AssistantInstructionFields({
  state,
  isRunning,
  canWrite,
  onChange,
}: AssistantFieldsProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      {state.action === "translate" ? (
        <>
          <label className="block text-sm" htmlFor="assistant-language">
            {t("assistant.targetLanguage")}
          </label>
          <Input
            id="assistant-language"
            value={state.targetLanguage}
            disabled={isRunning}
            required
            maxLength={35}
            onChange={(event) =>
              onChange({ ...state, targetLanguage: event.target.value })
            }
            onBlur={() => onChange(state, true)}
          />
        </>
      ) : null}
      <label className="block text-sm" htmlFor="assistant-instruction">
        {t("assistant.instruction")}
      </label>
      <textarea
        id="assistant-instruction"
        className="min-h-24 w-full rounded-lg border border-border bg-background p-2 text-sm"
        value={state.instruction}
        disabled={isRunning}
        maxLength={5000}
        onChange={(event) =>
          onChange({ ...state, instruction: event.target.value })
        }
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={state.autoApply}
          disabled={isRunning || !canWrite}
          onChange={(event) =>
            onChange({ ...state, autoApply: event.target.checked }, true)
          }
        />
        {t("assistant.autoApply")}
      </label>
    </>
  );
}

/** Shared controls for wiki pages and ticket descriptions. */
export function AssistantForm(
  props: AssistantFieldsProps & {
    readonly canSend: boolean;
    readonly onSend: () => void;
    readonly onCancel: () => void;
  },
): React.ReactElement {
  const { t } = useTranslation();

  function handleCancel(event: React.MouseEvent<HTMLButtonElement>): void {
    // Cancelling can immediately turn this same button into a submit button.
    event.preventDefault();
    props.onCancel();
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSend();
      }}
    >
      <AssistantActionFields {...props} />
      <AssistantInstructionFields {...props} />
      {!props.canSend ? (
        <p className="text-xs text-muted-foreground">
          {t("assistant.waitForSave")}
        </p>
      ) : null}
      <div className="flex gap-2">
        {props.isRunning ? (
          <Button type="button" variant="outline" onClick={handleCancel}>
            {t("assistant.cancel")}
          </Button>
        ) : (
          <Button
            type="submit"
            disabled={
              !props.canSend ||
              (props.state.change !== "answer" && !props.canWrite)
            }
          >
            {t("assistant.send")}
          </Button>
        )}
      </div>
    </form>
  );
}
