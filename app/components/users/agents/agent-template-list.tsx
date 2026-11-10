import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";

import { Button } from "@/app/components/ui/button";
import { useCloseAfterAction } from "@/app/components/users/use-close-after-action";
import {
  useIsSubmitting,
  useUsersError,
} from "@/app/components/users/use-users-action";
import { cn } from "@/app/lib/cn";

import { AgentTemplateConfirm } from "./agent-template-confirm";
import { AgentTemplateEditor } from "./agent-template-editor";

import type { AgentTemplateDraft } from "./agent-template-editor";
import type {
  AgentInstructionTemplate,
  AgentInstructionTemplateList,
} from "@/definition/AgentInstructionTemplate";

interface AgentTemplateListProps {
  readonly templates: AgentInstructionTemplateList;
  /** The current text of `AGENT.md`. */
  readonly document: string;
  readonly onApply: (content: string) => void;
  readonly isDisabled: boolean;
}

interface TemplateEntryProps {
  readonly template: AgentInstructionTemplate;
  readonly isSelected: boolean;
  readonly canManage: boolean;
  readonly isDisabled: boolean;
  readonly onPick: () => void;
  readonly onEdit: () => void;
  readonly onDuplicate: () => void;
  readonly onRemove: () => void;
}

const BADGE_CLASS_NAME =
  "rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground";

