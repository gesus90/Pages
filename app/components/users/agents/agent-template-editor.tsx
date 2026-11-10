import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";

import { Button } from "@/app/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { FormError } from "@/app/components/users/form-error";
import { useCloseAfterAction } from "@/app/components/users/use-close-after-action";
import {
  useIsSubmitting,
  useUsersError,
} from "@/app/components/users/use-users-action";
import { AGENT_DOCUMENT_LIMITS } from "@/definition/AgentEmployee";
import { AGENT_TEMPLATE_LIMITS } from "@/definition/AgentInstructionTemplate";

import type { AgentInstructionTemplateInput } from "@/definition/AgentInstructionTemplate";

const LABEL_CLASS_NAME = "text-sm font-medium text-foreground";

/** What the editor opens with: a stored template to change, or the fields of a new one. */
export interface AgentTemplateDraft extends AgentInstructionTemplateInput {
  /** The template to change; `null` stores a new one. */
  readonly id: string | null;
}

interface AgentTemplateEditorProps {
  readonly draft: AgentTemplateDraft;
  readonly onClose: () => void;
}

/** One labelled single-line field of the editor. */
function EditorField({
  label,
  value,
  maximum,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly maximum: number;
  readonly onChange: (value: string) => void;
}): React.ReactElement {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label className={LABEL_CLASS_NAME} htmlFor={id}>
        {label}
      </label>
      <Input
        id={id}
        value={value}
        maxLength={maximum}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}

/**
 * Creates or changes a template of `AGENT.md` (PAGE-283): name, short
 * description and content. The server checks the right to manage agents,
 * a unique name and the limits again.
 */
export function AgentTemplateEditor({
  draft,
  onClose,
}: AgentTemplateEditorProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  const contentId = useId();
  const [fields, setFields] = useState<AgentInstructionTemplateInput>({
    name: draft.name,
    description: draft.description,
    content: draft.content,
  });
  const isPending = useIsSubmitting("save-agent-template");
  const error = useUsersError("save-agent-template");
  useCloseAfterAction("save-agent-template", onClose);
  const length = Array.from(fields.content).length;
  const isValid =
    fields.name.trim() !== "" &&
    length <= AGENT_DOCUMENT_LIMITS.instructionsCharacters;

  function change(
    key: keyof AgentInstructionTemplateInput,
    value: string,
  ): void {
    setFields((current) => ({ ...current, [key]: value }));
  }

  function save(event: React.FormEvent): void {
    event.preventDefault();
    if (!isValid) return;
    const formData = new FormData();
    formData.set("intent", "save-agent-template");
    formData.set("templateId", draft.id ?? "");
    formData.set("template", JSON.stringify(fields));
    void submit(formData, { method: "post" });
  }

  function handleOpenChange(isOpen: boolean): void {
    if (!isOpen) onClose();
  }

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent size="lg">
        <DialogTitle className="text-lg font-semibold">
          {draft.id === null
            ? t("agentEmployees.templateList.editor.createTitle")
            : t("agentEmployees.templateList.editor.editTitle")}
        </DialogTitle>
        <form className="mt-5 flex flex-col gap-4" onSubmit={save}>
          <EditorField
            label={t("agentEmployees.templateList.editor.name")}
            value={fields.name}
            maximum={AGENT_TEMPLATE_LIMITS.nameCharacters}
            onChange={(value) => change("name", value)}
          />
          <EditorField
            label={t("agentEmployees.templateList.editor.description")}
            value={fields.description}
            maximum={AGENT_TEMPLATE_LIMITS.descriptionCharacters}
            onChange={(value) => change("description", value)}
          />
          <div className="flex flex-col gap-1.5">
            <label className={LABEL_CLASS_NAME} htmlFor={contentId}>
              {t("agentEmployees.templateList.editor.content")}
            </label>
            <Textarea
              id={contentId}
              className="min-h-64 font-mono text-[13px] leading-relaxed"
              value={fields.content}
              spellCheck={false}
              onChange={(event) => change("content", event.currentTarget.value)}
            />
            <span
              className={
                length > AGENT_DOCUMENT_LIMITS.instructionsCharacters
                  ? "text-xs tabular-nums text-destructive"
                  : "text-xs tabular-nums text-muted-foreground"
              }
            >
              {t("agentEmployees.documents.length", {
                count: length,
                length,
                maximum: AGENT_DOCUMENT_LIMITS.instructionsCharacters,
              })}
            </span>
          </div>
          <FormError error={error} />
          <footer className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("agentEmployees.templateList.editor.cancel")}
            </Button>
            <Button type="submit" isPending={isPending} disabled={!isValid}>
              {t("agentEmployees.templateList.editor.save")}
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
