import { ArrowLeft } from "lucide-react";
import { useId } from "react";

import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { cn } from "@/app/lib/cn";

import { ActionFields } from "./automation-action-fields";
import { automationDescription } from "./automation-description";
import { draftFromAutomation } from "./automation-draft";
import { AutomationFailureMessage } from "./automation-failure";
import { FormField } from "./automation-form-controls";
import { RunsList } from "./automation-runs-list";
import { SharingFields } from "./automation-sharing-fields";
import { TriggerFields } from "./automation-trigger-fields";

import type { Automation } from "@/definition/Automation";
import type { AutomationDraft } from "./automation-draft";
import type { SectionProps } from "./automation-section-props";
import type { AutomationsPageState } from "./use-automations-page";

interface PanelProps {
  readonly page: AutomationsPageState;
}

/** The title of the panel with the way back to the table on narrow screens. */
function PanelHeader({
  page,
  automation,
}: PanelProps & {
  readonly automation: Automation | undefined;
}): React.ReactElement {
  const { t } = page.context;
  const { mode } = page.editor;
  const title =
    mode === "create"
      ? t("automations.panel.createTitle")
      : (automation?.name ?? "");
  return (
    <header className="flex flex-col gap-1">
      <Button
        className="-ml-2 self-start lg:hidden"
        onClick={page.closeDetail}
        size="xs"
        variant="ghost"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        {t("automations.panel.back")}
      </Button>
      <h2 className="text-lg font-semibold text-foreground">
        {mode === "edit"
          ? t("automations.panel.editTitle", { name: title })
          : title}
      </h2>
      {mode === "view" && automation ? (
        <p className="text-sm text-muted-foreground">
          {automationDescription(automation, page.context)}
        </p>
      ) : null}
    </header>
  );
}

/** Name and "Aktiv" of the editor. */
function NameFields({
  draft,
  change,
  options,
  context,
}: SectionProps): React.ReactElement {
  const { t } = context;
  const nameId = useId();
  const activeId = useId();
  return (
    <>
      <FormField label={t("automations.fields.name")} htmlFor={nameId}>
        <Input
          id={nameId}
          maxLength={options.limits.nameLength}
          value={draft.name}
          onChange={(event) => change({ name: event.currentTarget.value })}
        />
      </FormField>
      <div className="flex items-center gap-2.5">
        <Checkbox
          checked={draft.isActive}
          id={activeId}
          onChange={(event) =>
            change({ isActive: event.currentTarget.checked })
          }
        />
        <label className="text-sm" htmlFor={activeId}>
          {t("automations.fields.active")}
        </label>
      </div>
    </>
  );
}

/** "Jetzt ausführen", "Bearbeiten", "Löschen" or "Speichern", "Abbrechen". */
function PanelButtons({
  page,
  automation,
}: PanelProps & {
  readonly automation: Automation | undefined;
}): React.ReactElement | null {
  const { t } = page.context;
  const { editor, actions } = page;
  if (editor.mode !== "view")
    return (
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={editor.close} variant="ghost">
          {t("automations.panel.cancel")}
        </Button>
        <Button
          isPending={
            actions.busyIntent === "create" || actions.busyIntent === "update"
          }
          onClick={() => editor.save(automation)}
        >
          {t("automations.panel.save")}
        </Button>
      </div>
    );
  if (!automation) return null;
  const { permissions } = automation;
  return (
    <div className="flex flex-wrap gap-2">
      {permissions.canRun ? (
        <Button
          isPending={actions.busyIntent === "run"}
          onClick={() => page.runNow(automation)}
          size="sm"
        >
          {t("automations.panel.runNow")}
        </Button>
      ) : null}
      {permissions.canEdit ? (
        <Button
          onClick={() => editor.startEdit(automation)}
          size="sm"
          variant="outline"
        >
          {t("automations.panel.edit")}
        </Button>
      ) : null}
      {permissions.canDelete ? (
        <Button
          onClick={() => page.askDelete(automation)}
          size="sm"
          variant="destructive-soft"
        >
          {t("automations.panel.delete")}
        </Button>
      ) : null}
    </div>
  );
}

/** The failure of the last change and the field the editor cannot use. */
function PanelMessages({ page }: PanelProps): React.ReactElement | null {
  const { t } = page.context;
  const { failure } = page.actions;
  const { problem } = page.editor;
  const shownFailure = failure && failure.intent !== "delete" ? failure : null;
  const shownProblem = problem && problem !== "time" ? problem : null;
  if (!shownFailure && !shownProblem) return null;
  return (
    <div className="flex flex-col gap-2">
      {shownProblem ? (
        <p
          className="rounded-xl bg-destructive-subtle px-3 py-2.5 text-sm text-destructive"
          role="alert"
        >
          {t(`automations.problems.${shownProblem}`)}
        </p>
      ) : null}
      {shownFailure ? (
        <AutomationFailureMessage failure={shownFailure} />
      ) : null}
    </div>
  );
}

function panelDraft(
  page: AutomationsPageState,
  automation: Automation | undefined,
): AutomationDraft | null {
  if (page.editor.draft) return page.editor.draft;
  if (!automation) return null;
  return draftFromAutomation(
    automation,
    page.pageData.options,
    page.context.now,
  );
}

/**
 * The panel of the selected automation: its description and fields, read
 * only or as the editor, its buttons and its last runs.
 */
export function AutomationPanel({ page }: PanelProps): React.ReactElement {
  const { t } = page.context;
  const { editor, selection } = page;
  const automation = editor.mode === "create" ? undefined : selection.shown;
  const draft = panelDraft(page, automation);
  const isReadOnly = editor.mode === "view";
  return (
    <aside
      aria-label={t("automations.panel.label")}
      className={cn(
        "min-h-0 flex-1 flex-col rounded-2xl bg-surface shadow-card lg:flex lg:w-[26rem] lg:flex-none",
        page.isDetailOpen ? "flex" : "hidden",
      )}
    >
      <VerticalScrollArea
        className="min-h-0 flex-1"
        contentClassName="gap-4 p-5"
      >
        <PanelHeader page={page} automation={automation} />
        {draft ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!isReadOnly) editor.save(automation);
            }}
          >
            <PanelSections page={page} draft={draft} isReadOnly={isReadOnly} />
            <PanelMessages page={page} />
            <PanelButtons page={page} automation={automation} />
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("automations.panel.empty")}
          </p>
        )}
        {automation && isReadOnly ? (
          <RunsList
            automation={automation}
            history={page.pageData.history}
            context={page.context}
            onOpen={selection.setOpenRun}
          />
        ) : null}
      </VerticalScrollArea>
    </aside>
  );
}

/** The field sections of the panel. */
function PanelSections({
  page,
  draft,
  isReadOnly,
}: PanelProps & {
  readonly draft: AutomationDraft;
  readonly isReadOnly: boolean;
}): React.ReactElement {
  const props: SectionProps = {
    draft,
    change: page.editor.change,
    isReadOnly,
    options: page.pageData.options,
    context: page.context,
  };
  return (
    <>
      {isReadOnly ? null : <NameFields {...props} />}
      <TriggerFields {...props} timeAlert={page.editor.timeAlert} />
      <ActionFields {...props} />
      <SharingFields {...props} />
    </>
  );
}