/** One template: a click fills `AGENT.md`; the actions change the template. */
function TemplateEntry({
  template,
  isSelected,
  canManage,
  isDisabled,
  onPick,
  onEdit,
  onDuplicate,
  onRemove,
}: TemplateEntryProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2",
        isSelected ? "border-primary bg-primary/5" : "border-border",
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-lg py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed"
        disabled={isDisabled}
        aria-pressed={isSelected}
        onClick={onPick}
      >
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {template.name}
          {template.isDefault ? (
            <span className={BADGE_CLASS_NAME}>
              {t("agentEmployees.templateList.default")}
            </span>
          ) : null}
          {isSelected ? (
            <span className="rounded-md bg-primary px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground">
              {t("agentEmployees.templateList.selected")}
            </span>
          ) : null}
        </span>
        {template.description ? (
          <span className="text-xs text-muted-foreground">
            {template.description}
          </span>
        ) : null}
      </button>
      {canManage ? (
        <div
          className="flex shrink-0 gap-1"
          role="group"
          aria-label={t("agentEmployees.templateList.actions", {
            name: template.name,
          })}
        >
          <Button variant="ghost" size="xs" onClick={onEdit}>
            {t("agentEmployees.templateList.edit")}
          </Button>
          <Button variant="ghost" size="xs" onClick={onDuplicate}>
            {t("agentEmployees.templateList.duplicate")}
          </Button>
          <Button variant="ghost" size="xs" onClick={onRemove}>
            {t("agentEmployees.templateList.remove")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** Asks before a template is deleted for the whole instance. */
function RemoveTemplateConfirm({
  template,
  onClose,
}: {
  readonly template: AgentInstructionTemplate;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  const isPending = useIsSubmitting("delete-agent-template");
  const error = useUsersError("delete-agent-template");
  useCloseAfterAction("delete-agent-template", onClose);
  function remove(): void {
    const formData = new FormData();
    formData.set("intent", "delete-agent-template");
    formData.set("templateId", template.id);
    void submit(formData, { method: "post" });
  }
  return (
    <AgentTemplateConfirm
      title={t("agentEmployees.templateList.removeConfirm.title")}
      description={t("agentEmployees.templateList.removeConfirm.description", {
        name: template.name,
      })}
      confirmLabel={t("agentEmployees.templateList.removeConfirm.confirm")}
      isDestructive
      isPending={isPending}
      error={error}
      onConfirm={remove}
      onCancel={onClose}
    />
  );
}

/** Title and the buttons "Als Vorlage speichern" and "Neue Vorlage". */
function TemplateListHeader({
  canManage,
  document,
  onCreate,
}: {
  readonly canManage: boolean;
  readonly document: string;
  /** Opens the editor of a new template with the given content. */
  readonly onCreate: (content: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">
        {t("agentEmployees.templateList.title")}
      </h3>
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="xs"
            disabled={document.trim() === ""}
            onClick={() => onCreate(document)}
          >
            {t("agentEmployees.templateList.saveFromDocument")}
          </Button>
          <Button variant="outline" size="xs" onClick={() => onCreate("")}>
            {t("agentEmployees.templateList.create")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The state of the list: the picked entry and the open dialogs. */
function useTemplateListState(props: AgentTemplateListProps): {
  readonly selectedId: string | null;
  readonly editing: AgentTemplateDraft | null;
  readonly setEditing: (draft: AgentTemplateDraft | null) => void;
  readonly replacing: AgentInstructionTemplate | null;
  readonly setReplacing: (template: AgentInstructionTemplate | null) => void;
  readonly removing: AgentInstructionTemplate | null;
  readonly setRemoving: (template: AgentInstructionTemplate | null) => void;
  readonly pick: (template: AgentInstructionTemplate) => void;
  readonly apply: (template: AgentInstructionTemplate) => void;
} {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AgentTemplateDraft | null>(null);
  const [replacing, setReplacing] = useState<AgentInstructionTemplate | null>(
    null,
  );
  const [removing, setRemoving] = useState<AgentInstructionTemplate | null>(
    null,
  );
  function apply(template: AgentInstructionTemplate): void {
    props.onApply(template.content);
    setSelectedId(template.id);
    setReplacing(null);
  }
  function pick(template: AgentInstructionTemplate): void {
    // Text in AGENT.md is never replaced without the person's consent.
    if (props.document.trim() === "") apply(template);
    else setReplacing(template);
  }
  return {
    selectedId,
    editing,
    setEditing,
    replacing,
    setReplacing,
    removing,
    setRemoving,
    pick,
    apply,
  };
}

/**
 * The templates of the tab "Aufgabe" (PAGE-283): picking one fills
 * `AGENT.md` once, asking first when the field already holds text. Whoever
 * may manage agents creates, changes, duplicates and deletes templates; a
 * change of a template changes no agent.
 */
export function AgentTemplateList(
  props: AgentTemplateListProps,
): React.ReactElement {
  const { t } = useTranslation();
  const state = useTemplateListState(props);
  const { templates, canManage } = props.templates;
  return (
    <section className="flex flex-col gap-3">
      <TemplateListHeader
        canManage={canManage}
        document={props.document}
        onCreate={(content) =>
          state.setEditing({ id: null, name: "", description: "", content })
        }
      />
      <p className="text-sm text-muted-foreground">
        {t("agentEmployees.templateList.description")}
      </p>
      {templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("agentEmployees.templateList.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {templates.map((template) => (
            <TemplateEntry
              key={template.id}
              template={template}
              isSelected={state.selectedId === template.id}
              canManage={canManage}
              isDisabled={props.isDisabled}
              onPick={() => state.pick(template)}
              onEdit={() => state.setEditing(template)}
              onDuplicate={() =>
                state.setEditing({
                  id: null,
                  name: t("agentEmployees.templateList.copyName", {
                    name: template.name,
                  }),
                  description: template.description,
                  content: template.content,
                })
              }
              onRemove={() => state.setRemoving(template)}
            />
          ))}
        </ul>
      )}
      {state.editing ? (
        <AgentTemplateEditor
          draft={state.editing}
          onClose={() => state.setEditing(null)}
        />
      ) : null}
      {state.removing ? (
        <RemoveTemplateConfirm
          template={state.removing}
          onClose={() => state.setRemoving(null)}
        />
      ) : null}
      {state.replacing ? (
        <AgentTemplateConfirm
          title={t("agentEmployees.templateList.replaceConfirm.title")}
          description={t(
            "agentEmployees.templateList.replaceConfirm.description",
            { name: state.replacing.name },
          )}
          confirmLabel={t("agentEmployees.templateList.replaceConfirm.confirm")}
          isDestructive={false}
          onConfirm={() => {
            if (state.replacing) state.apply(state.replacing);
          }}
          onCancel={() => state.setReplacing(null)}
        />
      ) : null}
    </section>
  );
}
